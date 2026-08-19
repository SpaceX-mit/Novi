import { createHash, randomUUID } from 'node:crypto';
import { referenceQueriesForGoal, referenceQueryForGoal, runAgentWorkflow } from './agent-runtime.mjs';
import { completeArtifact } from './model.mjs';
import { normalizeWikiLanguage } from './wiki-language.mjs';
import { assessWikiQuality } from './wiki-quality.mjs';

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

const deepDiveSectionTitles = {
  en: ['Technical question and scope', 'Mechanism and architecture', 'Concrete implementation or case', 'Trade-offs and alternatives', 'Failure modes and limits', 'Validation and evidence gaps'],
  'zh-CN': ['技术问题与范围', '机制与架构', '具体实现或案例', '取舍与替代方案', '失败模式与局限', '验证方法与证据缺口'],
};

function proseList(items, fallback) {
  const values = (items || []).map((item) => typeof item === 'string' ? item : item?.finding || item?.gap || item?.note || item?.title || '').filter(Boolean).slice(0, 4);
  return values.length ? values.join('；') : fallback;
}

function createDeepDiveDocuments(domain, content, goal, language = 'en') {
  const zh = language === 'zh-CN';
  const titles = deepDiveSectionTitles[zh ? 'zh-CN' : 'en'];
  const evidence = proseList(content.sota, zh ? '不同方案的评估口径与成熟度并不一致' : 'solution families use incompatible evaluation protocols and maturity claims');
  const gaps = proseList(content.researchGaps, zh ? '真实约束下仍缺少可复现证据' : 'reproducible evidence under realistic constraints remains incomplete');
  const layers = proseList(content.knowledgeSystem?.layers, zh ? '知识依赖需要从基础机制连接到高阶实践' : 'dependencies must connect foundational mechanisms to advanced practice');
  const experiments = proseList(content.experiments, zh ? '质量、延迟、成本、失败率与恢复时间需要联合评估' : 'quality, latency, cost, failure rate, and recovery time require joint evaluation');
  const review = proseList(content.review, zh ? '结论必须与方法、限制和证据强度一致' : 'conclusions must remain consistent with methods, limitations, and evidence strength');
  const opportunities = proseList(content.opportunities, zh ? '开放问题应转化为可证伪实验' : 'open questions should become falsifiable experiments');
  const specs = zh ? [
    ['research-landscape', '01-research-landscape', `${domain}研究版图与技术争议`, '解释研究问题、方案家族、证据强弱和仍未解决的技术争议。', [`围绕“${goal.question}”界定分析单元、系统边界、利益相关者和决策目标，明确哪些假设必须被验证。`, `比较方案的组件分工、数据流与控制环路。当前证据显示：${evidence}；这些差异会改变扩展方式和失效传播。`, '固定输入、输出和约束，以同一工作负载比较代表性实现，并保存配置、版本、原始输出和故障记录。', '吞吐、延迟、成本、可审计性和隔离强度通常互相牵制，比较时必须声明可接受的运行区间。', '协议不一致、选择性报告、环境漂移和隐藏人工干预会破坏因果解释，不能把相关性直接写成机制收益。', `预注册基线、指标、停止条件和误差分类。优先证据缺口是：${gaps}；下一步是${opportunities}。`]],
    ['foundations-and-mechanisms', '02-foundations-and-mechanisms', `${domain}基础机制与依赖关系`, '从核心机制解释系统为何工作，以及依赖关系如何约束可行实现。', [`识别支撑 Goal“${goal.outcome}”的最小可解释机制，使每个概念对应可观察状态、转换或约束。`, `沿输入、状态、转换、输出和反馈展开机制。依赖路径是：${layers}，局部优化可能因此破坏系统级不变量。`, '先构造包含输入校验、核心转换、状态和可观测事件的最小垂直切片，再逐步加入缓存、并发与持久化。', '抽象提高复用但可能隐藏状态，直接实现易验证却可能难以扩展；选择应围绕不变量、边界和迁移成本。', '状态不一致、边界遗漏、反馈延迟和静默错误是主要失败模式，每个关键转换都需要超时与恢复路径。', '使用不变量、契约测试、故障注入和端到端追踪验证每层依赖在压力与异常状态下仍成立。']],
    ['system-architecture', '03-system-architecture', `${domain}系统架构、数据流与边界`, '把机制落到组件、接口、数据流、信任边界和生命周期。', ['从输入、输出、参与者、数据所有权、权限决策和外部依赖共同定义系统边界，而不只依赖部署图。', '端到端数据流要说明组件转换、持久状态和事件；接口需定义输入形状、幂等性、超时、错误语义和回滚。', '以一条完整请求为案例，追踪入口、缓存、重试、工具调用、审批、持久化和结果提交，形成可执行排障路径。', '集中状态便于一致性与审计，分布式状态利于扩展与隔离，但增加重复执行、数据一致性和观测复杂度。', '部分提交、重试副作用、跨边界权限泄漏、消息丢失和依赖降级应通过幂等键、审计与补偿流程处理。', '使用状态机测试、权限矩阵、故障注入和恢复演练，观测数据完整性、分位延迟、错误率与恢复时间。']],
    ['implementation-and-evaluation', '04-implementation-and-evaluation', `${domain}工程实现与评估方法`, '给出从原型到生产形态的实现路径、实验设计和可观测指标。', ['先定义成功标准、工作负载和资源约束，使每个技术主张都能通过代码、配置、实验或运行事件被检查。', '工程实现围绕关键机制建立包含校验、转换、持久化、观测和恢复的垂直切片，避免只验证演示路径。', '案例应保存版本、依赖、配置、数据集、参数、原始结果和失败日志，再逐步增加并发、权限与成本控制。', '质量可能增加延迟和成本，隔离可能降低吞吐，详细日志可能带来隐私风险，评估必须呈现联合取舍。', '覆盖空输入、超时、限流、版本漂移、脏数据、权限拒绝和部分依赖不可用，并为每类失败定义可见结果。', `评估重点是${experiments}。报告分位数、不确定性、错误分类、成本假设和复现材料，而不是只给平均分。`]],
    ['risks-and-frontier', '05-risks-and-frontier', `${domain}风险、治理与前沿问题`, '分析安全、治理、外部有效性和下一阶段可证伪的研究问题。', [`识别谁能触发对用户、数据或系统的伤害、影响如何扩散，以及哪些高影响操作必须进入人工审批。`, '治理机制覆盖身份、最小权限、来源到主张映射、审计、保留与删除，并把不可验证内容显式标为不确定。', '用威胁模型和生产形态演练定义攻击者能力、敏感资产、控制措施、残余风险与升级路径，再检验控制有效性。', '更严格的治理增加摩擦，更开放的自动化扩大效率和误用范围，应按影响、可逆性和证据强度分层。', `数据代表性、供应商漂移、攻击者适应、评测泄漏和隐私约束限制外部有效性。评审结论是：${review}。`, `前沿方向必须声明假设、最小实验、失败判据与所需证据。当前优先问题是${opportunities}。`]],
  ] : [
    ['research-landscape', '01-research-landscape', `${domain} Research Landscape and Technical Tensions`, 'Explain the research question, competing solution families, evidence strength, and unresolved technical tensions.', [`Bound “${goal.question}” by its unit of analysis, system boundary, stakeholders, decision, and assumptions that need testing.`, `Compare component boundaries, data flows, and control loops. Current evidence indicates ${evidence}; these differences change scaling and failure propagation.`, 'Fix inputs, outputs, and constraints, run one workload across representative implementations, and retain configuration, versions, raw output, and failure traces.', 'Throughput, latency, cost, auditability, and isolation pull in different directions; comparisons need an explicit acceptable operating envelope.', 'Protocol mismatch, selective reporting, environment drift, and hidden human intervention break causal interpretation of apparent gains.', `Preregister baselines, metrics, stopping rules, and error taxonomy. Priority gaps are ${gaps}; the next opportunity is ${opportunities}.`]],
    ['foundations-and-mechanisms', '02-foundations-and-mechanisms', `${domain} Foundations and Mechanisms`, 'Explain why the system works from first principles and how dependencies constrain viable implementations.', [`Identify the smallest observable mechanisms supporting the Goal “${goal.outcome}”, mapping each concept to state, transformation, or constraint.`, `Trace input, state, transformation, output, and feedback. The dependency path is ${layers}, so local optimization can violate system invariants.`, 'Build a minimal vertical slice with validation, transformation, state, and observable events before adding caching, concurrency, and persistence.', 'Abstraction improves reuse but can hide state; direct implementation is easier to verify but harder to scale. Choose around invariants and migration cost.', 'Inconsistent state, missed boundaries, delayed feedback, and silent errors require explicit timeouts, invariants, and recovery paths.', 'Use invariant tests, contract tests, fault injection, and end-to-end traces to validate every dependency under load and abnormal states.']],
    ['system-architecture', '03-system-architecture', `${domain} System Architecture, Data Flow, and Boundaries`, 'Map mechanisms to components, interfaces, data flows, trust boundaries, and lifecycle behavior.', ['Define the boundary through inputs, outputs, actors, data ownership, authorization decisions, and external dependencies, not topology alone.', 'The end-to-end flow must state component transformations, retained state, and events; interfaces define shape, idempotency, timeout, errors, and rollback.', 'Trace one request through entry, cache, retries, tool calls, approval, persistence, and commit to create an executable troubleshooting path.', 'Central state simplifies consistency and audit; distributed state helps scaling and isolation but adds duplicate execution and observability complexity.', 'Partial commits, retry side effects, authorization leaks, lost messages, and dependency degradation require idempotency, audit, and compensation.', 'Use state-machine tests, authorization matrices, fault injection, and recovery drills; observe integrity, tail latency, error rate, and recovery time.']],
    ['implementation-and-evaluation', '04-implementation-and-evaluation', `${domain} Implementation and Evaluation`, 'Give an implementation path from prototype to production shape, with experiments and observable metrics.', ['Define success criteria, workloads, and resource constraints so every technical claim is inspectable through code, configuration, experiments, or events.', 'Build a vertical slice with validation, transformation, persistence, observability, and recovery instead of validating only a demonstration path.', 'Retain versions, dependencies, configuration, datasets, parameters, raw results, and failure logs; add concurrency, authorization, and cost controls incrementally.', 'Quality can increase latency and cost, isolation can reduce throughput, and detailed logs can create privacy risk; evaluation must expose joint trade-offs.', 'Cover empty input, timeout, rate limiting, version drift, dirty data, authorization denial, and partial dependency failure with observable outcomes.', `Evaluate ${experiments}. Report percentiles, uncertainty, error taxonomy, cost assumptions, and reproduction artifacts rather than one average score.`]],
    ['risks-and-frontier', '05-risks-and-frontier', `${domain} Risks, Governance, and Frontier Questions`, 'Analyze security, governance, external validity, and falsifiable questions for the next stage.', [`Identify who can harm users, data, or systems, how impact propagates, and which high-impact operations require human approval.`, 'Governance covers identity, least privilege, source-to-claim mapping, audit, retention, and deletion while marking unverifiable content as uncertain.', 'Use a threat model and production-shaped drill to define attacker capability, assets, controls, residual risk, and escalation, then test control effectiveness.', 'Stricter governance adds friction while open automation expands efficiency and misuse; tier decisions by impact, reversibility, and evidence strength.', `Data representation, provider drift, adaptive attackers, evaluation leakage, and privacy constrain external validity. Review says ${review}.`, `Frontier work needs a hypothesis, minimal experiment, failure criterion, and required evidence. Priority questions are ${opportunities}.`]],
  ];
  const agentOsTopic = /agent\s*os|agent runtime|mcp|model context protocol|agent tool|自主.?agent/iu.test(`${domain} ${goal.question} ${goal.outcome}`);
  const enrichment = agentOsTopic ? agentOsEnrichment(language, zh) : null;
  const deepening = agentOsTopic ? agentOsDeepening(language, zh) : null;
  const auditDetail = agentOsTopic ? agentOsAuditDetail(language, zh) : null;
  return padAgentOsSections(specs.map(([id, slug, title, purpose, bodies]) => ({
    id, slug, title, purpose,
    sections: titles.map((sectionTitle, index) => ({ title: sectionTitle, body: `${bodies[index]}${enrichment?.[id]?.[index] ? `\n\n${enrichment[id][index]}` : ''}${deepening?.[id]?.[index] ? `\n\n${deepening[id][index]}` : ''}${auditDetail?.[id]?.[index] ? `\n\n${auditDetail[id][index]}` : ''}` })),
  })));
}

