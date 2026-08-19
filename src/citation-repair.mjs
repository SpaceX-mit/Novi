// Conservative, source-packet-only citation repair. This is deliberately not
// a claim generator: it may add an existing [S#] marker only when a paragraph
// shares enough distinctive terms with a verified source excerpt/title.

const TEXT_KEYS = new Set([
  'abstract', 'body', 'description', 'definition', 'finding', 'gap', 'method',
  'note', 'objective', 'opportunities', 'outcome', 'purpose', 'question',
  'responsibility', 'summary', 'text', 'tradeoffs', 'limitations', 'evidence',
  'explanation', 'analysis', 'rationale', 'conclusion', 'result', 'scope',
]);

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'being', 'between', 'could',
  'first', 'from', 'have', 'into', 'more', 'most', 'other', 'over', 'should',
  'their', 'there', 'these', 'those', 'through', 'under', 'using', 'where',
  'which', 'while', 'with', 'without', 'would', '以及', '一个', '一种', '可以',
  '通过', '这个', '这些', '需要', '进行', '系统', '内容', '研究',
]);

function tokens(value) {
  return [...new Set(String(value || '').toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|\d{2,}|[\u4e00-\u9fff]{2,}/gu) || [])]
    .filter((item) => !STOP_WORDS.has(item));
}

function usableSources(sources) {
  return (Array.isArray(sources) ? sources : []).map((source, index) => {
    const citationId = String(source?.citationId || `S${index + 1}`);
    const excerpt = String(source?.excerpt || source?.snippet || '').trim();
    const verified = source?.mapped === true
      && source?.verification !== 'unreachable'
      && source?.status !== 'unreachable'
      && (source?.verification === 'verified' || Boolean(source?.contentHash) || Boolean(excerpt));
    if (!verified || !/^S\d+$/u.test(citationId) || excerpt.length < 20) return null;
    const sourceTokens = tokens(`${source.name || ''} ${source.kind || ''} ${excerpt}`);
    return sourceTokens.length >= 2 ? { source, citationId, sourceTokens: new Set(sourceTokens) } : null;
  }).filter(Boolean);
}

function paragraphSupport(paragraph, indexedSources) {
  const paragraphTokens = tokens(paragraph);
  if (paragraphTokens.length < 5) return [];
  const values = indexedSources.map((item) => {
    const overlap = paragraphTokens.filter((token) => item.sourceTokens.has(token));
    // Two distinctive terms is the minimum; requiring either a third term or
    // a meaningful ratio prevents generic words from manufacturing citations.
    const ratio = overlap.length / Math.max(1, Math.min(paragraphTokens.length, item.sourceTokens.size));
    return { citationId: item.citationId, overlap: overlap.length, ratio };
  }).filter((item) => item.overlap >= 2 && (item.overlap >= 3 || item.ratio >= 0.16))
    .sort((left, right) => right.overlap - left.overlap || right.ratio - left.ratio);
  return values.slice(0, 2).map((item) => item.citationId);
}

function repairText(value, indexedSources, stats) {
  const raw = String(value || '');
  if (raw.length < 80 || !indexedSources.length) return raw;
  const paragraphs = raw.split(/(\n\s*\n)/u);
  let changed = false;
  for (let index = 0; index < paragraphs.length; index += 2) {
    const paragraph = paragraphs[index];
    if (!paragraph || /\[S\d+\]/u.test(paragraph)) continue;
    // Repair at sentence granularity so a source-supported first sentence
    // does not accidentally certify an unrelated claim in the same paragraph.
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/u);
    const repairedSentences = sentences.map((sentence) => {
      const citations = paragraphSupport(sentence, indexedSources);
      if (!citations.length) return sentence;
      changed = true;
      stats.markersAdded += citations.length;
      for (const id of citations) stats.byCitation[id] = (stats.byCitation[id] || 0) + 1;
      return `${sentence.trimEnd()} ${citations.map((id) => `[${id}]`).join(' ')}`;
    });
    paragraphs[index] = repairedSentences.join(' ');
  }
  return changed ? paragraphs.join('') : raw;
}

function walk(value, key, indexedSources, stats, seen) {
  if (typeof value === 'string') return TEXT_KEYS.has(key) ? repairText(value, indexedSources, stats) : value;
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, key, indexedSources, stats, seen));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, walk(childValue, childKey, indexedSources, stats, seen)]));
}

export function repairCitationMarkers(content, sources = []) {
  const stats = { method: 'verified-excerpt-term-overlap', markersAdded: 0, byCitation: {} };
  const indexedSources = usableSources(sources);
  if (!indexedSources.length) return { content, stats: { ...stats, eligibleSources: 0 } };
  const repaired = walk(content, '', indexedSources, stats, new Set());
  return { content: repaired, stats: { ...stats, eligibleSources: indexedSources.length } };
}

export { TEXT_KEYS };
