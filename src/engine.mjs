import { createHash, randomUUID } from 'node:crypto';
import { referenceQueriesForGoal, referenceQueryForGoal, runAgentWorkflow } from './agent-runtime.mjs';
import { completeArtifact } from './model.mjs';
import { normalizeWikiLanguage } from './wiki-language.mjs';

const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const titleCase = (value) => clean(value).replace(/\b\w/g, (letter) => letter.toUpperCase());

export const artifactDefinitions = {
  knowledge: { label: 'Knowledge Base', accent: 'green' },
  research: { label: 'Research Report', accent: 'blue' },
  paper: { label: 'Paper Draft', accent: 'orange' },
};

function knowledgeArtifact(topic) {
  const name = titleCase(topic);
  const concepts = [
    { id: 'foundation', label: 'Foundations', group: 'core' },
    { id: 'architecture', label: 'Architecture', group: 'core' },
    { id: 'components', label: 'Core Components', group: 'core' },
    { id: 'usage', label: 'Usage Patterns', group: 'applied' },
    { id: 'practice', label: 'Practice', group: 'applied' },
    { id: 'interview', label: 'Interview Readiness', group: 'applied' },
    { id: 'project', label: 'Capstone Project', group: 'applied' },
    { id: 'security', label: 'Security & Risk', group: 'applied' },
    { id: 'frontier', label: 'Frontier', group: 'advanced' },
  ];
  return {
    summary: `${name} is organized as a progressive knowledge system: establish the vocabulary, understand the architecture, practise with real projects, then evaluate risks and frontier directions.`,
    sections: [
      { title: `What is ${name}?`, body: `A working definition, scope boundaries, core vocabulary, and the problems ${name} is designed to solve.` },
      { title: 'Why it matters', body: 'The practical value, trade-offs, adoption drivers, and situations where alternative approaches are a better fit.' },
      { title: 'Architecture', body: 'Core components, information flow, interfaces, lifecycle, and the design decisions that shape a production implementation.' },
      { title: 'Core components', body: 'Identify the major subsystems, their responsibilities, contracts, dependencies, and the failure modes at each boundary.' },
      { title: 'Usage patterns', body: 'Work through representative workflows, configuration choices, operational checks, debugging techniques, and common anti-patterns.' },
      { title: 'Advanced topics', body: 'Scaling constraints, security boundaries, performance, governance, and open research questions.' },
      { title: 'Interview preparation', body: 'Practise explaining the mental model, tracing a request, comparing alternatives, diagnosing failures, and defending production trade-offs.' },
      { title: 'Capstone project', body: 'Build a small end-to-end system with explicit requirements, architecture, tests, observability, failure recovery, and measurable completion criteria.' },
    ],
    learningPath: [
      { stage: 'Beginner', duration: 'Week 1', outcome: `Explain the core vocabulary and mental model of ${name}.`, tasks: ['Read the overview', 'Build a glossary', 'Map one real use case'] },
      { stage: 'Intermediate', duration: 'Week 2', outcome: 'Trace the architecture and compare common implementation choices.', tasks: ['Draw the system flow', 'Compare two approaches', 'Complete a guided prototype'] },
      { stage: 'Advanced', duration: 'Week 3', outcome: 'Build and evaluate a production-shaped implementation.', tasks: ['Define quality metrics', 'Test failure modes', 'Document trade-offs'] },
      { stage: 'Expert', duration: 'Week 4', outcome: 'Form an original position and identify a frontier problem.', tasks: ['Review recent work', 'Reproduce a result', 'Write a technical proposal'] },
    ],
    caseStudies: [
      { title: 'Architecture decision', scenario: `A team must adopt ${name} under reliability, security, and cost constraints.`, deliverable: 'A decision record comparing at least two architectures, their risks, and measurable acceptance criteria.' },
      { title: 'Failure investigation', scenario: `A production-shaped ${name} workflow is slow, intermittently incorrect, and difficult to recover.`, deliverable: 'A causal timeline, instrumentation plan, reproduced failure, corrective change, and regression test.' },
      { title: 'Governed rollout', scenario: `${name} will handle sensitive organizational knowledge across multiple user roles.`, deliverable: 'A threat model, least-privilege design, audit plan, staged rollout, and rollback exercise.' },
    ],
    practiceQuestions: [
      { level: 'Foundation', question: `Explain ${name} to a technical peer, including its scope and one situation where it is the wrong choice.`, successCriteria: 'Uses precise vocabulary, states boundaries, and compares a credible alternative.' },
      { level: 'Architecture', question: 'Trace one end-to-end request and identify state, trust, and failure boundaries.', successCriteria: 'Names each component contract and describes observable failure behavior.' },
      { level: 'Applied', question: 'Design a minimal implementation and the tests that would make it safe to change.', successCriteria: 'Includes acceptance, integration, failure-recovery, security, and performance tests.' },
      { level: 'Advanced', question: 'Defend a scaling and governance strategy under a constrained budget.', successCriteria: 'Quantifies trade-offs and defines monitoring, escalation, and rollback thresholds.' },
    ],
    graph: {
      nodes: [{ id: 'topic', label: name, group: 'topic' }, ...concepts],
      edges: concepts.map((node) => ({ source: 'topic', target: node.id, relation: 'contains' })),
    },
    opportunities: ['Create an evaluation benchmark', 'Map security and governance gaps', 'Build a reference implementation'],
  };
}

function researchArtifact(topic) {
  const name = titleCase(topic);
  const knowledge = knowledgeArtifact(topic);
  return {
    summary: `This research brief frames ${name}, maps the evidence landscape, identifies current approaches, and turns unresolved tensions into testable research opportunities.`,
    sections: [
      { title: 'Executive summary', body: `${name} should be evaluated across capability, reliability, security, operational cost, and governance rather than a single headline metric.` },
      { title: 'Problem definition', body: 'Define the unit of analysis, stakeholders, system boundary, assumptions, and the decision this research must support.' },
      { title: 'State of the art', body: 'Compare dominant architectural families, reported evidence, reproducibility, deployment maturity, and known limitations.' },
      { title: 'Evidence gaps', body: 'Prioritize missing longitudinal studies, weak baselines, underspecified threat models, and results that do not transfer to production.' },
      { title: 'Recommendations', body: 'Run a scoped systematic review, establish a benchmark, validate with a prototype, and publish artifacts required for reproduction.' },
    ],
    sources: sourceSuggestions(topic),
    sota: [
      { dimension: 'Capability', finding: 'Strong task-level results; cross-domain generalization remains uneven.', confidence: 'Medium' },
      { dimension: 'Reliability', finding: 'Evaluation protocols differ, limiting direct comparison.', confidence: 'High' },
      { dimension: 'Operations', finding: 'Cost, latency, observability, and incident recovery are underreported.', confidence: 'Medium' },
    ],
    opportunities: [
      `A reproducible benchmark for ${name}`,
      'Longitudinal evaluation under real operational constraints',
      'Security and governance controls with measurable effectiveness',
    ],
    wikiSections: knowledge.sections,
    graph: knowledge.graph,
  };
}

