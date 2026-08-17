import { mcpSourceConfigured, searchMcpSources } from './source-adapters.mjs';

const timeoutSignal = (ms) => AbortSignal.timeout(ms);
const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const safeLimit = (value, fallback = 5) => Math.max(1, Math.min(50, Number.isFinite(Number(value)) ? Number(value) : fallback));
const headers = (accept = 'application/json') => ({ accept, 'user-agent': 'Novi/0.1 (+https://novi.local)' });

const kindWeight = Object.freeze({ Standards: 1, 'Official Docs': 0.98, Papers: 0.95, Preprints: 0.9, 'Books & Reports': 0.86, Code: 0.82, Models: 0.8, Reference: 0.72, Video: 0.62, 'Blogs & Industry': 0.58, Community: 0.5 });

function normalizeSource(source, query = '') {
  if (!source || !source.url) return null;
  try {
    const parsed = new URL(String(source.url));
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    const authority = Math.max(0, Math.min(100, Number(source.authority) || 0));
    const year = Number.parseInt(String(source.publishedAt || '').slice(0, 4), 10);
    const recency = Number.isFinite(year) ? Math.max(0, Math.min(1, (year - 2015) / 15)) : 0.35;
    const terms = String(query).toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{2,}/g) || [];
    const haystack = `${source.name || ''} ${source.snippet || ''}`.toLowerCase();
    const overlap = terms.length ? terms.filter((term) => haystack.includes(term)).length / new Set(terms).size : 0.35;
    const score = Number((0.45 * authority / 100 + 0.2 * (kindWeight[source.kind] || 0.5) + 0.15 * recency + 0.2 * overlap).toFixed(4));
    return { ...source, url: parsed.toString(), authority, relevanceScore: score };
  } catch { return null; }
}

async function openAlex(topic, limit, { fetchImpl = globalThis.fetch } = {}) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(topic)}&per-page=${limit}&select=id,display_name,publication_year,doi,primary_location,cited_by_count,open_access`;
  const response = await fetchImpl(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);
  const payload = await response.json();
  return (payload.results || []).map((item) => ({
    name: text(item.display_name) || 'Untitled work', kind: 'Papers', url: item.doi || item.primary_location?.landing_page_url || item.id,
    authority: Math.min(99, 70 + Math.round(Math.log10((item.cited_by_count || 0) + 1) * 10)), publishedAt: item.publication_year ? String(item.publication_year) : '', mapped: true,
  }));
}

async function arxiv(topic, limit, { fetchImpl = globalThis.fetch } = {}) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}&start=0&max_results=${limit}&sortBy=relevance`;
  const response = await fetchImpl(url, { signal: timeoutSignal(6500), headers: headers('application/atom+xml') });
  if (!response.ok) throw new Error(`arXiv returned ${response.status}`);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((match) => {
    const body = match[1];
    const value = (tag) => text(body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]);
    const identifier = value('id').split('/').pop();
    return { name: value('title') || 'arXiv preprint', kind: 'Preprints', url: value('id'), authority: 85, publishedAt: value('published').slice(0, 10), mapped: true, snippet: value('summary'), ...(identifier ? { arxivId: identifier, pdfUrl: `https://arxiv.org/pdf/${identifier}` } : {}) };
  });
}

async function wikipedia(topic, limit) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=${limit}&format=json&origin=*`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const payload = await response.json();
  return (payload.query?.search || []).map((item) => ({
    name: text(item.title) || 'Wikipedia article', kind: 'Reference', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || '').replace(/ /g, '_'))}`,
    authority: 72, publishedAt: '', mapped: true, snippet: text(item.snippet?.replace(/<[^>]+>/g, '')),
  }));
}

async function crossref(topic, limit, { fetchImpl = globalThis.fetch } = {}) {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(topic)}&rows=${limit}&select=DOI,title,published,container-title,URL,abstract`;
  const response = await fetchImpl(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Crossref returned ${response.status}`);
  const payload = await response.json();
  return (payload.message?.items || []).map((item) => {
    const date = item.published?.['date-parts']?.[0] || [];
    return { name: text(item.title?.[0]) || 'Crossref work', kind: 'Papers', url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''), authority: 80, publishedAt: date.join('-'), mapped: true, snippet: text(item.abstract?.replace(/<[^>]+>/g, '')), ...(item.DOI ? { doi: item.DOI } : {}), ...(item['container-title']?.[0] ? { venue: text(item['container-title'][0]) } : {}) };
  });
}

const publisherCatalogs = Object.freeze({
  ieee: { prefix: '10.1109', label: 'IEEE Xplore', authority: 92 },
  acm: { prefix: '10.1145', label: 'ACM Digital Library', authority: 92 },
  springer: { prefix: '10.1007', label: 'SpringerLink', authority: 89 },
});

