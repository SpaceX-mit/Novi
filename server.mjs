import http from 'node:http';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './src/store.mjs';
import { artifactToLatex, artifactToMarkdown, generateArtifact, generateArtifactAsync } from './src/engine.mjs';
import { searchKnowledgeSources } from './src/connectors.mjs';
import { AuthService, bearerToken } from './src/auth.mjs';
import { billingSnapshot, consumeGeneration, consumeSourceQuery, refundGeneration, refundSourceQuery } from './src/billing.mjs';
import { applyWebhook, createCheckoutSession, verifyWebhook } from './src/payments.mjs';
import { assertRole, roleFor } from './src/rbac.mjs';
import { createAuthorizationRequestWithPkce, discoverIssuer, exchangeAuthorizationCode, fetchUserInfo, newNonce, newState, newVerifier, oidcConfigured, stateHash, validateOidcConfiguration, verifyIdToken } from './src/oidc.mjs';
import { createPostgresStore } from './src/postgres-store.mjs';
import { contentHash, extractImportedText, ingestDocument, knowledgeForProject, searchProjectKnowledge } from './src/knowledge.mjs';
import { PDFParse } from 'pdf-parse';
import { sourceChanges, startRefreshWorker, updateProjectFromSnapshot } from './src/refresh.mjs';
import { verifyEvidenceSources } from './src/evidence.mjs';
import { objectStoreConfigured, validateObjectStoreConfiguration } from './src/object-store.mjs';
import { graphStoreConfigured, validateGraphConfiguration } from './src/graph-store.mjs';
import { enqueueDocumentDeletion, enqueueDocumentProjection, externalProjectionPending, flushExternalProjectionJobs } from './src/external-projection.mjs';
import { providerCatalog, publicProviderConfig, resolvedProviderConfig, saveProviderConfig, testProviderConnection } from './src/llm-providers.mjs';
import { browserAgentConfigured, mcpSourceConfigured, renderWithBrowserAgent, validateSourceAdapterConfiguration } from './src/source-adapters.mjs';
import { agentModeCatalog, publicMode, selectAgentMode, validateRequestedMode } from './src/agent-modes.mjs';
import { beginSessionRun, completeSessionRun, createAgentSession, ensureAgentSession, failSessionRun, findAgentSession, publicAgentSession, sessionSummary, updateSessionRun, updateSessionRunEvent, updateSessionToolCall, upsertRunEvent } from './src/agent-sessions.mjs';
import { createToolExecutor, publicToolSettings, resolvedTools, saveToolSettings, sourceAccessTool } from './src/agent-tools.mjs';
import { discoverMcpServer, publicMcpSettings, resolvedMcpTools, saveMcpSettings } from './src/mcp-runtime.mjs';
import { publicSkillSettings, resolveSkills, saveSkillSettings, skillProvenance } from './src/skill-runtime.mjs';
import { bindPluginTools, pluginProvenance, publicPluginSettings, resolvePlugins, savePluginSettings } from './src/plugin-runtime.mjs';
import { normalizeWikiLanguage } from './src/wiki-language.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = new Set(['knowledge', 'research', 'paper']);
const authRequired = () => process.env.NOVI_AUTH_REQUIRED === 'true' || (process.env.NODE_ENV === 'production' && process.env.NOVI_AUTH_REQUIRED !== 'false');
const requestBuckets = new Map();
const authFailureBuckets = new Map();
const secureCookie = () => process.env.NOVI_COOKIE_SECURE === 'true' ? '; Secure' : '';

export function createMetrics() {
  return { startedAt: new Date().toISOString(), requests: 0, generationStarted: 0, generationCompleted: 0, generationFailed: 0, refreshStarted: 0, refreshCompleted: 0, refreshFailed: 0 };
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'", ...headers });
  res.end(payload);
}

async function streamJobEvents(req, res, store, user, jobId) {
  const initialJob = (await store.read()).jobs.find((item) => item.id === jobId && item.tenantId === user.tenantId);
  if (!initialJob) return send(res, 404, { error: 'Job not found' });
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  res.writeHead(200, { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...headers });
  let closed = false; let lastUpdatedAt = ''; let lastHeartbeat = Date.now();
  const close = () => { closed = true; };
  req.on('close', close);
  const write = (event, payload) => {
    if (!closed && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  while (!closed && !res.destroyed) {
    const job = (await store.read()).jobs.find((item) => item.id === jobId && item.tenantId === user.tenantId);
    if (!job) { write('error', { error: 'Job not found' }); break; }
    if (job.updatedAt !== lastUpdatedAt) { lastUpdatedAt = job.updatedAt; write('job', { job }); }
    if (Date.now() - lastHeartbeat >= 15_000) { write('heartbeat', { at: new Date().toISOString() }); lastHeartbeat = Date.now(); }
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!res.destroyed) res.end();
}

async function jsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > 1_000_000) throw Object.assign(new Error('Request body is too large'), { status: 413 });
  }
  try {
    const parsed = body ? JSON.parse(body) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('JSON body must be an object'), { status: 400 });
    return parsed;
  }
  catch (error) { if (error?.status) throw error; throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

async function rawBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > 1_000_000) throw Object.assign(new Error('Request body is too large'), { status: 413 });
  }
  return body;
}

function validateProject(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { body: 'Request body must be an object' };
  const errors = {};
  if (!String(input.title || '').trim()) errors.title = 'Title is required';
  if (!String(input.topic || '').trim()) errors.topic = 'Topic is required';
  if (!types.has(input.type)) errors.type = 'Type must be knowledge, research, or paper';
  if (String(input.title || '').length > 120) errors.title = 'Title must be 120 characters or less';
  if (String(input.topic || '').length > 300) errors.topic = 'Topic must be 300 characters or less';
  if (String(input.description || '').length > 500) errors.description = 'Description must be 500 characters or less';
  try { normalizeWikiLanguage(input.wikiLanguage); }
  catch (error) { errors.wikiLanguage = error.message; }
  return errors;
}

const IMPORT_MAX_BYTES = 8 * 1024 * 1024;
const privateIpv4 = (address) => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 2 || second === 168)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && third === 113);
};
const mappedIpv4 = (address) => {
  const lower = String(address).toLowerCase();
  const decimal = lower.match(/^(?:0:){5}ffff:(\d+\.\d+\.\d+\.\d+)$/) || lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (decimal) return decimal[1];
  const hex = lower.match(/^(?:0:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const first = Number.parseInt(hex[1], 16); const second = Number.parseInt(hex[2], 16);
  return `${first >>> 8}.${first & 255}.${second >>> 8}.${second & 255}`;
};
const privateAddress = (address) => {
  if (net.isIPv4(address)) return privateIpv4(address);
  if (!net.isIPv6(address)) return true;
  const lower = address.toLowerCase();
  const mapped = mappedIpv4(lower);
  return Boolean(mapped && privateIpv4(mapped)) || lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff') || lower.startsWith('2001:db8:') || lower.startsWith('2001:2:') || lower.startsWith('2001:10:') || lower.startsWith('3fff:');
};

async function validateImportUrl(value, { skipDns = false, lookupImpl = lookup } = {}) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw Object.assign(new Error('url must be a valid URL'), { status: 422 }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw Object.assign(new Error('url must use http or https'), { status: 422 });
  if (parsed.username || parsed.password) throw Object.assign(new Error('url credentials are not allowed'), { status: 422 });
  if (!skipDns) {
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
    // Some resolvers return an unspecified IPv6 placeholder alongside the real
    // address. Ignore that non-routable placeholder, but reject if no routable
    // answer remains or any actual answer is private/local.
    const routable = addresses.filter(({ address }) => !['::', '0.0.0.0'].includes(address));
    if (!routable.length || routable.some(({ address }) => privateAddress(address))) throw Object.assign(new Error('url resolves to a private or local address'), { status: 422 });
  }
  return parsed;
}

async function fetchImport(urlValue, { lookupImpl = lookup } = {}) {
  let target;
  try { target = new URL(String(urlValue)); } catch { throw Object.assign(new Error('url must be a valid URL'), { status: 422 }); }
  target = await validateImportUrl(urlValue, { lookupImpl });
  const githubRepository = await fetchGitHubRepository(target);
  if (githubRepository) return githubRepository;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html, text/plain, application/pdf, application/json, application/octet-stream', 'user-agent': 'Novi/0.1 importer' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3 || !response.headers.get('location')) throw Object.assign(new Error('too many redirects'), { status: 422 });
      target = await validateImportUrl(new URL(response.headers.get('location'), target), { lookupImpl });
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`remote document returned ${response.status}`), { status: 422 });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > IMPORT_MAX_BYTES) throw Object.assign(new Error('remote document exceeds 8 MB'), { status: 422 });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > IMPORT_MAX_BYTES) throw Object.assign(new Error('remote document exceeds 8 MB'), { status: 422 });
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const extracted = extractImportedText(bytes, contentType, target.toString());
    if (extracted.format === 'unsupported' || extracted.format === 'binary') throw Object.assign(new Error('unsupported remote document content type'), { status: 422 });
    if (extracted.format === 'pdf') {
      const parser = new PDFParse({ data: bytes });
      try {
        const result = await parser.getText();
        const content = String(result.text || '').trim();
        if (!content) throw Object.assign(new Error('PDF contained no extractable text'), { status: 422 });
        return { url: target.toString(), content, sourceKind: 'pdf', mimeType: contentType };
      } catch (error) {
        if (error?.status) throw error;
        throw Object.assign(new Error('PDF could not be parsed'), { status: 422 });
      }
      finally { await parser.destroy(); }
    }
    return { url: target.toString(), content: extracted.content, sourceKind: extracted.format, mimeType: contentType };
  }
  throw Object.assign(new Error('remote document could not be fetched'), { status: 422 });
}

const codeExtensions = new Set(['.c', '.cc', '.cpp', '.cjs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.json', '.jsx', '.kt', '.mjs', '.md', '.php', '.py', '.rb', '.rs', '.sh', '.sql', '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml']);
const ignoredCodePath = (path) => /(^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|target)(\/|$)/i.test(path);

async function fetchGitHubRepository(target) {
  if (target.hostname.toLowerCase() !== 'github.com') return null;
  const parts = target.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) return null;
  const [owner, repo] = parts;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/HEAD?recursive=1`;
  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'Novi/0.1 importer' } });
  if (response.status === 404) throw Object.assign(new Error('GitHub repository was not found or is private'), { status: 422 });
  if (!response.ok) throw Object.assign(new Error(`GitHub repository returned ${response.status}`), { status: 422 });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > IMPORT_MAX_BYTES) throw Object.assign(new Error('GitHub repository tree exceeds 8 MB'), { status: 422 });
  const treeBytes = Buffer.from(await response.arrayBuffer());
  if (treeBytes.length > IMPORT_MAX_BYTES) throw Object.assign(new Error('GitHub repository tree exceeds 8 MB'), { status: 422 });
  let tree;
  try { tree = JSON.parse(treeBytes.toString('utf8')); } catch { throw Object.assign(new Error('GitHub repository tree was invalid JSON'), { status: 422 }); }
  const files = (tree.tree || []).filter((entry) => entry.type === 'blob' && !ignoredCodePath(entry.path || '') && codeExtensions.has(entry.path?.slice(entry.path.lastIndexOf('.')).toLowerCase())).sort((a, b) => (a.path || '').localeCompare(b.path || '')).slice(0, 80);
  if (!files.length) throw Object.assign(new Error('GitHub repository contains no supported text files'), { status: 422 });
  const sections = [];
  let total = 0;
  for (const file of files) {
    if (Number(file.size || 0) > 250_000) continue;
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${String(file.path).split('/').map(encodeURIComponent).join('/')}`;
    const fileResponse = await fetch(rawUrl, { signal: AbortSignal.timeout(10_000), headers: { accept: 'text/plain', 'user-agent': 'Novi/0.1 importer' } });
    if (!fileResponse.ok) continue;
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (bytes.includes(0) || bytes.length > 250_000) continue;
    const text = bytes.toString('utf8');
    const section = `\n\n===== ${file.path} =====\n${text}`;
    if (total + Buffer.byteLength(section) > 850_000) break;
    sections.push(section); total += Buffer.byteLength(section);
  }
  if (!sections.length) throw Object.assign(new Error('GitHub repository text files could not be fetched'), { status: 422 });
  return { url: target.toString(), content: sections.join('').trim(), sourceKind: 'code-repository', mimeType: 'text/plain' };
}

async function principal(req, res, auth) {
  const user = await auth.authenticate(bearerToken(req));
  if (user) return user;
  if (!authRequired()) return { id: 'local', tenantId: 'local', email: 'local@novi.local' };
  send(res, 401, { error: 'Authentication required' });
  return null;
}

function owned(project, user) { return (project.tenantId || 'local') === user.tenantId; }

function activePrincipal(state, user) {
  if (user.id === 'local') return true;
  return (state.users || []).some((item) => item.id === user.id)
    && (state.memberships || []).some((item) => item.userId === user.id && item.tenantId === user.tenantId && item.status === 'active');
}