function paperArtifact(topic, description) {
  const name = titleCase(topic);
  const idea = clean(description) || `A measurable method for improving the reliability of ${name}`;
  return {
    summary: `A structured academic draft derived from the idea: ${idea}. Claims remain hypotheses until supported by cited evidence and experiments.`,
    title: `A Reproducible Framework for ${name}: Design, Evaluation, and Operational Evidence`,
    abstract: `We study ${name} and propose a reproducible evaluation framework that connects system design to capability, reliability, cost, and risk. The planned study compares representative baselines under controlled workloads and reports both aggregate performance and failure modes.`,
    sections: [
      { title: 'Introduction', body: `${name} is important, but current evaluations often isolate task quality from reliability, operational cost, and risk. This draft defines a falsifiable study rather than treating a promising idea as an established result.` },
      { title: 'Related work and research gap', body: 'The closest architectural and evaluation families must be compared on common workloads. The central gap is the lack of reproducible, multi-dimensional evidence connecting design choices to production behavior.' },
      { title: 'Proposed method', body: `We operationalize the idea “${idea}” through explicit system boundaries, controlled baselines, ablations, failure injection, and a reporting protocol that preserves raw evidence.` },
      { title: 'Evaluation plan', body: 'The study measures task quality, latency, cost, failure rate, recovery time, and uncertainty across controlled and realistic workloads, with pre-declared hypotheses and error analysis.' },
      { title: 'Limitations and ethics', body: 'External validity, dataset representativeness, provider drift, privacy, security, and downstream misuse must be reported. Claims remain provisional until experiments and independent review are complete.' },
    ],
    researchGaps: [
      { gap: 'Reported task quality is rarely connected to operational reliability under realistic failure conditions.', evidenceNeeded: 'Longitudinal workloads, incident traces, recovery metrics, and controlled baselines.', test: 'Run matched normal, degraded, and recovery scenarios and compare failure rate and recovery time.' },
      { gap: 'Evaluation protocols and cost accounting differ enough to prevent direct comparison.', evidenceNeeded: 'A shared dataset, fixed workload envelope, transparent pricing assumptions, and uncertainty intervals.', test: 'Re-evaluate representative baselines under one preregistered protocol.' },
      { gap: 'Security and governance controls are commonly described without measurable effectiveness.', evidenceNeeded: 'Explicit threat models, attack suites, policy violations, and false-positive/false-negative rates.', test: 'Perform adversarial evaluation with and without each proposed control.' },
    ],
    noveltyAnalysis: [
      { dimension: 'Problem formulation', baseline: 'Single-metric capability evaluation', differentiation: 'Joint capability, reliability, cost, and risk objective', risk: 'May broaden scope beyond feasible experimental power' },
      { dimension: 'Method', baseline: 'Static benchmark comparison', differentiation: 'Controlled workloads plus ablation, failure injection, and recovery analysis', risk: 'Infrastructure variance may confound causal attribution' },
      { dimension: 'Evidence', baseline: 'Aggregate headline results', differentiation: 'Raw artifacts, uncertainty, error taxonomy, and reproducibility checklist', risk: 'Artifact release may be constrained by privacy or provider terms' },
    ],
    contributions: [
      'A precise problem formulation and evaluation protocol',
      'A reference architecture with explicit system boundaries',
      'A multi-dimensional benchmark covering quality, reliability, cost, and risk',
      'An artifact and reporting checklist for reproducibility',
    ],
    method: ['Define research questions and falsifiable hypotheses', 'Select representative baselines', 'Create controlled and realistic workloads', 'Run ablations and error analysis', 'Report uncertainty and threats to validity'],
    experiments: [
      { name: 'Baseline comparison', metric: 'Task quality, latency, cost', purpose: 'Establish relative performance' },
      { name: 'Ablation study', metric: 'Change from full system', purpose: 'Attribute gains to components' },
      { name: 'Stress and failure test', metric: 'Failure rate and recovery time', purpose: 'Measure operational reliability' },
    ],
    figures: [
      {
        id: 'fig-system-overview', caption: `${name} system overview`, purpose: 'Show the system boundary, inputs, core method, outputs, and evaluation loop.', diagram: 'Inputs → Method → Outputs\n                 ↘ Evaluation ↗',
        nodes: [{ id: 'inputs', label: 'Inputs', x: 80, y: 65 }, { id: 'method', label: 'Method', x: 280, y: 65 }, { id: 'outputs', label: 'Outputs', x: 480, y: 65 }, { id: 'evaluation', label: 'Evaluation', x: 280, y: 155 }],
        edges: [{ source: 'inputs', target: 'method' }, { source: 'method', target: 'outputs' }, { source: 'outputs', target: 'evaluation' }, { source: 'evaluation', target: 'method' }],
      },
      {
        id: 'fig-evaluation-protocol', caption: 'Evaluation protocol', purpose: 'Show baselines, controlled workloads, metrics, uncertainty, and failure analysis.', diagram: 'Baselines → Workloads → Metrics → Error analysis',
        nodes: [{ id: 'baselines', label: 'Baselines', x: 25, y: 100 }, { id: 'workloads', label: 'Workloads', x: 200, y: 100 }, { id: 'metrics', label: 'Metrics', x: 375, y: 100 }, { id: 'analysis', label: 'Error analysis', x: 550, y: 100 }],
        edges: [{ source: 'baselines', target: 'workloads' }, { source: 'workloads', target: 'metrics' }, { source: 'metrics', target: 'analysis' }],
      },
    ],
    review: [
      { area: 'Novelty', verdict: 'Needs evidence', note: 'Differentiate clearly from the closest three methods.' },
      { area: 'Method', verdict: 'Promising', note: 'Pre-register hypotheses and statistical analysis.' },
      { area: 'Reproducibility', verdict: 'Required', note: 'Release configuration, prompts, seeds, workloads, and raw results.' },
    ],
    sources: sourceSuggestions(topic).slice(0, 4),
  };
}

function sourceSuggestions(topic) {
  const query = encodeURIComponent(clean(topic));
  return [
    { name: 'OpenAlex search', kind: 'Search entry', url: `https://openalex.org/works?search=${query}`, authority: 92, mapped: false },
    { name: 'arXiv search', kind: 'Search entry', url: `https://arxiv.org/search/?query=${query}&searchtype=all`, authority: 85, mapped: false },
    { name: 'GitHub search', kind: 'Search entry', url: `https://github.com/search?q=${query}&type=repositories`, authority: 78, mapped: false },
    { name: 'IEEE Xplore search', kind: 'Search entry', url: `https://ieeexplore.ieee.org/search/searchresult.jsp?newsearch=true&queryText=${query}`, authority: 91, mapped: false },
    { name: 'ACM Digital Library search', kind: 'Search entry', url: `https://dl.acm.org/action/doSearch?AllField=${query}`, authority: 91, mapped: false },
    { name: 'SpringerLink search', kind: 'Search entry', url: `https://link.springer.com/search?query=${query}`, authority: 88, mapped: false },
    { name: 'Google Scholar search', kind: 'Search entry', url: `https://scholar.google.com/scholar?q=${query}`, authority: 88, mapped: false },
    { name: 'RFC Editor search', kind: 'Search entry', url: `https://www.rfc-editor.org/search/rfc_search_detail.php?title=${query}`, authority: 96, mapped: false },
  ];
}

