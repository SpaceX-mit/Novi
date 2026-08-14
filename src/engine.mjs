import { createHash, randomUUID } from 'node:crypto';
import { runAgentWorkflow } from './agent-runtime.mjs';
import { completeArtifact } from './model.mjs';

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

function evidenceFor(content, sources = []) {
  const usable = sources.filter((source) => {
    try { const url = new URL(String(source?.url || '')); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && source.mapped === true && source.verification !== 'unreachable' && source.status !== 'unreachable'; }
    catch { return false; }
  }).map((source, index) => ({
    id: `source-${index + 1}`,
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
  const claimTexts = [
    ...(content.sections || []).map((section) => section.body),
    ...(content.wikiSections || []).map((section) => section.body),
    ...(content.sota || []).map((item) => item.finding),
    ...(content.researchGaps || []).map((item) => item.gap),
  ].filter(Boolean).slice(0, 24);
  const claims = claimTexts.map((claim, index) => ({
    id: `claim-${index + 1}`,
    text: claim,
    evidenceIds: usable.length ? [usable[index % usable.length].id] : [],
    verification: usable.length ? 'source-mapped' : 'unverified',
  }));
  return { status: usable.length ? 'source-mapped' : 'unverified', sources: usable, claims, disclaimer: 'Source mapping is not fact verification. Review claims and citations before publication.' };
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

const AGENT_PIPELINE = Object.freeze([
  ['Research Agent', 'Collect and rank evidence, frame the problem, and identify research gaps.'],
  ['Knowledge Agent', 'Structure concepts into a wiki, learning path, graph, and retrievable memory.'],
  ['Writing Agent', 'Synthesize the selected product artifact without changing controlled sources.'],
  ['Review Agent', 'Map claims to evidence, surface limitations, and produce quality-review findings.'],
]);

function workflowFor(project, content, completedAt, execution = null) {
  const outputCounts = [
    { sources: content.sources?.length || 0, researchGaps: content.researchGaps?.length || 0, sotaDimensions: content.sota?.length || 0 },
    { wikiSections: (content.wikiSections || content.sections || []).length, graphNodes: content.graph?.nodes?.length || 0, knowledgePassages: content.knowledgeContext?.length || 0 },
    { draftSections: content.sections?.length || 0, methodSteps: content.method?.length || 0, experiments: content.experiments?.length || 0 },
    { evidenceClaims: content.evidence?.claims?.length || 0, reviewFindings: content.review?.length || 0, mappedSources: content.evidence?.sources?.length || 0 },
  ];
  const stages = new Map((execution?.stages || []).map((stage) => [stage.id, stage]));
  return {
    version: 1,
    strategy: execution?.runtime?.mode ? `adaptive-${execution.runtime.mode}` : 'bounded-four-stage-pipeline',
    product: project.type,
    completedAt,
    runtime: execution?.runtime || { name: 'offline-deterministic', version: 1 },
    agents: AGENT_PIPELINE.map(([name, responsibility], index) => {
      const stage = stages.get(['research', 'knowledge', 'writing', 'review'][index]);
      return { order: index + 1, name, responsibility, status: stage?.status || (execution ? 'not-run' : 'completed'), outputs: outputCounts[index], ...(stage ? { startedAt: stage.startedAt, completedAt: stage.completedAt, usage: stage.usage, ...(stage.error ? { error: stage.error } : {}) } : {}) };
    }),
  };
}

export function generateArtifact(project, options = {}) {
  const content = project.type === 'research'
    ? researchArtifact(project.topic)
    : project.type === 'paper'
      ? paperArtifact(project.topic, project.description)
      : knowledgeArtifact(project.topic);
  if (options.sources?.length) content.sources = options.sources;
  const sources = content.sources || [];
  const knowledgeContext = boundedKnowledgeContext(options.knowledgeContext);
  const createdAt = new Date().toISOString();
  const finalContent = { ...content, knowledgeContext, evidence: evidenceFor(content, sources) };
  return {
    id: randomUUID(),
    type: project.type,
    title: artifactDefinitions[project.type].label,
    createdAt,
    content: finalContent,
    workflow: workflowFor(project, finalContent, createdAt),
  };
}

export async function generateArtifactAsync(project, options = {}) {
  const fallback = generateArtifact(project, options);
  let artifact;
  let execution = null;
  if (options.providerConfig) {
    execution = await runAgentWorkflow(project, fallback, options.providerConfig, { sources: options.sources || fallback.content.sources || [], knowledgeContext: fallback.content.knowledgeContext || [], prompt: options.prompt, mode: options.mode, onStage: options.onStage, onMode: options.onMode, threadId: options.threadId });
    artifact = { ...fallback, content: execution.content, model: options.providerConfig.model };
  } else artifact = await completeArtifact(project, fallback, options.sources || fallback.content.sources || [], fallback.content.knowledgeContext || []);
  const sources = artifact.content.sources || [];
  const content = { ...artifact.content, sources: fallback.content.sources, knowledgeContext: fallback.content.knowledgeContext, evidence: evidenceFor(artifact.content, sources) };
  return { ...artifact, content, workflow: workflowFor(project, content, artifact.createdAt, execution) };
}

export function artifactToMarkdown(project, artifact) {
  const c = artifact.content;
  const evidenceById = new Map((c.evidence?.sources || []).map((source) => [source.id, source]));
  const markdownLink = (source) => `[${source.title || source.name}](${source.url})`;
  const lines = [`# ${c.title || artifact.title || project.title}`, '', c.summary, ''];
  if (c.abstract) lines.push('## Abstract', '', c.abstract, '');
  for (const section of c.sections || []) lines.push(`## ${section.title}`, '', section.body, '');
  if (c.wikiSections?.length) lines.push('## LLM Wiki', '', ...c.wikiSections.flatMap((section) => [`### ${section.title}`, '', section.body, '']));
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
  if (c.sources) lines.push('## Source map', '', ...c.sources.map((x) => `- [${x.name}](${x.url}) - ${x.kind}`), '');
  if (artifact.workflow?.agents?.length) lines.push('## Workflow provenance', '', ...artifact.workflow.agents.map((agent) => `- **${agent.order}. ${agent.name}** (${agent.status}) — ${agent.responsibility}`), '');
  lines.push('---', `Generated by Novi on ${artifact.createdAt.slice(0, 10)}. Verify claims and citations before publication.`);
  return lines.join('\n');
}

export function artifactToLatex(project, artifact, template = 'article') {
  if (template === 'ieee') return artifactToLatex(project, artifact, 'article').replace('\\documentclass{article}', '\\documentclass[conference]{IEEEtran}').replace('\n\\usepackage[margin=1in]{geometry}', '');
  if (template === 'acm') return artifactToLatex(project, artifact, 'article').replace('\\documentclass{article}', '\\documentclass[sigconf]{acmart}').replace('\n\\usepackage[margin=1in]{geometry}', '');
  const escape = (s) => String(s).replace(/[&%$#_{}]/g, '\\$&');
  const c = artifact.content;
  const knowledgeContext = c.knowledgeContext?.length ? `\\section*{Workspace knowledge used}\n${c.knowledgeContext.map((item) => `\\textbf{${escape(item.document)}} (${escape(item.relevanceScore.toFixed(2))}): ${escape(item.excerpt)}\\par`).join('\n')}\n\\emph{Workspace knowledge is user-provided context and is not independently fact-verified.}\n` : '';
  const evidence = `${knowledgeContext}${c.evidence ? `\\section*{Evidence status}\nStatus: ${escape(c.evidence.status)}. Sources mapped: ${c.evidence.sources.length}. ${escape(c.evidence.disclaimer)}\\par\n${(c.evidence.claims || []).map((claim) => `\\textbf{${escape(claim.id)}} (${escape(claim.verification)}): ${escape(claim.text)}\\par Evidence: ${escape((claim.evidenceIds || []).join(', ') || 'none')}`).join('\\n')}` : ''}`;
  const refs = (c.evidence?.sources || []).map((source) => `\\item[${escape(source.id)}] ${escape(source.title)} (${escape(source.kind || 'Source')})`).join('\\n');
  const contributions = c.contributions?.length ? `\\section{Contributions}\n\\begin{itemize}\n${c.contributions.map((item) => `\\item ${escape(item)}`).join('\n')}\n\\end{itemize}` : '';
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
