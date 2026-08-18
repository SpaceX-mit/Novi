import { randomUUID } from 'node:crypto';
import { posix as pathPosix } from 'node:path';
import { enqueueDocumentProjection } from './external-projection.mjs';
import { contentHash, ingestDocument } from './knowledge.mjs';
import { decryptApiKey, encryptApiKey } from './llm-providers.mjs';
import { searchKnowledgeSources, searchPaperSources } from './connectors.mjs';
import { verifyEvidenceSources } from './evidence.mjs';
import { invokeMcpTool } from './mcp-runtime.mjs';
import { fetchPaper } from './paper-tools.mjs';

const BUILTIN_TOOLS = Object.freeze([
  { name: 'workspace_read', label: 'Workspace read', description: 'Retrieve relevant passages from documents in the current workspace.', defaultEnabled: true, inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 500 }, limit: { type: 'number' } } } },
  { name: 'workspace_write', label: 'Workspace write', description: 'Create a text document in the current workspace semantic memory.', defaultEnabled: false, inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'content'], properties: { title: { type: 'string', maxLength: 200 }, content: { type: 'string', maxLength: 20000 } } } },
  { name: 'read_file', label: 'Read file', description: 'Read a bounded text file from the current workspace.', defaultEnabled: false, inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', maxLength: 500 }, startLine: { type: 'number' }, endLine: { type: 'number' } } } },
  { name: 'search_files', label: 'Search files', description: 'Search workspace file paths and text without leaving the current project.', defaultEnabled: false, inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 300 }, pathPattern: { type: 'string', maxLength: 300 }, limit: { type: 'number' } } } },
  { name: 'write_file', label: 'Write file', description: 'Create or replace a bounded text file in the current workspace.', defaultEnabled: false, inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string', maxLength: 500 }, content: { type: 'string', maxLength: 200000 }, overwrite: { type: 'boolean' } } } },
  { name: 'patch', label: 'Patch file', description: 'Apply an exact bounded text replacement to a current workspace file.', defaultEnabled: false, inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'oldText', 'newText'], properties: { path: { type: 'string', maxLength: 500 }, oldText: { type: 'string', maxLength: 20000 }, newText: { type: 'string', maxLength: 20000 }, expectedReplacements: { type: 'number' } } } },
  { name: 'web_search', label: 'Web search', description: 'Search Novi source connectors for current scholarly and technical evidence.', defaultEnabled: true, inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 300 }, limit: { type: 'number' } } } },
  { name: 'paper_search', label: 'Paper search', description: 'Search scholarly catalogs for papers and preprints with traceable metadata and public links.', defaultEnabled: true, inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 300 }, limit: { type: 'number' } } } },
  { name: 'paper_fetch', label: 'Paper fetch', description: 'Fetch a paper by DOI, arXiv identifier, or public URL. Reports metadata and access status, and extracts bounded text only when publicly reachable.', defaultEnabled: true, inputSchema: { type: 'object', additionalProperties: false, required: ['identifier'], properties: { identifier: { type: 'string', maxLength: 2000 }, includeText: { type: 'boolean' }, maxCharacters: { type: 'number' } } } },
]);

const SOURCE_ACCESS_TOOLS = new Set(['web_search', 'paper_search', 'paper_fetch']);
const FILE_TOOLS = new Set(['read_file', 'search_files', 'write_file', 'patch']);

const customNamePattern = /^[a-z][a-z0-9_]{1,47}$/;
const scalarTypes = new Set(['string', 'number', 'boolean']);
const MAX_CUSTOM_TOOLS = 10;
const MAX_RESULT_BYTES = 32 * 1024;
const MAX_FILE_BYTES = 200_000;
const MAX_FILES_PER_PROJECT = 500;

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function safeFilePath(value) {
  const filePath = String(value || '').replaceAll('\\', '/').trim();
  if (!filePath || filePath.startsWith('/') || /^[a-zA-Z]:\//u.test(filePath) || filePath.includes('\u0000')) throw new Error('File path must be a relative workspace path');
  const normalized = pathPosix.normalize(filePath);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('*') || normalized.includes('?')) throw new Error('File path escapes the workspace or contains a pattern');
  return normalized;
}

function workspaceFile(state, project, tenantId, filePath) {
  return (state.workspaceFiles || []).find((file) => file.projectId === project.id && file.tenantId === tenantId && file.path === filePath);
}

function fileSummary(file) {
  return { path: file.path, content: file.content, size: Buffer.byteLength(file.content, 'utf8'), updatedAt: file.updatedAt, contentHash: file.contentHash };
}

