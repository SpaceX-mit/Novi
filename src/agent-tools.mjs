import { randomUUID } from 'node:crypto';
import { enqueueDocumentProjection } from './external-projection.mjs';
import { ingestDocument } from './knowledge.mjs';
import { decryptApiKey, encryptApiKey } from './llm-providers.mjs';
import { searchKnowledgeSources } from './connectors.mjs';
import { verifyEvidenceSources } from './evidence.mjs';

const BUILTIN_TOOLS = Object.freeze([
  { name: 'workspace_read', label: 'Workspace read', description: 'Retrieve relevant passages from documents in the current workspace.', defaultEnabled: true, inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 500 }, limit: { type: 'number' } } } },
  { name: 'workspace_write', label: 'Workspace write', description: 'Create a text document in the current workspace semantic memory.', defaultEnabled: false, inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'content'], properties: { title: { type: 'string', maxLength: 200 }, content: { type: 'string', maxLength: 20000 } } } },
  { name: 'web_search', label: 'Web search', description: 'Search Novi source connectors for current scholarly and technical evidence.', defaultEnabled: true, inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 300 }, limit: { type: 'number' } } } },
]);

const customNamePattern = /^[a-z][a-z0-9_]{1,47}$/;
const scalarTypes = new Set(['string', 'number', 'boolean']);
const MAX_CUSTOM_TOOLS = 10;
const MAX_RESULT_BYTES = 32 * 1024;

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function allowedHosts() {
  return new Set(String(process.env.NOVI_TOOL_ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function validatedEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(String(value || '')); } catch { throw new Error('Custom tool endpoint must be a valid URL'); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Custom tool endpoint cannot contain credentials, query parameters, or fragments');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(endpoint.hostname.toLowerCase());
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local && process.env.NODE_ENV !== 'production')) throw new Error('Custom tool endpoints must use HTTPS; loopback HTTP is allowed only in development');
  if (!local && !allowedHosts().has(endpoint.hostname.toLowerCase())) throw new Error('Custom tool hostname is not listed in NOVI_TOOL_ALLOWED_HOSTS');
  return endpoint.toString();
}

function normalizeSchema(value) {
  const schema = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (schema.type !== 'object' || schema.additionalProperties !== false) throw new Error('Custom tool inputSchema must be an object with additionalProperties false');
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {};
  if (Object.keys(properties).length > 12) throw new Error('Custom tool inputSchema supports at most 12 properties');
  const normalized = {};
  for (const [name, definition] of Object.entries(properties)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(name) || !definition || !scalarTypes.has(definition.type)) throw new Error(`Custom tool property ${name} is invalid`);
    normalized[name] = { type: definition.type, ...(definition.description ? { description: clean(definition.description, 200) } : {}), ...(definition.type === 'string' ? { maxLength: Math.max(1, Math.min(20_000, Number(definition.maxLength) || 2_000)) } : {}) };
  }
  const required = Array.isArray(schema.required) ? [...new Set(schema.required.map(String))] : [];
  if (required.some((name) => !Object.hasOwn(normalized, name))) throw new Error('Custom tool required fields must exist in properties');
  return { type: 'object', additionalProperties: false, properties: normalized, required };
}

function publicCustomTool(tool) {
  const { encryptedBearerToken: _encryptedBearerToken, ...safe } = tool;
  return { ...safe, hasBearerToken: Boolean(tool.encryptedBearerToken), bearerTokenLast4: tool.bearerTokenLast4 || null };
}

export function builtinToolCatalog() {
  return BUILTIN_TOOLS.map((tool) => ({ ...tool, inputSchema: structuredClone(tool.inputSchema) }));
}

export function publicToolSettings(state, tenantId) {
  const record = (state.agentToolConfigs || []).find((item) => item.tenantId === tenantId);
  const configured = record?.builtins || {};
  return {
    builtins: BUILTIN_TOOLS.map((tool) => ({ ...tool, enabled: typeof configured[tool.name] === 'boolean' ? configured[tool.name] : tool.defaultEnabled })),
    customTools: (record?.customTools || []).map(publicCustomTool),
    updatedAt: record?.updatedAt || null,
  };
}

export async function saveToolSettings(state, tenantId, userId, input = {}) {
  state.agentToolConfigs ||= [];
  const existing = state.agentToolConfigs.find((item) => item.tenantId === tenantId);
  const priorById = new Map((existing?.customTools || []).map((tool) => [tool.id, tool]));
  const builtins = {};
  for (const definition of BUILTIN_TOOLS) builtins[definition.name] = input.builtins?.[definition.name] === undefined ? (existing?.builtins?.[definition.name] ?? definition.defaultEnabled) : input.builtins[definition.name] === true;
  if (!Array.isArray(input.customTools || [])) throw new Error('customTools must be an array');
  if ((input.customTools || []).length > MAX_CUSTOM_TOOLS) throw new Error(`At most ${MAX_CUSTOM_TOOLS} custom tools are allowed`);
  const names = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  const customTools = [];
  for (const candidate of input.customTools || []) {
    const id = clean(candidate.id, 100) || randomUUID();
    const name = clean(candidate.name, 48);
    if (!customNamePattern.test(name) || names.has(name)) throw new Error(`Custom tool name ${name || '(empty)'} is invalid or duplicated`);
    names.add(name);
    const description = clean(candidate.description, 500);
    if (!description) throw new Error(`Custom tool ${name} requires a description`);
    const prior = priorById.get(id);
    const bearerToken = candidate.bearerToken === undefined ? undefined : String(candidate.bearerToken).trim();
    if (bearerToken && (bearerToken.length > 2_000 || /[\r\n]/.test(bearerToken))) throw new Error(`Custom tool ${name} bearer token is invalid`);
    customTools.push({
      id, name, description, endpoint: validatedEndpoint(candidate.endpoint), inputSchema: normalizeSchema(candidate.inputSchema), enabled: candidate.enabled !== false,
      encryptedBearerToken: bearerToken ? await encryptApiKey(bearerToken) : prior?.encryptedBearerToken || null,
      bearerTokenLast4: bearerToken ? bearerToken.slice(-4) : prior?.bearerTokenLast4 || null,
    });
  }
  const now = new Date().toISOString();
  const record = { tenantId, builtins, customTools, updatedBy: userId, createdAt: existing?.createdAt || now, updatedAt: now };
  if (existing) Object.assign(existing, record); else state.agentToolConfigs.push(record);
  return publicToolSettings(state, tenantId);
}

