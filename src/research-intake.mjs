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

function selectedOption(prompt, previous) {
  const value = String(prompt || '').trim().toLocaleLowerCase();
  if (!value || !Array.isArray(previous?.options)) return null;
  return previous.options.find((item) => [item.id, item.label].filter(Boolean).some((candidate) => String(candidate).trim().toLocaleLowerCase() === value)) || null;
}

const DEFAULT_METHODOLOGY = [
  '先定义研究问题、系统边界、关键术语和可证伪的成功标准，再把主题拆成相互独立的研究 facet。',
  '分别检索论文、官方文档/规范、源码仓库和工程案例；对来源去重、记录内容摘要与哈希，并把事实主张映射到受控来源。',
  '让 Research、Knowledge、Writing、Review 专家共享同一份 Goal 和证据包，通过机制分析、架构追踪、实现案例、取舍、失败注入和复现检查形成结论。',
];
const DEFAULT_SOURCE_PLAN = [
  '研究版图：比较主要方案、运行时保证、成熟度和争议，不把营销标签当作能力证据。',
  '机制与架构：优先官方规范、论文、源码和设计文档，追踪状态、控制流、工具、记忆、审批和边界。',
  '工程验证与风险：查找可复现实验、基准、故障模式、威胁模型和生产限制，明确哪些结论仍是未知。',
];
const DEFAULT_STAGE_PLAN = [
  { id: 'goal', name: 'Goal Architect', purpose: '把用户主题变成有边界、可证伪的研究目标。' },
  { id: 'references', name: 'Reference Discovery', purpose: '按独立 facet 查找并验证权威论文、规范、源码和 Web 资料。' },
  { id: 'research', name: 'Research', purpose: '比较机制、方案和证据强弱，记录研究缺口。' },
  { id: 'knowledge', name: 'Knowledge', purpose: '建立概念依赖、架构图和可教学的知识体系。' },
  { id: 'writing', name: 'Writing', purpose: '分别撰写多篇技术 Deep Dive 和系统文档。' },
  { id: 'review', name: 'Review', purpose: '检查主张、引用、失败模式、取舍和可复现性。' },
  { id: 'finalizer', name: 'LLM Wiki Finalizer', purpose: '汇总文档、导航、证据状态和下一步研究问题。' },
];
const DEFAULT_COMPLETION_CRITERIA = [
  '研究问题、范围、交付物、证据策略和目标语言已经由用户确认。',
  '每个关键结论都能追溯到来源、实验、工作区材料或明确标记为未验证/证据缺口。',
  '输出包含多篇有独立技术论证的 Markdown Deep Dive、完整系统文档和一篇可导航的 llm-wiki.md。',
  'Review 已检查机制深度、架构边界、工程实现、取舍、失败模式、评估和安全风险。',
];

