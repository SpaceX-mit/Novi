import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteDocumentObject, getDocumentObject, putDocumentObject } from '../src/object-store.mjs';
import { deleteKnowledgeGraph, syncKnowledgeGraph } from '../src/graph-store.mjs';

const previous = { ...process.env }; const uploads = new Map(); let graphPayload; const authorizationHeaders = [];
const server = http.createServer(async (req, res) => {
  const body = []; for await (const chunk of req) body.push(chunk); const bytes = Buffer.concat(body);
  if (req.url.startsWith('/objects/')) { authorizationHeaders.push(req.headers.authorization || ''); const key = decodeURIComponent(req.url.slice('/objects/'.length)); if (req.method === 'PUT') { uploads.set(key, bytes); res.writeHead(200, { etag: 'contract-etag' }); res.end(); } else if (req.method === 'DELETE') { uploads.delete(key); res.writeHead(204); res.end(); } else { res.writeHead(uploads.has(key) ? 200 : 404); res.end(uploads.get(key) || ''); } return; }
  if (req.url === '/graph') { graphPayload = JSON.parse(bytes.toString() || '{}'); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
  res.writeHead(404); res.end();
});
const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address()))); const base = `http://127.0.0.1:${address.port}`;
try {
  process.env.NOVI_OBJECT_STORE_URL = `${base}/objects`; process.env.NOVI_OBJECT_STORE_TOKEN = 'object-contract';
  const stored = await putDocumentObject({ tenantId: 'tenant', documentId: 'doc', contentHash: 'a'.repeat(64), content: Buffer.from('raw source'), contentType: 'text/plain' });
  assert.equal(stored.backend, 'http'); assert.equal((await getDocumentObject({ objectKey: stored.objectKey })).toString(), 'raw source');
  delete process.env.NOVI_OBJECT_STORE_TOKEN; process.env.NOVI_OBJECT_STORE_ACCESS_KEY = 'contract-access'; process.env.NOVI_OBJECT_STORE_SECRET_KEY = 'contract-secret';
  const signed = await putDocumentObject({ tenantId: 'tenant', documentId: 'signed', contentHash: 'b'.repeat(64), content: 'signed source', contentType: 'text/plain' });
  assert.equal(signed.backend, 'http'); assert.ok(authorizationHeaders.some((value) => value.startsWith('AWS4-HMAC-SHA256 Credential=contract-access/')));
  process.env.NOVI_GRAPH_URL = `${base}/graph`; const graph = await syncKnowledgeGraph({ tenantId: 'tenant', projectId: 'project', documentId: 'doc', entities: [{ label: 'Agent' }, { label: 'Runtime' }], edges: [{ source: 'Agent', target: 'Runtime', relation: 'contains' }] });
  assert.equal(graph.status, 'synced'); assert.equal(graphPayload.statements.length, 2); assert.match(graphPayload.statements[0].statement, /MERGE/); await deleteKnowledgeGraph({ tenantId: 'tenant', projectId: 'project', documentId: 'doc' }); assert.match(graphPayload.statements[0].statement, /DETACH DELETE/);
  const dir = await mkdtemp(join(tmpdir(), 'novi-object-contract-')); delete process.env.NOVI_OBJECT_STORE_URL; process.env.NOVI_OBJECT_STORE_DIR = dir;
  const local = await putDocumentObject({ tenantId: 't', documentId: 'd', contentHash: 'b'.repeat(64), content: 'local', contentType: 'text/plain' });
  const localBody = await getDocumentObject(local); assert.equal(localBody.toString(), 'local');
  const localPath = join(dir, ...local.objectKey.split('/')); assert.ok((await readFile(localPath)).length > 0);
  assert.equal((await deleteDocumentObject(local)).status, 'deleted'); const afterDelete = await getDocumentObject(local); assert.equal(afterDelete, null);
  console.log('storage-contract-check: object store and graph HTTP/filesystem contracts passed');
} finally { await new Promise((resolve) => server.close(resolve)); for (const key of ['NOVI_OBJECT_STORE_URL', 'NOVI_OBJECT_STORE_DIR', 'NOVI_OBJECT_STORE_TOKEN', 'NOVI_OBJECT_STORE_ACCESS_KEY', 'NOVI_OBJECT_STORE_SECRET_KEY', 'NOVI_GRAPH_URL']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