export async function resolvedTools(state, tenantId) {
  const settings = publicToolSettings(state, tenantId);
  const record = (state.agentToolConfigs || []).find((item) => item.tenantId === tenantId);
  const customById = new Map((record?.customTools || []).map((tool) => [tool.id, tool]));
  const tools = settings.builtins.filter((tool) => tool.enabled).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, kind: 'builtin' }));
  for (const tool of settings.customTools.filter((item) => item.enabled)) {
    const stored = customById.get(tool.id);
    tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, endpoint: validatedEndpoint(tool.endpoint), kind: 'custom', bearerToken: stored?.encryptedBearerToken ? await decryptApiKey(stored.encryptedBearerToken) : '' });
  }
  return tools;
}

function validatedInput(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool input must be an object');
  const properties = schema.properties || {};
  const required = schema.required || [];
  if (required.some((name) => input[name] === undefined)) throw new Error(`Tool input is missing required field ${required.find((name) => input[name] === undefined)}`);
  if (Object.keys(input).some((name) => !Object.hasOwn(properties, name))) throw new Error('Tool input contains an unsupported field');
  const output = {};
  for (const [name, value] of Object.entries(input)) {
    const definition = properties[name];
    if (definition.type === 'string') {
      if (typeof value !== 'string' || !value.trim() || value.length > (definition.maxLength || 2_000)) throw new Error(`Tool input ${name} must be a non-empty bounded string`);
      output[name] = value.trim();
    } else if (definition.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Tool input ${name} must be a finite number`);
      output[name] = value;
    } else if (definition.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Tool input ${name} must be a boolean`);
      output[name] = value;
    }
  }
  return output;
}

async function boundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESULT_BYTES) { await reader.cancel(); throw new Error('Custom tool response exceeds 32 KB'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

export function createToolExecutor({ store, project, principal, allowWebSearch = false, fetchImpl = globalThis.fetch }) {
  return async (definition, rawInput) => {
    const input = validatedInput(definition.inputSchema, rawInput);
    if (definition.name === 'workspace_read') {
      const results = await store.searchKnowledge(project.id, principal.tenantId, input.query, Math.max(1, Math.min(10, Number(input.limit) || 5)));
      return { result: { passages: results.map((item) => ({ document: item.document, text: clean(item.text, 1_500), score: item.score, sourceUrl: item.sourceUrl })) }, knowledgeContext: results };
    }
    if (definition.name === 'workspace_write') {
      const inserted = await store.update((state) => {
        const current = (state.projects || []).find((item) => item.id === project.id && item.tenantId === principal.tenantId);
        if (!current) throw new Error('Workspace is no longer available');
        const result = ingestDocument({ title: input.title, content: input.content, sourceKind: 'agent-note' }, { projectId: project.id, tenantId: principal.tenantId });
        if (result.error) throw new Error(result.error);
        if ((state.documents || []).some((item) => item.projectId === project.id && item.tenantId === principal.tenantId && item.contentHash === result.document.contentHash)) throw new Error('This content is already indexed in the workspace');
        state.documents.push(result.document); state.chunks.push(...result.chunks); state.knowledgeEntities.push(...result.entities); state.knowledgeEdges.push(...result.edges);
        enqueueDocumentProjection(state, result);
        return result;
      });
      return { result: { documentId: inserted.document.id, title: inserted.document.title, chunkCount: inserted.document.chunkCount }, knowledgeContext: inserted.chunks.map((chunk) => ({ ...chunk, document: inserted.document.title })) };
    }
    if (definition.name === 'web_search') {
      if (!allowWebSearch) throw new Error('Web search is unavailable for this run because source access was not authorized');
      let sources = await searchKnowledgeSources(input.query, Math.max(1, Math.min(10, Number(input.limit) || 5)));
      if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await verifyEvidenceSources(sources);
      return { result: { sources }, sources };
    }
    if (definition.kind !== 'custom') throw new Error('Unknown tool');
    const headers = { accept: 'application/json, text/plain', 'content-type': 'application/json', 'user-agent': 'Novi/0.1 agent-tool-runtime' };
    if (definition.bearerToken) headers.authorization = `Bearer ${definition.bearerToken}`;
    const timeout = Math.max(1_000, Math.min(30_000, Number(process.env.NOVI_TOOL_TIMEOUT_MS) || 10_000));
    const response = await fetchImpl(definition.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout), headers, body: JSON.stringify(input) });
    if (!response.ok) throw new Error(`Custom tool returned HTTP ${response.status}`);
    const text = await boundedResponse(response);
    let result;
    try { result = JSON.parse(text); } catch { result = { text }; }
    return { result };
  };
}

export function toolDefinitionFor(tools, name) {
  return (tools || []).find((tool) => tool.name === name) || null;
}

export { MAX_RESULT_BYTES };
