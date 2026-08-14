import { createHash, createHmac } from 'node:crypto';
import { mkdir, rename, chmod, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const timeout = (ms) => AbortSignal.timeout(ms);
const safePart = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'unknown';
const hex = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

function objectKey({ tenantId, documentId, contentHash }) {
  return `${safePart(tenantId)}/${safePart(documentId)}/${safePart(contentHash)}.source`;
}

function configured() {
  return Boolean(process.env.NOVI_OBJECT_STORE_URL || process.env.NOVI_OBJECT_STORE_DIR);
}

function endpoint() {
  if (!process.env.NOVI_OBJECT_STORE_URL) return null;
  const value = new URL(process.env.NOVI_OBJECT_STORE_URL);
  if (!['http:', 'https:'].includes(value.protocol)) throw new Error('NOVI_OBJECT_STORE_URL must use HTTP(S)');
  if (value.username || value.password) throw new Error('NOVI_OBJECT_STORE_URL must not embed credentials');
  const hostname = value.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
  if (process.env.NODE_ENV === 'production' && value.protocol !== 'https:' && !local) throw new Error('Production object store endpoint must use HTTPS (HTTP is allowed only for local loopback)');
  return value;
}

function signingCredentials() {
  const accessKey = process.env.NOVI_OBJECT_STORE_ACCESS_KEY;
  const secretKey = process.env.NOVI_OBJECT_STORE_SECRET_KEY;
  if (!accessKey && !secretKey) return null;
  if (!accessKey || !secretKey) throw new Error('NOVI_OBJECT_STORE_ACCESS_KEY and NOVI_OBJECT_STORE_SECRET_KEY must be configured together');
  return { accessKey, secretKey, region: process.env.NOVI_OBJECT_STORE_REGION || 'us-east-1', service: process.env.NOVI_OBJECT_STORE_SERVICE || 's3' };
}

function canonicalPath(url) {
  return url.pathname.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/').replace(/%2F/gi, '/');
}

function signedHeaders(url, method, body, contentType = null) {
  const credentials = signingCredentials();
  const token = process.env.NOVI_OBJECT_STORE_TOKEN;
  const payloadHash = hex(body || Buffer.alloc(0));
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  if (token && !credentials) headers.authorization = `Bearer ${token}`;
  if (!credentials) return headers;
  const signedNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const canonicalRequest = [method, canonicalPath(url), '', canonicalHeaders, signedNames.join(';'), payloadHash].join('\n');
  const scope = `${shortDate}/${credentials.region}/${credentials.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretKey}`, shortDate), credentials.region), credentials.service), 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKey}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${createHmac('sha256', signingKey).update(stringToSign).digest('hex')}`;
  return headers;
}

async function putRemote(key, body, contentType) {
  const base = endpoint();
  const target = new URL(key.split('/').map(encodeURIComponent).join('/'), `${base.toString().replace(/\/$/, '')}/`);
  const headers = { ...signedHeaders(target, 'PUT', body, contentType || 'application/octet-stream'), 'content-length': String(body.byteLength) };
  const response = await fetch(target, { method: 'PUT', signal: timeout(15_000), headers, body });
  if (!response.ok) throw new Error(`object store returned ${response.status}`);
  return { objectKey: key, backend: 'http', etag: response.headers.get('etag') || null };
}

async function putLocal(key, body, contentType) {
  const root = resolve(process.env.NOVI_OBJECT_STORE_DIR);
  const destination = resolve(join(root, ...key.split('/')));
  if (destination !== root && !destination.startsWith(`${root}/`)) throw new Error('invalid object key');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  if (contentType) await writeFile(`${destination}.content-type`, `${contentType}\n`, { mode: 0o600 });
  return { objectKey: key, backend: 'filesystem' };
}

export async function putDocumentObject({ tenantId, documentId, contentHash, content, contentType }) {
  if (!configured()) return null;
  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
  const key = objectKey({ tenantId, documentId, contentHash });
  return process.env.NOVI_OBJECT_STORE_URL ? putRemote(key, body, contentType) : putLocal(key, body, contentType);
}

export async function getDocumentObject({ objectKey: key }) {
  if (!configured() || !key) return null;
  if (process.env.NOVI_OBJECT_STORE_URL) {
    const base = endpoint();
    const target = new URL(String(key).split('/').map(encodeURIComponent).join('/'), `${base.toString().replace(/\/$/, '')}/`);
    const response = await fetch(target, { signal: timeout(15_000), headers: signedHeaders(target, 'GET', Buffer.alloc(0)) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`object store returned ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const root = resolve(process.env.NOVI_OBJECT_STORE_DIR); const target = resolve(join(root, ...String(key).split('/')));
  if (target !== root && !target.startsWith(`${root}/`)) throw new Error('invalid object key');
  try { const { readFile } = await import('node:fs/promises'); return await readFile(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function deleteDocumentObject({ objectKey: key }) {
  if (!configured() || !key) return { status: 'disabled' };
  if (process.env.NOVI_OBJECT_STORE_URL) {
    const base = endpoint(); const target = new URL(String(key).split('/').map(encodeURIComponent).join('/'), `${base.toString().replace(/\/$/, '')}/`);
    const response = await fetch(target, { method: 'DELETE', signal: timeout(15_000), headers: signedHeaders(target, 'DELETE', Buffer.alloc(0)) });
    if (!response.ok && response.status !== 404) throw new Error(`object store returned ${response.status}`);
    return { status: 'deleted' };
  }
  const root = resolve(process.env.NOVI_OBJECT_STORE_DIR); const target = resolve(join(root, ...String(key).split('/')));
  if (target !== root && !target.startsWith(`${root}/`)) throw new Error('invalid object key');
  const { unlink } = await import('node:fs/promises');
  for (const path of [target, `${target}.content-type`]) { try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return { status: 'deleted' };
}

export function objectStoreConfigured() { return configured(); }
export function validateObjectStoreConfiguration() {
  const value = endpoint();
  const credentials = signingCredentials();
  if (process.env.NODE_ENV === 'production' && value) {
    const hostname = value.hostname.replace(/^\[|\]$/g, '');
    const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
    if (!local && !credentials && !process.env.NOVI_OBJECT_STORE_TOKEN) throw new Error('Production remote object store requires SigV4 credentials or NOVI_OBJECT_STORE_TOKEN');
  }
  return true;
}
export { objectKey };
