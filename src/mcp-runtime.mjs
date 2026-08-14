import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { decryptApiKey, encryptApiKey } from './llm-providers.mjs';

const MAX_MCP_SERVERS = 5;
const MAX_MCP_TOOLS = 100;
const MAX_SCHEMA_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_LIST_PAGES = 5;
const validatorProvider = new AjvJsonSchemaValidator();

const clean = (value, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const loopback = (hostname) => ['localhost', '127.0.0.1', '::1'].includes(String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase());

function allowedHosts() {
  return new Set(String(process.env.NOVI_MCP_ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function validateMcpEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(String(value || '')); } catch { throw new Error('MCP endpoint must be a valid URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('MCP endpoint must be an HTTP(S) URL without credentials, query parameters, or fragments');
  const local = loopback(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local && process.env.NODE_ENV !== 'production')) throw new Error('MCP endpoints must use HTTPS; loopback HTTP is allowed only in development');
  if (!local && !allowedHosts().has(endpoint.hostname.toLowerCase())) throw new Error('MCP hostname is not listed in NOVI_MCP_ALLOWED_HOSTS');
  return endpoint.toString();
}

function normalizeMcpSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'object') throw new Error('MCP tool input schema must be an object schema');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SCHEMA_BYTES) throw new Error('MCP tool input schema exceeds 16 KB');
  const parsed = JSON.parse(serialized);
  let nodes = 0;
  const visit = (node, depth = 0) => {
    if (++nodes > 300 || depth > 12) throw new Error('MCP tool input schema is too complex');
    if (!node || typeof node !== 'object') return;
    if (Object.hasOwn(node, '$ref')) throw new Error('MCP tool input schema cannot use $ref');
    for (const [key, child] of Object.entries(node)) {
      if (['__proto__', 'prototype'].includes(key)) throw new Error('MCP tool input schema contains an unsafe key');
      if (typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(parsed);
  return parsed;
}

function aliasFor(server, remoteName) {
  const serverPart = clean(server.name, 24).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'server';
  const toolPart = clean(remoteName, 48).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'tool';
  const hash = createHash('sha256').update(`${server.id}:${remoteName}`).digest('hex').slice(0, 8);
  return `mcp__${serverPart}__${toolPart}_${hash}`.slice(0, 110);
}

function publicServer(server) {
  const { encryptedBearerToken: _encryptedBearerToken, ...safe } = server;
  return { ...safe, hasBearerToken: Boolean(server.encryptedBearerToken), bearerTokenLast4: server.bearerTokenLast4 || null };
}

export function publicMcpSettings(state, tenantId) {
  return { servers: (state.mcpServerConfigs || []).filter((server) => server.tenantId === tenantId).map(publicServer) };
}

export async function saveMcpSettings(state, tenantId, userId, input = {}) {
  state.mcpServerConfigs ||= [];
  if (!Array.isArray(input.servers)) throw new Error('servers must be an array');
  if (input.servers.length > MAX_MCP_SERVERS) throw new Error(`At most ${MAX_MCP_SERVERS} MCP servers are allowed`);
  const existingForTenant = state.mcpServerConfigs.filter((server) => server.tenantId === tenantId);
  const existingById = new Map(existingForTenant.map((server) => [server.id, server]));
  const ids = new Set(); const names = new Set(); const endpoints = new Set(); const now = new Date().toISOString(); const servers = [];
  for (const candidate of input.servers) {
    const existing = existingById.get(clean(candidate.id, 100)); const id = existing?.id || randomUUID();
    if (ids.has(id)) throw new Error('MCP server ID is duplicated'); ids.add(id);
    const name = clean(candidate.name, 80); if (!name) throw new Error('MCP server name is required');
    const nameKey = name.toLowerCase(); if (names.has(nameKey)) throw new Error(`MCP server name ${name} is duplicated`); names.add(nameKey);
    const endpoint = validateMcpEndpoint(candidate.endpoint); if (endpoints.has(endpoint)) throw new Error(`MCP endpoint ${endpoint} is duplicated`); endpoints.add(endpoint);
    const bearerToken = candidate.bearerToken === undefined ? undefined : String(candidate.bearerToken).trim();
    if (bearerToken && (bearerToken.length > 2_000 || /[\r\n]/.test(bearerToken))) throw new Error(`MCP server ${name} bearer token is invalid`);
    const endpointUnchanged = existing?.endpoint === endpoint;
    if (!Array.isArray(candidate.enabledTools || [])) throw new Error(`MCP server ${name} enabledTools must be an array`);
    if ((candidate.enabledTools || []).length > MAX_MCP_TOOLS) throw new Error(`MCP server ${name} enables more than ${MAX_MCP_TOOLS} tools`);
    const enabledTools = new Set((candidate.enabledTools || []).map(String));
    const discoveredTools = endpointUnchanged ? (existing.discoveredTools || []).map((tool) => ({ ...tool, alias: aliasFor({ id, name }, tool.name), enabled: tool.supported !== false && enabledTools.has(tool.name) })) : [];
    servers.push({
      id, tenantId, name, endpoint, transport: 'streamable-http', enabled: candidate.enabled !== false,
      encryptedBearerToken: bearerToken ? await encryptApiKey(bearerToken) : endpointUnchanged ? existing?.encryptedBearerToken || null : null,
      bearerTokenLast4: bearerToken ? bearerToken.slice(-4) : endpointUnchanged ? existing?.bearerTokenLast4 || null : null,
      discoveredTools, ...(endpointUnchanged && existing?.serverInfo ? { serverInfo: existing.serverInfo } : {}),
      ...(endpointUnchanged && existing?.lastSyncedAt ? { lastSyncedAt: existing.lastSyncedAt } : {}),
      createdBy: existing?.createdBy || userId, updatedBy: userId, createdAt: existing?.createdAt || now, updatedAt: now,
    });
  }
  state.mcpServerConfigs = state.mcpServerConfigs.filter((server) => server.tenantId !== tenantId).concat(servers);
  return publicMcpSettings(state, tenantId);
}

function boundedFetch(fetchImpl, maxBytes = MAX_RESPONSE_BYTES) {
  return async (input, init = {}) => {
    const response = await fetchImpl(input, init);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' || !response.body || [204, 205, 304].includes(response.status)) return response;
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('MCP response exceeds 256 KB'); }
    let total = 0;
    const bounded = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error('MCP response exceeds 256 KB');
        controller.enqueue(chunk);
      },
    }));
    return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

