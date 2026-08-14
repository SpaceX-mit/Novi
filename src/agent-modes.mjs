const modeDefinitions = Object.freeze([
  {
    id: 'workflow',
    name: 'Workflow',
    description: 'Runs the bounded Research, Knowledge, Writing, and Review stages in order.',
  },
  {
    id: 'react',
    name: 'ReAct',
    description: 'Re-evaluates the next useful stage after each observation and may finish early.',
  },
  {
    id: 'plan-execute',
    name: 'Plan & Execute',
    description: 'Creates a structured stage plan, executes it, and preserves the plan with the result.',
  },
  {
    id: 'supervisor',
    name: 'Supervisor',
    description: 'Supervises specialist stages, can revisit a stage, and decides when the artifact is ready.',
  },
]);

const modeIds = new Set(modeDefinitions.map((mode) => mode.id));
const aliases = Object.freeze({
  fixed: 'workflow', pipeline: 'workflow', standard: 'workflow',
  react: 'react', tool: 'react', search: 'react',
  plan: 'plan-execute', planner: 'plan-execute', 'plan-and-execute': 'plan-execute',
  supervisor: 'supervisor', multiagent: 'supervisor', 'multi-agent': 'supervisor',
});

function normalizedMode(value) {
  const requested = String(value || '').trim().toLowerCase();
  if (requested === 'auto') return 'auto';
  return modeIds.has(requested) ? requested : aliases[requested] || null;
}

export function validateRequestedMode(value = 'auto') {
  const mode = normalizedMode(value);
  if (!mode) throw Object.assign(new Error('mode must be auto, workflow, react, plan-execute, or supervisor'), { status: 422 });
  return mode;
}

export function agentModeCatalog() {
  return modeDefinitions.map((mode) => ({ ...mode }));
}

function explicitMode(prompt) {
  const match = String(prompt || '').match(/(?:^|\s)(?:\/mode\s+|mode\s*[:=]\s*)(workflow|fixed|pipeline|react|tool|search|plan(?:-and-execute)?|planner|supervisor|multi-?agent)(?:\s|$)/i);
  return match ? normalizedMode(match[1]) : null;
}

function score(text, expressions) {
  return expressions.reduce((total, expression) => total + (expression.test(text) ? 1 : 0), 0);
}

export function selectAgentMode(prompt, { requestedMode = 'auto' } = {}) {
  const requested = validateRequestedMode(requestedMode);
  if (requested !== 'auto') return { mode: requested, reason: 'explicit-request' };
  const explicit = explicitMode(prompt);
  if (explicit) return { mode: explicit, reason: 'prompt-directive' };
  const text = String(prompt || '').toLowerCase();
  const scores = {
    supervisor: score(text, [/multi[- ]?agent|supervisor|debate|critic|review and revise|iterate until|反复|多智能体|监督|审查并修改|反思/]),
    'plan-execute': score(text, [/plan|roadmap|step[- ]by[- ]step|milestone|decompose|complex|规划|计划|路线图|分解|步骤/]),
    react: score(text, [/search|look up|find sources?|latest|current|web|mcp|evidence|verify|检索|搜索|查找|最新|来源|证据|核实/]),
    workflow: score(text, [/fixed|pipeline|in order|standard|直接生成|固定流程|按顺序|标准流程/]),
  };
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  return ranked[0][1] > 0 ? { mode: ranked[0][0], reason: 'intent-classifier', scores } : { mode: 'workflow', reason: 'default', scores };
}

export function publicMode(mode) {
  return modeDefinitions.find((item) => item.id === mode) || modeDefinitions[0];
}

export function allowedAgentMode(value) {
  return normalizedMode(value);
}

export { modeDefinitions };