async function publisherPapers(topic, limit, catalog, { fetchImpl = globalThis.fetch } = {}) {
  const publisher = publisherCatalogs[catalog];
  if (!publisher) throw new Error('Unsupported publisher catalog');
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(topic)}&filter=prefix:${publisher.prefix}&rows=${limit}&select=DOI,title,published,container-title,URL,abstract`;
  const response = await fetchImpl(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`${publisher.label} catalog returned ${response.status}`);
  const payload = await response.json();
  return (payload.message?.items || []).map((item) => {
    const date = item.published?.['date-parts']?.[0] || [];
    return { name: text(item.title?.[0]) || `${publisher.label} work`, kind: 'Papers', url: item.DOI ? `https://doi.org/${item.DOI}` : item.URL, authority: publisher.authority, publishedAt: date.join('-'), mapped: true, snippet: text(item.abstract?.replace(/<[^>]+>/g, '')), publisher: publisher.label, ...(item.DOI ? { doi: item.DOI } : {}) };
  });
}

const ieeePapers = (topic, limit, options) => publisherPapers(topic, limit, 'ieee', options);
const acmPapers = (topic, limit, options) => publisherPapers(topic, limit, 'acm', options);
const springerPapers = (topic, limit, options) => publisherPapers(topic, limit, 'springer', options);

async function github(topic, limit) {
  const token = process.env.GITHUB_TOKEN;
  const requestHeaders = { ...headers(), accept: 'application/vnd.github+json' };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(topic)}&per_page=${limit}&sort=stars&order=desc`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: requestHeaders });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const payload = await response.json();
  return (payload.items || []).map((item) => ({
    name: text(item.full_name || item.name) || 'GitHub repository', kind: 'Code', url: item.html_url || item.url,
    authority: Math.min(95, 55 + Math.round(Math.log10((item.stargazers_count || 0) + 1) * 12)), publishedAt: text(item.updated_at).slice(0, 10), mapped: true, snippet: text(item.description),
  }));
}

async function semanticScholar(topic, limit, { fetchImpl = globalThis.fetch } = {}) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(topic)}&limit=${limit}&fields=title,abstract,url,year,citationCount,openAccessPdf`;
  const requestHeaders = headers();
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) requestHeaders['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const response = await fetchImpl(url, { signal: timeoutSignal(6500), headers: requestHeaders });
  if (!response.ok) throw new Error(`Semantic Scholar returned ${response.status}`);
  const payload = await response.json();
  return (payload.data || []).map((item) => ({ name: text(item.title) || 'Semantic Scholar paper', kind: 'Papers', url: item.openAccessPdf?.url || item.url || (item.paperId ? `https://www.semanticscholar.org/paper/${item.paperId}` : ''), authority: Math.min(99, 68 + Math.round(Math.log10((item.citationCount || 0) + 1) * 10)), publishedAt: item.year ? String(item.year) : '', mapped: true, snippet: text(item.abstract), ...(item.paperId ? { paperId: item.paperId } : {}), ...(item.openAccessPdf?.url ? { pdfUrl: item.openAccessPdf.url, openAccess: true } : {}) }));
}

async function huggingFace(topic, limit) {
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(topic)}&limit=${limit}&sort=downloads&direction=-1`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Hugging Face returned ${response.status}`);
  const payload = await response.json();
  return (payload || []).map((item) => ({ name: text(item.id) || 'Hugging Face model', kind: 'Models', url: item.id ? `https://huggingface.co/${item.id}` : '', authority: Math.min(94, 55 + Math.round(Math.log10((item.downloads || 0) + 1) * 10)), publishedAt: text(item.lastModified).slice(0, 10), mapped: true, snippet: text(item.pipeline_tag) }));
}

async function stackExchange(topic, limit) {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(topic)}&site=stackoverflow&pagesize=${limit}`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Stack Exchange returned ${response.status}`);
  const payload = await response.json();
  return (payload.items || []).map((item) => ({ name: text(item.title) || 'Stack Overflow question', kind: 'Community', url: item.link, authority: 65, publishedAt: item.creation_date ? new Date(item.creation_date * 1000).toISOString().slice(0, 10) : '', mapped: true, snippet: '' }));
}

async function reddit(topic, limit) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&limit=${limit}&sort=relevance`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
  const payload = await response.json();
  return (payload.data?.children || []).map((entry) => { const item = entry.data || {}; return { name: text(item.title) || 'Reddit discussion', kind: 'Community', url: item.permalink ? `https://www.reddit.com${item.permalink}` : '', authority: 52, publishedAt: item.created_utc ? new Date(item.created_utc * 1000).toISOString().slice(0, 10) : '', mapped: true, snippet: text(item.selftext) }; });
}

async function rfc(topic, limit) {
  const url = `https://www.rfc-editor.org/search/rfc_search_detail.php?title=${encodeURIComponent(topic)}`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers('text/html') });
  if (!response.ok) throw new Error(`RFC Editor returned ${response.status}`);
  const html = await response.text();
  const links = [...html.matchAll(/href="(\/rfc\/rfc\d+\.html)"[^>]*>([^<]+)/gi)].slice(0, limit);
  return links.map((match) => ({ name: text(match[2]) || 'RFC standard', kind: 'Standards', url: `https://www.rfc-editor.org${match[1]}`, authority: 90, publishedAt: '', mapped: true }));
}