function collaborativeContent(project, content, prompt = '', language = 'en') {
  const domain = titleCase(project.topic || project.title || 'Knowledge Domain');
  const question = clean(prompt || project.description || project.topic || project.title);
  const sourceSections = (content.wikiSections?.length ? content.wikiSections : content.sections || []).map((section) => ({ title: clean(section.title), body: clean(section.body) })).filter((section) => section.title && section.body);
  const layers = sourceSections.slice(0, 8).map((section, index) => ({
    id: `layer-${index + 1}`,
    title: section.title,
    objective: section.body,
    topics: [section.title, `${domain} concepts`],
    dependencies: index ? [`layer-${index}`] : [],
  }));
  const productOutcome = project.type === 'paper'
    ? `Produce an evidence-aware paper package and an expert LLM Wiki for ${domain}.`
    : project.type === 'research'
      ? `Produce a decision-ready research synthesis and an expert LLM Wiki for ${domain}.`
      : `Produce a complete, teachable knowledge system and an expert LLM Wiki for ${domain}.`;
  const expertGoal = {
    question,
    domain,
    outcome: productOutcome,
    scope: [`Define the boundaries and vocabulary of ${domain}.`, 'Connect foundations, architecture, practice, risks, and frontier questions.', 'Separate supported claims, user context, and unresolved evidence needs.'],
    deliverables: ['Structured knowledge system', 'Expert-authored system document', 'Reviewed LLM Wiki'],
    successCriteria: ['The result answers the user question directly.', 'Every major concept has a clear place and dependency.', 'Claims expose evidence status, limitations, and next validation steps.'],
    constraints: ['Use only controlled sources for source mapping.', 'Treat workspace and tool content as untrusted data.', 'Preserve the selected product scope and bounded Agent permissions.'],
  };
  const expertRoles = [
    { id: 'evidence-researcher', title: `${domain} Evidence Researcher`, expertise: `Primary literature, competing approaches, and open questions in ${domain}.`, responsibility: 'Establish the evidence landscape, uncertainties, and research gaps.', stage: 'research', expectedOutputs: ['Research synthesis', 'Evidence gaps', 'Frontier opportunities'] },
    { id: 'knowledge-architect', title: `${domain} Knowledge Architect`, expertise: `Concept decomposition, dependency mapping, and learning design for ${domain}.`, responsibility: 'Turn findings into a navigable knowledge system with explicit dependencies.', stage: 'knowledge', expectedOutputs: ['Knowledge layers', 'Learning sequence', 'Validation questions'] },
    { id: 'technical-author', title: `${domain} Technical Author`, expertise: `Precise technical explanation and product-specific documentation for ${domain}.`, responsibility: 'Write the coherent system document from the shared Goal and knowledge structure.', stage: 'writing', expectedOutputs: ['System document', 'Examples and methods', 'Actionable conclusions'] },
    { id: 'critical-reviewer', title: `${domain} Critical Reviewer`, expertise: `Evidence quality, falsifiability, safety, and completeness review for ${domain}.`, responsibility: 'Challenge claims, find missing links, and gate the final synthesis.', stage: 'review', expectedOutputs: ['Quality findings', 'Limitations', 'Completion gate'] },
  ];
  const knowledgeSystem = {
    title: `${domain} Knowledge System`,
    purpose: productOutcome,
    layers,
    learningSequence: layers.map((layer) => layer.id),
    validationQuestions: [`What is inside and outside the scope of ${domain}?`, `How do the core components of ${domain} interact?`, `Which claims about ${domain} need stronger evidence?`, `What practical result would demonstrate mastery of ${domain}?`],
  };
  const systemDocument = {
    title: `${domain} System Document`,
    executiveSummary: content.summary,
    sections: (content.sections || sourceSections).map((section) => ({ title: clean(section.title), body: clean(section.body) })).filter((section) => section.title && section.body),
    completionChecklist: ['Goal and scope are explicit.', 'Knowledge layers and dependencies are covered.', 'Evidence status and limitations are visible.', 'The final Wiki provides concrete next questions.'],
  };
  const llmWiki = {
    title: `${domain} LLM Wiki`,
    summary: content.summary,
    sections: sourceSections,
    glossary: [{ term: domain, definition: `The knowledge domain addressed by this workspace and its expert team.` }, { term: 'Knowledge system', definition: 'An ordered map of concepts, dependencies, practice, and validation.' }, { term: 'Controlled evidence', definition: 'Sources accepted by Novi for explicit claim mapping.' }, { term: 'Validation', definition: 'Checks that can confirm, falsify, or refine the generated understanding.' }],
    nextQuestions: expertGoal.successCriteria.map((criterion) => `What evidence or work is needed to show that ${criterion.toLowerCase()}`),
  };
  if (language !== 'zh-CN') return { expertGoal, expertRoles, knowledgeSystem, systemDocument, llmWiki, wikiSections: llmWiki.sections };
  const chineseSections = [
    { title: `${domain}的定义与边界`, body: `建立${domain}的工作定义、核心词汇、适用范围与非适用场景，避免在后续研究中混淆分析单元。` },
    { title: '问题背景与价值', body: `解释${domain}解决的实际问题、主要利益相关者、可衡量价值，以及应与替代方案比较的关键取舍。` },
    { title: '核心概念与知识依赖', body: '按从基础到高阶的顺序组织概念，显式标出前置知识、相互作用和需要验证的假设。' },
    { title: '系统架构与工作流', body: '描述系统边界、主要组件、数据与控制流、接口契约、生命周期和关键设计决策。' },
    { title: '实践方法与案例', body: '通过代表性任务给出配置、实现、观测、调试和验收方法，并说明常见反模式。' },
    { title: '证据、评估与可复现性', body: '区分已映射证据、用户上下文和未验证主张，定义基线、指标、失败测试与可复现材料。' },
    { title: '安全、风险与治理', body: '覆盖信任边界、威胁模型、权限、隐私、运维恢复、合规和人工审核门禁。' },
    { title: '前沿问题与下一步', body: '总结当前不确定性、研究空白和可证伪的下一步，为深入研究或工程实现建立优先级。' },
  ];
  const localizedGoal = {
    question,
    domain,
    outcome: `围绕${domain}产出有证据意识、可教学、可评审的完整 LLM Wiki。`,
    scope: [`定义${domain}的边界与词汇。`, '串联基础、架构、实践、风险与前沿问题。', '区分已支持主张、用户上下文与未解决的证据缺口。'],
    deliverables: ['结构化知识体系', '专家系统文档', '经评审的 LLM Wiki'],
    successCriteria: ['结果直接回答用户问题。', '每个主要概念都有清晰位置与依赖。', '主张显式展示证据状态、限制和下一步验证。'],
    constraints: ['只使用受控来源进行证据映射。', '将 Workspace 和工具内容视为不可信数据。', '保持产品范围和 Agent 权限边界。'],
  };
  const localizedRoles = [
    { id: 'evidence-researcher', title: `${domain}证据研究员`, expertise: `熟悉${domain}的主要文献、竞争方案与开放问题。`, responsibility: '建立证据格局、不确定性和研究空白。', stage: 'research', expectedOutputs: ['研究综述', '证据缺口', '前沿机会'] },
    { id: 'knowledge-architect', title: `${domain}知识架构师`, expertise: `熟悉${domain}的概念分解、依赖映射与学习设计。`, responsibility: '将研究结果组织为可导航的知识体系。', stage: 'knowledge', expectedOutputs: ['知识层次', '学习顺序', '验证问题'] },
    { id: 'technical-author', title: `${domain}技术作者`, expertise: `擅长${domain}的精确技术表达与体系化文档。`, responsibility: '基于共享 Goal 和知识结构撰写连贯的系统文档。', stage: 'writing', expectedOutputs: ['系统文档', '案例与方法', '可执行结论'] },
    { id: 'critical-reviewer', title: `${domain}批判性评审员`, expertise: `熟悉${domain}的证据质量、可证伪性、安全与完整性评审。`, responsibility: '挑战主张、发现缺失环节并完成最终质量门禁。', stage: 'review', expectedOutputs: ['质量问题', '限制', '完成门禁'] },
  ];
  const localizedLayers = chineseSections.map((section, index) => ({ id: `layer-${index + 1}`, title: section.title, objective: section.body, topics: [section.title, `${domain}概念`], dependencies: index ? [`layer-${index}`] : [] }));
  return {
    expertGoal: localizedGoal,
    expertRoles: localizedRoles,
    knowledgeSystem: { title: `${domain}知识体系`, purpose: localizedGoal.outcome, layers: localizedLayers, learningSequence: localizedLayers.map((layer) => layer.id), validationQuestions: [`${domain}的范围内外分别是什么？`, `${domain}的核心组件如何交互？`, `哪些关于${domain}的主张需要更强证据？`, `什么实践结果能证明已掌握${domain}？`] },
    systemDocument: { title: `${domain}系统文档`, executiveSummary: `本文档围绕${domain}的范围、架构、实践、证据与风险建立完整知识结构。`, sections: chineseSections, completionChecklist: ['Goal 和范围已明确。', '知识层次与依赖已覆盖。', '证据状态与限制可见。', '最终 Wiki 提供了具体的下一步问题。'] },
    llmWiki: { title: `${domain} LLM Wiki`, summary: `本 Wiki 以 Goal 为主线，整合受控参考、知识结构、技术写作与批判性评审。`, sections: chineseSections, glossary: [{ term: domain, definition: '本 Workspace 专家团队研究的知识领域。' }, { term: '知识体系', definition: '概念、依赖、实践与验证的有序映射。' }, { term: '受控证据', definition: 'Novi 允许用于显式主张映射的来源。' }, { term: '验证', definition: '用于确认、证伪或修正生成内容的检查。' }], nextQuestions: localizedGoal.successCriteria.map((criterion) => `还需要哪些证据或工作才能证明：${criterion}`) },
    wikiSections: chineseSections,
  };
}

