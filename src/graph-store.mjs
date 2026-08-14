const timeout = (ms) => AbortSignal.timeout(ms);

function endpoint() {
  if (!process.env.NOVI_GRAPH_URL) return null;
  const value = new URL(process.env.NOVI_GRAPH_URL);
  if (!['http:', 'https:'].includes(value.protocol)) throw new Error('NOVI_GRAPH_URL must use HTTP(S)');
  if (value.username || value.password) throw new Error('NOVI_GRAPH_URL must not embed credentials');
  const hostname = value.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
  if (process.env.NODE_ENV === 'production' && value.protocol !== 'https:' && !local) throw new Error('Production graph endpoint must use HTTPS (HTTP is allowed only for local loopback)');
  return value;
}

function authHeaders() {
  if (process.env.NOVI_GRAPH_TOKEN) return { authorization: `Bearer ${process.env.NOVI_GRAPH_TOKEN}` };
  if (process.env.NOVI_GRAPH_USER && process.env.NOVI_GRAPH_PASSWORD) return { authorization: `Basic ${Buffer.from(`${process.env.NOVI_GRAPH_USER}:${process.env.NOVI_GRAPH_PASSWORD}`).toString('base64')}` };
  return {};
}

/** Idempotently project tenant-scoped knowledge entities and edges into Neo4j's HTTP transaction endpoint. */
export async function syncKnowledgeGraph({ tenantId, projectId, documentId, entities = [], edges = [] }) {
  const url = endpoint();
  if (!url) return { status: 'disabled' };
  const statements = [{ statement: 'UNWIND $entities AS item MERGE (n:NoviEntity {tenantId:item.tenantId, projectId:item.projectId, documentId:item.documentId, label:item.label}) SET n.kind=item.kind', parameters: { entities: entities.map((item) => ({ tenantId, projectId, documentId, label: item.label, kind: item.kind || 'concept' })) } }, { statement: 'UNWIND $edges AS item MATCH (a:NoviEntity {tenantId:item.tenantId, projectId:item.projectId, documentId:item.documentId, label:item.source}), (b:NoviEntity {tenantId:item.tenantId, projectId:item.projectId, documentId:item.documentId, label:item.target}) MERGE (a)-[r:NOVI_RELATION {tenantId:item.tenantId, projectId:item.projectId, documentId:item.documentId, relation:item.relation}]->(b)', parameters: { edges: edges.map((item) => ({ tenantId, projectId, documentId, source: item.source, target: item.target, relation: item.relation || 'related-to' })) } }];
  const response = await fetch(url, { method: 'POST', signal: timeout(15_000), headers: { ...authHeaders(), accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ statements }) });
  if (!response.ok) throw new Error(`graph store returned ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  if (payload.errors?.length) throw new Error('graph store rejected knowledge projection');
  return { status: 'synced', entities: entities.length, edges: edges.length };
}

export function graphStoreConfigured() { return Boolean(process.env.NOVI_GRAPH_URL); }
export function validateGraphConfiguration() {
  const value = endpoint();
  if (process.env.NODE_ENV === 'production' && value) {
    const hostname = value.hostname.replace(/^\[|\]$/g, '');
    const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
    const basic = Boolean(process.env.NOVI_GRAPH_USER && process.env.NOVI_GRAPH_PASSWORD);
    if (!local && !process.env.NOVI_GRAPH_TOKEN && !basic) throw new Error('Production remote graph store requires NOVI_GRAPH_TOKEN or Basic credentials');
  }
  return true;
}

export async function deleteKnowledgeGraph({ tenantId, projectId, documentId }) {
  const url = endpoint(); if (!url) return { status: 'disabled' };
  const response = await fetch(url, { method: 'POST', signal: timeout(15_000), headers: { ...authHeaders(), accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ statements: [{ statement: 'MATCH (n:NoviEntity {tenantId:$tenantId, projectId:$projectId, documentId:$documentId}) DETACH DELETE n', parameters: { tenantId, projectId, documentId } }] }) });
  if (!response.ok) throw new Error(`graph store returned ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  if (payload.errors?.length) throw new Error('graph store rejected knowledge deletion');
  return { status: 'deleted' };
}
