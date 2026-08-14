import { randomUUID } from 'node:crypto';
import { deleteDocumentObject, getDocumentObject, putDocumentObject, validateObjectStoreConfiguration } from '../src/object-store.mjs';
import { deleteKnowledgeGraph, syncKnowledgeGraph, validateGraphConfiguration } from '../src/graph-store.mjs';

if (!process.env.NOVI_OBJECT_STORE_URL) throw new Error('infrastructure-integration-check requires NOVI_OBJECT_STORE_URL');
if (!process.env.NOVI_GRAPH_URL) throw new Error('infrastructure-integration-check requires NOVI_GRAPH_URL');
validateObjectStoreConfiguration(); validateGraphConfiguration();

const suffix = randomUUID();
const tenantId = `integration-${suffix}`; const projectId = randomUUID(); const documentId = randomUUID();
const content = `Novi external infrastructure integration ${suffix}`;
let object;

function graphHeaders() {
  if (process.env.NOVI_GRAPH_TOKEN) return { authorization: `Bearer ${process.env.NOVI_GRAPH_TOKEN}` };
  if (process.env.NOVI_GRAPH_USER && process.env.NOVI_GRAPH_PASSWORD) return { authorization: `Basic ${Buffer.from(`${process.env.NOVI_GRAPH_USER}:${process.env.NOVI_GRAPH_PASSWORD}`).toString('base64')}` };
  return {};
}

async function graphCount() {
  const response = await fetch(process.env.NOVI_GRAPH_URL, { method: 'POST', headers: { ...graphHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ statements: [{ statement: 'MATCH (n:NoviEntity {tenantId:$tenantId}) RETURN count(n) AS count', parameters: { tenantId } }] }) });
  if (!response.ok) throw new Error(`graph verification returned ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`graph verification failed: ${payload.errors[0].message || 'unknown error'}`);
  return Number(payload.results?.[0]?.data?.[0]?.row?.[0] || 0);
}

try {
  object = await putDocumentObject({ tenantId, documentId, contentHash: suffix.replaceAll('-', '').padEnd(64, '0').slice(0, 64), content, contentType: 'text/plain' });
  const restored = await getDocumentObject(object);
  if (restored?.toString() !== content) throw new Error('object store round trip content mismatch');
  const graph = await syncKnowledgeGraph({ tenantId, projectId, documentId, entities: [{ label: 'Novi', kind: 'product' }, { label: 'Knowledge', kind: 'concept' }], edges: [{ source: 'Novi', target: 'Knowledge', relation: 'builds' }] });
  if (graph.status !== 'synced' || await graphCount() !== 2) throw new Error('graph store round trip count mismatch');
} finally {
  if (object) await deleteDocumentObject(object);
  await deleteKnowledgeGraph({ tenantId, projectId, documentId });
}

if (object && await getDocumentObject(object) !== null) throw new Error('object store cleanup failed');
if (await graphCount() !== 0) throw new Error('graph store cleanup failed');
console.log('infrastructure-integration-check: object SigV4/gateway and Neo4j write-read-delete passed');