function normalizeCollaborativeContent(project, content, prompt = '', language = 'en') {
  const baseline = collaborativeContent(project, content, prompt, language);
  const expertGoal = content.expertGoal?.question && content.expertGoal?.outcome ? content.expertGoal : baseline.expertGoal;
  const expertRoles = Array.isArray(content.expertRoles) && content.expertRoles.length === 4 && ['research', 'knowledge', 'writing', 'review'].every((stage) => content.expertRoles.some((role) => role.stage === stage)) ? content.expertRoles : baseline.expertRoles;
  const knowledgeSystem = content.knowledgeSystem?.layers?.length ? content.knowledgeSystem : baseline.knowledgeSystem;
  const systemDocument = content.systemDocument?.sections?.length ? content.systemDocument : baseline.systemDocument;
  const llmWiki = content.llmWiki?.sections?.length ? content.llmWiki : baseline.llmWiki;
  const wikiSections = llmWiki.sections?.length ? llmWiki.sections : content.wikiSections?.length ? content.wikiSections : baseline.wikiSections;
  return { ...baseline, ...content, expertGoal, expertRoles, knowledgeSystem, systemDocument, llmWiki: { ...baseline.llmWiki, ...llmWiki, sections: wikiSections }, wikiSections };
}

function evidenceFor(content, sources = []) {
  const usable = sources.filter((source) => {
    try { const url = new URL(String(source?.url || '')); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && source.mapped === true && source.verification !== 'unreachable' && source.status !== 'unreachable'; }
    catch { return false; }
  }).slice(0, 24).map((source, index) => ({
    id: `source-${index + 1}`,
    citationId: `S${index + 1}`,
    url: source.url,
    title: source.name,
    kind: source.kind,
    authority: source.authority ?? 0,
    relevanceScore: source.relevanceScore ?? null,
    contentHash: source.contentHash || createHash('sha256').update(`${source.url}|${source.name}|${source.publishedAt || ''}`).digest('hex'),
    verification: source.verification || 'source-mapped',
    verifiedAt: source.verifiedAt,
    httpStatus: source.httpStatus,
  }));
  const claimTexts = [...new Set([
    content.expertGoal?.outcome,
    ...(content.sections || []).map((section) => section.body),
    ...(content.knowledgeSystem?.layers || []).flatMap((layer) => [layer.objective, ...(layer.topics || [])]),
    ...(content.systemDocument?.sections || []).map((section) => section.body),
    ...(content.llmWiki?.sections || content.wikiSections || []).map((section) => section.body),
    ...(content.sota || []).map((item) => item.finding),
    ...(content.researchGaps || []).map((item) => item.gap),
  ].filter(Boolean))].slice(0, 24);
  const byCitation = new Map(usable.map((source) => [source.citationId, source]));
  const claims = claimTexts.map((claim, index) => {
    const citations = [...String(claim).matchAll(/\[S(\d+)\]/g)].map((match) => `S${match[1]}`);
    const evidenceIds = [...new Set(citations.map((citation) => byCitation.get(citation)?.id).filter(Boolean))];
    return {
      id: `claim-${index + 1}`,
      text: claim,
      citationIds: citations,
      evidenceIds,
      verification: evidenceIds.length ? (evidenceIds.length === citations.length ? 'source-mapped' : 'partially-mapped') : 'unverified',
    };
  });
  const mappedClaims = claims.filter((claim) => claim.evidenceIds.length).length;
  return { status: usable.length && mappedClaims ? 'source-mapped' : 'unverified', sources: usable, claims, disclaimer: 'Source mapping is not fact verification. Claims without an explicit [S#] citation remain unverified; review all claims before publication.' };
}

function boundedKnowledgeContext(items = []) {
  return items.slice(0, 6).map((item) => ({
    chunkId: String(item.id || ''),
    documentId: String(item.documentId || ''),
    document: clean(item.document || 'Workspace document').slice(0, 200),
    sourceUrl: String(item.sourceUrl || '').slice(0, 2_000),
    excerpt: String(item.text || '').trim().slice(0, 700),
    relevanceScore: Number.isFinite(Number(item.score)) ? Number(Number(item.score).toFixed(4)) : 0,
  })).filter((item) => item.chunkId && item.documentId && item.excerpt);
}