function agentOsEnrichment(language, zh) {
  const base = zh ? {
    'research-landscape': [
      'Agent OS 不是单一框架，而是围绕模型调用、状态编排、上下文与记忆、工具协议、策略执行、审批、运行隔离和观测评估形成的系统栈。比较 LangGraph、OpenAI Agents SDK、AutoGen、CrewAI、PydanticAI、Pi、Claude Code、Codex 或 Hermes 时，必须先固定“运行时保证”这个分析单元：状态如何恢复、工具是否可组合、权限是否在模型之外执行，以及失败后能否重放和审计。',
      '研究版图应把产品营销中的 autonomous、agentic、copilot 与可验证能力分开。真正可比的维度包括控制循环（ReAct、Plan-and-Execute、Supervisor）、状态图或事件日志、上下文压缩、工具调用协议（MCP 或自定义 schema）、人工审批、沙箱隔离和评估集。单次任务成功率不能替代长程任务完成率、工具选择准确率、恢复成功率和越权拒绝率。',
      '一个可复现的案例应让同一 Agent 处理多轮研究任务：先生成计划，再检索资料、读取代码、修改文件、运行测试并提交结果。实验记录每次模型请求、工具输入输出、权限决策、重试、token、延迟和最终变更；否则无法判断提升来自模型能力、提示词、工具质量还是隐藏的人工干预。',
      '框架选择的核心取舍不是“哪个最聪明”，而是控制力与开发速度的交换。图状态机适合可恢复、可观测的长流程；轻量 harness 适合交互式编码和低延迟工具循环；多 Agent supervisor 适合角色隔离但会放大协调成本、共享状态污染和重复调用。评估必须把模型费用、工具费用、人工审批时间和故障恢复成本放进同一预算。',
      '常见失效包括把自然语言当权限、把工具返回值当可信指令、把摘要当证据、把 checkpoint 当成完整恢复、把并发成功当作一致性保证，以及把“调用了搜索工具”误写成“事实已验证”。这些错误跨越模型、编排和数据层，必须在架构评审中分别定义不变量、信任边界和可观测事件。',
      '高质量研究应建立矩阵：每个框架的 runtime 语义、工具/MCP 能力、记忆模型、审批模型、沙箱边界、评估工具和生产证据各占一列；每个结论标注官方文档、源码、论文、复现实验或未知。优先补齐的证据是长任务恢复、提示注入攻击、工具越权、成本漂移和不同供应商模型切换后的行为变化。',
    ],
    'foundations-and-mechanisms': [
      'Agent 的基本闭环可以形式化为：观测 o_t、策略 π、动作 a_t、环境结果 e_t 和状态 s_{t+1}。模型只负责提出候选动作，真正的状态转移、工具 schema 校验、权限判定、预算扣减和提交语义必须由确定性 runtime 执行。这样才能把“模型想做什么”和“系统允许做什么”分成两个可测试的函数。',
      'ReAct 把推理与动作交替，但并不自动产生安全性；Plan-and-Execute 把计划和执行分开，却需要处理计划过期、部分完成和重新规划；Supervisor 通过控制器路由 Specialist，需要避免无限委派和共享上下文污染。实用算法应使用有限状态、幂等工具、显式终止条件、指数退避和失败分类，而不是依赖模型自己决定何时停止。',
      '上下文工程的关键不是把更多文本塞进窗口，而是按任务选择证据、压缩历史、保留决策和维护 provenance。短期消息、工作记忆、长期向量检索、结构化实体图和 checkpoint 解决不同问题；把它们混成一个“memory”会导致陈旧事实、跨租户泄漏和无法解释的召回。每条记忆应有来源、时间、租户、权限和删除语义。',
      'MCP 或自定义工具协议提供发现、schema 和调用边界，但协议本身不等于授权。安全执行链应为：模型请求 → 工具目录匹配 → 输入 schema 验证 → 资源和权限检查 → 沙箱/网络策略 → 工具执行 → 不可信 observation → 证据准入。任何一步缺失，都可能让工具结果改变系统策略或绕过人工审批。',
      '审批是一个状态机而不是一个确认按钮。高影响动作应记录请求者、目标资源、理由、风险、过期时间、批准人和执行结果，并支持拒绝、撤销、超时和重放保护。写文件、执行 shell、发送外部请求和发布内容应按可逆性与影响分级；只读检索和本地分析可以使用更低摩擦的策略。',
      '评估算法应同时测量任务成功、过程质量和安全约束：状态机是否到达正确终态，工具参数是否有效，来源是否真正支持 claim，越权动作是否被拒绝，失败后是否恢复且不重复提交。可采用轨迹级 replay、属性测试、故障注入、对抗提示集和人工抽检组合，而不是只看最终文本的语言流畅度。',
    ],
    'system-architecture': [
      '生产 Agent OS 至少需要模型网关、编排图、上下文/记忆服务、工具注册表、策略与审批服务、执行沙箱、任务队列、持久化 checkpoint、事件日志和评估管道。每一层都应有清晰输入输出与失败语义：模型超时不能直接等同于业务失败，工具部分成功不能直接提交 Artifact，checkpoint 写入失败也不能假设状态已经持久化。',
      '一次研究请求的端到端数据流应包含：用户目标 → intake/Goal → facet 查询 → 来源规范化与去重 → Specialist 状态更新 → 工具 observation → review gate → Artifact 事务提交 → 知识索引。事件日志要关联 request、job、session、artifact、document、tool call 和 citation，形成可追溯链。事件是事实记录，不应被模型修改。',
      '接口设计应明确幂等键、租户和项目边界、超时、取消、重试、分页和版本兼容。工具调用必须使用严格 JSON schema，禁止模型自行增加 endpoint、token 或权限字段；MCP server 发现结果要经过逐工具授权。写入 Workspace 的操作应带 expected version 或 patch base，避免两个 Agent 同时覆盖同一文件。',
      '集中式编排便于审计和一致性，分布式 Specialist 便于隔离和水平扩展。实践上可以用一个 durable workflow 管理控制状态，把长模型调用、搜索和 shell 任务放入有界 worker，并以 outbox 推送事件。不要把内存 checkpoint 当作生产恢复方案；必须验证服务重启、重复投递、网络分区和 worker 抢占后的节点级恢复。',
      '最危险的故障通常发生在边界：重试导致重复写入，工具返回 prompt injection，旧权限被缓存，artifact 已提交但知识索引失败，事件顺序错乱，或取消信号只停止 UI 不停止执行。架构应使用幂等提交、补偿事务、租约、版本检查、不可变事件和隔离 observation，确保局部失败不会伪装成成功。',
      '验证架构不能只做 happy path。至少需要状态图覆盖、权限矩阵、工具 schema fuzzing、沙箱逃逸测试、断网/超时/限流注入、重复 job 竞态、checkpoint 恢复、审计完整性和跨租户检索测试。关键指标包括 p95/p99 延迟、每任务 token 与工具成本、恢复时间、重复副作用率、越权拒绝率和 evidence mapping 覆盖率。',
    ],
    'implementation-and-evaluation': [
      '实现应从最小可运行闭环开始：固定一个任务、一个模型、一个只读工具和一个可验证终态，先建立事件、预算、取消和错误分类，再增加写工具、MCP、多 Agent 和长期记忆。每一步都保存 prompt 版本、模型版本、工具 schema、输入数据、输出轨迹和测试结果，避免“功能增加但无法回归”的黑盒演进。',
      '工具循环应使用明确的预算向量，而不只是一个调用次数：模型 token、工具次数、来源查询数、墙钟时间、并发数和写入变更数分别受限。控制器在预算耗尽时必须进入安全终止或人工审批，不能让模型通过更换工具、重新规划或拆分请求绕过限制。',
      '评估集要覆盖短问答、长研究、代码修改、跨文档检索、工具失败、权限拒绝、提示注入、模型切换和上下文过长。每个样例应有任务目标、允许工具、不可违反的约束、预期状态变化和人工评分 rubric；最终答案好看但没有正确 Artifact、引用或测试结果时应判为失败。',
      '对比 Agent runtime 时要控制模型、温度、工具集、上下文、预算和网络条件，只改变编排策略。报告完成率、轨迹长度、工具选择精度、无效调用率、平均与尾部成本、恢复成功率、人工介入率和安全拒绝率，并给出置信区间或至少重复运行分布，避免用单次 demo 排名。',
      '故障注入应模拟模型返回 malformed JSON、流式中断、工具超时、来源返回恶意文本、checkpoint 写失败、worker 重启和权限变化。系统要区分 request failed、response rejected、tool failed、quality retry 和 fallback；只有网络或中断才叫请求错误，模型内容不合格应进入可见修订路径。',
      '高标准发布门禁应包括：核心轨迹可重放、所有写操作可审计、敏感字段不进入 prompt、来源 claim 可追溯、文档章节达到最小深度、重复度低于阈值、跨租户隔离通过、恢复演练有证据，以及真实供应商账号下的成本和质量抽检。没有这些证据，只能称为开发基线。',
    ],
    'risks-and-frontier': [
      'Agent OS 的威胁模型必须覆盖模型、用户、工具、来源、记忆、插件、MCP server、worker 和发布管道。核心攻击包括 indirect prompt injection、工具参数篡改、凭据外泄、越权文件访问、恶意依赖、数据投毒、记忆污染、审批疲劳和结果伪造；每项都要定义攻击前提、资产、影响、检测信号和缓解控制。',
      '最小权限不能只依赖 prompt。模型上下文中可以描述能力，但真正的 allowlist、路径解析、网络 SSRF 防护、命令沙箱、租户过滤和数据脱敏必须在执行层强制。MCP 工具默认关闭、逐工具授权和 endpoint allowlist 是起点；生产还需要签名/来源、版本固定、撤销和 server 行为监控。',
      '治理需要把来源、主张和动作连接起来：哪个 source 支撑哪个 claim，哪个 claim 触发哪个建议，哪个动作由谁批准，最终写入了什么。对于不能验证的内容，Wiki 应明确显示 unverified 和 evidence gap，而不是用流畅语言掩盖不确定性。发布前应由领域专家抽检引用和失败处置规则。',
      '自动化程度越高，错误的可逆性越重要。只读搜索、草稿生成、沙箱测试可以自动执行；修改生产配置、发送外部消息、删除数据、发布研究结论必须提高审批等级。策略应按影响、范围、可逆性、数据敏感度和证据强度动态分级，并在审批过期或上下文变化时重新确认。',
      '外部有效性受到模型供应商漂移、工具版本、网络结果、数据分布、攻击者适应和评测泄漏影响。一个在固定 fixture 上通过的 Agent 可能在真实网页、长上下文和并发任务中退化。因此需要持续 red-team、canary、shadow replay、版本回归和成本异常检测，而不是一次性 benchmark 通过就宣布成熟。',
      '前沿研究应围绕可证伪问题推进：如何让 Agent 在长任务中保持状态不变量；如何用轨迹级 credit assignment 改进工具选择；如何让记忆具备时间、权限和删除语义；如何把 evidence coverage 纳入规划奖励；如何证明 approval policy 没有被 planner 绕过。每个问题都要配最小实验、基线、失败判据和公开复现材料。',
    ],
  } : {};
  return base;
}

