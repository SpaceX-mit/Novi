import { configuredTimeout, createChatModel, messageText } from './llm-providers.mjs';

const MAX_INTAKE_TURNS = 8;

function parseObject(raw) {
  const cleaned = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
  const candidates = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]).concat(cleaned);
  for (const candidate of candidates) {
    const start = candidate.indexOf('{'); const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try { const value = JSON.parse(candidate.slice(start, end + 1)); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* try another candidate */ }
  }
  return null;
}

function list(value, limit = 8, maxLength = 500) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim().slice(0, maxLength)).filter(Boolean).slice(0, limit) : [];
}

function options(value) {
  return Array.isArray(value) ? value.map((item, index) => ({ id: String(item?.id || `option-${index + 1}`).slice(0, 40), label: String(item?.label || item?.title || '').trim().slice(0, 120), description: String(item?.description || item?.reason || '').trim().slice(0, 400) })).filter((item) => item.label).slice(0, 5) : [];
}

function normalized(candidate, prompt, previous) {
  const scope = list(candidate?.scope); const deliverables = list(candidate?.deliverables); const facets = list(candidate?.searchFacets || candidate?.facets); const constraints = list(candidate?.constraints);
  const question = String(candidate?.researchQuestion || candidate?.question || previous?.researchQuestion || prompt).trim().slice(0, 2_000);
  const domain = String(candidate?.domain || previous?.domain || '').trim().slice(0, 500);
  const ready = candidate?.status === 'ready' && Boolean(question && domain && scope.length >= 2 && deliverables.length >= 2 && facets.length >= 3);
  const incompleteQuestions = list(candidate?.questions, 5, 700);
  const incompleteOptions = options(candidate?.options);
  return {
    status: ready ? 'ready' : 'incomplete', researchQuestion: question, domain, scope, deliverables, constraints,
    searchFacets: facets,
    questions: incompleteQuestions.length ? incompleteQuestions : (ready ? [] : [
      '你希望重点解释哪些机制、架构或实现细节？',
      '最终需要哪些 Markdown 文档或可验证交付物？',
    ]),
    options: incompleteOptions.length ? incompleteOptions : (ready ? [] : [
      { id: 'broad', label: '全面技术 Deep Dive', description: '覆盖机制、架构、实现、评估、风险与前沿。' },
      { id: 'implementation', label: '实现与工程落地', description: '聚焦代码路径、系统设计、性能和故障恢复。' },
    ]),
    brief: String(candidate?.brief || '').trim().slice(0, 12_000), rationale: String(candidate?.rationale || '').trim().slice(0, 1_000),
  };
}

function fallback(prompt, previous) {
  const explicitWikiRequest = /(?:wiki|知识库|知识体系)/iu.test(String(prompt || ''));
  if (explicitWikiRequest) {
    return {
      status: 'ready',
      researchQuestion: String(previous?.researchQuestion || prompt).trim().slice(0, 2_000),
      domain: previous?.domain || 'User-defined technical topic',
      scope: previous?.scope?.length >= 2 ? previous.scope : ['核心概念、机制与边界', '系统架构、实现路径与工程取舍', '评估、风险、失败模式与前沿方向'],
      deliverables: previous?.deliverables?.length >= 2 ? previous.deliverables : ['00-goal.md 研究目标与范围', '五篇技术 Deep Dive Markdown 文档', 'llm-wiki.md 总结、导航与后续问题'],
      constraints: previous?.constraints?.length ? previous.constraints : ['所有关键事实标注证据状态', '区分已验证来源与未验证推断'],
      searchFacets: previous?.searchFacets?.length >= 3 ? previous.searchFacets : ['Research landscape and competing approaches', 'Foundations and mechanisms', 'System architecture and implementation', 'Evaluation and reproducibility', 'Risks and frontier directions'],
      questions: [], options: [], brief: String(prompt || '').trim().slice(0, 12_000), rationale: 'The request explicitly asks to generate or improve a technical Wiki, so a bounded default research brief can be proposed immediately.',
    };
  }
  const current = normalized({ status: 'incomplete', researchQuestion: previous?.researchQuestion || prompt, domain: previous?.domain, scope: previous?.scope, deliverables: previous?.deliverables, constraints: previous?.constraints, searchFacets: previous?.searchFacets }, prompt, previous);
  current.questions = ['你希望重点解释哪些机制、架构或实现细节？', '最终需要哪些 Markdown 文档或可验证交付物？'];
  current.options = [{ id: 'broad', label: '全面技术 Deep Dive', description: '覆盖机制、架构、实现、评估、风险与前沿。' }, { id: 'implementation', label: '实现与工程落地', description: '聚焦代码路径、系统设计、性能和故障恢复。' }];
  return current;
}

