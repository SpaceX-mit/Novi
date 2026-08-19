const AGENT_OS_TERMS = [
  'agent os', 'agent runtime', 'langgraph', 'mcp', 'model context protocol',
  'react', 'plan-and-execute', 'supervisor', 'checkpoint', 'memory',
  'approval', 'sandbox', 'prompt injection', 'evaluation', 'replay',
  'idempotency', '幂等', '记忆', '审批', '沙箱', '提示注入', '评估', '重放',
];
import { supportedCitationIds } from './citation-repair.mjs';

const AGENT_RUNTIME_OPTIONS = [
  'langgraph', 'openai agents', 'autogen', 'crewai', 'pydanticai',
  'pi', 'claude code', 'codex', 'hermes', 'semantic kernel',
];

const REQUIRED_SECTION_SIGNALS = Object.freeze({
  mechanism: ['state', '状态', 'transition', '转换', 'react', 'plan', 'supervisor', '策略'],
  architecture: ['architecture', '架构', 'interface', '接口', 'event', '事件', 'checkpoint', '队列'],
  implementation: ['implementation', '实现', 'workload', '工作负载', 'experiment', '实验', 'metric', '指标'],
  tradeoffs: ['trade-off', 'tradeoff', '取舍', '替代', 'cost', '成本', 'latency', '延迟'],
  failures: ['failure', '失败', 'risk', '风险', 'prompt injection', '提示注入', 'recovery', '恢复'],
  validation: ['validation', '验证', 'evidence', '证据', 'replay', '重放', 'falsif', '可证伪'],
});

const textOf = (value) => String(value || '').trim();
const normalized = (value) => textOf(value).toLocaleLowerCase().replace(/\s+/gu, ' ');
const includesAny = (text, terms) => terms.some((term) => text.includes(term));
const countAny = (text, terms) => terms.filter((term) => text.includes(term)).length;

function paragraphCount(body) {
  return textOf(body).split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean).length;
}

function documentText(document) {
  return [document?.title, document?.purpose, ...(document?.sections || []).flatMap((section) => [section?.title, section?.body])].map(textOf).join('\n');
}

function score(value, maximum) {
  return Number(Math.max(0, Math.min(1, value / maximum)).toFixed(3));
}

function sectionFor(document, index) {
  return textOf(document?.sections?.[index]?.body);
}