function workflowFor(project, content, completedAt, execution = null) {
  const outputCounts = [
    { goalFields: Object.keys(content.expertGoal || {}).length, expertRoles: content.expertRoles?.length || 0 },
    { sources: content.sources?.length || 0, sourceKinds: execution?.runtime?.references?.sourceKinds || [] },
    { sources: content.sources?.length || 0, researchGaps: content.researchGaps?.length || 0, sotaDimensions: content.sota?.length || 0 },
    { knowledgeLayers: content.knowledgeSystem?.layers?.length || 0, graphNodes: content.graph?.nodes?.length || 0, knowledgePassages: content.knowledgeContext?.length || 0 },
    { documentSections: content.systemDocument?.sections?.length || 0, draftSections: content.sections?.length || 0, experiments: content.experiments?.length || 0 },
    { evidenceClaims: content.evidence?.claims?.length || 0, reviewFindings: content.review?.length || 0, mappedSources: content.evidence?.sources?.length || 0 },
    { wikiSections: content.llmWiki?.sections?.length || 0, glossaryTerms: content.llmWiki?.glossary?.length || 0, nextQuestions: content.llmWiki?.nextQuestions?.length || 0 },
  ];
  const stages = new Map((execution?.stages || []).map((stage) => [stage.id, stage]));
  const roles = new Map((content.expertRoles || []).map((role) => [role.stage, role]));
  const pipeline = [
    { id: 'goal', name: 'Expert Goal Architect', responsibility: 'Translate the selected mode and user question into an expert Goal, success criteria, and domain team.' },
    { id: 'references', name: 'Reference Discovery', responsibility: 'Use the completed Goal to discover controlled paper, GitHub, and Web references before specialist synthesis.' },
    ...['research', 'knowledge', 'writing', 'review'].map((id) => ({ id, name: roles.get(id)?.title || `${titleCase(id)} Agent`, responsibility: roles.get(id)?.responsibility || `Complete the bounded ${id} responsibility.` })),
    { id: 'finalizer', name: 'LLM Wiki Finalizer', responsibility: 'Reconcile the Goal, expert outputs, evidence status, and review into the final LLM Wiki.' },
  ];
  return {
    version: 3,
    strategy: execution?.runtime?.mode ? `adaptive-${execution.runtime.mode}` : 'goal-expert-wiki-pipeline',
    product: project.type,
    completedAt,
    runtime: execution?.runtime || { name: 'offline-deterministic', version: 2, language: content.language || project.wikiLanguage || 'en', references: { status: 'offline', sourceCount: 0, sourceKinds: [] } },
    goal: content.expertGoal,
    expertRoles: content.expertRoles,
    agents: pipeline.map(({ id, name, responsibility }, index) => {
      const stage = stages.get(id);
      const status = stage?.status || (id === 'references' ? (execution?.runtime?.references?.status || 'offline') : execution ? 'not-run' : 'completed');
      return { order: index + 1, id, name, responsibility, status, outputs: outputCounts[index], ...(stage ? { startedAt: stage.startedAt, completedAt: stage.completedAt, usage: stage.usage, ...(stage.warning ? { warning: stage.warning } : {}), ...(stage.error ? { error: stage.error } : {}) } : {}) };
    }),
  };
}

export function generateArtifact(project, options = {}) {
  const language = normalizeWikiLanguage(options.language || project.wikiLanguage || 'en');
  const content = project.type === 'research'
    ? researchArtifact(project.topic)
    : project.type === 'paper'
      ? paperArtifact(project.topic, project.description)
      : knowledgeArtifact(project.topic);
  if (options.sources?.length) content.sources = options.sources;
  Object.assign(content, collaborativeContent(project, content, options.prompt, language));
  const sources = content.sources || [];
  const knowledgeContext = boundedKnowledgeContext(options.knowledgeContext);
  const createdAt = new Date().toISOString();
  const finalContent = { ...content, language, knowledgeContext, evidence: evidenceFor(content, sources) };
  const artifact = {
    id: randomUUID(),
    type: project.type,
    title: artifactDefinitions[project.type].label,
    createdAt,
    language,
    content: finalContent,
    workflow: workflowFor(project, finalContent, createdAt),
  };
  return withMarkdownDocument(project, artifact);
}

function refinementFallback(project, fresh, previous, language) {
  if (!previous?.content) return fresh;
  const prior = structuredClone(previous.content);
  const content = {
    ...fresh.content,
    ...prior,
    language,
    expertGoal: fresh.content.expertGoal,
    expertRoles: prior.expertRoles?.length ? prior.expertRoles : fresh.content.expertRoles,
    sources: prior.sources || [],
    knowledgeContext: fresh.content.knowledgeContext || [],
  };
  return withMarkdownDocument(project, { ...fresh, title: previous.title || fresh.title, content });
}