function refundUnfinishedJob(state, job) {
  const principal = { tenantId: job.tenantId, plan: 'free' };
  if (job.generationCharged && !job.generationRefunded) {
    refundGeneration(state, principal, job.generationPeriod);
    job.generationCharged = false; job.generationRefunded = true;
  }
  if (job.sourceCharged && !job.sourceRefunded) {
    refundSourceQuery(state, principal, job.sourcePeriod);
    job.sourceCharged = false; job.sourceRefunded = true;
  }
}

function removeJobs(state, predicate) {
  for (const job of (state.jobs || []).filter(predicate)) {
    if (job.status === 'queued' || job.status === 'running') refundUnfinishedJob(state, job);
  }
  state.jobs = (state.jobs || []).filter((job) => !predicate(job));
}

function hasBearerAuthorization(req) {
  return /^Bearer\s+\S+/i.test(String(req.headers.authorization || ''));
}

function hasCookieSession(req) {
  return String(req.headers.cookie || '').split(';').some((part) => {
    const [name, ...value] = part.trim().split('=');
    return name === 'novi_session' && value.join('=').length > 0;
  });
}

function cookieValue(req, name) {
  return String(req.headers.cookie || '').split(';').map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.slice(1).join('=') || null;
}

function publicWatch(config) {
  if (!config) return config;
  const { refreshToken: _refreshToken, ...safe } = config;
  return { ...safe, autoUpdate: config.autoUpdate !== false };
}

function requestOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = process.env.NOVI_TRUST_PROXY === 'true' && ['http', 'https'].includes(forwarded)
    ? forwarded
    : (req.socket.encrypted ? 'https' : 'http');
  // Keep the host bound to the actual HTTP Host header; trusting a client-supplied
  // X-Forwarded-Host would let an unsanitized proxy header defeat this check.
  const host = String(req.headers.host || '').trim();
  return host ? `${protocol}://${host}` : null;
}

function csrfViolation(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return null;
  // Bearer-authenticated API clients are not exposed to browser cookie CSRF.
  if (hasBearerAuthorization(req)) return null;
  const authBootstrap = req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(req.url?.split('?')[0]);
  if (!hasCookieSession(req) && !authBootstrap) return null;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return 'Cross-site requests are not allowed';
  const origin = req.headers.origin;
  if (origin === undefined) return authBootstrap ? null : 'Origin header is required for cookie write requests';
  const normalized = String(origin).replace(/\/$/, '');
  if (normalized !== requestOrigin(req)) return 'Origin does not match request origin';
  return null;
}

function clientRateLimitKey(req) {
  return `${req.socket.localPort || 'unknown'}:${req.socket.remoteAddress || 'unknown'}`;
}

function loginRateLimit(req, failed) {
  const address = clientRateLimitKey(req);
  const now = Date.now();
  const bucket = authFailureBuckets.get(address) || { start: now, count: 0 };
  if (now - bucket.start > 15 * 60_000) { bucket.start = now; bucket.count = 0; }
  if (!failed) { authFailureBuckets.delete(address); return null; }
  bucket.count += 1; authFailureBuckets.set(address, bucket);
  return bucket.count > 10 ? Math.ceil((15 * 60_000 - (now - bucket.start)) / 1000) : null;
}

async function requireRole(store, res, user, required) {
  const result = assertRole(await store.read(), user, required);
  if (!result.ok) { send(res, 403, { error: 'Insufficient permissions', code: 'FORBIDDEN', role: result.role, required: result.required }); return false; }
  return true;
}

async function retrieveWorkspaceKnowledge(store, project, user, limit = 6) {
  const query = `${project.topic || ''} ${project.description || ''}`.trim();
  if (!query) return [];
  try {
    if (typeof store.searchKnowledge === 'function') return await store.searchKnowledge(project.id, user.tenantId, query, limit);
    return searchProjectKnowledge(await store.read(), project.id, user.tenantId, query, limit);
  } catch (error) {
    console.warn(`Workspace knowledge retrieval failed: ${error.message}`);
    return [];
  }
}

