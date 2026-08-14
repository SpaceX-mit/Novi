import assert from 'node:assert/strict';
import http from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { completeArtifact } from '../src/model.mjs';
import { generateArtifact } from '../src/engine.mjs';
import { createCheckoutSession, applyWebhook, signWebhook, verifyWebhook } from '../src/payments.mjs';
import { createAuthorizationRequestWithPkce, discoverIssuer, exchangeAuthorizationCode, fetchUserInfo, newNonce, newState, newVerifier, pkceChallenge, stateHash, verifyIdToken } from '../src/oidc.mjs';
import { renderWithBrowserAgent, searchMcpSources } from '../src/source-adapters.mjs';

const previousFetch = global.fetch;
const previousEnv = { ...process.env };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }); jwk.kid = 'provider-contract-key';
let mode = 'ok';
let paymentMode = 'ok';
let lastPaymentBody;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const server = http.createServer(async (req, res) => {
  const body = await new Promise((resolve) => { let value = ''; req.on('data', (chunk) => { value += chunk; }); req.on('end', () => resolve(value)); });
  const send = (status, payload, headers = { 'content-type': 'application/json' }) => { res.writeHead(status, headers); res.end(typeof payload === 'string' ? payload : JSON.stringify(payload)); };
  if (req.url === '/v1/chat/completions') {
    if (mode === 'llm-timeout') return setTimeout(() => send(200, {}), 100);
    if (mode === 'llm-error') return send(503, { error: 'temporarily unavailable' });
    return send(200, { choices: [{ message: { content: JSON.stringify({ summary: 'Provider contract summary' }) } }] });
  }
  if (req.url === '/browser/render') {
    const input = JSON.parse(body || '{}');
    if (req.headers.authorization !== 'Bearer browser-contract-key' || !input.javascript) return send(401, { error: 'invalid Browser Agent request' });
    return send(200, { finalUrl: input.url, title: 'Rendered contract page', text: 'Hydrated Browser Agent contract content' });
  }
  if (req.url === '/mcp') {
    const input = JSON.parse(body || '{}');
    if (req.headers.authorization !== 'Bearer mcp-contract-key') return send(401, { error: 'invalid MCP credentials' });
    const sessionHeaders = { 'content-type': 'application/json', 'mcp-session-id': 'contract-session' };
    if (input.method === 'notifications/initialized') return send(202, '', sessionHeaders);
    if (input.method === 'initialize') return send(200, { jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'contract-mcp', version: '1' } } }, sessionHeaders);
    if (input.method === 'tools/list') return send(200, { jsonrpc: '2.0', id: input.id, result: { tools: [{ name: 'sources.search', inputSchema: { type: 'object' } }] } }, sessionHeaders);
    if (input.method === 'tools/call') return send(200, { jsonrpc: '2.0', id: input.id, result: { structuredContent: { sources: [{ name: 'MCP contract source', url: `${base}/public-source`, kind: 'Official Docs', authority: 80 }] }, content: [] } }, sessionHeaders);
  }
  if (req.url === '/public-source') return send(200, 'public source', { 'content-type': 'text/plain' });
  if (req.url === '/checkout') { if (paymentMode === 'error') return send(502, { error: 'provider unavailable' }); lastPaymentBody = JSON.parse(body || '{}'); return send(200, { provider: 'contract-provider', checkoutUrl: `${base}/checkout/session_123` }); }
  if (req.url === '/.well-known/openid-configuration') {
    return send(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, userinfo_endpoint: `${base}/userinfo`, jwks_uri: `${base}/jwks` });
  }
  if (req.url === '/token') return send(200, { access_token: 'access-contract', id_token: idToken });
  if (req.url === '/userinfo') return send(200, { sub: 'provider-user', email: 'verified@example.com', email_verified: true, name: 'Provider User' });
  if (req.url === '/jwks') return send(200, { keys: [jwk] });
  return send(404, { error: 'not found' });
});