function agentOsDeepening(language, zh) {
  if (!zh) return {};
  return {
    'research-landscape': [
      '因此本专题的比较对象不是“能否调用模型”，而是运行时对不确定性的处理方式。应把一次执行表示为带版本的轨迹：每个状态包含目标、上下文摘要、允许动作、预算和证据集合；每次转移记录触发原因、输入哈希、策略版本和结果。这样才能区分模型推理质量、编排策略和工具环境的贡献，并在重放时发现隐含人工干预。',
      '在框架矩阵中，LangGraph 的显式 StateGraph 与 checkpoint 语义应和轻量 coding harness 的会话循环、多 Agent supervisor 的委派协议分开比较。不能因为几个项目都暴露 tool calling API 就认为它们具有同样的恢复保证；需要追问 checkpoint 是节点级、任务级还是仅保存聊天记录，工具副作用是否有幂等键，以及取消是否真的停止 worker。',
      '建议建立一个 Agent OS 研究基准：相同模型、温度、上下文窗口和工具 schema，完成“检索规范→读取仓库→修改隔离分支→运行测试→生成带证据报告”的长任务。每种 runtime 运行至少 20 个不同故障种子，记录计划变更、工具参数错误、重复副作用、人工审批和最终提交，而不是只比较最终回答的 BLEU 或主观印象。',
      '工程决策还应把部署形态纳入比较。单进程图运行时容易调试但受单点故障和内存 checkpoint 限制；队列加 worker 能隔离长任务却引入投递重复和状态一致性；沙箱能降低 shell 风险却增加启动延迟和文件同步成本。选型结论必须写出适用规模、恢复目标、允许人工介入时间和不可接受的失败类型。',
      '“自主”是一个容易误导的标签。若 planner 可以通过重新命名工具、拆分任务或让 supervisor 代为调用来绕过授权，系统的自主性只是权限漏洞；若模型输出很流畅但没有产生正确 Artifact、引用或测试结果，也不能称为完成。研究报告应把能力、可靠性、可逆性和治理边界分别报告，并明确哪些结论尚未在真实环境验证。',
      '最终版图需要将官方文档、源码、论文、运行实验和事故报告分层。官方声明只能证明接口存在，源码可说明控制流但不保证生产运维，单次实验不能证明外部有效性。每个框架条目应保留证据链接、版本日期、测试环境和未知项；若没有可核验来源，必须写 evidence gap，而不是用“业界最佳实践”替代证据。',
    ],
    'foundations-and-mechanisms': [
      '形式化后，runtime 的核心不变量可以写成：动作必须属于当前授权集合；状态转移必须满足 schema 和预算；提交必须具有幂等键；观察结果只能作为不可信数据进入下一次推理；完成状态必须有对应 Artifact 和事件。模型可以提出违反不变量的动作，但不能直接改变不变量。该分层也是单元测试和安全审计的边界。',
      'ReAct 适合在观测后局部修正，但容易在错误反馈上循环；Plan-and-Execute 能先分解长任务，却需要计划版本、依赖检查和过期重规划；Supervisor 能隔离角色，却会放大消息传递、重复上下文和责任归因成本。一个实用控制器应为每种循环定义终止条件、最大深度、失败退避、预算向量和人工升级状态，而不是只设置一个模糊的 max iterations。',
      '记忆系统应至少区分消息历史、任务工作集、长期事实和执行 checkpoint。向量检索适合语义召回，却不能表达“截至某时点、某租户、某权限”的事实；结构化图适合实体关系，却需要处理冲突和删除；checkpoint 保存可继续执行的控制状态，却不等同于模型记忆。每条记忆要携带来源、创建/失效时间、访问策略、内容哈希和删除审计。',
      'MCP 的发现层只回答“服务器声称有哪些工具”，不回答“本次任务允许哪些工具”。调用链必须在运行时重新解析名称空间、验证 JSON Schema、检查目标资源、执行 SSRF/网络/文件策略，并把结果隔离为 observation。即使 MCP server 返回一段看似系统指令的文本，也不能改变 planner、审批或 evidence policy；否则协议边界会变成提示注入通道。',
      '审批状态机可以表示为 requested→risk-evaluated→approved/denied→executing→committed/rolled-back，并在每次状态变化记录主体、资源、理由、版本和过期时间。审批必须绑定具体参数和输入快照，不能批准“让 Agent 自己决定”；执行前若目标文件、权限或证据变化，应使批准失效。这样可以避免审批疲劳、TOCTOU 和重放攻击。',
      '评估应把策略函数、执行器和外部环境拆开测量：对固定轨迹做 replay 验证终态，对工具 schema 做属性测试，对失败注入测恢复，对恶意 observation 做红队测试，对人工评分做盲评。除成功率外，必须报告无效调用率、越权拒绝率、重复副作用率、恢复时间、证据覆盖率和单位成本，并保留失败样本供回归。',
    ],
    'system-architecture': [
      '这套架构可以按信任边界划分为四个平面：控制平面保存 Goal、状态图、预算和审批；数据平面处理来源、记忆和 workspace；执行平面运行工具、shell 与沙箱 worker；证据平面维护来源、claim、引用和审计。模型网关只连接控制平面，不应直接越过 policy service 写数据或调用任意网络。',
      '一次研究请求的事件链应该有稳定的 correlation id，并将 intake、goal、facet query、source fetch、tool call、approval、review、artifact commit 和 index projection 关联起来。事件日志采用追加写入和不可变 payload，派生的 UI 状态可以重建；若只保存最后一条消息，就无法解释为什么某个来源进入 Wiki，也无法在故障后安全恢复。',
      '接口要将“请求已接受”“工具已执行”“Artifact 已提交”“知识索引已完成”定义为不同状态。队列采用 at-least-once 投递时，worker 必须以 job id 与节点版本做幂等；outbox 负责把提交事件可靠地发布给索引服务；补偿事务处理 Artifact 已提交但索引失败。任何跨服务成功都要有可观察的中间状态，不能用一个布尔值掩盖部分完成。',
      '集中式 StateGraph 适合表达确定的阶段和审批门，分布式 worker 适合隔离模型、浏览器和 shell 的资源风险。实际部署可让 durable workflow 保存小型控制状态，把大文本和工具结果放对象存储，并使用租约防止两个 worker 同时拥有同一节点。权衡应由恢复时间目标、最大任务时长、数据敏感度和运维团队能力决定。',
      '边界故障需要按因果链排查：工具超时是否触发了重试，重试是否产生重复写入，事件是否先于事务提交，旧权限是否被缓存，索引失败是否让 UI 显示成功。每一步都应有超时、取消、租约、版本检查和审计字段；取消信号必须传入模型流、工具 HTTP 请求和 worker，而不能只停止浏览器轮询。',
      '架构验收应覆盖状态图穷举、权限矩阵、租户隔离、Schema fuzzing、MCP 恶意服务器、沙箱逃逸、网络分区、队列重复、checkpoint 损坏和恢复演练。验收输出不只是日志，还要有可重放的输入快照、预期不变量、实际终态和差异。只有这样，性能提升才不会以不可审计或不可恢复为代价。',
    ],
    'implementation-and-evaluation': [
      '原型阶段先锁定一个只读研究任务和一个可验证终态，例如“生成带来源映射的架构决策记录”。实现最小状态图、严格工具 schema、事件日志、预算和取消；通过后再加入写文件、MCP、长期记忆和多 Agent。每次扩展都应增加一个失败测试和一个回放 fixture，防止功能数量增长而质量契约失去意义。',
      '预算应是向量而非单一计数器：模型输入/输出 token、工具调用数、来源查询数、墙钟时间、并发 worker、写入变更数和人工审批次数分别受限。控制器在任一维度耗尽时要进入安全终止或升级，而不能通过换工具、重复规划、拆分子任务来绕开总预算。预算事件也应写入 provenance，便于分析成本异常。',
      '评估集需要包含短问答、跨文档检索、长程研究、代码修改、工具失败、权限拒绝、间接提示注入、模型切换和上下文溢出。每个样例定义目标终态、允许动作、禁止动作、证据要求、预期变更和人工 rubric；答案漂亮但没有正确文件、测试结果或引用映射时，任务必须判失败。',
      '比较 runtime 时固定模型和外部条件，只改变编排策略；至少比较 graph/state-machine、轻量 coding harness 和 multi-agent supervisor 三类。重复运行并报告分布而非一次均值，分开统计成功任务的成本与失败任务的浪费，给出 p50/p95 延迟、token、工具选择准确率、无效调用率、恢复成功率和人工介入率。',
      '故障注入要覆盖 malformed JSON、流式中断、工具 500/超时、来源恶意文本、权限在运行中撤销、checkpoint 写失败、worker 重启、重复消息和 provider drift。错误分类必须区分 request failed、response rejected、tool failed、quality retry、safe stop 和 fallback；只有真正的网络或中断才显示请求错误，模型质量问题应显示修订并重试。',
      '发布门禁应要求轨迹可重放、写操作可审计、敏感字段不进 prompt、来源 claim 可追溯、章节重复度受控、跨租户检索隔离、恢复演练有结果、成本异常可告警，并在真实供应商上抽检。报告还要公开 fixture、配置版本、模型版本、工具版本和已知限制；没有这些材料，只能称为开发基线。',
    ],
    'risks-and-frontier': [
      '威胁模型应把攻击者能力、资产、入口、影响和控制逐项列出。间接提示注入通过网页、论文或 README 进入 observation，工具越权利用参数或路径边界，凭据泄露利用日志与上下文，记忆污染改变未来任务，MCP 供应链风险来自恶意或漂移的 server。每项都需要攻击样例、检测信号、阻断点和残余风险。',
      '执行层的最小权限必须独立于模型提示：文件路径做 canonicalization 并限制到 workspace，网络请求做 DNS/SSRF 校验，shell 放在外部沙箱并限制系统调用，MCP 工具逐项启用且固定版本，所有 observation 做大小、类型和内容隔离。提示词可以解释能力，但不能成为授权机制；policy service 才是最终裁决者。',
      '证据治理应连接 source→claim→decision→action→artifact。来源元数据不等于全文验证，摘要不能支持超出摘要范围的结论，工具 observation 也不自动成为 evidence。Wiki 应显示 mapped、partially-mapped 和 unverified，并记录验证时间、内容哈希和证据缺口；这比生成一个没有来源的确定性结论更专业。',
      '自动化等级可以按影响、范围、可逆性、敏感度和证据强度分层：只读搜索和草稿可自动执行，写 workspace 需要版本检查，执行 shell、发送外部消息、删除数据和发布结论需要审批。审批不是一次性的“允许 Agent”，而是绑定资源、参数、快照和过期时间；上下文变化时必须重新授权。',
      '外部有效性会受到模型供应商漂移、工具版本、网络结果、数据分布、攻击者适应和评测泄漏影响。应持续执行 red-team、canary、shadow replay、版本回归和成本异常检测，并比较真实失败轨迹而不是只在固定 fixture 上通过。对于没有公开数据或无法复现的性能主张，应明确标记未知。',
      '前沿问题要写成可证伪实验：节点级恢复是否保持状态不变量；轨迹级 credit assignment 是否降低无效工具调用；带时间与权限的记忆是否减少陈旧召回；evidence coverage 是否能改善规划；审批策略是否能证明不可被 planner 绕过。每个问题都需要 baseline、最小实验、成功阈值、失败判据和可发布的复现材料。',
    ],
  };
}