async function api(req, res, url, store, auth, metrics, dependencies = {}) {
  metrics.requests += 1;
  const address = clientRateLimitKey(req);
  const now = Date.now();
  const bucket = requestBuckets.get(address) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1; requestBuckets.set(address, bucket);
  if (bucket.count > 240) return send(res, 429, { error: 'Too many requests' }, { 'Retry-After': '60' });
  const csrfError = csrfViolation(req);
  if (csrfError) return send(res, 403, { error: csrfError, code: 'CSRF_ORIGIN_MISMATCH' });
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { status: 'ok', version: '0.1.0' });
  if (req.method === 'GET' && url.pathname === '/api/ready') {
    try { await store.read(); validateObjectStoreConfiguration(); validateGraphConfiguration(); validateOidcConfiguration(); validateSourceAdapterConfiguration(); return send(res, 200, { status: 'ready', storage: 'ok', objectStore: objectStoreConfigured() ? 'configured' : 'inline', graphStore: graphStoreConfigured() ? 'configured' : 'inline', vectorStore: store.vectorEnabled ? 'pgvector' : process.env.NOVI_STORAGE === 'postgres' ? 'jsonb-fallback' : 'inline', browserAgent: browserAgentConfigured() ? 'configured' : 'disabled', mcpSource: mcpSourceConfigured() ? 'configured' : 'disabled' }); }
    catch (error) { console.warn(`Readiness check failed: ${error.message}`); return send(res, 503, { status: 'not_ready', storage: 'error' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const result = await auth.register(await jsonBody(req));
    if (result.errors) return send(res, 422, { error: 'Validation failed', fields: result.errors });
    if (result.conflict) return send(res, 409, { error: 'An account with this email already exists' });
    return send(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const address = clientRateLimitKey(req);
    const currentFailures = authFailureBuckets.get(address);
    if (currentFailures && currentFailures.count > 10 && Date.now() - currentFailures.start <= 15 * 60_000) return send(res, 429, { error: 'Too many failed login attempts', code: 'AUTH_RATE_LIMITED' }, { 'Retry-After': '900' });
    const result = await auth.login(await jsonBody(req));
    if (result.invalid) { const retryAfter = loginRateLimit(req, true); return send(res, retryAfter ? 429 : 401, { error: retryAfter ? 'Too many failed login attempts' : 'Invalid email or password', ...(retryAfter ? { code: 'AUTH_RATE_LIMITED' } : {}) }, retryAfter ? { 'Retry-After': String(retryAfter) } : {}); }
    loginRateLimit(req, false);
    const body = req.headers['x-novi-client'] === 'web' ? { user: result.user } : result;
    return send(res, 200, body, { 'Set-Cookie': `novi_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie()}` });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') { await auth.logout(bearerToken(req)); return send(res, 204, '', { 'Set-Cookie': `novi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie()}` }); }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const current = await auth.authenticate(bearerToken(req));
    return current ? send(res, 200, { user: current }) : send(res, 401, { error: 'Authentication required' });
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/oidc/start') {
    if (!oidcConfigured()) return send(res, 503, { error: 'OIDC provider is not configured', code: 'OIDC_UNAVAILABLE' });
    try {
      const metadata = await discoverIssuer(); const state = newState(); const nonce = newNonce(); const verifier = newVerifier();
      await store.update((next) => { next.oidcStates = (next.oidcStates || []).filter((item) => item.expiresAt > Date.now()); next.oidcStates.push({ hash: stateHash(state), nonceHash: stateHash(nonce), verifier, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 }); });
      return send(res, 302, '', { Location: createAuthorizationRequestWithPkce(metadata, state, nonce, verifier), 'Set-Cookie': `novi_oidc_state=${stateHash(state)}; HttpOnly; SameSite=Lax; Path=/api/auth/oidc; Max-Age=600${secureCookie()}`, 'Cache-Control': 'no-store' });
    } catch (error) { console.warn(`OIDC start failed: ${error.message}`); return send(res, 502, { error: 'OIDC provider is unavailable' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/oidc/callback') {
    const code = url.searchParams.get('code'); const stateParam = url.searchParams.get('state'); const error = url.searchParams.get('error');
    if (error || !code || !stateParam) return send(res, 400, { error: 'OIDC callback is incomplete' });
    const stateCookie = cookieValue(req, 'novi_oidc_state');
    if (!stateCookie || stateCookie !== stateHash(stateParam)) return send(res, 400, { error: 'OIDC state does not match the initiating browser' }, { 'Set-Cookie': `novi_oidc_state=; HttpOnly; SameSite=Lax; Path=/api/auth/oidc; Max-Age=0${secureCookie()}` });
    const consumed = await store.update((next) => {
      const index = (next.oidcStates || []).findIndex((item) => item.hash === stateHash(stateParam) && item.expiresAt > Date.now());
      if (index < 0) return null; const item = next.oidcStates[index]; next.oidcStates.splice(index, 1); return item;
    });
    if (!consumed) return send(res, 400, { error: 'OIDC state is invalid or expired' });
    try {
      const metadata = await discoverIssuer(); const tokens = await exchangeAuthorizationCode(metadata, code, consumed.verifier); if (!(await verifyIdToken(metadata, tokens.id_token, consumed.nonceHash))) throw new Error('OIDC ID token validation failed'); const profile = await fetchUserInfo(metadata, tokens.access_token); const result = await auth.oidcLogin(profile); if (result.invalid) return send(res, 403, { error: 'OIDC account linking is not allowed for this email', code: result.code || 'OIDC_LINK_REJECTED' });
      return send(res, 302, '', { Location: '/', 'Set-Cookie': [`novi_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie()}`, `novi_oidc_state=; HttpOnly; SameSite=Lax; Path=/api/auth/oidc; Max-Age=0${secureCookie()}`], 'Cache-Control': 'no-store' });
    } catch (callbackError) { console.warn(`OIDC callback failed: ${callbackError.message}`); return send(res, 502, { error: 'OIDC authentication failed' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/switch') {
    const current = await auth.authenticate(bearerToken(req));
    if (!current) return send(res, 401, { error: 'Authentication required' });
    const result = await auth.switchTenant(bearerToken(req), (await jsonBody(req)).tenantId);
    if (result.invalid) return send(res, 403, { error: 'You are not a member of that organization' });
    const body = req.headers['x-novi-client'] === 'web' ? { user: result.user } : result;
    return send(res, 200, body, { 'Set-Cookie': `novi_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie()}` });
  }
  if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
    const raw = await rawBody(req);
    if (!verifyWebhook(raw, req.headers['x-novi-signature'], process.env.NOVI_PAYMENT_WEBHOOK_SECRET)) return send(res, 401, { error: 'Invalid webhook signature' });
    let event;
    try { event = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid webhook JSON' }); }
    const result = await store.update((state) => applyWebhook(state, event));
    if (result.error) return send(res, 422, { error: result.error });
    return send(res, 200, { received: true, ...result });
  }
  const user = await principal(req, res, auth);
  if (!user) return true;
  if (req.method === 'GET' && url.pathname === '/api/metrics') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const state = await store.read();
    return send(res, 200, { metrics: { ...metrics, externalProjectionPending: externalProjectionPending(state), uptimeSeconds: Math.floor((Date.now() - Date.parse(metrics.startedAt)) / 1000) } });
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/modes') {
    return send(res, 200, { modes: agentModeCatalog(), defaultMode: 'auto' });
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/tools') {
    const state = await store.read(); const role = roleFor(state, user);
    return send(res, 200, { settings: publicToolSettings(state, user.tenantId), configurable: role === 'owner' || role === 'admin' });
  }
  if (req.method === 'PUT' && url.pathname === '/api/agent/tools') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    try {
      const input = await jsonBody(req);
      const settings = await store.update((state) => saveToolSettings(state, user.tenantId, user.id, input));
      await store.audit({ action: 'agent.tools.updated', userId: user.id, tenantId: user.tenantId, resourceId: user.tenantId, builtins: settings.builtins.filter((tool) => tool.enabled).map((tool) => tool.name), customToolCount: settings.customTools.length });
      return send(res, 200, { settings });
    } catch (error) {
      const unavailable = /NOVI_CONFIG_ENCRYPTION_KEY/.test(error.message);
      return send(res, unavailable ? 503 : 422, { error: error.message, code: unavailable ? 'SECRET_STORAGE_UNAVAILABLE' : 'AGENT_TOOL_CONFIG_INVALID' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/mcp') {
    const state = await store.read(); const role = roleFor(state, user);
    return send(res, 200, { settings: publicMcpSettings(state, user.tenantId), configurable: role === 'owner' || role === 'admin' });
  }
  if (req.method === 'PUT' && url.pathname === '/api/agent/mcp') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    try {
      const input = await jsonBody(req);
      const settings = await store.update((state) => saveMcpSettings(state, user.tenantId, user.id, input));
      await store.audit({ action: 'agent.mcp.updated', userId: user.id, tenantId: user.tenantId, resourceId: user.tenantId, serverCount: settings.servers.length });
      return send(res, 200, { settings });
    } catch (error) {
      const unavailable = /NOVI_CONFIG_ENCRYPTION_KEY/.test(error.message);
      return send(res, unavailable ? 503 : 422, { error: error.message, code: unavailable ? 'SECRET_STORAGE_UNAVAILABLE' : 'MCP_CONFIG_INVALID' });
    }
  }
  const mcpSyncMatch = url.pathname.match(/^\/api\/agent\/mcp\/servers\/([^/]+)\/sync$/);
  if (mcpSyncMatch && req.method === 'POST') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const serverId = decodeURIComponent(mcpSyncMatch[1]); const state = await store.read();
    const configured = (state.mcpServerConfigs || []).find((server) => server.id === serverId && server.tenantId === user.tenantId);
    if (!configured) return send(res, 404, { error: 'MCP server not found' });
    const revision = configured.updatedAt;
    try {
      const discovered = await discoverMcpServer(configured);
      const settings = await store.update((next) => {
        const server = (next.mcpServerConfigs || []).find((item) => item.id === serverId && item.tenantId === user.tenantId);
        if (!server || server.updatedAt !== revision) return null;
        const enabled = new Set((server.discoveredTools || []).filter((tool) => tool.enabled).map((tool) => tool.name));
        server.discoveredTools = discovered.tools.map((tool) => ({ ...tool, enabled: tool.supported !== false && enabled.has(tool.name) }));
        server.serverInfo = discovered.serverInfo; server.lastSyncedAt = new Date().toISOString(); server.updatedAt = server.lastSyncedAt; server.updatedBy = user.id;
        return publicMcpSettings(next, user.tenantId);
      });
      if (!settings) return send(res, 409, { error: 'MCP server configuration changed during discovery', code: 'MCP_CONFIG_CHANGED' });
      await store.audit({ action: 'agent.mcp.synced', userId: user.id, tenantId: user.tenantId, resourceId: serverId, toolCount: settings.servers.find((server) => server.id === serverId)?.discoveredTools?.length || 0 });
      return send(res, 200, { settings, server: settings.servers.find((server) => server.id === serverId) });
    } catch (error) {
      console.warn(`MCP server discovery failed for tenant ${user.tenantId}: ${String(error.message || '').slice(0, 240)}`);
      return send(res, 502, { error: 'The MCP server could not be discovered', code: 'MCP_SERVER_UNAVAILABLE' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/skills') {
    const state = await store.read(); const role = roleFor(state, user);
    return send(res, 200, { settings: publicSkillSettings(state, user.tenantId), configurable: role === 'owner' || role === 'admin' });
  }
  if (req.method === 'PUT' && url.pathname === '/api/agent/skills') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    try {
      const input = await jsonBody(req);
      const settings = await store.update((state) => saveSkillSettings(state, user.tenantId, user.id, input));
      await store.audit({ action: 'agent.skills.updated', userId: user.id, tenantId: user.tenantId, resourceId: user.tenantId, skillCount: settings.skills.length, enabledSkillCount: settings.skills.filter((skill) => skill.enabled).length });
      return send(res, 200, { settings });
    } catch (error) {
      return send(res, 422, { error: error.message, code: 'SKILL_CONFIG_INVALID' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/plugins') {
    const state = await store.read(); const role = roleFor(state, user);
    return send(res, 200, { settings: publicPluginSettings(state, user.tenantId), configurable: role === 'owner' || role === 'admin' });
  }
  if (req.method === 'PUT' && url.pathname === '/api/agent/plugins') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    try {
      const input = await jsonBody(req);
      const settings = await store.update((state) => savePluginSettings(state, user.tenantId, user.id, input));
      await store.audit({ action: 'agent.plugins.updated', userId: user.id, tenantId: user.tenantId, resourceId: user.tenantId, pluginCount: settings.plugins.length, enabledPluginCount: settings.plugins.filter((plugin) => plugin.enabled).length });
      return send(res, 200, { settings });
    } catch (error) { return send(res, 422, { error: error.message, code: 'PLUGIN_CONFIG_INVALID' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/org') {
    const state = await store.read();
    const organization = state.organizations.find((item) => item.id === user.tenantId) || { id: user.tenantId, name: 'Personal workspace' };
    return send(res, 200, { organization, role: roleFor(state, user) });
  }
  if (req.method === 'GET' && url.pathname === '/api/llm/providers') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const state = await store.read();
    const configs = (state.llmProviderConfigs || []).filter((config) => config.tenantId === user.tenantId).map(publicProviderConfig);
    return send(res, 200, { providers: providerCatalog(), configs, activeProvider: configs.find((config) => config.active)?.provider || null });
  }
  if (req.method === 'PUT' && url.pathname === '/api/llm/provider') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const input = await jsonBody(req);
    try {
      const config = await store.update((state) => saveProviderConfig(state, user.tenantId, user.id, input));
      await store.audit({ action: 'llm.provider.updated', userId: user.id, tenantId: user.tenantId, resourceId: config.provider, model: config.model });
      return send(res, 200, { config });
    } catch (error) {
      const unavailable = /NOVI_CONFIG_ENCRYPTION_KEY/.test(error.message);
      return send(res, unavailable ? 503 : 422, { error: error.message, code: unavailable ? 'SECRET_STORAGE_UNAVAILABLE' : 'LLM_PROVIDER_INVALID' });
    }
  }
  if (req.method === 'DELETE' && url.pathname === '/api/llm/provider') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    await store.update((state) => { for (const config of (state.llmProviderConfigs || [])) if (config.tenantId === user.tenantId) config.active = false; });
    await store.audit({ action: 'llm.provider.disabled', userId: user.id, tenantId: user.tenantId, resourceId: user.tenantId });
    return send(res, 204, '');
  }
  if (req.method === 'POST' && url.pathname === '/api/llm/provider/test') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    try {
      const config = await resolvedProviderConfig(await store.read(), user.tenantId);
      if (!config) return send(res, 409, { error: 'No active LLM provider is configured', code: 'LLM_PROVIDER_NOT_CONFIGURED' });
      const result = await testProviderConnection(config);
      await store.audit({ action: 'llm.provider.tested', userId: user.id, tenantId: user.tenantId, resourceId: config.provider, model: config.model });
      return send(res, 200, result);
    } catch (error) {
      console.warn(`LLM provider connection test failed for tenant ${user.tenantId}: ${String(error.message || '').slice(0, 200)}`);
      return send(res, 502, { error: 'The configured LLM provider could not complete the connection test', code: 'LLM_PROVIDER_UNAVAILABLE' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/orgs') {
    const state = await store.read();
    if (user.id === 'local') return send(res, 200, { organizations: [{ id: 'local', name: 'Personal workspace', role: 'owner', current: true }] });
    const memberships = (state.memberships || []).filter((item) => item.userId === user.id && item.status === 'active');
    const organizations = memberships.map((membership) => {
      const organization = (state.organizations || []).find((item) => item.id === membership.tenantId);
      return { id: membership.tenantId, name: organization?.name || 'Organization', role: membership.role, current: membership.tenantId === user.tenantId };
    }).sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name));
    return send(res, 200, { organizations });
  }
  if (req.method === 'GET' && url.pathname === '/api/org/members') {
    const state = await store.read();
    const members = state.memberships.filter((item) => item.tenantId === user.tenantId).map((membership) => ({ ...membership, user: state.users.find((candidate) => candidate.id === membership.userId)?.email || null }));
    return send(res, 200, { members });
  }
  const memberMatch = url.pathname.match(/^\/api\/org\/members\/([^/]+)$/);
  if (memberMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const memberId = decodeURIComponent(memberMatch[1]);
    const requestedRole = req.method === 'PATCH' ? String((await jsonBody(req)).role || '') : '';
    const result = await store.update((state) => {
      const membership = state.memberships.find((item) => item.tenantId === user.tenantId && item.userId === memberId && item.status === 'active');
      if (!membership || membership.role === 'owner' || memberId === user.id && membership.role === 'owner') return { error: 'Owner membership cannot be modified' };
      if (req.method === 'PATCH') {
        if (!['viewer', 'editor', 'admin'].includes(requestedRole)) return { error: 'Role must be viewer, editor, or admin' };
        membership.role = requestedRole; membership.updatedAt = new Date().toISOString(); return { membership };
      }
      membership.status = 'removed'; membership.updatedAt = new Date().toISOString(); return { membership };
    });
    if (result.error) return send(res, 422, { error: result.error });
    await store.audit({ action: req.method === 'PATCH' ? 'org.member.role_changed' : 'org.member.removed', userId: user.id, tenantId: user.tenantId, resourceId: memberId });
    return send(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/org/invitations') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const input = await jsonBody(req); const email = String(input.email || '').trim().toLowerCase(); const role = String(input.role || 'viewer');
    if (!/^\S+@\S+\.\S+$/.test(email) || !['viewer', 'editor', 'admin'].includes(role)) return send(res, 422, { error: 'Valid email and role (viewer/editor/admin) are required' });
    const invitation = await store.update((state) => {
      const existing = state.invitations.find((item) => item.tenantId === user.tenantId && item.email === email && item.status === 'pending');
      if (existing) return existing;
      const item = { id: randomUUID(), token: randomUUID(), tenantId: user.tenantId, email, role, inviterId: user.id, status: 'pending', createdAt: new Date().toISOString(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
      state.invitations.unshift(item); return item;
    });
    await store.audit({ action: 'org.invitation.created', userId: user.id, tenantId: user.tenantId, resourceId: invitation.id });
    return send(res, 201, { invitation });
  }
  const inviteMatch = url.pathname.match(/^\/api\/org\/invitations\/([^/]+)\/accept$/);
  if (req.method === 'POST' && inviteMatch) {
    const input = await jsonBody(req); const invitationId = decodeURIComponent(inviteMatch[1]);
    const accepted = await store.update((state) => {
      const item = state.invitations.find((candidate) => candidate.id === invitationId && candidate.token === input.token && candidate.status === 'pending' && candidate.expiresAt > Date.now());
      if (!item || item.email !== user.email) return null;
      const existing = state.memberships.find((membership) => membership.tenantId === item.tenantId && membership.userId === user.id);
      if (existing) existing.role = item.role;
      else state.memberships.push({ id: randomUUID(), tenantId: item.tenantId, userId: user.id, role: item.role, status: 'active', createdAt: new Date().toISOString() });
      item.status = 'accepted'; item.acceptedAt = new Date().toISOString(); return item;
    });
    return accepted ? send(res, 200, { invitation: accepted }) : send(res, 404, { error: 'Invitation is invalid, expired, or does not match the signed-in email' });
  }
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    const state = await store.read();
    return send(res, 200, { projects: state.projects.filter((item) => owned(item, user)) });
  }
  const knowledgeImportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/knowledge\/import$/);
  if (knowledgeImportMatch && req.method === 'POST') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const projectId = decodeURIComponent(knowledgeImportMatch[1]);
    const state = await store.read();
    const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const input = await jsonBody(req);
    const title = String(input.title || '').trim();
    if (!title || title.length > 200 || !input.url) return send(res, 422, { error: 'title and url are required; title must be 200 characters or less' });
    const renderMode = String(input.render || 'static');
    if (!['static', 'browser'].includes(renderMode)) return send(res, 422, { error: 'render must be static or browser' });
    try {
      let fetched;
      if (renderMode === 'browser') {
        await validateImportUrl(input.url, { lookupImpl: dependencies.dnsLookup || lookup });
        fetched = await renderWithBrowserAgent(input.url, { skipTargetDns: true });
        await validateImportUrl(fetched.url, { lookupImpl: dependencies.dnsLookup || lookup });
      }
      else fetched = await fetchImport(input.url, { lookupImpl: dependencies.dnsLookup || lookup });
      if (!fetched.content) return send(res, 422, { error: 'The remote document did not contain extractable text' });
      const result = ingestDocument({ title, content: fetched.content, sourceUrl: fetched.url, sourceKind: fetched.sourceKind, mimeType: fetched.mimeType }, { projectId, tenantId: user.tenantId });
      if (result.error) return send(res, 422, { error: result.error });
      const persisted = await store.update((next) => {
        next.documents ||= []; next.chunks ||= []; next.knowledgeEntities ||= []; next.knowledgeEdges ||= [];
        const duplicate = next.documents.find((document) => document.projectId === projectId && document.tenantId === user.tenantId && document.contentHash === result.document.contentHash);
        if (duplicate) return { duplicate };
        next.documents.unshift(result.document); next.chunks.push(...result.chunks); next.knowledgeEntities.push(...result.entities); next.knowledgeEdges.push(...result.edges);
        enqueueDocumentProjection(next, { document: result.document, content: fetched.content, entities: result.entities, edges: result.edges });
        return { document: result.document };
      });
      if (persisted?.duplicate) return send(res, 409, { error: 'This document is already indexed in the workspace', code: 'DOCUMENT_DUPLICATE', document: persisted.duplicate });
      await flushExternalProjectionJobs(store, { limit: 1 });
      const projectedDocument = (await store.read()).documents.find((item) => item.id === result.document.id && item.tenantId === user.tenantId) || result.document;
      await store.audit({ action: 'knowledge.document.imported', userId: user.id, tenantId: user.tenantId, resourceId: result.document.id });
      return send(res, 201, { document: projectedDocument, chunks: result.chunks.length, entities: result.entities.length, edges: result.edges.length, imported: true });
    } catch (error) { return send(res, error.status || 502, { error: error.status ? error.message : 'Remote document import is temporarily unavailable' }); }
  }
  const knowledgeDocumentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/knowledge\/([^/]+)$/);
  if (knowledgeDocumentMatch && req.method === 'DELETE') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const projectId = decodeURIComponent(knowledgeDocumentMatch[1]);
    const documentId = decodeURIComponent(knowledgeDocumentMatch[2]);
    const deleted = await store.update((state) => {
      const project = state.projects.find((item) => item.id === projectId && owned(item, user));
      const document = (state.documents || []).find((item) => item.id === documentId && item.projectId === projectId && item.tenantId === user.tenantId);
      if (!project || !document) return null;
      enqueueDocumentDeletion(state, { tenantId: document.tenantId, projectId, documentId, objectKey: document.objectKey, contentHash: document.contentHash });
      state.externalProjectionJobs = (state.externalProjectionJobs || []).filter((job) => job.documentId !== documentId || !['completed', 'cancelled'].includes(job.status));
      state.documents = state.documents.filter((item) => item.id !== documentId || item.tenantId !== user.tenantId);
      state.chunks = (state.chunks || []).filter((item) => item.documentId !== documentId || item.tenantId !== user.tenantId);
      state.knowledgeEntities = (state.knowledgeEntities || []).filter((item) => item.documentId !== documentId || item.tenantId !== user.tenantId);
      state.knowledgeEdges = (state.knowledgeEdges || []).filter((item) => item.documentId !== documentId || item.tenantId !== user.tenantId);
      project.updatedAt = new Date().toISOString();
      return document;
    });
    if (!deleted) return send(res, 404, { error: 'Knowledge document not found' });
    await flushExternalProjectionJobs(store, { limit: 1 });
    await store.audit({ action: 'knowledge.document.deleted', userId: user.id, tenantId: user.tenantId, resourceId: documentId, projectId });
    return send(res, 204, '');
  }
  const knowledgeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/knowledge$/);
  if (knowledgeMatch && req.method === 'GET') {
    const projectId = decodeURIComponent(knowledgeMatch[1]);
    const state = await store.read();
    const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const rawQuery = url.searchParams.get('q');
    if (rawQuery && rawQuery.length > 500) return send(res, 422, { error: 'q must be 500 characters or less' });
    const query = rawQuery?.trim();
    const results = query
      ? (typeof store.searchKnowledge === 'function' ? await store.searchKnowledge(projectId, user.tenantId, query, url.searchParams.get('limit')) : searchProjectKnowledge(state, projectId, user.tenantId, query, url.searchParams.get('limit')))
      : null;
    return query ? send(res, 200, { results }) : send(res, 200, knowledgeForProject(state, projectId, user.tenantId));
  }
  if (knowledgeMatch && req.method === 'POST') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const projectId = decodeURIComponent(knowledgeMatch[1]);
    const state = await store.read();
    const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const input = await jsonBody(req);
    const result = ingestDocument(input, { projectId, tenantId: user.tenantId });
    if (result.error) return send(res, 422, { error: result.error });
    const persisted = await store.update((next) => {
      next.documents ||= []; next.chunks ||= []; next.knowledgeEntities ||= []; next.knowledgeEdges ||= [];
      const duplicate = next.documents.find((document) => document.projectId === projectId && document.tenantId === user.tenantId && document.contentHash === result.document.contentHash);
      if (duplicate) return { duplicate };
      next.documents.unshift(result.document); next.chunks.push(...result.chunks); next.knowledgeEntities.push(...result.entities); next.knowledgeEdges.push(...result.edges);
      enqueueDocumentProjection(next, { document: result.document, content: result.content, entities: result.entities, edges: result.edges });
      return { document: result.document };
    });
    if (persisted?.duplicate) return send(res, 409, { error: 'This document is already indexed in the workspace', code: 'DOCUMENT_DUPLICATE', document: persisted.duplicate });
    await flushExternalProjectionJobs(store, { limit: 1 });
    const projectedDocument = (await store.read()).documents.find((item) => item.id === result.document.id && item.tenantId === user.tenantId) || result.document;
    await store.audit({ action: 'knowledge.document.ingested', userId: user.id, tenantId: user.tenantId, resourceId: result.document.id });
    return send(res, 201, { document: projectedDocument, chunks: result.chunks.length, entities: result.entities.length, edges: result.edges.length });
  }
  const watchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/watch$/);
  if (watchMatch && (req.method === 'GET' || req.method === 'PUT')) {
    const projectId = decodeURIComponent(watchMatch[1]);
    const state = await store.read();
    const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    if (req.method === 'GET') return send(res, 200, { watch: publicWatch(state.watchConfigs.find((item) => item.projectId === projectId && item.tenantId === user.tenantId) || { projectId, tenantId: user.tenantId, enabled: false, frequency: 'manual' }) });
    if (!await requireRole(store, res, user, 'editor')) return true;
    const input = await jsonBody(req);
    if (typeof input.enabled !== 'boolean' || !['manual', 'daily', 'weekly'].includes(input.frequency || 'manual') || input.autoUpdate !== undefined && typeof input.autoUpdate !== 'boolean') return send(res, 422, { error: 'enabled and autoUpdate must be boolean; frequency must be manual, daily, or weekly' });
    const watch = await store.update((next) => {
      next.watchConfigs ||= [];
      const existing = next.watchConfigs.find((item) => item.projectId === projectId && item.tenantId === user.tenantId);
      const value = { projectId, tenantId: user.tenantId, enabled: input.enabled, frequency: input.frequency || 'manual', autoUpdate: input.autoUpdate ?? existing?.autoUpdate ?? true, updatedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, value); else next.watchConfigs.push(value);
      return value;
    });
    await store.audit({ action: 'project.watch.updated', userId: user.id, tenantId: user.tenantId, resourceId: projectId });
    return send(res, 200, { watch });
  }
  const refreshMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/refresh$/);
  if (refreshMatch && req.method === 'POST') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const projectId = decodeURIComponent(refreshMatch[1]);
    const state = await store.read();
    const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const claim = await store.update((next) => {
      next.watchConfigs ||= [];
      const config = next.watchConfigs.find((item) => item.projectId === projectId && item.tenantId === user.tenantId);
      const started = Date.parse(config?.refreshStartedAt || '');
      const stale = config?.refreshing && (!Number.isFinite(started) || Date.now() - started >= 15 * 60 * 1000);
      if (config?.refreshing && !stale) return null;
      const value = config || { projectId, tenantId: user.tenantId, enabled: false, frequency: 'manual' };
      value.refreshing = true; value.refreshStartedAt = new Date().toISOString(); value.refreshToken = randomUUID(); value.lastError = null;
      if (!config) next.watchConfigs.push(value);
      return { ...value };
    });
    if (!claim) return send(res, 409, { error: 'Source refresh already in progress', code: 'REFRESH_IN_PROGRESS' });
    const quota = await store.update((next) => consumeSourceQuery(next, user));
    if (!quota.allowed) {
      await store.update((next) => { const config = next.watchConfigs.find((item) => item.projectId === projectId && item.tenantId === user.tenantId && item.refreshToken === claim.refreshToken); if (config) { config.refreshing = false; config.refreshToken = null; config.refreshStartedAt = null; } });
      return send(res, 402, { error: 'Monthly source query limit reached', code: 'SOURCE_QUOTA_EXCEEDED', plan: quota.plan, usage: quota.usage, limits: quota.limits });
    }
    metrics.refreshStarted += 1;
    try {
      let sources = await searchKnowledgeSources(project.topic, 5);
      if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await verifyEvidenceSources(sources);
      const snapshot = await store.update((next) => {
        const activeWatch = next.watchConfigs.find((entry) => entry.tenantId === user.tenantId && entry.projectId === projectId && entry.refreshToken === claim.refreshToken);
        if (!activeWatch) return null;
        next.sourceSnapshots ||= [];
        const previous = (next.sourceSnapshots || []).find((entry) => entry.tenantId === user.tenantId && entry.projectId === projectId && entry.autoUpdateStatus === 'completed');
        const changes = sourceChanges(previous?.sources || [], sources);
        const item = { id: randomUUID(), projectId, tenantId: user.tenantId, topic: project.topic, fetchedAt: new Date().toISOString(), sourceCount: sources.length, sources, trigger: 'manual', changeStatus: changes.changed ? 'changed' : 'unchanged', changes };
        next.sourceSnapshots.unshift(item);
        let retained = 0;
        next.sourceSnapshots = next.sourceSnapshots.filter((entry) => {
          if (entry.tenantId !== user.tenantId || entry.projectId !== projectId) return true;
          retained += 1;
          return retained <= 20;
        });
        activeWatch.lastRefreshedAt = item.fetchedAt; activeWatch.refreshing = false; activeWatch.refreshToken = null; activeWatch.refreshStartedAt = null; activeWatch.lastError = null;
        return item;
      });
      if (!snapshot) {
        await store.update((next) => { refundSourceQuery(next, user, quota.usage.period); });
        metrics.refreshFailed += 1;
        return send(res, 409, { error: 'Source refresh lease was superseded', code: 'REFRESH_LEASE_SUPERSEDED' });
      }
      await store.audit({ action: 'project.sources.refreshed', userId: user.id, tenantId: user.tenantId, resourceId: projectId });
      const update = await updateProjectFromSnapshot(store, snapshot, user);
      metrics.refreshCompleted += 1;
      return send(res, 200, { snapshot, update });
    } catch (error) {
      await store.update((next) => { refundSourceQuery(next, user, quota.usage.period); const config = next.watchConfigs.find((item) => item.projectId === projectId && item.tenantId === user.tenantId && item.refreshToken === claim.refreshToken); if (config) { config.refreshing = false; config.refreshToken = null; config.refreshStartedAt = null; config.lastError = 'PROVIDER_UNAVAILABLE'; } });
      console.warn(`Source refresh failed: ${error.message}`);
      metrics.refreshFailed += 1;
      return send(res, 502, { error: 'Source refresh is temporarily unavailable' });
    }
  }
  const snapshotsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/snapshots$/);
  if (snapshotsMatch && req.method === 'GET') {
    const projectId = decodeURIComponent(snapshotsMatch[1]);
    const state = await store.read();
    const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const requested = Number(url.searchParams.get('limit') || 20);
    const limit = Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 20));
    return send(res, 200, { snapshots: (state.sourceSnapshots || []).filter((item) => item.projectId === projectId && item.tenantId === user.tenantId).slice(0, limit) });
  }
  if (req.method === 'GET' && url.pathname === '/api/me/export') {
    const state = await store.read();
    const payload = { user: { id: user.id, tenantId: user.tenantId, email: user.email, plan: user.plan, role: user.role }, organizations: state.organizations.filter((item) => item.id === user.tenantId), memberships: state.memberships.filter((item) => item.tenantId === user.tenantId), invitations: state.invitations.filter((item) => item.tenantId === user.tenantId).map(({ token, ...safe }) => safe), subscriptions: state.subscriptions.filter((item) => item.tenantId === user.tenantId), paymentEvents: state.paymentEvents.filter((item) => item.tenantId === user.tenantId), llmProviderConfigs: (state.llmProviderConfigs || []).filter((item) => item.tenantId === user.tenantId).map(publicProviderConfig), agentToolSettings: publicToolSettings(state, user.tenantId), mcpSettings: publicMcpSettings(state, user.tenantId), skillSettings: publicSkillSettings(state, user.tenantId), pluginSettings: publicPluginSettings(state, user.tenantId), projects: state.projects.filter((item) => owned(item, user)), jobs: state.jobs.filter((item) => item.tenantId === user.tenantId), workspaceFiles: (state.workspaceFiles || []).filter((item) => item.tenantId === user.tenantId), agentMemories: (state.agentMemories || []).filter((item) => item.tenantId === user.tenantId), documents: state.documents.filter((item) => item.tenantId === user.tenantId), chunks: state.chunks.filter((item) => item.tenantId === user.tenantId), knowledgeEntities: state.knowledgeEntities.filter((item) => item.tenantId === user.tenantId), knowledgeEdges: state.knowledgeEdges.filter((item) => item.tenantId === user.tenantId), watchConfigs: state.watchConfigs.filter((item) => item.tenantId === user.tenantId).map(publicWatch), sourceSnapshots: state.sourceSnapshots.filter((item) => item.tenantId === user.tenantId), externalProjectionJobs: (state.externalProjectionJobs || []).filter((item) => item.tenantId === user.tenantId).map(({ content: _content, ...safe }) => safe), usage: state.usage.filter((item) => item.tenantId === user.tenantId), audit: state.audit.filter((item) => item.tenantId === user.tenantId) };
    payload.agentSessions = (state.agentSessions || []).filter((item) => item.tenantId === user.tenantId).map(publicAgentSession);
    return send(res, 200, payload, { 'Content-Disposition': 'attachment; filename="novi-data.json"' });
  }
  if (req.method === 'GET' && (url.pathname === '/api/billing' || url.pathname === '/api/usage')) {
    return send(res, 200, billingSnapshot(await store.read(), user));
  }
  if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const input = await jsonBody(req);
    try {
      const result = await createCheckoutSession({ tenantId: user.tenantId, userId: user.id, email: user.email, plan: input.plan, returnUrl: input.returnUrl });
      if (result.error) return send(res, 422, { error: result.error });
      if (result.unavailable) return send(res, 503, { error: 'Payment provider is not configured', code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
      return send(res, 200, result);
    } catch (error) { console.warn(`Payment checkout failed: ${error.message}`); return send(res, 502, { error: 'Payment provider is temporarily unavailable' }); }
  }
  if (req.method === 'DELETE' && url.pathname === '/api/me') {
    if (user.id === 'local') return send(res, 403, { error: 'A signed-in account is required' });
    const deletion = await store.update((state) => {
      const activeMemberships = state.memberships.filter((item) => item.userId === user.id && item.status === 'active');
      const ownedShared = activeMemberships.find((membership) => membership.role === 'owner' && state.memberships.some((item) => item.tenantId === membership.tenantId && item.status === 'active' && item.userId !== user.id));
      if (ownedShared) return { error: 'Transfer organization ownership or remove other members before deleting this account' };
      const ownedTenants = new Set(activeMemberships.filter((item) => item.role === 'owner').map((item) => item.tenantId));
      for (const document of (state.documents || []).filter((item) => ownedTenants.has(item.tenantId))) {
        enqueueDocumentDeletion(state, { tenantId: document.tenantId, projectId: document.projectId, documentId: document.id, objectKey: document.objectKey, contentHash: document.contentHash, suppressAudit: true, purgeAfterCompletion: true });
      }
      const deletedDocumentIds = new Set((state.documents || []).filter((item) => ownedTenants.has(item.tenantId)).map((item) => item.id));
      state.externalProjectionJobs = (state.externalProjectionJobs || []).filter((job) => !deletedDocumentIds.has(job.documentId) || !['completed', 'cancelled'].includes(job.status));
      // Delete organizations owned solely by this user; detach the user from shared organizations.
      state.projects = state.projects.filter((item) => !ownedTenants.has(item.tenantId));
      removeJobs(state, (item) => ownedTenants.has(item.tenantId) || item.userId === user.id);
      state.agentSessions = (state.agentSessions || []).filter((item) => !ownedTenants.has(item.tenantId) && item.createdBy !== user.id);
      state.documents = state.documents.filter((item) => !ownedTenants.has(item.tenantId));
      state.chunks = state.chunks.filter((item) => !ownedTenants.has(item.tenantId));
      state.knowledgeEntities = state.knowledgeEntities.filter((item) => !ownedTenants.has(item.tenantId));
      state.knowledgeEdges = state.knowledgeEdges.filter((item) => !ownedTenants.has(item.tenantId));
      state.watchConfigs = state.watchConfigs.filter((item) => !ownedTenants.has(item.tenantId));
      state.sourceSnapshots = state.sourceSnapshots.filter((item) => !ownedTenants.has(item.tenantId));
      state.audit = state.audit.filter((item) => !ownedTenants.has(item.tenantId) && item.userId !== user.id);
      state.usage = state.usage.filter((item) => !ownedTenants.has(item.tenantId));
      state.organizations = state.organizations.filter((item) => !ownedTenants.has(item.id));
      state.invitations = state.invitations.filter((item) => !ownedTenants.has(item.tenantId) && item.inviterId !== user.id);
      state.subscriptions = state.subscriptions.filter((item) => !ownedTenants.has(item.tenantId));
      state.paymentEvents = state.paymentEvents.filter((item) => !ownedTenants.has(item.tenantId));
      state.llmProviderConfigs = (state.llmProviderConfigs || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.agentToolConfigs = (state.agentToolConfigs || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.mcpServerConfigs = (state.mcpServerConfigs || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.agentSkillConfigs = (state.agentSkillConfigs || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.agentPluginConfigs = (state.agentPluginConfigs || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.workspaceFiles = (state.workspaceFiles || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.agentMemories = (state.agentMemories || []).filter((item) => !ownedTenants.has(item.tenantId));
      state.memberships = state.memberships.filter((item) => !ownedTenants.has(item.tenantId) && item.userId !== user.id);
      state.sessions = state.sessions.filter((item) => item.userId !== user.id);
      state.users = state.users.filter((item) => item.id !== user.id);
      return { mode: 'account' };
    });
    if (deletion.error) return send(res, 409, { error: deletion.error, code: 'OWNERSHIP_TRANSFER_REQUIRED' });
    await flushExternalProjectionJobs(store, { limit: 100 });
    return send(res, 204, '', { 'Set-Cookie': `novi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie()}` });
  }
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const topic = url.searchParams.get('topic') || '';
    if (!topic.trim()) return send(res, 422, { error: 'topic query is required' });
    if (topic.length > 300) return send(res, 422, { error: 'topic query must be 300 characters or less' });
    const quota = await store.update((state) => consumeSourceQuery(state, user));
    if (!quota.allowed) return send(res, 402, { error: 'Monthly source query limit reached', code: 'SOURCE_QUOTA_EXCEEDED', plan: quota.plan, usage: quota.usage, limits: quota.limits });
    try {
      let sources = await searchKnowledgeSources(topic, 5);
      if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await verifyEvidenceSources(sources);
      return send(res, 200, { sources, live: true });
    }
    catch (error) {
      await store.update((state) => { refundSourceQuery(state, user, quota.usage.period); });
      console.warn(`Source search failed: ${error.message}`);
      return send(res, 502, { error: 'Source search is temporarily unavailable' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const input = await jsonBody(req);
    const errors = validateProject(input);
    if (Object.keys(errors).length) return send(res, 422, { error: 'Validation failed', fields: errors });
    const project = await store.createProject(input, user);
    const session = await store.update((state) => ensureAgentSession(state, project, user));
    await store.audit({ action: 'project.created', userId: user.id, tenantId: user.tenantId, resourceId: project.id });
    return send(res, 201, { project, session: publicAgentSession(session) });
  }

  const sessionCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
  if (sessionCollectionMatch && (req.method === 'GET' || req.method === 'POST')) {
    const projectId = decodeURIComponent(sessionCollectionMatch[1]);
    const project = (await store.read()).projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    if (req.method === 'POST' && !await requireRole(store, res, user, 'editor')) return true;
    let title = '';
    if (req.method === 'POST') {
      title = String((await jsonBody(req)).title || '').trim();
      if (title.length > 120) return send(res, 422, { error: 'title must be 120 characters or less' });
    }
    const result = await store.update((state) => {
      const current = state.projects.find((item) => item.id === projectId && owned(item, user));
      if (!current) return null;
      const session = req.method === 'POST' ? createAgentSession(state, current, user, { title }) : ensureAgentSession(state, current, user);
      const sessions = (state.agentSessions || []).filter((item) => item.projectId === projectId && item.tenantId === user.tenantId).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      return { session, sessions };
    });
    if (!result) return send(res, 404, { error: 'Project not found' });
    if (req.method === 'POST') await store.audit({ action: 'agent.session.created', userId: user.id, tenantId: user.tenantId, resourceId: result.session.id, projectId });
    return send(res, req.method === 'POST' ? 201 : 200, { sessions: result.sessions.map(sessionSummary), ...(req.method === 'POST' ? { session: publicAgentSession(result.session) } : {}) });
  }
  const sessionDetailMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)$/);
  if (sessionDetailMatch && (req.method === 'GET' || req.method === 'DELETE')) {
    const projectId = decodeURIComponent(sessionDetailMatch[1]); const sessionId = decodeURIComponent(sessionDetailMatch[2]);
    const state = await store.read(); const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const session = findAgentSession(state, sessionId, projectId, user.tenantId);
    if (!session) return send(res, 404, { error: 'Agent session not found' });
    if (req.method === 'GET') return send(res, 200, { session: publicAgentSession(session) });
    if (!await requireRole(store, res, user, 'editor')) return true;
    const deletion = await store.update((next) => {
      const current = findAgentSession(next, sessionId, projectId, user.tenantId);
      if (!current) return 'missing';
      if (current.status === 'running') return 'active';
      next.agentSessions = (next.agentSessions || []).filter((item) => item.id !== sessionId || item.projectId !== projectId || item.tenantId !== user.tenantId);
      return 'deleted';
    });
    if (deletion === 'missing') return send(res, 404, { error: 'Agent session not found' });
    if (deletion === 'active') return send(res, 409, { error: 'An active Agent session cannot be deleted', code: 'AGENT_SESSION_ACTIVE' });
    await store.audit({ action: 'agent.session.deleted', userId: user.id, tenantId: user.tenantId, resourceId: sessionId, projectId });
    return send(res, 204, '');
  }

  const conversationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/messages$/);
  if (req.method === 'POST' && conversationMatch) {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const projectId = decodeURIComponent(conversationMatch[1]); const sessionId = decodeURIComponent(conversationMatch[2]);
    const state = await store.read(); const project = state.projects.find((item) => item.id === projectId && owned(item, user));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const session = findAgentSession(state, sessionId, projectId, user.tenantId);
    if (!session) return send(res, 404, { error: 'Agent session not found', code: 'AGENT_SESSION_NOT_FOUND' });
    if (session.status === 'running' || project.status === 'generating') return send(res, 409, { error: 'Agent session or workspace is already running', code: 'AGENT_SESSION_ACTIVE' });
    const input = await jsonBody(req);
    const prompt = String(input.prompt || '').trim();
    if (!prompt || prompt.length > 20_000) return send(res, 422, { error: 'prompt is required and must be 20000 characters or less' });
    let requestedMode;
    try { requestedMode = validateRequestedMode(input.mode || 'auto'); }
    catch (error) { return send(res, error.status || 422, { error: error.message, code: 'AGENT_MODE_INVALID' }); }
    let language;
    try { language = normalizeWikiLanguage(input.language || project.wikiLanguage); }
    catch (error) { return send(res, error.status || 422, { error: error.message, code: error.code || 'WIKI_LANGUAGE_INVALID' }); }
    const providerConfig = await resolvedProviderConfig(state, user.tenantId);
    if (!providerConfig) return send(res, 409, { error: 'No active LLM provider configured', code: 'LLM_PROVIDER_REQUIRED' });
    const selectedMode = selectAgentMode(prompt, { requestedMode });
    const quota = await store.update((next) => consumeGeneration(next, user));
    if (!quota.allowed) return send(res, 402, { error: 'Monthly generation limit reached', code: 'GENERATION_QUOTA_EXCEEDED', plan: quota.plan, usage: quota.usage, limits: quota.limits });
    const generationPeriod = quota.usage.period;
    let sourceCharged = false; let sourcePeriod = null;
    if (process.env.NOVI_LIVE_SOURCES === 'true') {
      const sourceQuota = await store.update((next) => consumeSourceQuery(next, user));
      if (!sourceQuota.allowed) {
        await store.update((next) => refundGeneration(next, user, generationPeriod));
        return send(res, 402, { error: 'Monthly source query limit reached', code: 'SOURCE_QUOTA_EXCEEDED', plan: sourceQuota.plan, usage: sourceQuota.usage, limits: sourceQuota.limits });
      }
      sourceCharged = true; sourcePeriod = sourceQuota.usage.period;
    }
    let job;
    try {
      job = await store.update((next) => {
        const currentProject = next.projects.find((item) => item.id === projectId && owned(item, user));
        const currentSession = findAgentSession(next, sessionId, projectId, user.tenantId);
        if (!currentProject || !currentSession) return null;
        if (currentProject.status === 'generating' || currentSession.status === 'running') return { conflict: true };
        const createdAt = new Date().toISOString();
        const created = { id: randomUUID(), type: 'refine', projectId, sessionId, userId: user.id, tenantId: user.tenantId, prompt, requestedMode, language, currentMode: selectedMode.mode, currentModeLabel: publicMode(selectedMode.mode).name, modeReason: selectedMode.reason, previousStatus: currentProject.status, status: 'queued', progress: 0, generationCharged: true, sourceCharged, generationPeriod, sourcePeriod, createdAt, updatedAt: createdAt };
        const message = beginSessionRun(currentSession, { jobId: created.id, prompt, requestedMode, currentMode: selectedMode.mode });
        updateSessionRun(currentSession, { language });
        currentProject.status = 'generating'; currentProject.updatedAt = createdAt;
        created.userMessageId = message.id; next.jobs.unshift(created); return created;
      });
    } catch (error) {
      await store.update((next) => { refundGeneration(next, user, generationPeriod); if (sourceCharged) refundSourceQuery(next, user, sourcePeriod); });
      throw error;
    }
    if (!job || job.conflict) {
      await store.update((next) => { refundGeneration(next, user, generationPeriod); if (sourceCharged) refundSourceQuery(next, user, sourcePeriod); });
      return send(res, job?.conflict ? 409 : 404, { error: job?.conflict ? 'Agent session or workspace is already running' : 'Agent session not found', code: job?.conflict ? 'AGENT_SESSION_ACTIVE' : 'AGENT_SESSION_NOT_FOUND' });
    }
    metrics.generationStarted += 1;
    void runGeneration(store, auth, job.id, project, user, job.previousStatus, sourceCharged, generationPeriod, sourcePeriod, metrics, dependencies);
    return send(res, 202, { job, sessionId });
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const jobEventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
  if (req.method === 'GET' && jobEventsMatch) return streamJobEvents(req, res, store, user, decodeURIComponent(jobEventsMatch[1]));
  if (req.method === 'GET' && jobMatch) {
    const job = (await store.read()).jobs.find((item) => item.id === decodeURIComponent(jobMatch[1]) && item.tenantId === user.tenantId);
    return job ? send(res, 200, { job }) : send(res, 404, { error: 'Job not found' });
  }
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(generate|export|pin))?$/);
  if (!match) return false;
  const id = decodeURIComponent(match[1]);
  const action = match[2];

  if (req.method === 'GET' && !action) {
    const project = (await store.read()).projects.find((item) => item.id === id && owned(item, user));
    return project ? send(res, 200, { project }) : send(res, 404, { error: 'Project not found' });
  }
  if (req.method === 'POST' && action === 'generate') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const current = (await store.read()).projects.find((entry) => entry.id === id && owned(entry, user));
    if (!current) return send(res, 404, { error: 'Project not found' });
    if (current.status === 'generating') return send(res, 409, { error: 'Generation already in progress', code: 'GENERATION_IN_PROGRESS' });
    const generationInput = await jsonBody(req);
    const prompt = String(generationInput.prompt || current.description || current.topic || '').trim();
    if (!prompt || prompt.length > 20_000) return send(res, 422, { error: 'prompt is required and must be 20000 characters or less' });
    let requestedMode;
    try { requestedMode = validateRequestedMode(generationInput.mode || 'auto'); }
    catch (error) { return send(res, error.status || 422, { error: error.message, code: 'AGENT_MODE_INVALID' }); }
    let language;
    try { language = normalizeWikiLanguage(generationInput.language || current.wikiLanguage); }
    catch (error) { return send(res, error.status || 422, { error: error.message, code: error.code || 'WIKI_LANGUAGE_INVALID' }); }
    const selectedMode = selectAgentMode(prompt, { requestedMode });
    const requestedSessionId = String(generationInput.sessionId || '').trim();
    if (requestedSessionId.length > 100) return send(res, 422, { error: 'sessionId is invalid' });
    const selectedSession = await store.update((state) => {
      const project = state.projects.find((entry) => entry.id === id && owned(entry, user));
      if (!project) return null;
      return requestedSessionId ? findAgentSession(state, requestedSessionId, id, user.tenantId) : ensureAgentSession(state, project, user);
    });
    if (!selectedSession) return send(res, 404, {
      error: requestedSessionId ? 'Agent session not found' : 'Project not found',
      code: requestedSessionId ? 'AGENT_SESSION_NOT_FOUND' : 'PROJECT_NOT_FOUND',
    });
    if (selectedSession.status === 'running') return send(res, 409, { error: 'Agent session is already running', code: 'AGENT_SESSION_ACTIVE' });
    const quota = await store.update((state) => consumeGeneration(state, user));
    if (!quota.allowed) return send(res, 402, { error: 'Monthly generation limit reached', code: 'GENERATION_QUOTA_EXCEEDED', plan: quota.plan, usage: quota.usage, limits: quota.limits });
    const generationPeriod = quota.usage.period;
    metrics.generationStarted += 1;
    let sourceCharged = false;
    let sourcePeriod = null;
    if (process.env.NOVI_LIVE_SOURCES === 'true') {
      const sourceQuota = await store.update((state) => consumeSourceQuery(state, user));
      if (!sourceQuota.allowed) {
        await store.update((state) => { refundGeneration(state, user, generationPeriod); });
        return send(res, 402, { error: 'Monthly source query limit reached', code: 'SOURCE_QUOTA_EXCEEDED', plan: sourceQuota.plan, usage: sourceQuota.usage, limits: sourceQuota.limits });
      }
      sourceCharged = true; sourcePeriod = sourceQuota.usage.period;
    }
    if (url.searchParams.get('async') === 'true') {
      let job;
      try {
        job = await store.update((state) => {
          const item = state.projects.find((entry) => entry.id === id && owned(entry, user));
          if (!item) return null;
          if (item.status === 'generating') return { conflict: true };
          const createdAt = new Date().toISOString();
          const created = { id: randomUUID(), type: 'generate', projectId: id, sessionId: selectedSession.id, userId: user.id, tenantId: user.tenantId, prompt, requestedMode, language, currentMode: selectedMode.mode, currentModeLabel: publicMode(selectedMode.mode).name, modeReason: selectedMode.reason, modeHistory: [{ from: null, to: selectedMode.mode, reason: selectedMode.reason, at: createdAt }], status: 'queued', progress: 0, previousStatus: item.status, generationCharged: true, sourceCharged, generationPeriod, sourcePeriod, createdAt, updatedAt: createdAt };
          const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
          if (!session) return { sessionMissing: true };
          if (session.status === 'running') return { conflict: true };
          const message = beginSessionRun(session, { jobId: created.id, prompt, requestedMode, currentMode: selectedMode.mode });
          updateSessionRun(session, { language });
          created.userMessageId = message.id;
          item.status = 'generating'; item.updatedAt = new Date().toISOString();
          state.jobs.unshift(created);
          return created;
        });
      } catch (error) {
        await store.update((state) => { refundGeneration(state, user, generationPeriod); if (sourceCharged) refundSourceQuery(state, user, sourcePeriod); });
        throw error;
      }
      if (!job || job.conflict || job.sessionMissing) {
        await store.update((state) => { refundGeneration(state, user, generationPeriod); if (sourceCharged) refundSourceQuery(state, user, sourcePeriod); });
        return send(res, job?.sessionMissing ? 404 : 409, { error: job?.sessionMissing ? 'Agent session not found' : 'Generation already in progress', code: job?.sessionMissing ? 'AGENT_SESSION_NOT_FOUND' : 'GENERATION_IN_PROGRESS' });
      }
      void runGeneration(store, auth, job.id, current, user, job.previousStatus, sourceCharged, generationPeriod, sourcePeriod, metrics, dependencies);
      return send(res, 202, { job, sessionId: selectedSession.id });
    }
    const knowledgeContext = await retrieveWorkspaceKnowledge(store, current, user);
    let marked;
    const syncRunId = `sync:${randomUUID()}`;
    try {
      marked = await store.update((state) => {
        const item = state.projects.find((entry) => entry.id === id && owned(entry, user));
        if (!item || !owned(item, user)) return null;
        if (item.status === 'generating') return { conflict: true };
        const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
        if (!session) return { sessionMissing: true };
        if (session.status === 'running') return { conflict: true };
        beginSessionRun(session, { jobId: syncRunId, prompt, requestedMode, currentMode: selectedMode.mode });
        updateSessionRun(session, { language });
        item.status = 'generating';
        item.updatedAt = new Date().toISOString();
        return { ...item, artifacts: [...item.artifacts] };
      });
    } catch (error) {
      await store.update((state) => { refundGeneration(state, user, generationPeriod); if (sourceCharged) refundSourceQuery(state, user, sourcePeriod); });
      throw error;
    }
    if (!marked || marked.conflict || marked.sessionMissing) {
      await store.update((state) => { refundGeneration(state, user, generationPeriod); if (sourceCharged) refundSourceQuery(state, user, sourcePeriod); });
      if (marked?.conflict) return send(res, 409, { error: 'Generation already in progress', code: 'GENERATION_IN_PROGRESS' });
      return send(res, 404, { error: marked?.sessionMissing ? 'Agent session not found' : 'Project not found', code: marked?.sessionMissing ? 'AGENT_SESSION_NOT_FOUND' : 'PROJECT_NOT_FOUND' });
    }
    let artifact;
    try {
      const runtimeState = await store.read();
      const providerConfig = await resolvedProviderConfig(runtimeState, user.tenantId);
      const selectedPlugins = providerConfig ? resolvePlugins(runtimeState, user.tenantId, marked, prompt) : [];
      const skills = providerConfig ? resolveSkills(runtimeState, user.tenantId, marked, prompt, { pluginSkillNames: selectedPlugins.flatMap((plugin) => plugin.skillNames || []) }) : [];
      const tools = [...(await resolvedTools(runtimeState, user.tenantId)).filter((tool) => !sourceAccessTool(tool.name) || sourceCharged), ...await resolvedMcpTools(runtimeState, user.tenantId)];
      const plugins = bindPluginTools(selectedPlugins, tools);
      const appliedSkills = skillProvenance(skills);
      const appliedPlugins = pluginProvenance(plugins);
      if (!await store.update((state) => {
        const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
        if (!session?.activeRun || session.activeRun.jobId !== syncRunId) return false;
        updateSessionRun(session, { skills: appliedSkills, plugins: appliedPlugins }); return true;
      })) throw new Error('Generation was cancelled');
      const toolExecutor = createToolExecutor({ store, project: marked, principal: user, allowSourceAccess: sourceCharged });
      const onTool = async (call) => store.update((state) => {
        const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
        if (!session?.activeRun || session.activeRun.jobId !== syncRunId) return false;
        recordSessionRunEvent(state, session, { id: `tool:${call.id}`, type: 'tool', actor: call.label || call.tool, title: `Tool ${call.status}`, status: call.status, mode: selectedMode.mode, input: call.input, output: call.output, summary: call.status === 'running' ? 'Agent requested a tool call' : `Tool call ${call.status}`, createdAt: call.startedAt || new Date().toISOString(), ...(call.completedAt ? { completedAt: call.completedAt } : {}), ...(call.error ? { error: call.error } : {}) });
        updateSessionToolCall(session, call); return true;
      });
      const onStage = async (stage) => store.update((state) => {
        const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
        if (!session?.activeRun || session.activeRun.jobId !== syncRunId) return false;
        recordSessionRunEvent(state, session, { id: `stage:${stage.id}:${stage.startedAt || stage.completedAt || syncRunId}`, type: stage.id === 'references' ? 'reference' : 'stage', actor: stage.name, title: `${stage.name} ${stage.status}`, status: stage.status, stageId: stage.id, mode: stage.mode || selectedMode.mode, createdAt: stage.startedAt || new Date().toISOString(), ...(stage.completedAt ? { completedAt: stage.completedAt } : {}), ...(stage.query ? { input: { query: stage.query, ...(stage.queries ? { queries: stage.queries } : {}) } } : {}), output: { ...(stage.outputKeys ? { outputKeys: stage.outputKeys } : {}), ...(Number.isFinite(stage.sourceCount) ? { sourceCount: stage.sourceCount } : {}), ...(stage.sourceKinds ? { sourceKinds: stage.sourceKinds } : {}) }, ...(stage.usage ? { usage: stage.usage } : {}), ...(stage.warning ? { warning: stage.warning } : {}), ...(stage.error ? { error: stage.error } : {}), summary: stage.status === 'running' ? 'Agent stage started' : `Agent stage ${stage.status}` });
        updateSessionRun(session, { currentMode: stage.mode || selectedMode.mode, currentStage: stage.name, progress: stage.progress || session.activeRun.progress, ...(stage.expertGoal ? { expertGoal: stage.expertGoal, expertRoles: stage.expertRoles || [] } : {}), ...(stage.id === 'references' ? { referenceDiscovery: { query: stage.query, ...(stage.queries ? { queries: stage.queries } : {}), status: stage.status, sourceCount: stage.sourceCount || 0, sourceKinds: stage.sourceKinds || [] } } : {}) });
        return true;
      });
      const onMode = async (event) => store.update((state) => {
        const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
        if (!session?.activeRun || session.activeRun.jobId !== syncRunId) return false;
        recordSessionRunEvent(state, session, { id: `mode:${event.mode}:${session.activeRun.runEvents?.length || 0}:${Date.now()}`, type: 'mode', actor: 'Agent router', title: 'Agent mode decision', status: event.status || 'running', mode: event.mode, summary: event.reason || 'Runtime mode selected', output: { mode: event.mode, label: event.label || publicMode(event.mode).name, reason: event.reason || '' }, createdAt: new Date().toISOString() });
        updateSessionRun(session, { currentMode: event.mode, currentStage: event.status === 'planning' ? 'Planning execution' : session.activeRun.currentStage, progress: Math.max(session.activeRun.progress || 0, event.progress || 0) }); return true;
      });
      const onModel = async (event) => store.update((state) => {
        const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
        if (!session?.activeRun || session.activeRun.jobId !== syncRunId) return false;
        recordSessionRunEvent(state, session, event);
        updateSessionRun(session, { currentStage: event.type === 'model-request' ? `${event.actor} sending` : event.status === 'streaming' ? `${event.actor} streaming` : `${event.actor} replied` }); return true;
      });
      let successfulReferenceQueries = 0;
      const referenceRetriever = sourceCharged ? async ({ query, queryIndex = 0, queryCount = 1 }) => {
        try {
          let sources = await (dependencies.searchKnowledgeSources || searchKnowledgeSources)(query, 8);
          if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await verifyEvidenceSources(sources);
          successfulReferenceQueries += 1;
          return { sources, status: 'completed' };
        } catch (error) {
          if (queryIndex >= queryCount - 1 && successfulReferenceQueries === 0) {
            await store.update((state) => { refundSourceQuery(state, user, sourcePeriod); });
            sourceCharged = false;
          }
          throw error;
        }
      } : null;
      artifact = await generateArtifactAsync(marked, { sources: [], knowledgeContext, providerConfig, prompt, language, mode: requestedMode, referenceRetriever, onStage, onMode, onModel, tools, skills, plugins, toolExecutor, onTool, threadId: `${user.tenantId}:sync:${marked.id}:${Date.now()}` });
    } catch (error) {
      await store.update((state) => {
        refundGeneration(state, user, generationPeriod); if (sourceCharged) refundSourceQuery(state, user, sourcePeriod);
        const item = state.projects.find((entry) => entry.id === id && owned(entry, user));
        if (item?.status === 'generating') { item.status = current.status; item.updatedAt = new Date().toISOString(); }
        failSessionRun(findAgentSession(state, selectedSession.id, id, user.tenantId), { jobId: syncRunId, mode: selectedMode.mode, error: 'Generation failed' });
      });
      throw error;
    }
    const project = await store.update((state) => {
      const item = state.projects.find((entry) => entry.id === id && owned(entry, user));
      if (!item || !activePrincipal(state, user)) return null;
      const session = findAgentSession(state, selectedSession.id, id, user.tenantId);
      recordSessionRunEvent(state, session, { id: `artifact:${artifact.id}`, type: 'artifact', actor: 'Novi Finalizer', title: 'Artifact saved', status: 'completed', mode: artifact.workflow?.runtime?.mode || selectedMode.mode, summary: 'Generated Files/LLM Wiki are now available in the workspace.', output: { artifactId: artifact.id, documents: (artifact.documents || []).map((document) => document.name) }, createdAt: artifact.createdAt || new Date().toISOString(), completedAt: new Date().toISOString() });
      item.artifacts.unshift(artifact); item.status = 'ready'; item.updatedAt = new Date().toISOString();
      completeSessionRun(session, { jobId: syncRunId, artifact, mode: artifact.workflow?.runtime?.mode || selectedMode.mode });
      return item;
    });
    if (!project) {
      await store.update((state) => {
        refundGeneration(state, user, generationPeriod); if (sourceCharged) refundSourceQuery(state, user, sourcePeriod);
        const item = state.projects.find((entry) => entry.id === id && entry.tenantId === user.tenantId);
        if (item?.status === 'generating') { item.status = current.status; item.updatedAt = new Date().toISOString(); }
        failSessionRun(findAgentSession(state, selectedSession.id, id, user.tenantId), { jobId: syncRunId, mode: selectedMode.mode, error: 'Generation was cancelled' });
      });
      return send(res, 404, { error: 'Project not found' });
    }
    metrics.generationCompleted += 1;
    await store.audit({ action: 'project.generated', userId: user.id, tenantId: user.tenantId, resourceId: id });
    return send(res, 200, { project, sessionId: selectedSession.id });
  }
  if (req.method === 'PATCH' && action === 'pin') {
    if (!await requireRole(store, res, user, 'editor')) return true;
    const project = await store.update((state) => {
      const item = state.projects.find((entry) => entry.id === id && owned(entry, user));
      if (!item) return null;
      item.pinned = !item.pinned;
      item.updatedAt = new Date().toISOString();
      return item;
    });
    return project ? send(res, 200, { project }) : send(res, 404, { error: 'Project not found' });
  }
  if (req.method === 'DELETE' && !action) {
    if (!await requireRole(store, res, user, 'admin')) return true;
    const deleted = await store.update((state) => {
      const index = state.projects.findIndex((entry) => entry.id === id && owned(entry, user));
      if (index < 0) return false;
      for (const document of (state.documents || []).filter((item) => item.projectId === id && item.tenantId === user.tenantId)) {
        enqueueDocumentDeletion(state, { tenantId: document.tenantId, projectId: document.projectId, documentId: document.id, objectKey: document.objectKey, contentHash: document.contentHash });
      }
      const deletedDocumentIds = new Set((state.documents || []).filter((item) => item.projectId === id && item.tenantId === user.tenantId).map((item) => item.id));
      state.externalProjectionJobs = (state.externalProjectionJobs || []).filter((job) => !deletedDocumentIds.has(job.documentId) || !['completed', 'cancelled'].includes(job.status));
      state.projects.splice(index, 1);
      removeJobs(state, (item) => item.projectId === id && item.tenantId === user.tenantId);
      state.agentSessions = (state.agentSessions || []).filter((item) => item.projectId !== id || item.tenantId !== user.tenantId);
      state.workspaceFiles = (state.workspaceFiles || []).filter((item) => item.projectId !== id || item.tenantId !== user.tenantId);
      state.agentMemories = (state.agentMemories || []).filter((item) => item.projectId !== id || item.tenantId !== user.tenantId);
      state.documents = (state.documents || []).filter((item) => item.projectId !== id);
      state.chunks = (state.chunks || []).filter((item) => item.projectId !== id);
      state.knowledgeEntities = (state.knowledgeEntities || []).filter((item) => item.projectId !== id);
      state.knowledgeEdges = (state.knowledgeEdges || []).filter((item) => item.projectId !== id);
      state.watchConfigs = (state.watchConfigs || []).filter((item) => item.projectId !== id);
      state.sourceSnapshots = (state.sourceSnapshots || []).filter((item) => item.projectId !== id);
      return true;
    });
    if (deleted) {
      await flushExternalProjectionJobs(store, { limit: 100 });
      await store.audit({ action: 'project.deleted', userId: user.id, tenantId: user.tenantId, resourceId: id });
    }
    return deleted ? send(res, 204, '') : send(res, 404, { error: 'Project not found' });
  }
  if (req.method === 'GET' && action === 'export') {
    const project = (await store.read()).projects.find((item) => item.id === id && owned(item, user));
    if (!project || !project.artifacts.length) return send(res, 404, { error: 'Generated artifact not found' });
    const format = url.searchParams.get('format') || 'markdown';
    if (!['markdown', 'latex'].includes(format)) return send(res, 422, { error: 'format must be markdown or latex' });
    const template = url.searchParams.get('template') || 'article';
    if (format === 'latex' && !['article', 'ieee', 'acm'].includes(template)) return send(res, 422, { error: 'template must be article, ieee, or acm' });
    const requestedArtifactId = url.searchParams.get('artifactId');
    const artifact = requestedArtifactId
      ? project.artifacts.find((item) => item.id === requestedArtifactId)
      : project.artifacts[0];
    if (!artifact) return send(res, 404, { error: 'Artifact version not found' });
    const content = format === 'latex' ? artifactToLatex(project, artifact, template) : artifactToMarkdown(project, artifact);
    const extension = format === 'latex' ? 'tex' : 'md';
    const safeName = project.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'novi-export';
    const version = project.artifacts.length - project.artifacts.findIndex((item) => item.id === artifact.id);
    return send(res, 200, content, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-v${version}${format === 'latex' && template !== 'article' ? `-${template}` : ''}.${extension}"`,
    });
  }
  return send(res, 405, { error: 'Method not allowed' });
}

function indexWikiIteration(state, project, artifact, job) {
  const generatedDocuments = (artifact.documents || []).filter((document) => document.mediaType === 'text/markdown' && document.content);
  if (!generatedDocuments.length) return null;
  const sourceCount = (artifact.content?.sources || []).filter((source) => source.mapped === true).length;
  state.documents ||= []; state.chunks ||= []; state.knowledgeEntities ||= []; state.knowledgeEdges ||= [];
  const indexed = [];
  for (const generated of [...generatedDocuments].reverse()) {
    const title = `Wiki iteration ${project.artifacts.length + 1}: ${generated.name} - ${project.title}`.slice(0, 200);
    const ingested = ingestDocument({ title, content: generated.content, sourceKind: 'agent-wiki', mimeType: 'text/markdown' }, { projectId: project.id, tenantId: project.tenantId });
    if (ingested.error) throw new Error(ingested.error);
    const duplicate = state.documents.find((document) => document.projectId === project.id && document.tenantId === project.tenantId && document.contentHash === ingested.document.contentHash);
    const document = duplicate || ingested.document;
    if (!duplicate) {
      state.documents.unshift(ingested.document); state.chunks.push(...ingested.chunks); state.knowledgeEntities.push(...ingested.entities); state.knowledgeEdges.push(...ingested.edges);
      enqueueDocumentProjection(state, ingested);
    }
    indexed.unshift({ name: generated.name, documentId: document.id, contentHash: document.contentHash, reused: Boolean(duplicate) });
  }
  const summary = indexed.find((document) => document.name === 'llm-wiki.md') || indexed[0];
  artifact.workflow.runtime.knowledgeEnrichment = { documentId: summary.documentId, contentHash: summary.contentHash, documents: indexed, documentCount: indexed.length, sourceCount, reused: indexed.every((document) => document.reused), indexedAt: new Date().toISOString(), jobId: job.id };
  return indexed;
}

function recordRunEvent(state, job, event) {
  if (!job) return;
  job.runEvents = upsertRunEvent(job.runEvents, event);
  recordSessionRunEvent(state, findAgentSession(state, job.sessionId, job.projectId, job.tenantId), event);
}

function recordSessionRunEvent(_state, session, event) {
  updateSessionRunEvent(session, event);
}

async function runGeneration(store, auth, jobId, project, user, previousStatus = 'draft', sourceCharged = false, generationPeriod = null, sourcePeriod = null, metrics = null, dependencies = {}) {
  let committed = false;
  try {
    const claimed = store.claimJob ? await store.claimJob(jobId, `worker-${process.pid}`) : await store.updateJob(jobId, { status: 'running', progress: 10 });
    if (!claimed) return false;
    const sessionState = await store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === jobId && item.status === 'running');
      const currentProject = state.projects.find((item) => item.id === project.id && item.tenantId === user.tenantId);
      if (!job || !currentProject) return null;
      const session = job.sessionId ? findAgentSession(state, job.sessionId, project.id, user.tenantId) : ensureAgentSession(state, currentProject, user);
      if (!session) return null;
      job.sessionId = session.id;
      job.prompt ||= project.description || project.topic;
      job.requestedMode ||= 'auto';
      job.currentMode ||= selectAgentMode(job.prompt, { requestedMode: job.requestedMode }).mode;
      if (!(session.messages || []).some((message) => message.jobId === job.id && message.role === 'user')) {
        const message = beginSessionRun(session, { jobId: job.id, prompt: job.prompt, requestedMode: job.requestedMode, currentMode: job.currentMode });
        job.userMessageId = message.id;
      }
      job.language ||= normalizeWikiLanguage(project.wikiLanguage);
      updateSessionRun(session, { language: job.language });
      return { sessionId: session.id, prompt: job.prompt, requestedMode: job.requestedMode, currentMode: job.currentMode, language: job.language };
    });
    if (!sessionState) throw new Error('Agent session is unavailable');
    Object.assign(claimed, sessionState);
    const knowledgeContext = await retrieveWorkspaceKnowledge(store, project, user);
    if (!await store.updateJob(jobId, { progress: 20, currentStage: 'Preparing agent workflow' })) throw new Error('Generation was cancelled');
    const runtimeState = await store.read();
    const providerConfig = await resolvedProviderConfig(runtimeState, user.tenantId);
    const runPrompt = claimed.prompt || project.description || project.topic;
    const selectedPlugins = providerConfig ? resolvePlugins(runtimeState, user.tenantId, project, runPrompt) : [];
    const skills = providerConfig ? resolveSkills(runtimeState, user.tenantId, project, runPrompt, { pluginSkillNames: selectedPlugins.flatMap((plugin) => plugin.skillNames || []) }) : [];
    const tools = [...(await resolvedTools(runtimeState, user.tenantId)).filter((tool) => !sourceAccessTool(tool.name) || sourceCharged), ...await resolvedMcpTools(runtimeState, user.tenantId)];
    const plugins = bindPluginTools(selectedPlugins, tools);
    const appliedSkills = skillProvenance(skills);
    const appliedPlugins = pluginProvenance(plugins);
    if (!await store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === jobId && item.status === 'running');
      if (!job) return false;
      job.activeSkills = appliedSkills; job.activePlugins = appliedPlugins; job.updatedAt = new Date().toISOString();
      updateSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { skills: appliedSkills, plugins: appliedPlugins });
      return true;
    })) throw new Error('Generation was cancelled');
    const toolExecutor = createToolExecutor({ store, project, principal: user, allowSourceAccess: sourceCharged });
    const onStage = async (stage) => store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === jobId && item.status === 'running');
      if (!job) return false;
      job.agentStages ||= [];
      const index = job.agentStages.findIndex((item) => item.id === stage.id);
      const publicStage = { id: stage.id, name: stage.name, mode: stage.mode || job.currentMode, status: stage.status, ...(stage.startedAt ? { startedAt: stage.startedAt } : {}), ...(stage.completedAt ? { completedAt: stage.completedAt } : {}), ...(stage.usage ? { usage: stage.usage } : {}), ...(stage.warning ? { warning: stage.warning } : {}), ...(stage.error ? { error: stage.error } : {}), ...(stage.query ? { query: stage.query } : {}), ...(stage.queries ? { queries: stage.queries } : {}), ...(Number.isFinite(stage.sourceCount) ? { sourceCount: stage.sourceCount } : {}), ...(stage.sourceKinds ? { sourceKinds: stage.sourceKinds } : {}) };
      if (index >= 0) job.agentStages[index] = publicStage; else job.agentStages.push(publicStage);
      if (stage.expertGoal) { job.expertGoal = stage.expertGoal; job.expertRoles = stage.expertRoles || []; }
      if (stage.id === 'references') job.referenceDiscovery = { query: stage.query, ...(stage.queries ? { queries: stage.queries } : {}), status: stage.status, sourceCount: stage.sourceCount || 0, sourceKinds: stage.sourceKinds || [] };
      job.progress = Math.max(job.progress || 0, stage.progress || 0); job.currentStage = stage.name; job.currentMode = stage.mode || job.currentMode; job.currentModeLabel = publicMode(job.currentMode).name; job.updatedAt = new Date().toISOString();
      const eventId = `stage:${stage.id}:${stage.startedAt || stage.completedAt || jobId}`;
      recordRunEvent(state, job, { id: eventId, type: stage.id === 'references' ? 'reference' : 'stage', actor: stage.name, title: `${stage.name} ${stage.status}`, status: stage.status, stageId: stage.id, mode: stage.mode || job.currentMode, createdAt: stage.startedAt || new Date().toISOString(), ...(stage.completedAt ? { completedAt: stage.completedAt } : {}), ...(stage.query ? { input: { query: stage.query, ...(stage.queries ? { queries: stage.queries } : {}) } } : {}), output: { ...(stage.outputKeys ? { outputKeys: stage.outputKeys } : {}), ...(Number.isFinite(stage.sourceCount) ? { sourceCount: stage.sourceCount } : {}), ...(stage.sourceKinds ? { sourceKinds: stage.sourceKinds } : {}) }, ...(stage.usage ? { usage: stage.usage } : {}), ...(stage.warning ? { warning: stage.warning } : {}), ...(stage.error ? { error: stage.error } : {}), ...(stage.status === 'running' ? { summary: 'Agent stage started' } : { summary: `Agent stage ${stage.status}` }) });
      updateSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { currentMode: job.currentMode, currentStage: job.currentStage, progress: job.progress, ...(stage.expertGoal ? { expertGoal: stage.expertGoal, expertRoles: stage.expertRoles || [] } : {}), ...(stage.id === 'references' ? { referenceDiscovery: job.referenceDiscovery } : {}) });
      return true;
    });
    const onMode = async (event) => store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === jobId && item.status === 'running');
      if (!job) return false;
      if (job.currentMode !== event.mode) job.modeHistory = [...(job.modeHistory || []), { from: job.currentMode || null, to: event.mode, reason: event.reason || 'runtime-router', at: new Date().toISOString() }];
      job.currentMode = event.mode; job.currentModeLabel = event.label || publicMode(event.mode).name; job.modeReason = event.reason || job.modeReason;
      job.currentStage = event.status === 'planning' ? 'Planning execution' : job.currentStage;
      job.progress = Math.max(job.progress || 0, event.progress || 0); job.updatedAt = new Date().toISOString();
      recordRunEvent(state, job, { id: `mode:${event.mode}:${job.runEvents?.length || 0}:${Date.now()}`, type: 'mode', actor: 'Agent router', title: 'Agent mode decision', status: event.status || 'running', mode: event.mode, summary: event.reason || 'Runtime mode selected', output: { mode: event.mode, label: event.label || publicMode(event.mode).name, reason: event.reason || '' }, createdAt: new Date().toISOString() });
      updateSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { currentMode: job.currentMode, currentStage: job.currentStage || event.status, progress: job.progress });
      return true;
    });
    const onTool = async (call) => store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === jobId && item.status === 'running');
      if (!job) return false;
      job.agentToolCalls ||= [];
      const index = job.agentToolCalls.findIndex((item) => item.id === call.id);
      if (index >= 0) job.agentToolCalls[index] = call; else job.agentToolCalls.push(call);
      job.currentStage = call.status === 'running' ? `Using ${call.tool}` : `${call.tool} ${call.status}`; job.updatedAt = new Date().toISOString();
      recordRunEvent(state, job, { id: `tool:${call.id}`, type: 'tool', actor: call.label || call.tool, title: `Tool ${call.status}`, status: call.status, mode: job.currentMode, input: call.input, output: call.output, summary: call.status === 'running' ? 'Agent requested a tool call' : `Tool call ${call.status}`, createdAt: call.startedAt || new Date().toISOString(), ...(call.completedAt ? { completedAt: call.completedAt } : {}), ...(call.error ? { error: call.error } : {}) });
      updateSessionToolCall(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), call);
      return true;
    });
    const onModel = async (event) => store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === jobId && item.status === 'running');
      if (!job) return false;
      recordRunEvent(state, job, event);
      job.currentStage = event.type === 'model-request' ? `${event.actor} sending` : event.status === 'streaming' ? `${event.actor} streaming` : `${event.actor} replied`;
      job.updatedAt = new Date().toISOString();
      updateSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { currentStage: job.currentStage, progress: job.progress });
      return true;
    });
    let successfulReferenceQueries = 0;
    const referenceRetriever = sourceCharged ? async ({ query, queryIndex = 0, queryCount = 1 }) => {
      try {
        let sources = await (dependencies.searchKnowledgeSources || searchKnowledgeSources)(query, 8);
        if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await verifyEvidenceSources(sources);
        successfulReferenceQueries += 1;
        return { sources, status: 'completed' };
      } catch (error) {
        if (queryIndex >= queryCount - 1 && successfulReferenceQueries === 0) await store.update((state) => {
          const job = (state.jobs || []).find((item) => item.id === jobId);
          if (job?.sourceCharged && !job.sourceRefunded) {
            refundSourceQuery(state, user, sourcePeriod);
            job.sourceCharged = false; job.sourceRefunded = true; job.updatedAt = new Date().toISOString();
          }
        });
        if (queryIndex >= queryCount - 1 && successfulReferenceQueries === 0) sourceCharged = false;
        throw error;
      }
    } : null;
    const refining = claimed.type === 'refine';
    const artifact = await generateArtifactAsync(project, { sources: [], knowledgeContext, providerConfig, prompt: runPrompt, language: claimed.language, mode: claimed.requestedMode || 'auto', refineFromLatest: refining, referenceRetriever, onStage, onMode, onModel, tools, skills, plugins, toolExecutor, onTool, threadId: `${user.tenantId}:${jobId}` });
    const result = await store.update((state) => {
      const item = state.projects.find((entry) => entry.id === project.id && owned(entry, user));
      const job = (state.jobs || []).find((entry) => entry.id === jobId && entry.status === 'running');
      if (!item || !job || !activePrincipal(state, user)) return null;
      if (refining) indexWikiIteration(state, item, artifact, job);
      recordRunEvent(state, job, { id: `artifact:${artifact.id}`, type: 'artifact', actor: 'Novi Finalizer', title: 'Artifact saved', status: 'completed', mode: artifact.workflow?.runtime?.mode || job.currentMode, summary: 'Generated Files/LLM Wiki are now available in the workspace.', output: { artifactId: artifact.id, documents: (artifact.documents || []).map((document) => document.name) }, createdAt: artifact.createdAt || new Date().toISOString(), completedAt: new Date().toISOString() });
      item.artifacts.unshift(artifact); item.status = 'ready'; item.updatedAt = new Date().toISOString();
      completeSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { jobId, artifact, mode: artifact.workflow?.runtime?.mode || job.currentMode });
      return item;
    });
    if (!result) throw new Error('Project was deleted');
    committed = true;
    await store.updateJob(jobId, { status: 'completed', progress: 100, resultId: project.id, currentStage: null });
    await store.audit({ action: 'job.completed', userId: project.ownerId, tenantId: project.tenantId, resourceId: jobId });
  } catch (error) {
    if (metrics) metrics.generationFailed += 1;
    if (!committed) {
      await store.update((state) => {
        const job = (state.jobs || []).find((item) => item.id === jobId);
        if (job) {
          refundUnfinishedJob(state, job);
          failSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { jobId, mode: job.currentMode, error: 'Generation failed' });
          job.updatedAt = new Date().toISOString();
        }
        const item = state.projects.find((entry) => entry.id === project.id && owned(entry, user));
        if (item?.status === 'generating') { item.status = previousStatus; item.updatedAt = new Date().toISOString(); }
      });
    }
    try { await store.updateJob(jobId, { status: committed ? 'completed' : 'failed', progress: 100, ...(committed ? { resultId: project.id } : { error: 'Generation failed' }) }); } catch (jobError) { console.warn(`Job status update failed: ${jobError.message}`); }
  }
  return committed;
}

