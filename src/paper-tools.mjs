import { PDFParse } from 'pdf-parse';
import { fetchSource } from './evidence.mjs';
import { extractImportedText } from './knowledge.mjs';

const MAX_PAPER_BYTES = 8 * 1024 * 1024;
const MAX_PAPER_TEXT = 12_000;

const clean = (value, max = 2_000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function decodeXml(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function doiFrom(value) {
  let candidate = String(value || '').trim().replace(/^doi:\s*/i, '');
  try {
    const url = new URL(candidate);
    if (['doi.org', 'dx.doi.org'].includes(url.hostname.toLowerCase())) candidate = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {}
  candidate = candidate.replace(/[\s),.;]+$/g, '');
  return /^10\.\d{4,9}\/\S+$/i.test(candidate) ? candidate : null;
}

function arxivFrom(value) {
  let candidate = String(value || '').trim().replace(/^arxiv:\s*/i, '');
  try {
    const url = new URL(candidate);
    if (/(?:^|\.)arxiv\.org$/i.test(url.hostname)) candidate = decodeURIComponent(url.pathname.replace(/^\/(?:abs|pdf)\//i, '').replace(/\.pdf$/i, ''));
  } catch {}
  const match = candidate.match(/^(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i);
  return match ? match[0] : null;
}

function dateParts(item = {}) {
  const parts = item.published?.['date-parts']?.[0] || item.issued?.['date-parts']?.[0] || [];
  return parts.filter((part) => Number.isFinite(Number(part))).join('-');
}

async function responseBody(url, options, maxBytes = 1_000_000) {
  const result = await fetchSource(url, { ...options, includeBody: true, maxBytes });
  if (result.status !== 'verified' || !result.body) return result;
  return result;
}

async function crossrefMetadata(doi, options) {
  const result = await responseBody(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, options);
  if (result.status !== 'verified') return { doi, landingUrl: `https://doi.org/${doi}` };
  let item = {};
  try { item = JSON.parse(result.body.toString('utf8')).message || {}; } catch {}
  return {
    doi: clean(item.DOI || doi, 500), title: clean(item.title?.[0]), authors: (item.author || []).slice(0, 50).map((author) => clean([author.given, author.family].filter(Boolean).join(' '), 200)).filter(Boolean),
    publishedAt: dateParts(item), venue: clean(item['container-title']?.[0], 500), abstract: clean(String(item.abstract || '').replace(/<[^>]+>/g, ' '), MAX_PAPER_TEXT),
    landingUrl: clean(item.URL || `https://doi.org/${doi}`, 2_000), publisher: clean(item.publisher, 500),
  };
}

function atomValue(body, tag) {
  return clean(decodeXml(body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]), MAX_PAPER_TEXT);
}

async function arxivMetadata(arxivId, options) {
  const result = await responseBody(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, options);
  const entry = result.status === 'verified' ? result.body.toString('utf8').match(/<entry>([\s\S]*?)<\/entry>/i)?.[1] || '' : '';
  const authors = [...entry.matchAll(/<author>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].slice(0, 50).map((match) => clean(decodeXml(match[1]), 200)).filter(Boolean);
  const discoveredId = atomValue(entry, 'id').split('/').pop() || arxivId;
  return {
    arxivId: discoveredId, title: atomValue(entry, 'title'), authors, publishedAt: atomValue(entry, 'published').slice(0, 10), abstract: atomValue(entry, 'summary'),
    landingUrl: `https://arxiv.org/abs/${discoveredId}`, pdfUrl: `https://arxiv.org/pdf/${discoveredId}`,
  };
}

function htmlMetadata(body) {
  const html = body.toString('utf8');
  const meta = (names) => {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const first = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'));
      const reversed = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'));
      const value = first?.[1] || reversed?.[1];
      if (value) return clean(decodeXml(value), MAX_PAPER_TEXT);
    }
    return '';
  };
  return {
    title: meta(['citation_title', 'dc.title', 'og:title']) || clean(decodeXml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])),
    doi: meta(['citation_doi', 'dc.identifier']), publishedAt: meta(['citation_publication_date', 'citation_date', 'article:published_time']).slice(0, 10),
    authors: [...html.matchAll(/<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']+)["'][^>]*>/gi)].slice(0, 50).map((match) => clean(decodeXml(match[1]), 200)),
    abstract: meta(['citation_abstract', 'dc.description', 'description']), pdfUrl: meta(['citation_pdf_url']), venue: meta(['citation_journal_title', 'citation_conference_title']),
  };
}

async function extractedPaper(result, maxCharacters) {
  const type = String(result.contentType || '').toLowerCase();
  if (type.includes('application/pdf') || /\.pdf(?:$|[?#])/i.test(result.url)) {
    const parser = new PDFParse({ data: result.body });
    try {
      const parsed = await parser.getText();
      const normalized = String(parsed.text || '').replace(/\s+/g, ' ').trim();
      const text = normalized.slice(0, maxCharacters);
      if (!text) throw new Error('PDF contained no extractable text');
      return { text, textTruncated: normalized.length > text.length, status: 'public-full-text', isFullText: true, format: 'pdf', metadata: {} };
    } finally { await parser.destroy().catch(() => {}); }
  }
  const metadata = type.includes('html') ? htmlMetadata(result.body) : {};
  const extracted = extractImportedText(result.body, result.contentType, result.url);
  const normalized = String(extracted.content || '').replace(/\s+/g, ' ').trim();
  const text = normalized.slice(0, maxCharacters);
  return { text, textTruncated: normalized.length > text.length, status: text ? 'public-page-text' : 'metadata-only', isFullText: false, format: extracted.format, metadata };
}

export async function fetchPaper(identifier, options = {}) {
  const raw = clean(identifier, 2_000);
  if (!raw) throw new Error('Paper identifier is required');
  const maxCharacters = Math.max(1_000, Math.min(MAX_PAPER_TEXT, Number(options.maxCharacters) || 6_000));
  const doi = doiFrom(raw); const arxivId = doi ? null : arxivFrom(raw);
  let metadata = doi ? await crossrefMetadata(doi, options) : arxivId ? await arxivMetadata(arxivId, options) : {};
  let contentUrl = arxivId ? metadata.pdfUrl : metadata.landingUrl;
  if (!doi && !arxivId) {
    try { contentUrl = new URL(raw).toString(); } catch { throw new Error('Paper identifier must be a DOI, arXiv identifier, or public HTTP(S) URL'); }
  }
  const base = { type: doi ? 'doi' : arxivId ? 'arxiv' : 'url', value: doi || arxivId || raw };
  if (options.includeText === false) {
    return { identifier: base, metadata, access: { status: metadata.abstract ? 'abstract-only' : 'metadata-only', isFullText: false, url: contentUrl || metadata.landingUrl || null }, ...(metadata.abstract ? { text: metadata.abstract.slice(0, maxCharacters) } : {}) };
  }
  let retrieved;
  try { retrieved = await responseBody(contentUrl, options, MAX_PAPER_BYTES); }
  catch (error) {
    return { identifier: base, metadata, access: { status: metadata.abstract ? 'abstract-only' : 'unavailable', isFullText: false, url: contentUrl || null, reason: clean(error.message, 240) }, ...(metadata.abstract ? { text: metadata.abstract.slice(0, maxCharacters) } : {}) };
  }
  if (retrieved.status !== 'verified') {
    return { identifier: base, metadata, access: { status: metadata.abstract ? 'abstract-only' : 'unavailable', isFullText: false, url: retrieved.url || contentUrl || null, httpStatus: retrieved.httpStatus }, ...(metadata.abstract ? { text: metadata.abstract.slice(0, maxCharacters) } : {}) };
  }
  let extracted;
  try { extracted = await extractedPaper(retrieved, maxCharacters); }
  catch (error) { extracted = { text: metadata.abstract || '', status: metadata.abstract ? 'abstract-only' : 'unavailable', isFullText: false, format: 'unavailable', metadata: {}, reason: clean(error.message, 240) }; }
  metadata = { ...extracted.metadata, ...metadata, title: metadata.title || extracted.metadata.title || '' };
  const access = { status: extracted.status, isFullText: extracted.isFullText, textTruncated: extracted.textTruncated === true, format: extracted.format, url: retrieved.url, httpStatus: retrieved.httpStatus, contentType: retrieved.contentType, retrievedBytes: retrieved.retrievedBytes, contentHash: retrieved.contentHash, verifiedAt: retrieved.verifiedAt, ...(extracted.reason ? { reason: extracted.reason } : {}) };
  const text = extracted.text || metadata.abstract || '';
  const source = { name: metadata.title || `Paper ${base.value}`, kind: arxivId ? 'Preprints' : 'Papers', url: retrieved.url, authority: arxivId ? 85 : doi ? 80 : 70, publishedAt: metadata.publishedAt || '', snippet: clean(metadata.abstract || text, 1_000), mapped: true, verification: 'verified', contentHash: retrieved.contentHash, verifiedAt: retrieved.verifiedAt, ...(metadata.doi ? { doi: metadata.doi } : {}), ...(metadata.arxivId ? { arxivId: metadata.arxivId } : {}) };
  return { identifier: base, metadata, access, ...(text ? { text } : {}), source };
}

export { MAX_PAPER_BYTES, MAX_PAPER_TEXT, arxivFrom, doiFrom };