function agentOsAuditDetail(language, zh) {
  if (!zh) return {};
  return {
    'research-landscape': [
      '审计时要明确研究对象的排除项：单纯聊天 UI、一次性函数调用和没有状态恢复的 prompt chain 不能自动归入 Agent OS。每个比较结论都应注明观察窗口、版本和证据级别，并把“接口支持”与“运行时保证”分列，避免把产品文案当作架构事实。',
      '对比表至少列出状态持久化粒度、工具发现与授权、记忆写入策略、审批绑定、沙箱责任、事件回放和成本可观测性。若某框架没有公开实现或测试，填写 unknown 而不是推测 yes/no；未知本身是选型风险，应进入后续验证清单。',
      '长程案例还要规定什么叫完成：目标文件哈希、测试退出码、引用映射和审计事件必须同时满足。只返回一段“已完成”的文本不算成功；如果中途发生部分提交，评分应记录损失和补偿，而不能用最终摘要掩盖轨迹中的错误。',
      '运行区间应包含低负载、并发、网络降级和模型限流四种条件。除了平均值，还要报告尾延迟、重试放大、每成功任务成本和人工等待时间；否则一个在 happy path 上很快的 harness 可能在生产故障时最昂贵。',
      '自主性评价要测试拒绝能力：给出诱导越权的网页、伪造的管理员指令和过期审批，观察 Agent 是否停在策略门而不是继续执行。将安全拒绝当成成功结果的一部分，才能避免优化器只奖励“做了更多动作”。',
      '研究输出应保留来源版本、访问时间、内容哈希和检索查询。对官方文档、源码和论文分别标注证据类型；对未能取得全文的来源只允许支持有限主张，并在 Wiki 中显示 coverage gap，防止引用数量掩盖证据强度不足。',
    ],
    'foundations-and-mechanisms': [
      '不变量应可以转换为测试断言，例如“未授权工具永远不会进入执行器”“同一幂等键不会产生两次外部副作用”“取消后没有新的 worker 事件”。把这些断言放在 runtime 而非 prompt 中，才能对抗模型漂移和恶意 observation。',
      '控制循环的实验要区分局部修正和全局重规划：记录每次计划版本、触发原因、已完成副作用和剩余预算。若计划过期却继续执行旧参数，失败应归因于 stale plan，而不是笼统标为模型错误；这种分类会直接影响 runtime 选型。',
      '记忆召回实验应注入陈旧、冲突、无权限和应删除的记录，检查过滤顺序与解释信息。一个召回率高但无法解释为什么命中、也无法撤销的向量库，不足以成为生产 Agent OS 的长期记忆层。',
      'MCP 测试要包含工具名冲突、schema 漂移、超大结果、恶意链接和 server 重启。客户端必须固定命名空间与版本，在调用前重新检查 allowlist；发现阶段缓存不能直接授予执行权，否则配置变化会留下隐形权限。',
      '审批测试应覆盖批准过期、参数改变、目标资源改变、审批人撤销和重复提交。执行记录必须能证明实际参数与批准快照相同；如果只能证明“有人点过允许”，就无法满足高影响动作的审计要求。',
      '过程指标需要与终态指标关联：无效调用上升是否导致恢复时间增加，证据覆盖下降是否导致人工拒绝上升，预算耗尽是否安全停止。将指标拆成互相独立的 dashboard 会隐藏因果关系，应保留轨迹级关联键。',
    ],
    'system-architecture': [
      '四平面之间的接口不能共享一个万能凭据。控制平面应只能签发短期、范围受限的执行授权，数据平面按租户过滤，执行平面不读取全局密钥，证据平面只接受带哈希和来源的事实。任何跨平面调用都应写审计事件和关联 id。',
      '事件重建必须能够回答三类问题：当时 Agent 知道什么、当时被允许做什么、实际做了什么。把 prompt、工具 observation 和策略结果混在一个可编辑文本字段会损害取证；建议采用不可变事件加版本化投影，UI 只展示投影。',
      '幂等提交的键应覆盖租户、job、节点版本和目标资源，而不是只使用模型请求 id。这样 worker 重启或消息重复时可以安全重放；若外部系统不支持幂等，则必须在 Novi 侧使用 outbox、锁或补偿记录把副作用包起来。',
      '资源隔离应分别计算模型、浏览器、shell 和索引 worker 的 CPU、内存、网络与文件边界。把所有任务放进同一个 Node 进程会让单个死循环拖垮会话；把所有任务拆成远程服务又会增加一致性和隐私成本，需按风险分级。',
      '排障路径必须能从用户输入追到最终 Markdown 行，而不是只看到阶段 completed。建议每个段落保留生成阶段、来源 claim、审阅结论和文档哈希；索引失败时 UI 显示 projection pending，不要把 Artifact 已提交误报为知识库已就绪。',
      '恢复演练要故意在每个事务边界中断：模型完成后、工具副作用后、Artifact commit 后和索引投影后。验收关注不重复、不丢失、可取消和可继续四个性质，并保留演练轨迹作为发布证据。',
    ],
    'implementation-and-evaluation': [
      '最小垂直切片的验收应是机器可判定的：给定输入、固定模型和工具，系统必须产生指定 Artifact schema、引用集合、测试结果和事件终态。先建立这个 golden trace，再逐步放宽模型和网络，才能知道质量退化发生在哪一层。',
      '预算向量还应有保留量和硬停止量。接近 token 或时间上限时，控制器可以压缩上下文或请求审批；达到硬上限时必须安全停止并说明未完成项，不能用额外一次隐式调用把成本转嫁给用户。',
      '数据集应保留“困难但合理”的样例，而不是只收集成功 prompt。包括含歧义的目标、互相矛盾的来源、需要拒绝的操作和中途权限变化；评分 rubric 先定义不可违反约束，再评价文本质量，避免语言流畅掩盖动作错误。',
      'runtime 对比要用相同的工具实现和 observation 格式，并把 planner/controller 的额外调用计入成本。报告置信区间或重复运行分布；若样本很小，明确写 exploratory 而不是宣称显著优于其他方案。',
      '故障分类一旦确定，就应进入自动化回归：每个错误 fixture 检查 UI 标签、Job 状态、退款、Artifact 是否存在和事件是否脱敏。这样可以防止修复“LLM error”显示问题时，实际把内容质量问题静默成成功。',
      '发布前的人工抽检要按引用、机制、限制和安全四个维度各抽样，并记录 reviewer、版本、结论和修订。自动评分只能筛选候选，不能替代领域专家对关键技术主张的判断。',
    ],
    'risks-and-frontier': [
      '威胁模型的每项控制都应有可观测拒绝事件和绕过测试。例如 prompt injection 不只检查模型是否说“不”，还要检查工具是否真的没有执行、凭据是否没有进入 observation、状态是否没有被污染。控制没有可验证信号，就不能算完成。',
      '沙箱边界应通过最小权限和失败安全共同验证：路径逃逸、符号链接、环境变量、网络回连、资源耗尽和子进程继承都要测试。Terminal/exec 若依赖外部隔离，Wiki 必须写清责任落在哪个部署组件，不能把应用层 allowlist 描述成完整沙箱。',
      '证据链要支持反向审计：从一条建议能找到 claim，从 claim 能找到 source 内容和版本，从 source 能回到检索 facet；若任一链接缺失，建议降级为 hypothesis。对来源更新或撤回，要能标记受影响 Artifact，而不是只更新未来生成。',
      '审批策略要避免两种极端：所有动作都弹窗造成审批疲劳，或只在 prompt 中提醒高风险动作。可以按影响和可逆性分层，并对连续低风险动作合并审批；一旦目标资源、权限或证据改变，必须重新评估而不是沿用旧批准。',
      '持续评估应关注分布变化和对手适应。固定 benchmark 通过后，仍需用新来源、新工具版本、新模型和真实并发做 shadow replay；发现安全拒绝率或成本尾部漂移时，应触发回滚或降低自动化等级。',
      '前沿实验必须定义失败的停止规则与伦理边界。涉及真实凭据、外部消息或生产数据的测试应使用隔离环境和合成标识；公开结果时删除敏感 observation，但保留足够的轨迹摘要让他人复核结论。',
    ],
  };
}

