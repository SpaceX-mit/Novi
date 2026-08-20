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

// The Wiki defaults to Chinese while controlled evidence is usually written
// in English. Normalizing the small set of Agent-OS terms below lets the
// citation gate compare a Chinese claim such as “状态图的检查点恢复” with
// an English excerpt such as “state graph checkpoint persistence” without
// treating a single product name as sufficient evidence. This is a lexical
// bridge only; the existing overlap thresholds remain in force.
const BILINGUAL_ALIASES = Object.freeze([
  ['状态图', 'state graph'], ['状态机', 'state machine'], ['状态转移', 'state transition'],
  ['检查点', 'checkpoint'], ['持久化', 'persistence'], ['运行时', 'runtime'],
  ['推理', 'reasoning'], ['行动', 'action'], ['观察', 'observation'],
  ['工具调用', 'tool calling'], ['工具', 'tool'], ['资源', 'resource'],
  ['协议', 'protocol'], ['客户端', 'client'], ['服务器', 'server'],
  ['多智能体', 'multi-agent'], ['监督器', 'supervisor'], ['记忆', 'memory'],
  ['检索', 'retrieval'], ['审批', 'approval'], ['权限', 'permission'],
  ['沙箱', 'sandbox'], ['隔离', 'isolation'], ['提示注入', 'prompt injection'],
  ['威胁模型', 'threat model'], ['风险', 'risk'], ['评估', 'evaluation'],
  ['重放', 'replay'], ['幂等', 'idempotency'], ['失败恢复', 'failure recovery'],
]);

function tokens(value) {
  const expanded = BILINGUAL_ALIASES.reduce((text, [term, alias]) => text.replaceAll(term, ` ${term} ${alias} `), String(value || '').toLocaleLowerCase());
  return [...new Set(expanded.match(/[a-z][a-z0-9_-]{2,}|\d{2,}|[\u4e00-\u9fff]{2,}/gu) || [])]
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

function markerSupport(paragraph, marker, indexedSources) {
  const clean = String(paragraph || '').replace(/\[S\d+\]/gu, '');
  const paragraphTokens = tokens(clean);
  const source = indexedSources.find((item) => item.citationId === marker);
  if (!source || paragraphTokens.length < 5) return false;
  const overlap = paragraphTokens.filter((token) => source.sourceTokens.has(token)).length;
  const ratio = overlap / Math.max(1, Math.min(paragraphTokens.length, source.sourceTokens.size));
  return overlap >= 2 && (overlap >= 3 || ratio >= 0.16);
}

export function supportedCitationIds(text, sources = []) {
  const indexedSources = Array.isArray(sources) && sources.length && sources[0]?.sourceTokens
    ? sources
    : usableSources(sources);
  if (!indexedSources.length) return [];
  const markers = [...new Set([...String(text || '').matchAll(/\[S(\d+)\]/gu)].map((match) => `S${match[1]}`))];
  const supported = new Set();
  const sentences = String(text || '').split(/(?<=[.!?。！？])\s+/u);
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    for (const marker of markers.filter((item) => sentence.includes(`[${item}]`))) {
      const trimmed = sentence.trim();
      const context = trimmed.startsWith(`[${marker}]`) && index > 0
        ? `${sentences[index - 1]} ${trimmed.slice(marker.length + 2)}`
        : sentence;
      if (markerSupport(context, marker, indexedSources)) supported.add(marker);
    }
  }
  return [...supported];
}

function repairText(value, indexedSources, stats) {
  const raw = String(value || '');
  if (raw.length < 80 || !indexedSources.length) return raw;
  const paragraphs = raw.split(/(\n\s*\n)/u);
  let changed = false;
  for (let index = 0; index < paragraphs.length; index += 2) {
    let paragraph = paragraphs[index];
    if (!paragraph) continue;
    // Repair at sentence granularity so a source-supported first sentence
    // does not accidentally certify an unrelated claim in the same paragraph.
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/u);
    const repairedSentences = sentences.map((sentence, sentenceIndex) => {
      const previous = sentenceIndex > 0 ? sentences[sentenceIndex - 1] : '';
      const context = sentence.trim().startsWith('[S') ? `${previous} ${sentence}` : sentence;
      const cleaned = sentence.replace(/\[S(\d+)\]/gu, (marker, number) => {
        if (markerSupport(context, `S${number}`, indexedSources)) return marker;
        changed = true; stats.markersRemoved += 1; return '';
      }).replace(/\s{2,}/gu, ' ').trim();
      if (/\[S\d+\]/u.test(cleaned)) return cleaned;
      const citations = paragraphSupport(cleaned, indexedSources);
      if (!citations.length) return cleaned;
      changed = true;
      stats.markersAdded += citations.length;
      for (const id of citations) stats.byCitation[id] = (stats.byCitation[id] || 0) + 1;
      return `${cleaned} ${citations.map((id) => `[${id}]`).join(' ')}`;
    });
    paragraphs[index] = repairedSentences.join(' ');
  }
  return changed ? paragraphs.join('') : raw;
}

function walk(value, key, indexedSources, stats, seen) {
  if (typeof value === 'string') {
    // Citation markers can appear in arrays such as nextQuestions, scope,
    // topics, or glossary terms even though those field names are not part of
    // the prose allowlist. If a marker is present, validate it everywhere;
    // otherwise an unsupported marker could survive in the artifact and make
    // the publication gate disagree with the repair pass.
    return (TEXT_KEYS.has(key) || /\[S\d+\]/u.test(value)) ? repairText(value, indexedSources, stats) : value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, key, indexedSources, stats, seen));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, walk(childValue, childKey, indexedSources, stats, seen)]));
}

export function repairCitationMarkers(content, sources = []) {
  const stats = { method: 'verified-excerpt-term-overlap', markersAdded: 0, markersRemoved: 0, byCitation: {} };
  const indexedSources = usableSources(sources);
  if (!indexedSources.length) return { content, stats: { ...stats, eligibleSources: 0 } };
  const repaired = walk(content, '', indexedSources, stats, new Set());
  return { content: repaired, stats: { ...stats, eligibleSources: indexedSources.length } };
}

export { TEXT_KEYS };