export function intakeMessage(intake, { language = 'zh-CN', confirmed = false } = {}) {
  if (confirmed) return '研究范围已确认。我现在开始检索权威资料、执行 Deep Dive，并生成完整的 Markdown 文档和 LLM Wiki。';
  if (intake.status === 'ready') {
    const facets = intake.searchFacets.map((item) => `- ${item}`).join('\n');
    return `我已经把这个主题整理成一个可执行的 Deep Dive 研究任务，请确认后开始生成。\n\n**研究问题**：${intake.researchQuestion}\n\n**研究范围**：${intake.scope.map((item) => `- ${item}`).join('\n')}\n\n**交付物**：${intake.deliverables.map((item) => `- ${item}`).join('\n')}\n\n**检索方向**：\n${facets}\n\n回复“确认生成”开始；如果要调整范围、语言或深度，请继续告诉我。`;
  }
  const questions = intake.questions.map((item) => `- ${item}`).join('\n');
  const choices = intake.options.map((item) => `- **${item.label}**：${item.description}`).join('\n');
  return `在开始检索和写作前，我需要先把 Deep Dive 目标定义清楚。\n\n${questions ? `请先回答这些问题：\n${questions}\n\n` : ''}${choices ? `你也可以直接选择一个方向：\n${choices}\n\n` : ''}补充信息后，我会重新判断研究目标是否完整，并给出最终的研究方案供你确认。`;
}

export async function runResearchIntake(project, config, { prompt, history = [], previous = null, language = 'zh-CN' } = {}) {
  if (!config) throw Object.assign(new Error('No active LLM provider configured'), { code: 'LLM_PROVIDER_REQUIRED' });
  const model = createChatModel(config);
  const system = `You are Novi's research-intake architect. Before any web search or document writing, decide whether the user's deep-research request is complete enough to execute. Ask focused follow-up questions when important scope, depth, deliverables, evidence, or boundaries are missing. Offer at most five mutually useful options when a choice would help. Return JSON only: {"status":"incomplete|ready","researchQuestion":"...","domain":"...","scope":["..."],"deliverables":["..."],"constraints":["..."],"searchFacets":["landscape","mechanisms","architecture","evaluation","risks"],"questions":["..."],"options":[{"id":"...","label":"...","description":"..."}],"brief":"...","rationale":"..."}. Mark ready only when the question, domain, at least two scope items, at least two deliverables, and at least three independent search facets are concrete. Do not search, cite sources, or write the Wiki yet. Target language: ${language}.`;
  const context = [
    `Project: ${JSON.stringify({ title: project.title, topic: project.topic, type: project.type, description: project.description || '' })}`,
    `Previous intake: ${JSON.stringify(previous || null)}`,
    `Conversation: ${JSON.stringify((history || []).slice(-8).map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 2_000) })))}`,
    `Latest user input: ${prompt}`,
  ].join('\n');
  try {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: context }], { signal: AbortSignal.timeout(configuredTimeout()) });
    const parsed = parseObject(messageText(response));
    const hasIntakeShape = parsed && ['status', 'researchQuestion', 'question', 'domain', 'scope', 'deliverables', 'searchFacets', 'facets', 'questions', 'options', 'brief'].some((key) => Object.hasOwn(parsed, key));
    const result = hasIntakeShape ? normalized(parsed, prompt, previous) : null;
    // Preserve the Intake Agent's incomplete decision. Replacing it with a
    // generic fallback would silently skip the clarification conversation and
    // could make an under-specified request look ready to execute.
    return result || fallback(prompt, previous);
  } catch (error) {
    if (error?.code === 'LLM_PROVIDER_REQUIRED') throw error;
    return fallback(prompt, previous);
  }
}

export function intakeConfirmation(prompt) {
  return /^(?:确认(?:生成|开始)?|开始(?:生成|研究)?|执行|生成吧|go ahead|confirm|start(?: research| generation)?|yes)$/iu.test(String(prompt || '').trim());
}

export { MAX_INTAKE_TURNS };
