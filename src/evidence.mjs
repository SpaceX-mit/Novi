import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const timeout = (ms) => AbortSignal.timeout(ms);

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = parts;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 2 || second === 168))
    || (first === 192 && second === 88 && third === 99)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0 && third === 113);
}
function mappedIpv4(address) {
  const lower = String(address).toLowerCase();
  const decimal = lower.match(/^(?:0:){5}ffff:(\d+\.\d+\.\d+\.\d+)$/) || lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (decimal) return decimal[1];
  const hex = lower.match(/^(?:0:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const first = Number.parseInt(hex[1], 16); const second = Number.parseInt(hex[2], 16);
  return `${first >>> 8}.${first & 255}.${second >>> 8}.${second & 255}`;
}

function privateAddress(address) {
  if (net.isIPv4(address)) return privateIpv4(address);
  if (!net.isIPv6(address)) return true;
  const lower = address.toLowerCase();
  const mapped = mappedIpv4(lower);
  return Boolean(mapped && privateIpv4(mapped)) || lower === '::' || lower === '::1'
    || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')
    || lower.startsWith('ff') || lower.startsWith('2001:db8:') || lower.startsWith('2001:2:') || lower.startsWith('2001:10:') || lower.startsWith('3fff:');
}

async function validateUrl(value, { skipDns = false } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('unsafe URL');
  if (!skipDns) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const routable = addresses.filter(({ address }) => !['::', '0.0.0.0'].includes(address));
    if (!routable.length || routable.some(({ address }) => privateAddress(address))) throw new Error('private or local address');
  }
  return url;
}

async function readBounded(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('response exceeds evidence limit');
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error('response exceeds evidence limit');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BYTES) throw new Error('response exceeds evidence limit');
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function fetchSource(urlValue, { fetchImpl = globalThis.fetch, skipDns = false, timeoutMs = 12_000 } = {}) {
  let target = await validateUrl(urlValue, { skipDns });
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(target, { redirect: 'manual', signal: timeout(timeoutMs), headers: { accept: 'text/html, text/plain, application/pdf, application/json', 'user-agent': 'Novi/0.1 evidence-verifier' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS || !response.headers.get('location')) throw new Error('too many redirects');
      target = await validateUrl(new URL(response.headers.get('location'), target), { skipDns });
      continue;
    }
    if (!response.ok) return { status: 'unreachable', httpStatus: response.status, url: target.toString() };
    const body = await readBounded(response);
    return {
      status: 'verified', httpStatus: response.status, url: target.toString(), contentHash: createHash('sha256').update(body).digest('hex'),
      retrievedBytes: body.byteLength, contentType: response.headers.get('content-type') || '', verifiedAt: new Date().toISOString(),
    };
  }
  throw new Error('too many redirects');
}

/**
 * Verify concrete connector results without trusting their metadata. Search
 * entries remain unmapped; each mapped source is fetched with SSRF, redirect,
 * timeout and response-size protections and receives a content hash.
 */
export async function verifyEvidenceSources(sources = [], options = {}) {
  const candidates = Array.isArray(sources) ? sources : [];
  return Promise.all(candidates.map(async (source) => {
    if (!source?.mapped) return source;
    try {
      const result = await fetchSource(source.url, options);
      return { ...source, ...result, mapped: result.status === 'verified' && source.mapped === true, verification: result.status };
    } catch (error) {
      return { ...source, mapped: false, status: 'unreachable', verification: 'unreachable', verificationError: error.message.slice(0, 160), verifiedAt: new Date().toISOString() };
    }
  }));
}

export { fetchSource, validateUrl, MAX_BYTES as EVIDENCE_MAX_BYTES, MAX_REDIRECTS as EVIDENCE_MAX_REDIRECTS };