async function runQueuedJobs(store, auth, metrics, dependencies = {}) {
  const state = await store.read();
  for (const job of (state.jobs || []).filter((item) => item.status === 'queued').slice(0, 10)) {
    const project = state.projects.find((item) => item.id === job.projectId && item.tenantId === job.tenantId);
    if (!project) continue;
    const storedUser = state.users.find((item) => item.id === job.userId && item.tenantId === job.tenantId);
    const user = storedUser ? { id: storedUser.id, tenantId: storedUser.tenantId, plan: storedUser.plan || 'free' } : { id: job.userId || 'local', tenantId: job.tenantId || 'local', plan: 'free' };
    void runGeneration(store, auth, job.id, project, user, job.previousStatus || 'draft', Boolean(job.sourceCharged), job.generationPeriod, job.sourcePeriod, metrics, dependencies);
  }
}

async function staticFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const path = resolve(publicDir, `.${pathname}`);
  if (path !== publicDir && !path.startsWith(`${publicDir}/`)) return send(res, 403, { error: 'Forbidden' });
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    const content = await readFile(path);
    return send(res, 200, content, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch {
    if (!extname(pathname)) {
      const content = await readFile(join(publicDir, 'index.html'));
      return send(res, 200, content, { 'Content-Type': mime['.html'] });
    }
    return send(res, 404, { error: 'Not found' });
  }
}