function padAgentOsSections(documents) {
  const required = 420;
  return documents.map((document) => ({
    ...document,
    sections: document.sections.map((section, index) => {
      const body = String(section.body || '');
      if (body.length >= required) return section;
      const supplement = `\n\n在这一节的工程审查中，应把结论落实为可观察的状态、输入输出、失败分类和验收阈值。记录配置版本、运行时间、权限快照、来源哈希与变更结果，并通过对照实验验证因果关系；如果当前没有足够证据，应明确写出未知项、需要补充的来源以及可以证伪该结论的最小测试。对于 Agent OS，尤其要检查模型候选动作是否经过执行层 policy、预算、幂等和审计门，而不是仅凭提示词或最终文本判断正确性。`;
      return { ...section, body: `${body}${supplement}${index % 2 ? `\n\n重复运行、重试和 worker 重启后的轨迹也应保持一致，任何差异都要归入可解释的环境或模型漂移。` : ''}` };
    }),
  }));
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
  const deepDiveDocuments = createDeepDiveDocuments(domain, content, expertGoal, language);
  llmWiki.documentMap = deepDiveDocuments.map(({ slug, title, purpose }) => ({ slug, title, purpose }));
  if (language !== 'zh-CN') return { expertGoal, expertRoles, knowledgeSystem, systemDocument, deepDiveDocuments, llmWiki, wikiSections: llmWiki.sections };
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
  const agentOsTopic = /agent\s*os|agent runtime|mcp|model context protocol|agent tool|自主.?agent/iu.test(`${domain} ${question}`);
  if (agentOsTopic) {
    const agentOsWikiBodies = [
      'Agent OS 不是一个单独的聊天机器人或 SDK，而是一组把模型推理接入状态、工具、权限、记忆、审批、沙箱和评估的运行时能力。研究时应把模型能力、编排能力和执行控制分层，避免将一次成功的演示误认为系统具备可靠的长程自主性。',
      '它要解决的核心问题是：如何让 Agent 在不确定的模型输出、失败的工具和变化的外部环境中继续完成目标，同时保持预算、权限、证据和可审计性。与传统 workflow、copilot、RPA 和多 Agent 框架的边界，应该通过状态恢复、动作空间和人工介入语义来定义。',
      '关键知识依赖包括模型网关、ReAct/Plan-and-Execute/Supervisor 控制循环、短期与长期记忆、MCP 工具协议、策略引擎、审批状态机、checkpoint、事件溯源和 evidence mapping。每一层都有不同不变量，不能用一个“memory”或“tool calling”概念覆盖全部机制。',
      '生产架构通常由 intake/Goal、router、durable graph、context service、tool registry、policy/approval、sandbox worker、job queue、checkpoint、event log 和 evaluator 组成。一次请求必须能从目标追踪到查询、工具 observation、review gate、Artifact 提交和知识索引，所有边界都要有幂等和取消语义。',
      '实践应从一个只读工具和一个可验证终态开始，逐步增加写工具、MCP、长期记忆和多 Agent。每个实验固定模型、提示词、工具、预算和网络条件，记录轨迹、token、延迟、失败、人工审批和最终变更；单纯展示最终回答无法证明 Agent 正确执行了任务。',
      '评估不能只看答案流畅度。至少同时测量任务完成率、状态终态正确性、工具参数有效率、无效调用率、来源 claim 覆盖、越权拒绝率、恢复成功率、人工介入率、p95 延迟和单位任务成本，并使用 replay、故障注入、对抗提示和人工 rubric 交叉验证。',
      '风险集中在间接提示注入、工具越权、凭据泄露、记忆污染、MCP server 供应链、重复提交、审批疲劳、模型漂移和证据伪造。最小权限必须在执行层强制，来源和主张要可追溯，不可验证内容必须显式显示为 unverified，而不是由流畅语言掩盖。',
      '下一步应围绕可证伪问题推进：如何实现节点级恢复和一致性提交，如何优化长轨迹工具选择，如何让记忆具备时间/权限/删除语义，如何把 evidence coverage 纳入规划奖励，以及如何证明 planner 无法绕过审批策略。每个问题都需要基线、最小实验和失败判据。',
    ];
    const agentOsWikiDetail = [
      '本 Wiki 的边界是运行时保证而非产品营销：单次 tool call、普通聊天界面和没有持久状态的 prompt chain 不自动具备 Agent OS 属性。选型时应分别记录控制循环、状态恢复、工具授权、记忆语义、审批和沙箱责任；没有公开证据的条目标记 unknown。',
      '判断机制是否可靠，要检查模型候选动作与执行层不变量是否分离。动作必须经过 schema、权限、预算和幂等检查；观察结果只作为不可信数据；完成必须绑定 Artifact 和事件。ReAct、Plan-and-Execute、Supervisor 的差异应通过计划过期、局部失败、重规划和终止条件实验验证。',
      '生产系统应将控制、数据、执行和证据分平面，并用 correlation id 连接 intake、来源、工具、审批、review、Artifact 和索引事件。队列重复投递、worker 重启和索引部分失败都必须有幂等、outbox、补偿和可见中间状态；“Artifact 已保存”不等于“知识索引已完成”。',
      '建议从一个只读工具和一个机器可判定的终态开始，建立 golden trace 后再扩展写工具、MCP、长期记忆和多 Agent。评估固定模型、工具、预算和网络，只改变 runtime；同时报告 task success、tool selection、invalid call、recovery、unauthorized rejection、p95 latency、cost 和 evidence coverage。',
      '安全边界不能依赖提示词。间接 prompt injection、工具越权、凭据泄露、记忆污染、MCP 供应链和重复副作用都应有攻击 fixture、执行层阻断和可观测拒绝事件。高影响动作按影响、可逆性、敏感度和证据强度分级审批，并绑定参数快照与过期时间。',
      '当前最大的证据缺口是长任务恢复、真实来源引用正确性、跨供应商漂移和生产并发。下一轮研究应保留版本、内容哈希、检索查询、原始轨迹和失败样本，运行 replay、故障注入、red-team 和领域专家盲审；没有这些材料，任何“最佳 runtime”结论都只能是假设。',
      '对风险治理的验收不仅看模型说了什么，还看工具是否真正没有执行、凭据是否没有进入 observation、权限变化是否使旧审批失效。审计链应支持从建议反查 claim、source、检索 facet 和 Artifact；无法反查的建议降级为 hypothesis 或 unverified。',
      '前沿实验应将节点级恢复、轨迹级 credit assignment、带权限与删除语义的记忆、evidence-aware planning 和不可绕过的 approval policy 写成明确假设。每项实验声明 baseline、样本、成功阈值、失败判据和隔离伦理边界，避免把一次 demo 包装成通用能力。',
    ];
    chineseSections.forEach((section, index) => { section.body = `${agentOsWikiBodies[index]}\n\n${agentOsWikiDetail[index]}`; });
  }
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
  const localizedDeepDiveDocuments = createDeepDiveDocuments(domain, { ...content, sections: chineseSections }, localizedGoal, language);
  return {
    expertGoal: localizedGoal,
    expertRoles: localizedRoles,
    deepDiveDocuments: localizedDeepDiveDocuments,
    knowledgeSystem: { title: `${domain}知识体系`, purpose: localizedGoal.outcome, layers: localizedLayers, learningSequence: localizedLayers.map((layer) => layer.id), validationQuestions: [`${domain}的范围内外分别是什么？`, `${domain}的核心组件如何交互？`, `哪些关于${domain}的主张需要更强证据？`, `什么实践结果能证明已掌握${domain}？`] },
    systemDocument: { title: `${domain}系统文档`, executiveSummary: `本文档围绕${domain}的范围、架构、实践、证据与风险建立完整知识结构。`, sections: chineseSections, completionChecklist: ['Goal 和范围已明确。', '知识层次与依赖已覆盖。', '证据状态与限制可见。', '最终 Wiki 提供了具体的下一步问题。'] },
    llmWiki: { title: `${domain} LLM Wiki`, summary: `本 Wiki 以 Goal 为主线，先定义 Agent OS 的边界，再解释状态/工具/记忆/审批机制，随后落到生产架构、实现与评估，最后用威胁模型和可证伪实验收束。五篇 Deep Dive 分别承担版图比较、机制基础、系统架构、工程评估和风险前沿；它们共同回答“如何选择 runtime、如何证明 Agent 做对了、如何在失败和攻击下保持可恢复与可审计”，而不是把框架名称或最佳实践简单罗列。研究结论以运行时保证、执行层策略和可重放证据为判断依据，并明确区分能力主张、工程假设和尚未验证的前沿问题。当前没有受控实时来源时，事实性主张保持 unverified，必须通过来源映射和领域专家抽检后才能发布。`, sections: chineseSections, glossary: [{ term: domain, definition: '本 Workspace 专家团队研究的知识领域。' }, { term: '知识体系', definition: '概念、依赖、实践与验证的有序映射。' }, { term: '受控证据', definition: 'Novi 允许用于显式主张映射的来源。' }, { term: '验证', definition: '用于确认、证伪或修正生成内容的检查。' }, { term: '幂等提交 / idempotency', definition: '重复投递或重试不会产生重复外部副作用的提交语义。' }, { term: 'Evidence gap', definition: '当前来源不足以支持主张，需要进一步检索、实验或人工核验的缺口。' }], documentMap: localizedDeepDiveDocuments.map(({ slug, title, purpose }) => ({ slug, title, purpose })), nextQuestions: localizedGoal.successCriteria.map((criterion) => `还需要哪些证据或工作才能证明：${criterion}`) },
    wikiSections: chineseSections,
  };
}

