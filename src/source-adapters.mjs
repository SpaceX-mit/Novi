import { validateUrl } from './evidence.mjs';

const ADAPTER_MAX_BYTES = 1_000_000;
const RENDERED_TEXT_MAX_BYTES = 880_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MCP_PROTOCOL_VERSION = '2025-06-18';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const loopback = (hostname) => ['localhost', '127.0.0.1', '::1'].includes(String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase());

function configuredUrl(name) {
  const value = String(process.env[name] || '').trim();
  return value || null;
}

function validateAdapterEndpoint(value, label) {
  if (!value) return null;
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash) throw new Error(`${label} must be an HTTP(S) URL without credentials or fragments`);
  if (endpoint.protocol !== 'https:' && !loopback(endpoint.hostname)) throw new Error(`${label} must use HTTPS except for loopback development`);
  return endpoint;
}

function requireProductionToken(endpoint, token, label) {
  if (process.env.NODE_ENV === 'production' && endpoint && !loopback(endpoint.hostname) && !token) throw new Error(`${label} requires an isolated bearer token in production`);
}

export function browserAgentConfigured() { return Boolean(configuredUrl('NOVI_BROWSER_AGENT_URL')); }
export function mcpSourceConfigured() { return Boolean(configuredUrl('NOVI_MCP_SOURCE_URL')); }

export function validateSourceAdapterConfiguration() {
  const browser = validateAdapterEndpoint(configuredUrl('NOVI_BROWSER_AGENT_URL'), 'NOVI_BROWSER_AGENT_URL');
  const mcp = validateAdapterEndpoint(configuredUrl('NOVI_MCP_SOURCE_URL'), 'NOVI_MCP_SOURCE_URL');
  requireProductionToken(browser, process.env.NOVI_BROWSER_AGENT_TOKEN, 'Browser Agent');
  requireProductionToken(mcp, process.env.NOVI_MCP_SOURCE_TOKEN, 'MCP source adapter');
  const tool = String(process.env.NOVI_MCP_SOURCE_TOOL || 'search').trim();
  if (mcp && !/^[A-Za-z0-9_.:/-]{1,128}$/.test(tool)) throw new Error('NOVI_MCP_SOURCE_TOOL is invalid');
  return { browser: Boolean(browser), mcp: Boolean(mcp) };
}

async function readBoundedText(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > ADAPTER_MAX_BYTES) throw new Error('adapter response exceeds 1 MB');
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > ADAPTER_MAX_BYTES) throw new Error('adapter response exceeds 1 MB');
    return bytes.toString('utf8');
  }
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > ADAPTER_MAX_BYTES) throw new Error('adapter response exceeds 1 MB');
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); }
}

function truncateUtf8(value, maxBytes = RENDERED_TEXT_MAX_BYTES) {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  return (bytes.byteLength <= maxBytes ? bytes : bytes.subarray(0, maxBytes)).toString('utf8').trim();
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}