function assessDeepDive(document, { minSectionChars = 420, minParagraphs = 2 } = {}) {
  const sections = Array.isArray(document?.sections) ? document.sections : [];
  const sectionLengths = sections.map((section) => textOf(section?.body).length);
  const paragraphCounts = sections.map((section) => paragraphCount(section?.body));
  const structuralFailures = [];
  if (sections.length !== 6) structuralFailures.push('exactly six technical sections are required');
  if (sectionLengths.some((length) => length < minSectionChars)) structuralFailures.push(`each section must contain at least ${minSectionChars} characters`);
  if (paragraphCounts.some((count) => count < minParagraphs)) structuralFailures.push(`each section must contain at least ${minParagraphs} coherent paragraphs`);
  if (sections.some((section) => /^\s*#{1,6}\s/u.test(textOf(section?.body)))) structuralFailures.push('section bodies must not contain nested Markdown headings');
  const allText = normalized(documentText(document));
  const sectionSignals = {
    mechanism: includesAny(normalized(sectionFor(document, 1)), REQUIRED_SECTION_SIGNALS.mechanism),
    architecture: includesAny(normalized(sectionFor(document, 2)), REQUIRED_SECTION_SIGNALS.architecture),
    implementation: includesAny(normalized(sectionFor(document, 3)), REQUIRED_SECTION_SIGNALS.implementation),
    tradeoffs: includesAny(normalized(sectionFor(document, 3)), REQUIRED_SECTION_SIGNALS.tradeoffs) || includesAny(normalized(sectionFor(document, 4)), REQUIRED_SECTION_SIGNALS.tradeoffs),
    failures: includesAny(normalized(sectionFor(document, 4)), REQUIRED_SECTION_SIGNALS.failures),
    validation: includesAny(normalized(sectionFor(document, 5)), REQUIRED_SECTION_SIGNALS.validation),
  };
  return {
    id: document?.id,
    slug: document?.slug,
    title: document?.title,
    sectionLengths,
    paragraphCounts,
    totalCharacters: sectionLengths.reduce((sum, value) => sum + value, 0),
    structuralFailures,
    sectionSignals,
    score: Number((Object.values(sectionSignals).filter(Boolean).length / Object.keys(sectionSignals).length).toFixed(3)),
    text: allText,
  };
}

export function assessWikiQuality(artifact, { topic = '', requireAgentOs = false, minSectionChars = 420, sources = null } = {}) {
  const content = artifact?.content || {};
  const documents = Array.isArray(content.deepDiveDocuments) ? content.deepDiveDocuments : [];
  const wiki = content.llmWiki || {};
  const deepDive = documents.map((document) => assessDeepDive(document, { minSectionChars }));
  const corpus = normalized([
    topic, content.expertGoal?.question, content.expertGoal?.domain, content.expertGoal?.outcome,
    content.summary, wiki.summary, ...documents.map(documentText),
    ...(wiki.sections || []).flatMap((section) => [section?.title, section?.body]),
    ...(wiki.glossary || []).flatMap((item) => [item?.term, item?.definition]),
  ].join('\n'));
  const termHits = (requireAgentOs ? AGENT_OS_TERMS : []).filter((term) => corpus.includes(normalized(term)));
  const runtimeHits = AGENT_RUNTIME_OPTIONS.filter((term) => corpus.includes(normalized(term)));
  const requiredAgentOsTerms = requireAgentOs ? AGENT_OS_TERMS.length : 0;
  const evidenceStatus = textOf(content.evidence?.status || 'unverified');
  const evidenceDisclaimer = textOf(content.evidence?.disclaimer);
  const evidenceSources = Array.isArray(sources) ? sources.filter((source) => source?.mapped === true && source.verification !== 'unreachable' && source.status !== 'unreachable') : content.evidence?.sources;
  const mappedSources = Array.isArray(evidenceSources) ? evidenceSources.length : 0;
  const claimSources = Array.isArray(evidenceSources) ? evidenceSources : [];
  const mappedClaims = Array.isArray(content.evidence?.claims) ? content.evidence.claims.filter((claim) => supportedCitationIds(claim?.text, claimSources).length).length : 0;
  const totalClaims = Array.isArray(content.evidence?.claims) ? content.evidence.claims.length : 0;
  const supportedCitationCount = Array.isArray(content.evidence?.claims)
    ? content.evidence.claims.reduce((sum, claim) => sum + supportedCitationIds(claim?.text, claimSources).length, 0)
    : 0;
  const citationCount = supportedCitationCount;
  const explicitSourceClaims = Array.isArray(content.evidence?.claims) ? content.evidence.claims.filter((claim) => supportedCitationIds(claim?.text, claimSources).length).length : 0;
  const rawCitationCount = (corpus.match(/\[s\d+\]/gu) || []).length;
  const mapSlugs = (wiki.documentMap || []).map((document) => document?.slug);
  const expectedSlugs = documents.map((document) => document?.slug);
  const coherenceFailures = [];
  if (expectedSlugs.length < 5) coherenceFailures.push('at least five Deep Dive documents are required');
  if (JSON.stringify(mapSlugs) !== JSON.stringify(expectedSlugs)) coherenceFailures.push('LLM Wiki document map must match Deep Dive order');
  if (!wiki.summary || textOf(wiki.summary).length < 280) coherenceFailures.push('LLM Wiki summary must explain the decision and synthesis, not only announce the files');
  if (!Array.isArray(wiki.sections) || wiki.sections.length < 8) coherenceFailures.push('LLM Wiki must contain at least eight synthesis sections');
  if ((wiki.sections || []).some((section) => textOf(section?.body).length < 220)) coherenceFailures.push('LLM Wiki synthesis sections are too short');

  const dimensions = {
    technicalSpecificity: requireAgentOs ? score(termHits.length, 12) : score(corpus.length > 2500 ? 1 : 0, 1),
    mechanismDepth: score(deepDive.filter((item) => item.sectionSignals.mechanism).length, Math.max(1, documents.length)),
    architectureCoverage: score(deepDive.filter((item) => item.sectionSignals.architecture).length, Math.max(1, documents.length)),
    implementationConcreteness: score(deepDive.filter((item) => item.sectionSignals.implementation).length, Math.max(1, documents.length)),
    tradeoffCoverage: score(deepDive.filter((item) => item.sectionSignals.tradeoffs).length, Math.max(1, documents.length)),
    failureModeCoverage: score(deepDive.filter((item) => item.sectionSignals.failures).length, Math.max(1, documents.length)),
    evaluationRigor: score(deepDive.filter((item) => item.sectionSignals.validation).length, Math.max(1, documents.length)),
    runtimeComparison: requireAgentOs ? score(runtimeHits.length, 3) : 1,
    evidenceTransparency: evidenceStatus === 'source-mapped' || (evidenceStatus === 'unverified' && /unverified|not fact verification|未验证/iu.test(evidenceDisclaimer)) ? 1 : 0,
    crossDocumentCoherence: coherenceFailures.length ? 0 : 1,
  };
  const hardFailures = [
    ...deepDive.flatMap((item) => item.structuralFailures.map((failure) => `${item.slug}: ${failure}`)),
    ...coherenceFailures,
  ];
  if (requireAgentOs) {
    if (termHits.length < 12) hardFailures.push(`Agent OS terminology coverage is ${termHits.length}/${requiredAgentOsTerms}; at least 12 required`);
    if (runtimeHits.length < 3) hardFailures.push(`runtime comparison names only ${runtimeHits.length}; at least 3 required`);
    const requiredSignals = ['MCP', 'memory', 'approval', 'sandbox', 'evaluation', 'replay', 'idempotency'];
    for (const term of requiredSignals) if (!corpus.includes(normalized(term))) hardFailures.push(`missing required Agent OS concept: ${term}`);
    if (mappedSources >= 5 && citationCount < 8) hardFailures.push(`verified source packet is present but only ${citationCount} citation markers were emitted; at least 8 required`);
    if (rawCitationCount > supportedCitationCount && mappedSources >= 5) hardFailures.push(`${rawCitationCount - supportedCitationCount} citation markers are not supported by their source excerpts`);
  }
  const values = Object.values(dimensions);
  const overall = Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(3));
  const mappedCoverage = totalClaims ? mappedClaims / totalClaims : 0;
  const evidenceCoverage = totalClaims ? Math.max(mappedCoverage, explicitSourceClaims / totalClaims, (mappedSources && citationCount ? Math.min(1, citationCount / totalClaims) : 0)) : 0;
  const publicationReady = hardFailures.length === 0 && overall >= 0.9 && (!requireAgentOs || (mappedSources >= 5 && mappedCoverage >= 0.5 && evidenceCoverage >= 0.5 && citationCount >= 8));
  return {
    version: 1,
    topic,
    requireAgentOs,
    generatedAt: new Date().toISOString(),
    overall,
    pass: hardFailures.length === 0 && overall >= 0.82,
    publicationReady,
    dimensions,
    termCoverage: { hits: termHits, count: termHits.length, required: requiredAgentOsTerms },
    runtimeCoverage: { hits: runtimeHits, count: runtimeHits.length, required: requireAgentOs ? 3 : 0 },
    evidence: { status: evidenceStatus, mappedSources, mappedClaims, totalClaims, explicitSourceClaims, citationCount, coverage: Number(evidenceCoverage.toFixed(3)), disclaimer: evidenceDisclaimer },
    deepDive,
    hardFailures,
    recommendation: hardFailures.length ? '修复硬门禁失败项后重新生成并审计；结构完整不等于专业质量。' : publicationReady ? '达到高质量发布候选门禁；仍需领域专家最终验收。' : overall >= 0.9 ? '达到高质量结构门禁，但受控来源/claim 覆盖不足，不能作为已验证专业结论发布。' : '结构通过但仍需补充技术细节、对比证据或实验结果。',
  };
}

export { AGENT_OS_TERMS, AGENT_RUNTIME_OPTIONS };