async function youtube(topic, limit) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YouTube connector requires YOUTUBE_API_KEY');
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${limit}&q=${encodeURIComponent(topic)}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  const payload = await response.json();
  return (payload.items || []).map((item) => {
    const snippet = item.snippet || {};
    const videoId = item.id?.videoId;
    return { name: text(snippet.title) || 'YouTube video', kind: 'Video', url: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '', authority: 62, publishedAt: text(snippet.publishedAt).slice(0, 10), mapped: true, snippet: text(snippet.description) };
  });
}

async function internetArchiveBooks(topic, limit) {
  const query = encodeURIComponent(`title:(${topic}) OR description:(${topic})`);
  const url = `https://archive.org/advancedsearch.php?q=${query}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=year&rows=${limit}&page=1&output=json`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Internet Archive returned ${response.status}`);
  const payload = await response.json();
  return (payload.response?.docs || []).map((item) => ({ name: text(item.title) || 'Internet Archive item', kind: 'Books & Reports', url: item.identifier ? `https://archive.org/details/${encodeURIComponent(item.identifier)}` : '', authority: 68, publishedAt: item.year ? String(item.year) : '', mapped: true, snippet: text(item.description) }));
}

async function hackerNewsBlogs(topic, limit) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=${limit}`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: headers() });
  if (!response.ok) throw new Error(`Hacker News returned ${response.status}`);
  const payload = await response.json();
  return (payload.hits || []).map((item) => ({ name: text(item.title) || 'Hacker News article', kind: 'Blogs & Industry', url: item.url || (item.objectID ? `https://news.ycombinator.com/item?id=${item.objectID}` : ''), authority: 58, publishedAt: text(item.created_at).slice(0, 10), mapped: true, snippet: text(item.story_text || item.comment_text) }));
}

async function officialDocs(topic, limit) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${topic} official documentation`)}&per_page=${limit}&sort=stars&order=desc`;
  const requestHeaders = { ...headers(), accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) requestHeaders.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { signal: timeoutSignal(6500), headers: requestHeaders });
  if (!response.ok) throw new Error(`Documentation search returned ${response.status}`);
  const payload = await response.json();
  return (payload.items || []).map((item) => ({ name: text(item.full_name || item.name) || 'Documentation repository', kind: 'Official Docs', url: item.html_url || item.url, authority: Math.min(90, 68 + Math.round(Math.log10((item.stargazers_count || 0) + 1) * 8)), publishedAt: text(item.updated_at).slice(0, 10), mapped: true, snippet: text(item.description) }));
}

export async function searchKnowledgeSources(topic, limit = 5) {
  const query = text(topic);
  if (!query) return [];
  const count = safeLimit(limit);
  const providers = [openAlex, arxiv, wikipedia, crossref, ieeePapers, acmPapers, springerPapers, github, semanticScholar, huggingFace, stackExchange, reddit, rfc, youtube, internetArchiveBooks, hackerNewsBlogs, officialDocs];
  const calls = providers.map((provider) => provider(query, count));
  if (mcpSourceConfigured()) calls.push(searchMcpSources(query, count));
  const responses = await Promise.allSettled(calls);
  const items = responses.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!responses.some((result) => result.status === 'fulfilled')) throw new AggregateError(responses.filter((result) => result.status === 'rejected').map((result) => result.reason), 'All knowledge source providers failed');
  const unique = new Map();
  for (const item of items) {
    const normalized = normalizeSource(item, query);
    if (normalized && !unique.has(normalized.url)) unique.set(normalized.url, normalized);
  }
  return [...unique.values()].sort((left, right) => right.relevanceScore - left.relevanceScore || right.authority - left.authority || left.url.localeCompare(right.url)).slice(0, count * 2);
}

export async function searchPaperSources(topic, limit = 5, options = {}) {
  const query = text(topic);
  if (!query) return [];
  const count = Math.min(10, safeLimit(limit));
  const providers = options.providers || [openAlex, arxiv, crossref, semanticScholar, ieeePapers, acmPapers, springerPapers];
  const responses = await Promise.allSettled(providers.map((provider) => provider(query, count, options)));
  const items = responses.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!responses.some((result) => result.status === 'fulfilled')) throw new AggregateError(responses.filter((result) => result.status === 'rejected').map((result) => result.reason), 'All paper source providers failed');
  const unique = new Map();
  for (const item of items) {
    const normalized = normalizeSource(item, query);
    if (normalized && !unique.has(normalized.url)) unique.set(normalized.url, normalized);
  }
  return [...unique.values()].sort((left, right) => right.relevanceScore - left.relevanceScore || right.authority - left.authority || left.url.localeCompare(right.url)).slice(0, count * 2);
}

export { openAlex, arxiv, wikipedia, crossref, ieeePapers, acmPapers, springerPapers, github, semanticScholar, huggingFace, stackExchange, reddit, rfc, youtube, internetArchiveBooks, hackerNewsBlogs, officialDocs, normalizeSource };