const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
const base = `http://127.0.0.1:${address.port}`;
const nonce = newNonce();
const tokenPayload = { iss: base, aud: 'contract-client', nonce, exp: Math.floor(Date.now() / 1000) + 120, sub: 'provider-user' };
const tokenHeader = { alg: 'RS256', typ: 'JWT', kid: jwk.kid };
const signingInput = `${b64(tokenHeader)}.${b64(tokenPayload)}`;
const signer = createSign('RSA-SHA256'); signer.update(signingInput); signer.end();
const idToken = `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;

try {
  process.env.NOVI_LLM_API_KEY = 'contract-key'; process.env.NOVI_LLM_BASE_URL = `${base}/v1`; process.env.NOVI_LLM_MODEL = 'contract-model';
  const fallback = generateArtifact({ id: 'contract', title: 'Contract', topic: 'Provider', type: 'research' });
  const generated = await completeArtifact({ type: 'research', topic: 'Provider' }, fallback, fallback.content.sources);
  assert.equal(generated.content.summary, 'Provider contract summary');
  mode = 'llm-error'; assert.equal((await completeArtifact({ type: 'research', topic: 'Provider' }, fallback)).content.summary, fallback.content.summary);
  process.env.NOVI_LLM_TIMEOUT_MS = '100'; mode = 'llm-timeout'; assert.equal((await completeArtifact({ type: 'research', topic: 'Provider' }, fallback)).content.summary, fallback.content.summary);

  process.env.NOVI_PAYMENT_CHECKOUT_URL = `${base}/checkout`; process.env.NOVI_PAYMENT_WEBHOOK_SECRET = 'contract-secret'; process.env.NOVI_PAYMENT_API_KEY = 'payment-key'; process.env.NOVI_APP_ORIGIN = base;
  const checkout = await createCheckoutSession({ tenantId: 'tenant', userId: 'user', plan: 'pro', email: 'verified@example.com', returnUrl: `${base}/billing` });
  assert.match(checkout.checkoutUrl, /checkout\/session_123$/); assert.equal(lastPaymentBody.plan, 'pro');
  paymentMode = 'error'; await assert.rejects(() => createCheckoutSession({ tenantId: 'tenant', userId: 'user', plan: 'pro', email: 'verified@example.com' }), /returned 502/); paymentMode = 'ok';
  const event = { id: 'contract-event-1', type: 'subscription.active', data: { tenantId: 'tenant', plan: 'pro', subscriptionId: 'sub-contract' } };
  const state = { users: [{ tenantId: 'tenant', plan: 'free' }], subscriptions: [], paymentEvents: [] };
  const signed = signWebhook(JSON.stringify(event), process.env.NOVI_PAYMENT_WEBHOOK_SECRET);
  assert.equal(verifyWebhook(JSON.stringify(event), signed, process.env.NOVI_PAYMENT_WEBHOOK_SECRET), true);
  assert.equal(applyWebhook(state, event).applied, true); assert.equal(applyWebhook(state, event).duplicate, true); assert.equal(state.users[0].plan, 'pro');

  process.env.NOVI_OIDC_ISSUER = base; process.env.NOVI_OIDC_CLIENT_ID = 'contract-client'; process.env.NOVI_OIDC_CLIENT_SECRET = 'contract-secret'; process.env.NOVI_OIDC_REDIRECT_URI = `${base}/callback`;
  const metadata = await discoverIssuer();
  const verifier = newVerifier(); const authUrl = new URL(createAuthorizationRequestWithPkce(metadata, newState(), nonce, verifier));
  assert.equal(authUrl.searchParams.get('code_challenge'), pkceChallenge(verifier));
  const tokens = await exchangeAuthorizationCode(metadata, 'code-contract', verifier); assert.equal(tokens.access_token, 'access-contract');
  assert.equal(await verifyIdToken(metadata, tokens.id_token, stateHash(nonce)), true);
  const profile = await fetchUserInfo(metadata, tokens.access_token); assert.equal(profile.email, 'verified@example.com');

  process.env.NOVI_BROWSER_AGENT_URL = `${base}/browser/render`; process.env.NOVI_BROWSER_AGENT_TOKEN = 'browser-contract-key';
  const rendered = await renderWithBrowserAgent('https://example.com/dynamic', { skipTargetDns: true });
  assert.equal(rendered.sourceKind, 'browser-rendered'); assert.match(rendered.content, /Hydrated Browser Agent/);
  process.env.NOVI_MCP_SOURCE_URL = `${base}/mcp`; process.env.NOVI_MCP_SOURCE_TOKEN = 'mcp-contract-key'; process.env.NOVI_MCP_SOURCE_TOOL = 'sources.search';
  const mcpSources = await searchMcpSources('agent security', 3); assert.equal(mcpSources.length, 1); assert.equal(mcpSources[0].provider, 'MCP');
  console.log('provider-contract-check: LLM, payment, OIDC, Browser Agent, and MCP HTTP contracts passed');
} finally {
  global.fetch = previousFetch;
  for (const key of ['NOVI_LLM_API_KEY', 'NOVI_LLM_BASE_URL', 'NOVI_LLM_MODEL', 'NOVI_LLM_TIMEOUT_MS', 'NOVI_PAYMENT_CHECKOUT_URL', 'NOVI_PAYMENT_WEBHOOK_SECRET', 'NOVI_PAYMENT_API_KEY', 'NOVI_APP_ORIGIN', 'NOVI_OIDC_ISSUER', 'NOVI_OIDC_CLIENT_ID', 'NOVI_OIDC_CLIENT_SECRET', 'NOVI_OIDC_REDIRECT_URI', 'NOVI_BROWSER_AGENT_URL', 'NOVI_BROWSER_AGENT_TOKEN', 'NOVI_MCP_SOURCE_URL', 'NOVI_MCP_SOURCE_TOKEN', 'NOVI_MCP_SOURCE_TOOL']) {
    if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
  }
  await new Promise((resolve) => server.close(resolve));
}