export async function renderWithBrowserAgent(urlValue, { fetchImpl = globalThis.fetch, skipTargetDns = false } = {}) {
  const endpoint = validateAdapterEndpoint(configuredUrl('NOVI_BROWSER_AGENT_URL'), 'NOVI_BROWSER_AGENT_URL');
  if (!endpoint) throw Object.assign(new Error('Browser Agent is not configured'), { status: 503 });
  requireProductionToken(endpoint, process.env.NOVI_BROWSER_AGENT_TOKEN, 'Browser Agent');
  const target = await validateUrl(urlValue, { skipDns: skipTargetDns });
  const timeoutMs = Math.max(1_000, Math.min(30_000, Number(process.env.NOVI_BROWSER_AGENT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
  const requestHeaders = { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Novi/0.1 browser-agent-adapter' };
  if (process.env.NOVI_BROWSER_AGENT_TOKEN) requestHeaders.authorization = `Bearer ${process.env.NOVI_BROWSER_AGENT_TOKEN}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: requestHeaders,
    body: JSON.stringify({ url: target.toString(), waitUntil: 'networkidle', timeoutMs, maxBytes: RENDERED_TEXT_MAX_BYTES, javascript: true, blockResourceTypes: ['image', 'media', 'font'] }),
  });
  if (!response.ok) throw Object.assign(new Error(`Browser Agent returned ${response.status}`), { status: 502 });
  const payload = parseJson(await readBoundedText(response), 'Browser Agent');
  const finalUrl = await validateUrl(payload.finalUrl || payload.url || target, { skipDns: skipTargetDns });
  const raw = payload.text ?? payload.content ?? payload.markdown ?? (payload.html ? htmlToText(payload.html) : '');
  if (typeof raw !== 'string') throw Object.assign(new Error('Browser Agent returned invalid text'), { status: 502 });
  const content = truncateUtf8(raw);
  if (!content) throw Object.assign(new Error('Browser Agent returned no extractable text'), { status: 422 });
  return { url: finalUrl.toString(), title: clean(payload.title), content, sourceKind: 'browser-rendered', mimeType: 'text/plain' };
}

function parseMcpResponse(text, contentType, requestId) {
  if (String(contentType).toLowerCase().includes('text/event-stream')) {
    const events = [];
    for (const block of String(text).split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (data && data !== '[DONE]') events.push(parseJson(data, 'MCP source adapter'));
    }
    const matched = events.find((item) => item?.id === requestId) || events.at(-1);
    if (!matched) throw new Error('MCP source adapter returned no JSON-RPC event');
    return matched;
  }
  return parseJson(text, 'MCP source adapter');
}

async function mcpRequest(endpoint, method, params, requestId, sessionId, fetchImpl, timeoutMs) {
  const requestHeaders = { accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': MCP_PROTOCOL_VERSION, 'user-agent': 'Novi/0.1 mcp-source-adapter' };
  if (sessionId) requestHeaders['mcp-session-id'] = sessionId;
  if (process.env.NOVI_MCP_SOURCE_TOKEN) requestHeaders.authorization = `Bearer ${process.env.NOVI_MCP_SOURCE_TOKEN}`;
  const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: requestHeaders, body: JSON.stringify(requestId === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: requestId, method, params }) });
  if (!response.ok) throw new Error(`MCP source adapter returned ${response.status} for ${method}`);
  const nextSession = response.headers.get('mcp-session-id') || sessionId || null;
  if (requestId === null) { await readBoundedText(response); return { payload: null, sessionId: nextSession }; }
  const payload = parseMcpResponse(await readBoundedText(response), response.headers.get('content-type') || '', requestId);
  if (payload?.error) throw new Error(`MCP ${method} failed: ${clean(payload.error.message || payload.error.code)}`);
  if (payload?.id !== requestId || !payload?.result) throw new Error(`MCP ${method} returned an invalid JSON-RPC response`);
  return { payload, sessionId: nextSession };
}

function structuredCandidates(result) {
  const structured = result?.structuredContent;
  const direct = structured?.sources || structured?.results || structured?.items || (Array.isArray(structured) ? structured : null);
  if (Array.isArray(direct)) return direct;
  const candidates = [];
  for (const item of result?.content || []) {
    if (item?.type === 'resource_link' && item.uri) candidates.push({ name: item.name || item.title, url: item.uri, snippet: item.description });
    if (item?.type === 'text' && item.text) {
      try {
        const parsed = JSON.parse(item.text); const values = parsed?.sources || parsed?.results || parsed?.items || parsed;
        if (Array.isArray(values)) candidates.push(...values);
      } catch { /* Free-form text cannot be promoted to a concrete source. */ }
    }
  }
  return candidates;
}

function normalizeMcpCandidate(item) {
  if (!item || typeof item !== 'object') return null;
  const url = item.url || item.uri || item.href;
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
  return {
    name: clean(item.name || item.title) || parsed.hostname,
    kind: clean(item.kind || item.type) || 'Reference',
    url: parsed.toString(),
    authority: Math.max(0, Math.min(90, Number(item.authority) || 60)),
    publishedAt: clean(item.publishedAt || item.published_at || item.date),
    snippet: truncateUtf8(item.snippet || item.description || item.summary, 4_000),
    mapped: true,
    provider: 'MCP',
  };
}

export async function searchMcpSources(queryValue, limit = 5, { fetchImpl = globalThis.fetch } = {}) {
  const endpoint = validateAdapterEndpoint(configuredUrl('NOVI_MCP_SOURCE_URL'), 'NOVI_MCP_SOURCE_URL');
  if (!endpoint) throw new Error('MCP source adapter is not configured');
  requireProductionToken(endpoint, process.env.NOVI_MCP_SOURCE_TOKEN, 'MCP source adapter');
  const query = clean(queryValue);
  if (!query) return [];
  const count = Math.max(1, Math.min(50, Number(limit) || 5));
  const timeoutMs = Math.max(1_000, Math.min(30_000, Number(process.env.NOVI_MCP_SOURCE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
  let requestId = 1;
  let exchange = await mcpRequest(endpoint, 'initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Novi', version: '0.1.0' } }, requestId++, null, fetchImpl, timeoutMs);
  if (exchange.payload.result.protocolVersion !== MCP_PROTOCOL_VERSION) throw new Error(`MCP source adapter negotiated unsupported protocol ${clean(exchange.payload.result.protocolVersion)}`);
  let sessionId = exchange.sessionId;
  await mcpRequest(endpoint, 'notifications/initialized', {}, null, sessionId, fetchImpl, timeoutMs);
  exchange = await mcpRequest(endpoint, 'tools/list', {}, requestId++, sessionId, fetchImpl, timeoutMs); sessionId = exchange.sessionId;
  const toolName = String(process.env.NOVI_MCP_SOURCE_TOOL || 'search').trim();
  if (!(exchange.payload.result.tools || []).some((tool) => tool?.name === toolName)) throw new Error(`MCP source tool ${toolName} is not advertised`);
  exchange = await mcpRequest(endpoint, 'tools/call', { name: toolName, arguments: { query, limit: count } }, requestId++, sessionId, fetchImpl, timeoutMs);
  if (exchange.payload.result.isError) throw new Error('MCP source tool returned an error result');
  return structuredCandidates(exchange.payload.result).map(normalizeMcpCandidate).filter(Boolean).slice(0, count);
}

export { ADAPTER_MAX_BYTES, MCP_PROTOCOL_VERSION, RENDERED_TEXT_MAX_BYTES };