export async function generateArtifactAsync(project, options = {}) {
  const language = normalizeWikiLanguage(options.language || project.wikiLanguage || 'en');
  const previous = options.refineFromLatest ? project.artifacts?.[0] : null;
  const fresh = generateArtifact(project, { ...options, language });
  const fallback = refinementFallback(project, fresh, previous, language);
  const initialSources = previous?.content?.sources || options.sources || [];
  let artifact;
  let execution = null;
  if (options.providerConfig) {
    execution = await runAgentWorkflow(project, fallback, options.providerConfig, { sources: initialSources, knowledgeContext: fallback.content.knowledgeContext || [], language, referenceRetriever: options.referenceRetriever, prompt: options.prompt, mode: options.mode, onStage: options.onStage, onMode: options.onMode, onModel: options.onModel, tools: options.tools, skills: options.skills, plugins: options.plugins, toolExecutor: options.toolExecutor, onTool: options.onTool, threadId: options.threadId });
    artifact = { ...fallback, content: execution.content, model: options.providerConfig.model };
  } else {
    const startedAt = new Date().toISOString();
    const goalStage = { id: 'goal', name: 'Expert Goal Architect', mode: 'workflow', status: 'completed', startedAt, completedAt: new Date().toISOString(), outputKeys: ['expertGoal', 'expertRoles'], usage: { inputTokens: 0, outputTokens: 0 } };
    await options.onStage?.({ ...goalStage, expertGoal: fallback.content.expertGoal, expertRoles: fallback.content.expertRoles, progress: 30 });
    const queryPlans = referenceQueriesForGoal(fallback.content.expertGoal, project);
    const query = queryPlans[0]?.query || referenceQueryForGoal(fallback.content.expertGoal, project);
    const referenceStartedAt = new Date().toISOString();
    await options.onStage?.({ id: 'references', name: 'Reference Discovery', mode: 'workflow', status: 'running', query, queries: queryPlans, progress: 34 });
    let discoveredSources = initialSources;
    let referenceStatus = discoveredSources.length ? 'provided' : 'offline';
    let referenceError;
    const queryResults = [];
    if (options.referenceRetriever) {
      for (const [queryIndex, queryPlan] of queryPlans.entries()) {
        try {
          const result = await options.referenceRetriever({ expertGoal: fallback.content.expertGoal, project, prompt: options.prompt, language, query: queryPlan.query, facet: queryPlan.facet, queryIndex, queryCount: queryPlans.length });
          const additions = (Array.isArray(result) ? result : result?.sources || []).map((source) => ({ ...source, discoveryFacet: source.discoveryFacet || queryPlan.facet, discoveryQueryId: source.discoveryQueryId || queryPlan.id }));
          const byUrl = new Map(discoveredSources.map((source) => [String(source.url || `${source.name}:${source.publishedAt || ''}`), source]));
          for (const source of additions) if (!byUrl.has(String(source.url || `${source.name}:${source.publishedAt || ''}`))) byUrl.set(String(source.url || `${source.name}:${source.publishedAt || ''}`), source);
          discoveredSources = [...byUrl.values()];
          queryResults.push({ ...queryPlan, status: result?.status || 'completed', sourceCount: additions.length });
        } catch (error) {
          queryResults.push({ ...queryPlan, status: 'failed', sourceCount: 0, error: String(error?.message || 'Reference discovery failed').slice(0, 240) });
        }
      }
      const successfulQueries = queryResults.filter((item) => item.status !== 'failed').length;
      referenceStatus = successfulQueries ? (successfulQueries === queryPlans.length ? 'completed' : 'partial') : 'fallback';
      if (!successfulQueries) referenceError = queryResults.find((item) => item.error)?.error;
      const groups = new Map();
      for (const source of discoveredSources) { const facet = source.discoveryFacet || 'provided'; if (!groups.has(facet)) groups.set(facet, []); groups.get(facet).push(source); }
      const queues = [...groups.values()];
      discoveredSources = [];
      while (queues.some((items) => items.length)) for (const items of queues) if (items.length) discoveredSources.push(items.shift());
    }
    const referenceKinds = [...new Set(discoveredSources.map((source) => /github|repository|code/i.test(`${source.kind} ${source.url}`) ? 'github' : /arxiv|openalex|crossref|doi|paper|journal|conference|ieee|acm|springer/i.test(`${source.kind} ${source.url}`) ? 'paper' : 'web'))];
    const referenceStage = { id: 'references', name: 'Reference Discovery', mode: 'workflow', status: referenceStatus, startedAt: referenceStartedAt, completedAt: new Date().toISOString(), outputKeys: ['sources'], usage: { inputTokens: 0, outputTokens: 0 }, ...(referenceError ? { error: referenceError } : {}) };
    await options.onStage?.({ ...referenceStage, query, queries: queryResults.length ? queryResults : queryPlans, sourceCount: discoveredSources.length, sourceKinds: referenceKinds, progress: 42 });
    if (discoveredSources.length) fallback.content.sources = discoveredSources;
    artifact = await completeArtifact(project, fallback, fallback.content.sources || [], fallback.content.knowledgeContext || [], { language });
    const finalizerStage = { id: 'finalizer', name: 'LLM Wiki Finalizer', mode: 'workflow', status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), outputKeys: ['llmWiki', 'wikiSections'], usage: { inputTokens: 0, outputTokens: 0 } };
    await options.onStage?.({ ...finalizerStage, progress: 96 });
    execution = {
      stages: [goalStage, referenceStage, finalizerStage],
      runtime: { name: artifact.model ? 'legacy-model-gateway' : 'offline-deterministic', version: 3, language, references: { query, queries: queryResults.length ? queryResults : queryPlans, status: referenceStatus, sourceCount: discoveredSources.length, sourceKinds: referenceKinds }, mode: 'workflow', skills: [], plugins: [], toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } },
    };
  }
  const sources = artifact.content.sources || fallback.content.sources || [];
  const knowledgeContext = artifact.content.knowledgeContext || fallback.content.knowledgeContext || [];
  const coordinated = normalizeCollaborativeContent(project, artifact.content, options.prompt, language);
  const content = { ...coordinated, language, sources, knowledgeContext, evidence: evidenceFor(coordinated, sources) };
  const finalized = { ...artifact, language, content, workflow: workflowFor(project, content, artifact.createdAt, execution) };
  return withMarkdownDocument(project, finalized);
}

function withMarkdownDocument(project, artifact) {
  const markdown = artifactToMarkdown(project, { ...artifact, documents: undefined });
  return { ...artifact, documents: [{ id: `${artifact.id}:llm-wiki.md`, name: 'llm-wiki.md', mediaType: 'text/markdown', language: artifact.language || artifact.content?.language || 'en', content: markdown }] };
}

