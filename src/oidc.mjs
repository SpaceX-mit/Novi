import { createHash, createPublicKey, createVerify, randomBytes, randomUUID } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const clean = (value) => String(value || '').trim();

function providerUrl(value, field) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error(`OIDC ${field} must be a URL`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error(`OIDC ${field} must use HTTPS`);
  return url;
}

export function validateOidcConfiguration() {
  if (!process.env.NOVI_OIDC_ISSUER && !process.env.NOVI_OIDC_CLIENT_ID && !process.env.NOVI_OIDC_CLIENT_SECRET && !process.env.NOVI_OIDC_REDIRECT_URI) return true;
  if (!oidcConfigured()) throw new Error('OIDC configuration requires issuer, client id, client secret, and redirect URI');
  providerUrl(process.env.NOVI_OIDC_ISSUER, 'issuer');
  const redirect = providerUrl(process.env.NOVI_OIDC_REDIRECT_URI, 'redirect_uri');
  if (process.env.NODE_ENV === 'production' && redirect.protocol !== 'https:') throw new Error('Production OIDC redirect URI must use HTTPS');
  return true;
}

export function oidcConfigured() {
  return Boolean(process.env.NOVI_OIDC_ISSUER && process.env.NOVI_OIDC_CLIENT_ID && process.env.NOVI_OIDC_CLIENT_SECRET && process.env.NOVI_OIDC_REDIRECT_URI);
}

export async function discoverIssuer(issuer = process.env.NOVI_OIDC_ISSUER) {
  const base = providerUrl(issuer, 'issuer');
  const discovery = new URL(`${base.toString().replace(/\/$/, '')}/.well-known/openid-configuration`);
  const response = await fetch(discovery, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`OIDC discovery returned ${response.status}`);
  const metadata = await response.json();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.userinfo_endpoint || !metadata.jwks_uri) throw new Error('OIDC provider metadata is incomplete');
  for (const [name, value] of Object.entries({ authorization_endpoint: metadata.authorization_endpoint, token_endpoint: metadata.token_endpoint, userinfo_endpoint: metadata.userinfo_endpoint, jwks_uri: metadata.jwks_uri })) providerUrl(value, name);
  if (metadata.issuer && clean(metadata.issuer).replace(/\/$/, '') !== base.toString().replace(/\/$/, '')) throw new Error('OIDC discovery issuer does not match configured issuer');
  return metadata;
}

export function createAuthorizationRequest(metadata, state, nonce) {
  throw new Error('createAuthorizationRequest requires a PKCE verifier; use createAuthorizationRequestWithPkce');
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createAuthorizationRequestWithPkce(metadata, state, nonce, verifier) {
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: 'code', client_id: process.env.NOVI_OIDC_CLIENT_ID, redirect_uri: process.env.NOVI_OIDC_REDIRECT_URI, scope: process.env.NOVI_OIDC_SCOPE || 'openid profile email', state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' }).toString();
  return url.toString();
}

export async function exchangeAuthorizationCode(metadata, code, verifier) {
  const response = await fetch(metadata.token_endpoint, { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: process.env.NOVI_OIDC_CLIENT_ID, client_secret: process.env.NOVI_OIDC_CLIENT_SECRET, redirect_uri: process.env.NOVI_OIDC_REDIRECT_URI, code_verifier: verifier }) });
  if (!response.ok) throw new Error(`OIDC token exchange returned ${response.status}`);
  const tokens = await response.json();
  if (!tokens.access_token) throw new Error('OIDC token response has no access token');
  return tokens;
}

export async function verifyIdToken(metadata, idToken, expectedNonceHash) {
  if (!idToken || !expectedNonceHash || !metadata.jwks_uri) return false;
  const parts = String(idToken).split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const audienceValid = Array.isArray(payload.aud) ? payload.aud.includes(process.env.NOVI_OIDC_CLIENT_ID) && (!payload.azp || payload.azp === process.env.NOVI_OIDC_CLIENT_ID) : payload.aud === process.env.NOVI_OIDC_CLIENT_ID;
    const now = Math.floor(Date.now() / 1000);
    const issuer = clean(metadata.issuer || process.env.NOVI_OIDC_ISSUER).replace(/\/$/, '');
    if (header.alg !== 'RS256' || !payload.nonce || hash(payload.nonce) !== expectedNonceHash || clean(payload.iss).replace(/\/$/, '') !== issuer || !audienceValid || !Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) return false;
    const jwksUrl = providerUrl(metadata.jwks_uri, 'jwks_uri');
    const response = await fetch(jwksUrl, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } });
    if (!response.ok) return false;
    const keys = await response.json(); const jwk = (keys.keys || []).find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return false;
    const verifier = createVerify('RSA-SHA256'); verifier.update(`${parts[0]}.${parts[1]}`); verifier.end();
    return verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch { return false; }
}

export async function fetchUserInfo(metadata, accessToken) {
  const userinfoUrl = providerUrl(metadata.userinfo_endpoint, 'userinfo_endpoint');
  const response = await fetch(userinfoUrl, { signal: AbortSignal.timeout(8_000), headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  if (!response.ok) throw new Error(`OIDC userinfo returned ${response.status}`);
  const profile = await response.json();
  const email = clean(profile.email).toLowerCase();
  if (!profile.sub || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('OIDC profile must contain sub and verified email');
  if (profile.email_verified !== true) throw new Error('OIDC email is not verified');
  return { sub: clean(profile.sub), email, name: clean(profile.name || profile.preferred_username) };
}

export const stateHash = hash;
export const newState = () => randomBytes(32).toString('base64url');
export const newNonce = () => randomBytes(32).toString('base64url');
export const newVerifier = () => randomBytes(48).toString('base64url');
export const newOidcId = () => randomUUID();
