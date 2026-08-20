import { writeFile } from 'node:fs/promises';
import { generateArtifactAsync } from '../src/engine.mjs';
import { verifyEvidenceSources } from '../src/evidence.mjs';
import { assessWikiQuality } from '../src/wiki-quality.mjs';

const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('live-agent-os-quality-check: Anthropic-compatible credential is unavailable');

const sourceSeed = [
  // Prefer stable, content-bearing pages over documentation landing pages.
  // A reachable redirect/navigation shell is not sufficient evidence for a
  // mechanism claim such as checkpoint semantics or protocol message shape.
  ['LangGraph core README', 'Official Docs', 'https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/README.md'],
  ['LangGraph checkpointer types', 'Source Code', 'https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint/src/base.ts'],
  ['MCP protocol schema', 'Standards', 'https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-06-18/schema.ts'],
  ['ReAct paper', 'Papers', 'https://arxiv.org/abs/2210.03629'],
  ['OpenAI Agents SDK agents', 'Official Docs', 'https://openai.github.io/openai-agents-python/agents/'],
  ['NIST AI RMF Playbook', 'Standards', 'https://airc.nist.gov/airmf-resources/playbook/'],
  ['OWASP LLM Top 10 source', 'Standards', 'https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/master/index.md'],
  ['AutoGen core guide', 'Official Docs', 'https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/index.html'],
];

const verified = await verifyEvidenceSources(sourceSeed.map(([name, kind, url]) => ({ name, kind, url, mapped: true })));
const sources = verified.filter((source) => source.mapped === true && source.verification === 'verified' && source.contentHash && String(source.excerpt || '').length >= 20);
if (sources.length < 5) throw new Error(`live-agent-os-quality-check: only ${sources.length} controlled sources passed verification`);

const startedAt = Date.now();
const stages = [];
const modelEvents = [];
const project = {
  id: 'live-agent-os-quality', title: 'Agent OS 技术栈深度调查', topic: 'Agent OS 技术栈',
  description: '深度调查自主 Agent runtime、工具系统、MCP、Skills、权限、记忆、评估与生产部署最佳实践和算法。',
  type: 'research', wikiLanguage: 'zh-CN', tenantId: 'live-quality-audit',
};
const config = { provider: 'anthropic', family: 'anthropic', model: process.env.NOVI_LIVE_AUDIT_MODEL || 'claude-sonnet-4-5-20250929', apiKey };
const budgets = {
  maxStageRuns: Number(process.env.NOVI_LIVE_AUDIT_MAX_STAGE_RUNS || 8),
  maxStageAttempts: Number(process.env.NOVI_LIVE_AUDIT_MAX_STAGE_ATTEMPTS || 3),
  maxToolCalls: 6,
  recursionLimit: 96,
};
const prompt = '以深度调查 Agent OS 技术栈，输出详细的 LLM Wiki。先定义可证伪目标，再比较 LangGraph、ReAct、Plan-and-Execute、Supervisor、MCP、工具系统、记忆、审批、沙箱和评估；使用真实来源，输出五篇独立技术 Deep Dive、00-goal.md 和 llm-wiki.md。不要罗列，必须解释机制、架构、实现取舍、失败模式、验证方法和证据缺口。';
const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
const log = (event, extra = {}) => console.log(JSON.stringify({ event, elapsedSeconds: elapsed(), ...extra }));

log('verified-sources', { count: sources.length, sources: sources.map((source) => ({ name: source.name, host: new URL(source.url).hostname, excerptLength: source.excerpt.length })) });
const artifact = await generateArtifactAsync(project, {
  providerConfig: config, prompt, language: 'zh-CN', budgets,
  referenceRetriever: async ({ facet, query }) => ({ sources: sources.map((source) => ({ ...source, discoveryFacet: facet, discoveryQuery: query })), status: 'completed' }),
  onStage: async (event) => { stages.push({ id: event.id, status: event.status, progress: event.progress, warning: event.warning || null, error: event.error || null }); log('stage', { id: event.id, status: event.status, progress: event.progress, warning: Boolean(event.warning), error: Boolean(event.error) }); },
  onModel: async (event) => {
    if (event.type !== 'model-response' || !['completed', 'rejected', 'failed'].includes(event.status)) return;
    const responseText = String(event.response || '').replace(/\s+/gu, ' ').trim();
    const item = { stage: event.stageId, status: event.status, title: event.title, responseLength: responseText.length, responsePreview: responseText.slice(0, 500), warning: Boolean(event.warning || event.summary), warningDetail: event.warning || event.summary || null, error: Boolean(event.error), errorDetail: event.error || null, output: event.output || null, usage: event.usage };
    modelEvents.push(item); log('model-response', item);
  },
});
const quality = assessWikiQuality(artifact, { topic: project.topic, requireAgentOs: true, sources: artifact.content.sources });
const result = {
  generatedAt: new Date().toISOString(), model: config.model, sourceCount: artifact.content.sources?.length || 0,
  documentCount: artifact.documents?.length || 0, deepDiveCount: artifact.content.deepDiveDocuments?.length || 0,
  stages, modelEvents, quality: { pass: quality.pass, publicationReady: quality.publicationReady, overall: quality.overall, hardFailures: quality.hardFailures, evidence: quality.evidence, dimensions: quality.dimensions },
};
await writeFile('docs/live-agent-os-quality-result.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
log('result', result);
if (!quality.publicationReady) process.exitCode = 2;