export function artifactToMarkdown(project, artifact) {
  const c = artifact.content;
  const evidenceById = new Map((c.evidence?.sources || []).map((source) => [source.id, source]));
  const citationByUrl = new Map((c.evidence?.sources || []).map((source) => [source.url, source.citationId]));
  const markdownLink = (source) => `[${source.title || source.name}](${source.url})`;
  const lines = [`# ${c.title || artifact.title || project.title}`, '', c.summary, ''];
  if (c.expertGoal) lines.push('## Expert Goal', '', `**Question:** ${c.expertGoal.question}`, '', `**Domain:** ${c.expertGoal.domain}`, '', `**Outcome:** ${c.expertGoal.outcome}`, '', '### Deliverables', '', ...(c.expertGoal.deliverables || []).map((item) => `- ${item}`), '', '### Success criteria', '', ...(c.expertGoal.successCriteria || []).map((item) => `- ${item}`), '');
  if (c.expertRoles?.length) lines.push('## Coordinated expert team', '', ...c.expertRoles.flatMap((role) => [`### ${role.title}`, '', `${role.expertise} ${role.responsibility}`, '', `Stage: **${role.stage}**. Expected outputs: ${(role.expectedOutputs || []).join(', ')}.`, '']));
  if (c.knowledgeSystem) lines.push('## Knowledge system', '', c.knowledgeSystem.purpose, '', ...(c.knowledgeSystem.layers || []).flatMap((layer) => [`### ${layer.title}`, '', layer.objective, '', `Topics: ${(layer.topics || []).join(', ')}. Dependencies: ${(layer.dependencies || []).join(', ') || 'none'}.`, '']), '### Validation questions', '', ...(c.knowledgeSystem.validationQuestions || []).map((item) => `- ${item}`), '');
  if (c.systemDocument) lines.push('## System document', '', c.systemDocument.executiveSummary, '', ...(c.systemDocument.sections || []).flatMap((section) => [`### ${section.title}`, '', section.body, '']), '### Completion checklist', '', ...(c.systemDocument.completionChecklist || []).map((item) => `- ${item}`), '');
  if (c.abstract) lines.push('## Abstract', '', c.abstract, '');
  for (const section of c.sections || []) lines.push(`## ${section.title}`, '', section.body, '');
  if (c.llmWiki) lines.push('## LLM Wiki', '', c.llmWiki.summary, '', ...(c.llmWiki.sections || []).flatMap((section) => [`### ${section.title}`, '', section.body, '']), '### Glossary', '', ...(c.llmWiki.glossary || []).map((item) => `- **${item.term}:** ${item.definition}`), '', '### Next questions', '', ...(c.llmWiki.nextQuestions || []).map((item) => `- ${item}`), '');
  else if (c.wikiSections?.length) lines.push('## LLM Wiki', '', ...c.wikiSections.flatMap((section) => [`### ${section.title}`, '', section.body, '']));
  if (c.learningPath?.length) lines.push('## Learning path', '', ...c.learningPath.flatMap((item) => [`### ${item.stage} · ${item.duration}`, '', item.outcome, '', ...item.tasks.map((task) => `- ${task}`), '']));
  if (c.caseStudies?.length) lines.push('## Practice lab', '', ...c.caseStudies.flatMap((item) => [`### Case study · ${item.title}`, '', item.scenario, '', `**Deliverable:** ${item.deliverable}`, '']));
  if (c.practiceQuestions?.length) lines.push('### Practice questions', '', ...c.practiceQuestions.map((item) => `- **${item.level}:** ${item.question} Success criteria: ${item.successCriteria}`), '');
  if (c.graph?.nodes?.length) {
    const nodes = new Map(c.graph.nodes.map((node, index) => [node.id, { key: `g${index + 1}`, label: String(node.label || node.id).replace(/["\[\]]/g, '') }]));
    const graph = ['flowchart LR', ...[...nodes.values()].map((node) => `  ${node.key}["${node.label}"]`), ...(c.graph.edges || []).map((edge) => nodes.has(edge.source) && nodes.has(edge.target) ? `  ${nodes.get(edge.source).key} -->|${String(edge.relation || 'related').replace(/[^a-z0-9 _-]/gi, '')}| ${nodes.get(edge.target).key}` : '').filter(Boolean)].join('\n');
    lines.push('## Knowledge graph', '', '```mermaid', graph, '```', '');
  }
  if (c.sota?.length) lines.push('## State of the art', '', ...c.sota.map((item) => `- **${item.dimension}** (${item.confidence} confidence): ${item.finding}`), '');
  if (c.researchGaps?.length) lines.push('## Research gap discovery', '', ...c.researchGaps.flatMap((item) => [`### ${item.gap}`, '', `- Evidence needed: ${item.evidenceNeeded}`, `- Falsification test: ${item.test}`, '']));
  if (c.noveltyAnalysis?.length) lines.push('## Novelty analysis', '', ...c.noveltyAnalysis.map((item) => `- **${item.dimension}** — baseline: ${item.baseline}; differentiation: ${item.differentiation}; risk: ${item.risk}`), '');
  if (c.contributions) lines.push('## Contributions', '', ...c.contributions.map((x) => `- ${x}`), '');
  if (c.method) lines.push('## Method', '', ...c.method.map((x, i) => `${i + 1}. ${x}`), '');
  if (c.experiments) lines.push('## Experiments', '', ...c.experiments.map((x) => `- **${x.name}** — ${x.purpose}. Metrics: ${x.metric}.`), '');
  if (c.figures) lines.push('## Figures', '', ...c.figures.map((figure) => {
    const nodes = new Map((figure.nodes || []).map((node, index) => [node.id, { key: `n${index + 1}`, label: String(node.label || node.id).replace(/["\[\]]/g, '') }]));
    const graph = nodes.size ? ['flowchart LR', ...[...nodes.values()].map((node) => `  ${node.key}["${node.label}"]`), ...(figure.edges || []).map((edge) => nodes.has(edge.source) && nodes.has(edge.target) ? `  ${nodes.get(edge.source).key} --> ${nodes.get(edge.target).key}` : '').filter(Boolean)].join('\n') : String(figure.diagram || '');
    return `### ${figure.caption}\n\n${figure.purpose}\n\n\`\`\`mermaid\n${graph}\n\`\`\``;
  }), '');
  if (c.review) lines.push('## Review simulation', '', ...c.review.map((x) => `- **${x.area}** — ${x.verdict}: ${x.note}`), '');
  if (c.opportunities) lines.push('## Opportunities', '', ...c.opportunities.map((x) => `- ${x}`), '');
  if (c.knowledgeContext?.length) lines.push('## Workspace knowledge used', '', ...c.knowledgeContext.map((item) => `- **${item.document}** (${item.relevanceScore.toFixed(2)}): ${item.excerpt}${item.sourceUrl ? ` — ${item.sourceUrl}` : ''}`), '', '> Workspace knowledge is user-provided context and is not independently fact-verified.', '');
  if (c.evidence) {
    lines.push('## Evidence status', '', `- Status: ${c.evidence.status}`, `- Sources mapped: ${c.evidence.sources.length}`, `- ${c.evidence.disclaimer}`, '');
    if (c.evidence.claims?.length) lines.push('### Claim mapping', '', ...c.evidence.claims.map((claim) => {
      const links = (claim.evidenceIds || []).map((id) => evidenceById.get(id)).filter(Boolean).map(markdownLink);
      return `- **${claim.id}** (${claim.verification}): ${claim.text}${links.length ? ` — evidence: ${links.join(', ')}` : ' — evidence: none'}`;
    }), '');
  }
  if (c.sources) lines.push('## Source map', '', ...c.sources.map((x) => `- **${citationByUrl.get(x.url) || 'unmapped'}** [${x.name}](${x.url}) - ${x.kind}${x.publishedAt ? ` (${x.publishedAt})` : ''}${x.snippet ? `\n  - Retrieved abstract/note: ${String(x.snippet).slice(0, 1_000)}` : ''}`), '', '> Retrieved abstracts and source notes remain untrusted inputs; only S-numbered entries can support explicit [S#] claim mappings.', '');
  if (artifact.workflow?.agents?.length) lines.push('## Workflow provenance', '', ...artifact.workflow.agents.map((agent) => `- **${agent.order}. ${agent.name}** (${agent.status}) — ${agent.responsibility}`), '');
  lines.push('---', `Generated by Novi on ${artifact.createdAt.slice(0, 10)}. Verify claims and citations before publication.`);
  return lines.join('\n');
}

export function artifactToLatex(project, artifact, template = 'article') {
  if (template === 'ieee') return artifactToLatex(project, artifact, 'article').replace('\\documentclass{article}', '\\documentclass[conference]{IEEEtran}').replace('\n\\usepackage[margin=1in]{geometry}', '');
  if (template === 'acm') return artifactToLatex(project, artifact, 'article').replace('\\documentclass{article}', '\\documentclass[sigconf]{acmart}').replace('\n\\usepackage[margin=1in]{geometry}', '');
  const escape = (s) => String(s).replace(/[&%$#_{}]/g, '\\$&');
  const c = artifact.content;
  const expertGoal = c.expertGoal ? `\\section{Expert Goal}\n\\textbf{Question:} ${escape(c.expertGoal.question)}\\par\n\\textbf{Domain:} ${escape(c.expertGoal.domain)}\\par\n\\textbf{Outcome:} ${escape(c.expertGoal.outcome)}\\par\n\\begin{itemize}\n${(c.expertGoal.successCriteria || []).map((item) => `\\item ${escape(item)}`).join('\n')}\n\\end{itemize}` : '';
  const expertTeam = c.expertRoles?.length ? `\\section{Coordinated expert team}\n\\begin{description}\n${c.expertRoles.map((role) => `\\item[${escape(role.title)}] ${escape(role.expertise)} ${escape(role.responsibility)}`).join('\n')}\n\\end{description}` : '';
  const knowledgeSystem = c.knowledgeSystem ? `\\section{Knowledge system}\n${escape(c.knowledgeSystem.purpose)}\\par\n${(c.knowledgeSystem.layers || []).map((layer) => `\\subsection{${escape(layer.title)}}\n${escape(layer.objective)}`).join('\n')}` : '';
  const systemDocument = c.systemDocument ? `\\section{System document}\n${escape(c.systemDocument.executiveSummary)}\\par\n${(c.systemDocument.sections || []).map((section) => `\\subsection{${escape(section.title)}}\n${escape(section.body)}`).join('\n')}` : '';
  const llmWiki = c.llmWiki ? `\\section{LLM Wiki}\n${escape(c.llmWiki.summary)}\\par\n${(c.llmWiki.sections || []).map((section) => `\\subsection{${escape(section.title)}}\n${escape(section.body)}`).join('\n')}\n\\subsection{Glossary}\n\\begin{description}\n${(c.llmWiki.glossary || []).map((item) => `\\item[${escape(item.term)}] ${escape(item.definition)}`).join('\n')}\n\\end{description}` : '';
  const knowledgeContext = c.knowledgeContext?.length ? `\\section*{Workspace knowledge used}\n${c.knowledgeContext.map((item) => `\\textbf{${escape(item.document)}} (${escape(item.relevanceScore.toFixed(2))}): ${escape(item.excerpt)}\\par`).join('\n')}\n\\emph{Workspace knowledge is user-provided context and is not independently fact-verified.}\n` : '';
  const evidence = `${knowledgeContext}${c.evidence ? `\\section*{Evidence status}\nStatus: ${escape(c.evidence.status)}. Sources mapped: ${c.evidence.sources.length}. ${escape(c.evidence.disclaimer)}\\par\n${(c.evidence.claims || []).map((claim) => `\\textbf{${escape(claim.id)}} (${escape(claim.verification)}): ${escape(claim.text)}\\par Evidence: ${escape((claim.evidenceIds || []).join(', ') || 'none')}`).join('\\n')}` : ''}`;
  const refs = (c.evidence?.sources || []).map((source) => `\\item[${escape(source.id)}] ${escape(source.title)} (${escape(source.kind || 'Source')})`).join('\\n');
  const paperContributions = c.contributions?.length ? `\\section{Contributions}\n\\begin{itemize}\n${c.contributions.map((item) => `\\item ${escape(item)}`).join('\n')}\n\\end{itemize}` : '';
  const contributions = [expertGoal, expertTeam, knowledgeSystem, systemDocument, llmWiki, paperContributions].filter(Boolean).join('\n');
  const researchGaps = c.researchGaps?.length ? `\\section{Research gap discovery}\n\\begin{description}\n${c.researchGaps.map((item) => `\\item[Gap] ${escape(item.gap)}\\par Evidence needed: ${escape(item.evidenceNeeded)}\\par Falsification test: ${escape(item.test)}`).join('\n')}\n\\end{description}` : '';
  const novelty = c.noveltyAnalysis?.length ? `\\section{Novelty analysis}\n\\begin{description}\n${c.noveltyAnalysis.map((item) => `\\item[${escape(item.dimension)}] Baseline: ${escape(item.baseline)}\\par Differentiation: ${escape(item.differentiation)}\\par Risk: ${escape(item.risk)}`).join('\n')}\n\\end{description}` : '';
  const methodBody = c.method?.length ? `\\section{Method}\n\\begin{enumerate}\n${c.method.map((item) => `\\item ${escape(item)}`).join('\n')}\n\\end{enumerate}` : '';
  const method = [researchGaps, novelty, methodBody].filter(Boolean).join('\n');
  const experiments = c.experiments?.length ? `\\section{Experiments}\n\\begin{description}\n${c.experiments.map((item) => `\\item[${escape(item.name)}] ${escape(item.purpose)} Metrics: ${escape(item.metric)}.`).join('\n')}\n\\end{description}` : '';
  const figures = c.figures?.length ? c.figures.map((figure, index) => {
    const nodes = new Map((figure.nodes || []).slice(0, 12).map((node) => [node.id, { label: escape(node.label || node.id), x: Number((Math.max(0, Math.min(680, Number(node.x) || 0)) * 0.42).toFixed(1)), y: Number(((220 - Math.max(0, Math.min(220, Number(node.y) || 0))) * 0.42).toFixed(1)) }]));
    const pictureNodes = [...nodes.values()].map((node) => `\\put(${node.x},${node.y}){\\framebox(50,18){\\scriptsize ${node.label}}}`).join('\n');
    const pictureEdges = (figure.edges || []).slice(0, 24).map((edge) => {
      const source = nodes.get(edge.source); const target = nodes.get(edge.target); if (!source || !target) return '';
      const dx = target.x - source.x; const dy = target.y - source.y;
      if (Math.abs(dx) >= Math.abs(dy)) { const direction = dx >= 0 ? 1 : -1; const x = direction > 0 ? source.x + 50 : source.x; return `\\put(${x},${source.y + 9}){\\vector(${direction},0){${Math.max(1, Math.abs(dx) - 50)}}}`; }
      const direction = dy >= 0 ? 1 : -1; const y = direction > 0 ? source.y + 18 : source.y; return `\\put(${source.x + 25},${y}){\\vector(0,${direction}){${Math.max(1, Math.abs(dy) - 18)}}}`;
    }).filter(Boolean).join('\n');
    const rendered = nodes.size ? `\\setlength{\\unitlength}{1pt}\\begin{picture}(336,112)\n${pictureEdges}\n${pictureNodes}\n\\end{picture}` : `\\fbox{\\begin{minipage}{0.8\\linewidth}\\centering\\texttt{${escape(figure.diagram).replace(/\\n/g, ' \\textbackslash\\textbackslash ')}\\end{minipage}}`;
    return `\\begin{figure}[ht]\n\\centering\n${rendered}\n\\caption{${escape(figure.caption)}: ${escape(figure.purpose)}}\n\\label{fig:${escape(figure.id || `figure-${index + 1}`)}}\n\\end{figure}`;
  }).join('\n') : '';
  const review = c.review?.length ? `\\section{Review simulation}\n\\begin{description}\n${c.review.map((item) => `\\item[${escape(item.area)}: ${escape(item.verdict)}] ${escape(item.note)}`).join('\n')}\n\\end{description}` : '';
  return `\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{url}\n\\title{${escape(c.title || artifact.title || project.title)}}\n\\author{Novi Workspace}\n\\begin{document}\n\\maketitle\n\\begin{abstract}\n${escape(c.abstract || c.summary)}\n\\end{abstract}\n${(c.sections || []).map((s) => `\\section{${escape(s.title)}}\n${escape(s.body)}`).join('\n')}\n${contributions}\n${method}\n${experiments}\n${figures}\n${review}\n${evidence}\n${refs ? `\\section*{Mapped sources}\n\\begin{description}\n${refs}\n\\end{description}` : ''}\n\\end{document}\n`;
}
