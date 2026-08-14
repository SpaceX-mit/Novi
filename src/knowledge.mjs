import { createHash, randomUUID } from 'node:crypto';

const STOP_WORDS = new Set('a an the and or but for with from into onto this that these those is are was were be been to of in on by as at it its their our your we you they them'.split(' '));
const clean = (value) => String(value || '').replace(/\r\n?/g, '\n').trim();

export function contentHash(value) { return createHash('sha256').update(value).digest('hex'); }

/** Deterministic lightweight embedding for local/offline retrieval. Replace with a vector provider behind this boundary. */
export function embedText(value, dimensions = 24) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const terms = clean(value).toLowerCase().match(/[a-z0-9_\-\u4e00-\u9fff]+/gi) || [];
  for (const term of terms) {
    const digest = createHash('sha256').update(term).digest();
    const index = digest[0] % dimensions;
    vector[index] += (digest[1] / 255) * 2 - 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => Number((item / norm).toFixed(6)));
}

export function chunkText(value, maxCharacters = 900) {
  const content = clean(value);
  if (!content) return [];
  const paragraphs = content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs.length ? paragraphs : [content]) {
    if (paragraph.length <= maxCharacters && current.length + paragraph.length + 1 <= maxCharacters) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxCharacters) current = paragraph;
    else for (let offset = 0; offset < paragraph.length; offset += maxCharacters) chunks.push(paragraph.slice(offset, offset + maxCharacters));
    current = paragraph.length > maxCharacters ? '' : current;
  }
  if (current) chunks.push(current);
  return chunks.map((text, index) => ({ index, text }));
}

export function extractEntities(value) {
  const content = clean(value);
  const candidates = new Set();
  for (const match of content.matchAll(/\b[A-Z][A-Za-z0-9_-]{2,}(?:\s+[A-Z][A-Za-z0-9_-]{2,})*/g)) candidates.add(match[0].trim());
  for (const match of content.matchAll(/#[\p{L}\p{N}_-]{2,}/gu)) candidates.add(match[0].slice(1));
  for (const term of content.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || []) if (!STOP_WORDS.has(term)) candidates.add(term);
  return [...candidates].slice(0, 80);
}

export function ingestDocument(input, owner) {
  const title = clean(input?.title);
  const content = clean(input?.content);
  if (!title || title.length > 200) return { error: 'Document title is required and must be 200 characters or less' };
  if (!content || Buffer.byteLength(content, 'utf8') > 900_000) return { error: 'Document content is required and must be 900 KB or less' };
  const sourceUrl = clean(input?.sourceUrl);
  if (sourceUrl) {
    try { const parsed = new URL(sourceUrl); if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error(); }
    catch { return { error: 'sourceUrl must be a valid http or https URL' }; }
  }
  const now = new Date().toISOString();
  const documentId = randomUUID();
  const chunks = chunkText(content).map((chunk) => ({ id: randomUUID(), documentId, projectId: owner.projectId, tenantId: owner.tenantId, ...chunk, embedding: embedText(chunk.text), createdAt: now }));
  const entities = extractEntities(content).map((label) => ({ id: randomUUID(), projectId: owner.projectId, tenantId: owner.tenantId, documentId, label, kind: 'concept', createdAt: now }));
  const edges = [];
  for (let index = 1; index < entities.length; index += 1) edges.push({ id: randomUUID(), projectId: owner.projectId, tenantId: owner.tenantId, source: entities[index - 1].label, target: entities[index].label, relation: 'co-occurs-with', documentId, createdAt: now });
  return { document: { id: documentId, projectId: owner.projectId, tenantId: owner.tenantId, title, sourceUrl, sourceKind: clean(input?.sourceKind) || 'text', mimeType: clean(input?.mimeType) || 'text/plain', contentHash: contentHash(content), characterCount: content.length, chunkCount: chunks.length, entityCount: entities.length, createdAt: now, updatedAt: now }, content, chunks, entities, edges };
}

export function extractImportedText(buffer, contentType = '', sourceUrl = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const type = String(contentType).toLowerCase().split(';')[0].trim();
  if (type === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(sourceUrl)) return { content: null, format: 'pdf' };
  if (type === 'text/html' || type === 'application/xhtml+xml' || /\.(?:html?|xhtml)(?:$|[?#])/i.test(sourceUrl)) {
    const html = bytes.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return { content: html.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(), format: 'html' };
  }
  if (type && !['text/plain', 'text/markdown', 'application/json', 'application/xml', 'text/xml', 'application/javascript', 'text/javascript', 'application/octet-stream'].includes(type)) return { content: null, format: 'unsupported' };
  if (bytes.includes(0)) return { content: null, format: 'binary' };
  return { content: bytes.toString('utf8').replace(/\0/g, '').trim(), format: 'text' };
}

export function knowledgeForProject(state, projectId, tenantId) {
  const documents = (state.documents || []).filter((item) => item.projectId === projectId && item.tenantId === tenantId);
  const chunks = (state.chunks || []).filter((item) => documents.some((document) => document.id === item.documentId));
  const entities = (state.knowledgeEntities || []).filter((item) => documents.some((document) => document.id === item.documentId));
  const edges = (state.knowledgeEdges || []).filter((item) => documents.some((document) => document.id === item.documentId));
  return { documents, chunks, entities, edges };
}

function cosine(left, right) {
  return left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);
}

export function searchProjectKnowledge(state, projectId, tenantId, query, limit = 10) {
  const knowledge = knowledgeForProject(state, projectId, tenantId);
  const vector = embedText(query);
  const documents = new Map(knowledge.documents.map((item) => [item.id, item]));
  return knowledge.chunks.map((chunk) => {
    const document = documents.get(chunk.documentId);
    return { ...chunk, score: cosine(vector, chunk.embedding || []), document: document?.title || null, ...(document?.sourceUrl ? { sourceUrl: document.sourceUrl } : {}), sourceKind: document?.sourceKind || 'text' };
  })
    .sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}