function normalized(candidate, prompt, previous) {
  const scope = list(candidate?.scope); const deliverables = list(candidate?.deliverables); const facets = list(candidate?.searchFacets || candidate?.facets); const constraints = list(candidate?.constraints);
  const question = String(candidate?.researchQuestion || candidate?.question || previous?.researchQuestion || prompt).trim().slice(0, 2_000);
  const domain = String(candidate?.domain || previous?.domain || '').trim().slice(0, 500);
  const methodology = list(candidate?.methodology || candidate?.researchMethod || previous?.methodology, 8, 1_200);
  const sourcePlan = list(candidate?.sourcePlan || candidate?.evidencePlan || previous?.sourcePlan, 8, 1_200);
  const stagePlan = Array.isArray(candidate?.stagePlan || previous?.stagePlan)
    ? (candidate?.stagePlan || previous?.stagePlan).map((item, index) => ({ id: String(item?.id || `stage-${index + 1}`).slice(0, 60), name: String(item?.name || item?.title || '').trim().slice(0, 120), purpose: String(item?.purpose || item?.objective || '').trim().slice(0, 500) })).filter((item) => item.name && item.purpose).slice(0, 8)
    : [];
  const completionCriteria = list(candidate?.completionCriteria || candidate?.doneWhen || previous?.completionCriteria, 8, 1_200);
  const ready = candidate?.status === 'ready' && Boolean(question && domain && scope.length >= 2 && deliverables.length >= 2 && facets.length >= 3 && methodology.length >= 3 && sourcePlan.length >= 3 && stagePlan.length >= 5 && completionCriteria.length >= 3);
  const incompleteQuestions = list(candidate?.questions, 5, 700);
  const incompleteOptions = options(candidate?.options);
  return {
    status: ready ? 'ready' : 'incomplete', researchQuestion: question, domain, scope, deliverables, constraints,
    searchFacets: facets, methodology, sourcePlan, stagePlan, completionCriteria,
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
  // A provider/network failure is not an Agent decision. Never infer that a
  // Wiki-shaped prompt is complete here: doing so would let a deterministic
  // fallback bypass the first-turn clarification and confirmation boundary.
  // Preserve any previously discussed fields as context, but keep the intake
  // incomplete until the Intake Agent can evaluate the latest turn.
  const current = normalized({ status: 'incomplete', researchQuestion: previous?.researchQuestion || prompt, domain: previous?.domain, scope: previous?.scope, deliverables: previous?.deliverables, constraints: previous?.constraints, searchFacets: previous?.searchFacets, methodology: previous?.methodology, sourcePlan: previous?.sourcePlan, stagePlan: previous?.stagePlan, completionCriteria: previous?.completionCriteria }, prompt, previous);
  current.questions = ['你希望重点解释哪些机制、架构或实现细节？', '最终需要哪些 Markdown 文档或可验证交付物？'];
  current.options = [{ id: 'broad', label: '全面技术 Deep Dive', description: '覆盖机制、架构、实现、评估、风险与前沿。' }, { id: 'implementation', label: '实现与工程落地', description: '聚焦代码路径、系统设计、性能和故障恢复。' }];
  return current;
}

export function intakeMessage(intake, { language = 'zh-CN', confirmed = false } = {}) {
  if (confirmed) return '研究范围已确认。我现在开始检索权威资料、执行 Deep Dive，并生成完整的 Markdown 文档和 LLM Wiki。';
  if (intake.status === 'ready') {
    const facets = intake.searchFacets.map((item) => `- ${item}`).join('\n');
    const methodology = intake.methodology.map((item) => `- ${item}`).join('\n');
    const sourcePlan = intake.sourcePlan.map((item) => `- ${item}`).join('\n');
    const stages = intake.stagePlan.map((item) => `- **${item.name}**：${item.purpose}`).join('\n');
    const completion = intake.completionCriteria.map((item) => `- ${item}`).join('\n');
    return `我已经把这个主题整理成一个可执行的 Deep Dive 研究任务，请确认后开始生成。\n\n**研究问题**：${intake.researchQuestion}\n\n**研究范围**：${intake.scope.map((item) => `- ${item}`).join('\n')}\n\n**交付物**：${intake.deliverables.map((item) => `- ${item}`).join('\n')}\n\n**研究方法**：\n${methodology}\n\n**证据与来源策略**：\n${sourcePlan}\n\n**执行阶段**：\n${stages}\n\n**完成判据**：\n${completion}\n\n**检索方向**：\n${facets}\n\n回复“确认生成”开始；如果要调整范围、语言、深度或证据标准，请继续告诉我。`;
  }
  const questions = intake.questions.map((item) => `- ${item}`).join('\n');
  const choices = intake.options.map((item) => `- **${item.label}**：${item.description}`).join('\n');
  const turn = intake.turn && intake.maxTurns ? `（Intake 第 ${intake.turn}/${intake.maxTurns} 轮）` : '';
  return `在开始检索和写作前，我需要先把 Deep Dive 目标定义清楚${turn}。\n\n${questions ? `请先回答这些问题：\n${questions}\n\n` : ''}${choices ? `你也可以直接选择一个方向：\n${choices}\n\n` : ''}补充信息后，我会重新判断研究目标是否完整，并给出最终的研究方案供你确认。`;
}

export async function runResearchIntake(project, config, { prompt, history = [], previous = null, language = 'zh-CN' } = {}) {
  if (!config) throw Object.assign(new Error('No active LLM provider configured'), { code: 'LLM_PROVIDER_REQUIRED' });
  const turn = (history || []).filter((item) => item.kind === 'intake' && item.role === 'user').length + 1;
  if (turn > MAX_INTAKE_TURNS) {
    const capped = fallback(prompt, previous);
    capped.turn = MAX_INTAKE_TURNS;
    capped.maxTurns = MAX_INTAKE_TURNS;
    capped.questions = ['Intake 对话已达到最大轮数。请在新 Session 中提交更具体的研究问题、范围和交付物。'];
    capped.options = [];
    return capped;
  }
  const model = createChatModel(config);
  const system = `You are Novi's research-intake architect. This is the first Novi step after a user submits a research prompt. Before any web search, tool call, specialist work, or document writing, decide whether the user's deep-research request is complete enough to execute. Ask focused follow-up questions when important topic, scope, depth, deliverables, evidence, language, or boundaries are missing. Offer at most five mutually useful options when a choice would help. When it is complete, design the research method rather than merely restating the topic: explain how to decompose the deep dive, which independent source facets to search, how Research/Knowledge/Writing/Review will work, and what evidence and completion criteria will be used. Return JSON only: {"status":"incomplete|ready","researchQuestion":"...","domain":"...","scope":["..."],"deliverables":["..."],"constraints":["..."],"searchFacets":["landscape","mechanisms","architecture","evaluation","risks"],"methodology":["..."],"sourcePlan":["..."],"stagePlan":[{"id":"...","name":"...","purpose":"..."}],"completionCriteria":["..."],"questions":["..."],"options":[{"id":"...","label":"...","description":"..."}],"brief":"...","rationale":"..."}. Mark ready only when the question, domain, at least two scope items, at least two deliverables, at least three independent search facets, at least three method steps, at least three source/evidence steps, at least five execution stages, and at least three completion criteria are concrete. Do not search, cite sources, call tools, or write the Wiki yet. Target language: ${language}.`;
  const context = [
    'Boundary: the user may have used ChatGPT or another tool outside Novi to draft this prompt. That external drafting is not an approval or a completed research plan; you must perform the first Novi intake decision yourself.',
    `Project: ${JSON.stringify({ title: project.title, topic: project.topic, type: project.type, description: project.description || '' })}`,
    `Previous intake: ${JSON.stringify(previous || null)}`,
    `Conversation: ${JSON.stringify((history || []).slice(-8).map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 2_000) })))}`,
    `Latest user input: ${prompt}`,
    `Selected option (if the user answered with one of the offered option ids/labels): ${JSON.stringify(selectedOption(prompt, previous))}`,
  ].join('\n');
  try {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: context }], { signal: AbortSignal.timeout(configuredTimeout()) });
    const parsed = parseObject(messageText(response));
    const hasIntakeShape = parsed && ['status', 'researchQuestion', 'question', 'domain', 'scope', 'deliverables', 'searchFacets', 'facets', 'questions', 'options', 'brief'].some((key) => Object.hasOwn(parsed, key));
    const result = hasIntakeShape ? normalized(parsed, prompt, previous) : null;
    // Preserve the Intake Agent's incomplete decision. Replacing it with a
    // generic fallback would silently skip the clarification conversation and
    // could make an under-specified request look ready to execute.
    const intake = result || fallback(prompt, previous);
    intake.turn = turn; intake.maxTurns = MAX_INTAKE_TURNS;
    const choice = selectedOption(prompt, previous);
    if (choice) intake.selectedOption = { id: choice.id, label: choice.label };
    return intake;
  } catch (error) {
    if (error?.code === 'LLM_PROVIDER_REQUIRED') throw error;
    const intake = fallback(prompt, previous);
    intake.turn = turn; intake.maxTurns = MAX_INTAKE_TURNS;
    const choice = selectedOption(prompt, previous);
    if (choice) intake.selectedOption = { id: choice.id, label: choice.label };
    return intake;
  }
}

export function intakeConfirmation(prompt) {
  return /^(?:确认(?:生成|开始)?|开始(?:生成|研究)?|执行|生成吧|go ahead|confirm|start(?: research| generation)?|yes)$/iu.test(String(prompt || '').trim());
}

export { MAX_INTAKE_TURNS };