function timeoutMs() {
  return Math.max(1_000, Math.min(30_000, Number(process.env.NOVI_MCP_TIMEOUT_MS) || 10_000));
}

async function withClient(server, operation, { fetchImpl = globalThis.fetch } = {}) {
  const endpoint = new URL(validateMcpEndpoint(server.endpoint));
  const headers = { accept: 'application/json, text/event-stream', 'user-agent': 'Novi/0.1 agent-mcp-runtime' };
  if (server.bearerToken) headers.authorization = `Bearer ${server.bearerToken}`;
  const client = new Client({ name: 'Novi', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers }, fetch: boundedFetch(fetchImpl), reconnectionOptions: { maxReconnectionDelay: 1_000, initialReconnectionDelay: 250, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 } });
  const timeout = timeoutMs();
  try {
    await client.connect(transport, { timeout, maxTotalTimeout: timeout, signal: AbortSignal.timeout(timeout) });
    return await operation(client, timeout);
  } finally { await client.close().catch(() => {}); }
}

function normalizedAdvertisedTool(server, tool) {
  const name = clean(tool?.name, 128);
  if (!name || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(name)) throw new Error('MCP server advertised an invalid tool name');
  const inputSchema = normalizeMcpSchema(tool.inputSchema || { type: 'object', properties: {} });
  const taskRequired = tool.execution?.taskSupport === 'required';
  return {
    name, alias: aliasFor(server, name), title: clean(tool.title || name, 160), description: clean(tool.description || `MCP tool ${name}`, 1_000), inputSchema,
    annotations: { readOnlyHint: tool.annotations?.readOnlyHint === true, destructiveHint: tool.annotations?.destructiveHint === true, idempotentHint: tool.annotations?.idempotentHint === true, openWorldHint: tool.annotations?.openWorldHint === true },
    supported: !taskRequired, unsupportedReason: taskRequired ? 'Task-based MCP execution is not supported yet' : null, enabled: false,
  };
}