export function createServer(dependencies = {}) {
  const dataFile = process.env.NOVI_DATA_FILE || join(root, 'data', 'novi.json');
  const storePromise = process.env.NOVI_STORAGE === 'postgres'
    ? createPostgresStore(process.env.NOVI_PG_URL)
    : Promise.resolve(new JsonStore(dataFile));
  let worker; let jobWorker; let initialization; const metrics = createMetrics();
  const getStore = async () => {
    const store = await storePromise;
    if (!initialization) initialization = (async () => {
      if (store.migrateOrganizations) await store.migrateOrganizations();
      if (store.recoverInterruptedJobs) await store.recoverInterruptedJobs();
      if (process.env.NOVI_REFRESH_WORKER !== 'false') worker = startRefreshWorker(store);
      if (process.env.NOVI_JOB_WORKER !== 'false') {
        const timer = setInterval(() => runQueuedJobs(store, null, metrics, dependencies).catch((error) => console.warn(`Queued job worker failed: ${error.message}`)), Math.max(250, Number(process.env.NOVI_JOB_INTERVAL_MS || 1_000)));
        timer.unref?.(); jobWorker = { stop: () => clearInterval(timer) };
        void runQueuedJobs(store, null, metrics, dependencies).catch((error) => console.warn(`Queued job worker failed: ${error.message}`));
      }
      const projectionTimer = setInterval(() => flushExternalProjectionJobs(store, { limit: 10 }).catch((error) => console.warn(`External projection worker failed: ${error.message}`)), Math.max(1_000, Number(process.env.NOVI_PROJECTION_INTERVAL_MS || 5_000)));
      projectionTimer.unref?.();
      void flushExternalProjectionJobs(store, { limit: 100 }).catch((error) => console.warn(`External projection recovery failed: ${error.message}`));
      store._noviProjectionWorker = { stop: () => clearInterval(projectionTimer) };
      store._noviInitialized = true;
    })();
    await initialization;
    return store;
  };
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      const store = await getStore();
      const auth = new AuthService(store);
      if (url.pathname.startsWith('/api/')) {
        const handled = await api(req, res, url, store, auth, metrics, dependencies);
        if (handled === false) send(res, 404, { error: 'API route not found' });
      } else await staticFile(req, res, url);
    } catch (error) {
      console.error(JSON.stringify({ requestId, error: error.message, path: url.pathname, method: req.method }));
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
    }
  });
  server.on('listening', () => { getStore().catch((error) => console.warn(`Startup initialization failed: ${error.message}`)); });
  const originalClose = server.close.bind(server);
  server.close = (callback) => {
    worker?.stop();
    jobWorker?.stop();
    const done = (error) => {
      storePromise.then((store) => store.close?.()).catch((closeError) => console.warn(`Storage close failed: ${closeError.message}`));
      storePromise.then((store) => store._noviProjectionWorker?.stop?.()).catch(() => {});
      callback?.(error);
    };
    return originalClose(done);
  };
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(port, host, () => console.log(`Novi is running at http://${host}:${port}`));
  const shutdown = (signal) => { console.log(`Received ${signal}; shutting down`); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