function filePatternMatches(filePath, pattern) {
  const escaped = String(pattern || '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '.*').replaceAll('*', '[^/]*').replaceAll('?', '[^/]');
  return new RegExp(`^${escaped}$`, 'u').test(filePath);
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
    if (!customNamePattern.test(name) || name.startsWith('mcp__') || names.has(name)) throw new Error(`Custom tool name ${name || '(empty)'} is invalid, reserved, or duplicated`);
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

export function sourceAccessTool(name) {
  return SOURCE_ACCESS_TOOLS.has(String(name || ''));
}

export function createToolExecutor({ store, project, principal, allowWebSearch = false, allowSourceAccess = allowWebSearch, fetchImpl = globalThis.fetch, paperSearchImpl = searchPaperSources, paperFetchImpl = fetchPaper, sourceVerifier = verifyEvidenceSources }) {
  return async (definition, rawInput) => {
    if (definition.kind === 'mcp') return { result: await invokeMcpTool(definition, rawInput, { fetchImpl }) };
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
    if (FILE_TOOLS.has(definition.name)) {
      const filePath = definition.name === 'search_files' ? null : safeFilePath(input.path);
      if (definition.name === 'read_file') {
        const state = await store.read(); const file = workspaceFile(state, project, principal.tenantId, filePath);
        if (!file) throw new Error('Workspace file not found');
        const lines = file.content.split('\n'); const start = Math.max(1, Math.floor(Number(input.startLine) || 1)); const end = Math.min(lines.length, Math.max(start, Math.floor(Number(input.endLine) || lines.length)));
        return { result: { ...fileSummary(file), startLine: start, endLine: end, content: lines.slice(start - 1, end).join('\n') } };
      }
      if (definition.name === 'search_files') {
        const query = String(input.query || '').trim(); if (!query) throw new Error('Search query is required');
        const pattern = input.pathPattern ? String(input.pathPattern) : null; const state = await store.read();
        const files = (state.workspaceFiles || []).filter((file) => file.projectId === project.id && file.tenantId === principal.tenantId && (!pattern || filePatternMatches(file.path, pattern)) && file.content.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, Math.max(1, Math.min(50, Number(input.limit) || 20)));
        return { result: { files: files.map((file) => ({ path: file.path, matches: file.content.split('\n').map((line, index) => line.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? { line: index + 1, text: line.slice(0, 500) } : null).filter(Boolean).slice(0, 20), size: Buffer.byteLength(file.content, 'utf8') })) } };
      }
      const content = String(input.content ?? input.newText ?? ''); if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Workspace file exceeds 200 KB');
      const now = new Date().toISOString();
      const result = await store.update((state) => {
        state.workspaceFiles ||= []; const existing = workspaceFile(state, project, principal.tenantId, filePath);
        if (definition.name === 'write_file' && existing && input.overwrite !== true) throw new Error('Workspace file already exists; set overwrite true');
        if (definition.name === 'patch') {
          if (!existing) throw new Error('Workspace file not found');
          const oldText = String(input.oldText); const count = existing.content.split(oldText).length - 1; const expected = Number(input.expectedReplacements) || 1;
          if (count !== expected) throw new Error(`Patch expected ${expected} replacement(s), found ${count}`);
          const patched = existing.content.replaceAll(oldText, String(input.newText)); if (Buffer.byteLength(patched, 'utf8') > MAX_FILE_BYTES) throw new Error('Patched file exceeds 200 KB');
          existing.content = patched; existing.contentHash = contentHash(patched); existing.updatedAt = now; return fileSummary(existing);
        }
        if (!existing && state.workspaceFiles.filter((file) => file.projectId === project.id && file.tenantId === principal.tenantId).length >= MAX_FILES_PER_PROJECT) throw new Error('Workspace file limit reached');
        const file = existing || { id: randomUUID(), projectId: project.id, tenantId: principal.tenantId, path: filePath, createdAt: now };
        file.content = content; file.contentHash = contentHash(content); file.updatedAt = now; if (!existing) state.workspaceFiles.push(file); return fileSummary(file);
      });
      if (definition.name !== 'patch' || result.content) {
        const indexed = await store.update((state) => {
          const current = workspaceFile(state, project, principal.tenantId, filePath); const ingested = ingestDocument({ title: filePath, content: current.content, sourceKind: 'workspace-file' }, { projectId: project.id, tenantId: principal.tenantId });
          if (!ingested.error) {
            const replacedIds = new Set((state.documents || []).filter((doc) => doc.projectId === project.id && doc.tenantId === principal.tenantId && doc.sourceKind === 'workspace-file' && doc.title === filePath).map((doc) => doc.id));
            state.documents = (state.documents || []).filter((doc) => !replacedIds.has(doc.id));
            state.chunks = (state.chunks || []).filter((chunk) => !replacedIds.has(chunk.documentId));
            state.knowledgeEntities = (state.knowledgeEntities || []).filter((entity) => !replacedIds.has(entity.documentId));
            state.knowledgeEdges = (state.knowledgeEdges || []).filter((edge) => !replacedIds.has(edge.documentId));
            state.documents.push(ingested.document); state.chunks.push(...ingested.chunks); state.knowledgeEntities.push(...ingested.entities); state.knowledgeEdges.push(...ingested.edges); enqueueDocumentProjection(state, ingested);
          }
          return current;
        });
        return { result: indexed };
      }
      return { result };
    }
    if (definition.name === 'web_search') {
      if (!allowSourceAccess) throw new Error('Source access is unavailable for this run because it was not authorized');
      let sources = await searchKnowledgeSources(input.query, Math.max(1, Math.min(10, Number(input.limit) || 5)));
      if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await sourceVerifier(sources, { fetchImpl });
      return { result: { sources }, sources };
    }
    if (definition.name === 'paper_search') {
      if (!allowSourceAccess) throw new Error('Source access is unavailable for this run because it was not authorized');
      let sources = await paperSearchImpl(input.query, Math.max(1, Math.min(10, Number(input.limit) || 5)), { fetchImpl });
      if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await sourceVerifier(sources, { fetchImpl });
      return { result: { papers: sources }, sources };
    }
    if (definition.name === 'paper_fetch') {
      if (!allowSourceAccess) throw new Error('Source access is unavailable for this run because it was not authorized');
      const paper = await paperFetchImpl(input.identifier, { fetchImpl, includeText: input.includeText !== false, maxCharacters: input.maxCharacters });
      return { result: paper, ...(paper.source ? { sources: [paper.source] } : {}) };
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