export async function discoverMcpServer(server, options = {}) {
  const resolved = { ...server, endpoint: validateMcpEndpoint(server.endpoint), bearerToken: server.bearerToken || (server.encryptedBearerToken ? await decryptApiKey(server.encryptedBearerToken) : '') };
  return withClient(resolved, async (client, timeout) => {
    const discovered = []; let cursor;
    for (let page = 0; page < MAX_LIST_PAGES && discovered.length < MAX_MCP_TOOLS; page += 1) {
      const response = await client.listTools(cursor ? { cursor } : undefined, { timeout, maxTotalTimeout: timeout, signal: AbortSignal.timeout(timeout) });
      for (const tool of response.tools || []) discovered.push(normalizedAdvertisedTool(server, tool));
      cursor = response.nextCursor; if (!cursor) break;
    }
    if (discovered.length > MAX_MCP_TOOLS || cursor) throw new Error(`MCP server advertises more than ${MAX_MCP_TOOLS} tools`);
    const duplicate = discovered.find((tool, index) => discovered.findIndex((candidate) => candidate.name === tool.name) !== index);
    if (duplicate) throw new Error(`MCP server advertised duplicate tool ${duplicate.name}`);
    return { serverInfo: client.getServerVersion() || { name: server.name, version: 'unknown' }, tools: discovered };
  }, options);
}

export async function resolvedMcpTools(state, tenantId) {
  const tools = [];
  for (const server of (state.mcpServerConfigs || []).filter((item) => item.tenantId === tenantId && item.enabled)) {
    const endpoint = validateMcpEndpoint(server.endpoint); const bearerToken = server.encryptedBearerToken ? await decryptApiKey(server.encryptedBearerToken) : '';
    for (const tool of (server.discoveredTools || []).filter((item) => item.enabled && item.supported !== false)) {
      tools.push({ name: tool.alias || aliasFor(server, tool.name), label: `${server.name} / ${tool.title || tool.name}`, description: `[MCP: ${server.name}] ${tool.description}`, inputSchema: normalizeMcpSchema(tool.inputSchema), kind: 'mcp', endpoint, bearerToken, remoteToolName: tool.name, serverId: server.id, serverName: server.name, annotations: tool.annotations || {} });
    }
  }
  return tools;
}

function normalizeToolResult(result) {
  const content = (result.content || []).slice(0, 40).map((item) => {
    if (item.type === 'text') return { type: 'text', text: clean(item.text, 20_000) };
    if (item.type === 'resource') return { type: 'resource', uri: clean(item.resource?.uri, 2_000), mimeType: clean(item.resource?.mimeType, 200), ...(item.resource?.text ? { text: clean(item.resource.text, 20_000) } : { omittedBinary: true }) };
    if (item.type === 'resource_link') return { type: 'resource_link', uri: clean(item.uri, 2_000), name: clean(item.name, 300), description: clean(item.description, 1_000) };
    if (item.type === 'image' || item.type === 'audio') return { type: item.type, mimeType: clean(item.mimeType, 200), omittedBinary: true };
    return { type: clean(item.type || 'unknown', 80), omitted: true };
  });
  return { ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}), content };
}

export async function invokeMcpTool(definition, input, options = {}) {
  const validator = validatorProvider.getValidator(definition.inputSchema);
  const validated = validator(input);
  if (!validated.valid) throw new Error(`MCP tool input failed schema validation: ${clean(validated.errorMessage, 300)}`);
  const server = { endpoint: definition.endpoint, bearerToken: definition.bearerToken };
  return withClient(server, async (client, timeout) => {
    const result = await client.callTool({ name: definition.remoteToolName, arguments: validated.data }, undefined, { timeout, maxTotalTimeout: timeout, signal: AbortSignal.timeout(timeout) });
    const normalized = normalizeToolResult(result);
    if (result.isError) throw new Error(`MCP tool returned an error: ${clean(normalized.content.map((item) => item.text || item.description || '').filter(Boolean).join(' '), 300) || 'remote error'}`);
    return normalized;
  }, options);
}

export { MAX_MCP_SERVERS, MAX_MCP_TOOLS, MAX_RESPONSE_BYTES };