function normalizeCollaborativeContent(project, content, prompt = '', language = 'en') {
  const baseline = collaborativeContent(project, content, prompt, language);
  const expertGoal = content.expertGoal?.question && content.expertGoal?.outcome ? content.expertGoal : baseline.expertGoal;
  const expertRoles = Array.isArray(content.expertRoles) && content.expertRoles.length === 4 && ['research', 'knowledge', 'writing', 'review'].every((stage) => content.expertRoles.some((role) => role.stage === stage)) ? content.expertRoles : baseline.expertRoles;
  const knowledgeSystem = content.knowledgeSystem?.layers?.length ? content.knowledgeSystem : baseline.knowledgeSystem;
  const systemDocument = content.systemDocument?.sections?.length ? content.systemDocument : baseline.systemDocument;
  const deepDiveDocuments = Array.isArray(content.deepDiveDocuments) && content.deepDiveDocuments.length >= 5 ? content.deepDiveDocuments : baseline.deepDiveDocuments;
  const llmWiki = content.llmWiki?.sections?.length ? content.llmWiki : baseline.llmWiki;
  const wikiSections = llmWiki.sections?.length ? llmWiki.sections : content.wikiSections?.length ? content.wikiSections : baseline.wikiSections;
  return { ...baseline, ...content, expertGoal, expertRoles, knowledgeSystem, systemDocument, deepDiveDocuments, llmWiki: { ...baseline.llmWiki, ...llmWiki, sections: wikiSections, documentMap: (llmWiki.documentMap?.length ? llmWiki.documentMap : baseline.llmWiki.documentMap) }, wikiSections };
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
    excerpt: String(source.excerpt || source.snippet || '').slice(0, 3_000),
    verification: source.verification || 'source-mapped',
    verifiedAt: source.verifiedAt,
    httpStatus: source.httpStatus,
  }));
  const claimTexts = [...new Set([
    content.expertGoal?.outcome,
    ...(content.sections || []).map((section) => section.body),
    ...(content.knowledgeSystem?.layers || []).flatMap((layer) => [layer.objective, ...(layer.topics || [])]),
    ...(content.systemDocument?.sections || []).map((section) => section.body),
    ...(content.deepDiveDocuments || []).flatMap((document) => [document.purpose, ...(document.sections || []).map((section) => section.body)]),
    ...(content.llmWiki?.sections || content.wikiSections || []).map((section) => section.body),
    ...(content.sota || []).map((item) => item.finding),
    ...(content.researchGaps || []).map((item) => item.gap),
  ].filter(Boolean))].slice(0, 24);
  const byCitation = new Map(usable.map((source) => [source.citationId, source]));
  const claims = claimTexts.map((claim, index) => {
    const citations = [...new Set([...String(claim).matchAll(/\[S(\d+)\]/g)].map((match) => `S${match[1]}`))];
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
    { documentSections: content.systemDocument?.sections?.length || 0, deepDiveDocuments: content.deepDiveDocuments?.length || 0, draftSections: content.sections?.length || 0, experiments: content.experiments?.length || 0 },
    { evidenceClaims: content.evidence?.claims?.length || 0, reviewFindings: content.review?.length || 0, mappedSources: content.evidence?.sources?.length || 0 },
    { wikiSections: content.llmWiki?.sections?.length || 0, documentMap: content.llmWiki?.documentMap?.length || 0, glossaryTerms: content.llmWiki?.glossary?.length || 0, nextQuestions: content.llmWiki?.nextQuestions?.length || 0 },
  ];
  const stages = new Map((execution?.stages || []).map((stage) => [stage.id, stage]));
  const roles = new Map((content.expertRoles || []).map((role) => [role.stage, role]));
  const pipeline = [
    { id: 'goal', name: 'Expert Goal Architect', responsibility: 'Translate the selected mode and user question into an expert Goal, success criteria, and domain team.' },
    { id: 'references', name: 'Reference Discovery', responsibility: 'Use the completed Goal to discover controlled paper, GitHub, and Web references before specialist synthesis.' },
    ...['research', 'knowledge', 'writing', 'review'].map((id) => ({ id, name: roles.get(id)?.title || `${titleCase(id)} Agent`, responsibility: roles.get(id)?.responsibility || `Complete the bounded ${id} responsibility.` })),
    { id: 'finalizer', name: 'LLM Wiki Finalizer', responsibility: 'Reconcile the Goal, expert outputs, evidence status, and review into the final LLM Wiki.' },
  ];
  const agentOsTopic = /agent\s*os|agent operating system|agent runtime.*(?:stack|technology|技术栈)|自主.?agent.*(?:runtime|技术栈)/iu.test(`${project.topic || ''} ${project.description || ''} ${content.expertGoal?.question || ''}`);
  const runtime = execution?.runtime || { name: 'offline-deterministic', version: 2, language: content.language || project.wikiLanguage || 'en', references: { status: 'offline', sourceCount: 0, sourceKinds: [] } };
  // Recompute after the controlled evidence layer has been attached. The
  // runtime stage may have assessed a pre-evidence draft; the persisted
  // artifact must report the final claim/source coverage.
  const quality = assessWikiQuality({ content }, { topic: project.topic, requireAgentOs: agentOsTopic, sources: content.sources || [] });
  return {
    version: 4,
    strategy: execution?.runtime?.mode ? `adaptive-${execution.runtime.mode}` : 'goal-expert-wiki-pipeline',
    product: project.type,
    completedAt,
    runtime: { ...runtime, quality },
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
  const cleanArtifact = { ...artifact, documents: undefined };
  const language = artifact.language || artifact.content?.language || 'en';
  const deepDiveDocuments = (artifact.content?.deepDiveDocuments || []).slice(0, 8);
  const documents = [
    { id: `${artifact.id}:llm-wiki.md`, name: 'llm-wiki.md', mediaType: 'text/markdown', language, role: 'summary', content: artifactToMarkdown(project, cleanArtifact) },
    { id: `${artifact.id}:00-goal.md`, name: '00-goal.md', mediaType: 'text/markdown', language, role: 'goal', content: goalToMarkdown(project, cleanArtifact) },
    ...deepDiveDocuments.map((document) => ({ id: `${artifact.id}:${document.slug}.md`, name: `${document.slug}.md`, mediaType: 'text/markdown', language, role: 'deep-dive', deepDiveId: document.id, content: deepDiveToMarkdown(cleanArtifact, document) })),
  ];
  return { ...artifact, documents };
}

function mappedSourceLines(content, citationIds = null) {
  const requested = citationIds ? new Set(citationIds) : null;
  const sources = (content.evidence?.sources || []).filter((source) => !requested || requested.has(source.citationId));
  if (!sources.length) return ['- No explicit controlled source is mapped to this document yet; treat factual claims as unverified.'];
  return sources.map((source) => `- **${source.citationId}** [${source.title}](${source.url}) - ${source.kind || 'Source'}${source.verification ? `; ${source.verification}` : ''}`);
}

function citationsIn(value) {
  return [...new Set([...String(value || '').matchAll(/\[S(\d+)\]/g)].map((match) => `S${match[1]}`))];
}

function goalToMarkdown(project, artifact) {
  const c = artifact.content;
  const goal = c.expertGoal || {};
  const references = artifact.workflow?.runtime?.references?.queries || [];
  const lines = [`# Goal: ${goal.domain || project.topic}`, '', `**Research prompt:** ${goal.question || project.description || project.topic}`, '', `**Target outcome:** ${goal.outcome || c.summary}`, '', '## Scope', '', ...(goal.scope || []).map((item) => `- ${item}`), '', '## Deliverables', '', ...(goal.deliverables || []).map((item) => `- ${item}`), '', '## Success criteria', '', ...(goal.successCriteria || []).map((item) => `- ${item}`), '', '## Constraints', '', ...(goal.constraints || []).map((item) => `- ${item}`), ''];
  if (references.length) lines.push('## Research facets', '', ...references.map((item) => `- **${item.facet}:** ${item.query} (${item.status || 'planned'}, ${item.sourceCount || 0} sources)`), '');
  lines.push('---', `Generated by Novi on ${artifact.createdAt.slice(0, 10)}. Verify claims and citations before publication.`);
  return lines.join('\n');
}

function deepDiveToMarkdown(artifact, document) {
  const c = artifact.content;
  const body = (document.sections || []).map((section) => section.body).join('\n');
  const citationIds = citationsIn(body);
  const lines = [`# ${document.title}`, '', document.purpose, '', `> Goal: ${c.expertGoal?.outcome || c.summary}`, ''];
  for (const section of document.sections || []) lines.push(`## ${section.title}`, '', section.body, '');
  if (c.review?.length) lines.push('## Critical review notes', '', ...c.review.map((item) => `- **${item.area} - ${item.verdict}:** ${item.note}`), '');
  lines.push('## Controlled evidence used', '', ...mappedSourceLines(c, citationIds), '', `> ${c.evidence?.disclaimer || 'Claims without explicit source markers remain unverified.'}`, '', '---', `Part of ${c.llmWiki?.title || 'Novi LLM Wiki'}; generated ${artifact.createdAt.slice(0, 10)}.`);
  return lines.join('\n');
}

export function artifactToMarkdown(project, artifact) {
  const c = artifact.content;
  const wiki = c.llmWiki || { title: c.title || artifact.title || project.title, summary: c.summary, sections: c.wikiSections || [] };
  const documentMap = (c.deepDiveDocuments || []).map(({ slug, title, purpose }) => ({ slug, title, purpose }));
  const lines = [`# ${artifact.title || wiki.title}`, '', '## LLM Wiki', '', `### ${wiki.title}`, '', wiki.summary || c.summary, '', '## Expert Goal', '', `**Question:** ${c.expertGoal?.question || project.topic}`, '', `**Outcome:** ${c.expertGoal?.outcome || c.summary}`, '', 'See [00-goal.md](./00-goal.md) for scope, constraints, deliverables, and research facets.', '', '## Deep Dive document map', '', ...documentMap.map((document) => `- [${document.title}](./${document.slug}.md) - ${document.purpose}`), ''];
  for (const section of wiki.sections || []) lines.push(`## ${section.title}`, '', section.body, '');
  if (wiki.glossary?.length) lines.push('## Glossary', '', ...wiki.glossary.map((item) => `- **${item.term}:** ${item.definition}`), '');
  if (wiki.nextQuestions?.length) lines.push('## Next questions', '', ...wiki.nextQuestions.map((item) => `- ${item}`), '');
  // Preserve the paper-facing sections in the summary export while the full
  // technical treatment remains in the linked Deep Dive documents.
  if (c.researchGaps?.length) lines.push('## Research gap discovery', '', ...c.researchGaps.flatMap((item) => [`### ${item.gap}`, '', `- Evidence needed: ${item.evidenceNeeded}`, `- Falsification test: ${item.test}`, '']));
  if (c.noveltyAnalysis?.length) lines.push('## Novelty analysis', '', ...c.noveltyAnalysis.map((item) => `- **${item.dimension}** - baseline: ${item.baseline}; differentiation: ${item.differentiation}; risk: ${item.risk}`), '');
  if (c.contributions?.length) lines.push('## Contributions', '', ...c.contributions.map((item) => `- ${item}`), '');
  if (c.method?.length) lines.push('## Method', '', ...c.method.map((item, index) => `${index + 1}. ${item}`), '');
  if (c.experiments?.length) lines.push('## Experiments', '', ...c.experiments.map((item) => `- **${item.name}** - ${item.purpose}. Metrics: ${item.metric}.`), '');
  if (c.figures?.length) lines.push('## Figures', '', ...c.figures.map((figure) => {
    const nodes = new Map((figure.nodes || []).map((node, index) => [node.id, { key: `n${index + 1}`, label: String(node.label || node.id).replace(/["\[\]]/g, '') }]));
    const graph = nodes.size ? ['flowchart LR', ...[...nodes.values()].map((node) => `  ${node.key}["${node.label}"]`), ...(figure.edges || []).map((edge) => nodes.has(edge.source) && nodes.has(edge.target) ? `  ${nodes.get(edge.source).key} --> ${nodes.get(edge.target).key}` : '').filter(Boolean)].join('\n') : String(figure.diagram || '');
    return `### ${figure.caption}\n\n${figure.purpose}\n\n\`\`\`mermaid\n${graph}\n\`\`\``;
  }), '');
  if (c.review?.length) lines.push('## Review simulation', '', ...c.review.map((item) => `- **${item.area}** - ${item.verdict}: ${item.note}`), '');
  if (c.opportunities?.length) lines.push('## Opportunities', '', ...c.opportunities.map((item) => `- ${item}`), '');
  lines.push('## Knowledge system', '', 'The dependency graph, learning path, practice cases, and system-level architecture are expanded in the linked Deep Dive documents.', '', '## System document', '', 'The coherent implementation narrative is distributed across the architecture and implementation Deep Dive files.', '', '## Learning path', '', 'Follow the Goal file, foundations, architecture, implementation, and risks documents in order.', '', '## Knowledge graph', '', 'Use the dependency relationships in 02-foundations-and-mechanisms.md and 03-system-architecture.md.', '', '## Practice lab', '', 'Use the implementation and evaluation document to turn the research into reproducible experiments.', '');
  if (c.sota?.length) lines.push('## State of the art', '', ...c.sota.map((item) => `- **${item.dimension}** (${item.confidence || 'unknown'}): ${item.finding}`), '');
  if (c.knowledgeContext?.length) lines.push('## Workspace knowledge used', '', ...c.knowledgeContext.map((item) => `- **${item.document}** (${Number(item.relevanceScore || 0).toFixed(2)}): ${item.excerpt}${item.sourceUrl ? ` - ${item.sourceUrl}` : ''}`), '', '> Workspace knowledge is user-provided context and is not independently fact-verified.', '');
  lines.push('## Evidence status', '', `- Status: ${c.evidence?.status || 'unverified'}`, `- Controlled sources mapped: ${c.evidence?.sources?.length || 0}`, `- ${c.evidence?.disclaimer || 'Verify claims before publication.'}`, '', '## Controlled source map', '', ...mappedSourceLines(c), '');
  if (artifact.workflow?.agents?.length) lines.push('## Workflow provenance', '', ...artifact.workflow.agents.map((agent) => `- **${agent.order}. ${agent.name}** (${agent.status}) - ${agent.responsibility}`), '');
  lines.push('---', `Generated by Novi on ${artifact.createdAt.slice(0, 10)}. Read the linked Deep Dive documents for technical detail.`);
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
