const DEFAULTS = Object.freeze({
  generation: Object.freeze({ maxToolCalls: 24, maxStageRuns: 16, maxStageAttempts: 3, recursionLimit: 180 }),
  chat: Object.freeze({ maxToolCalls: 24, maxStageRuns: 0, maxStageAttempts: 0, recursionLimit: 64 }),
});

const LIMITS = Object.freeze({
  maxToolCalls: { min: 6, max: 64 },
  maxStageRuns: { min: 8, max: 32 },
  maxStageAttempts: { min: 2, max: 5 },
  recursionLimit: { min: 32, max: 512 },
});

function bounded(value, fallback, range) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.floor(number)));
}

function envValue(kind, key) {
  const prefix = kind === 'chat' ? 'NOVI_CHAT' : 'NOVI_AGENT';
  return process.env[`${prefix}_${key}`] ?? process.env[`NOVI_${key}`];
}

export function agentBudgetConfig(kind = 'generation', overrides = {}) {
  const defaults = DEFAULTS[kind] || DEFAULTS.generation;
  const maxToolCalls = bounded(overrides.maxToolCalls ?? envValue(kind, 'MAX_TOOL_CALLS'), defaults.maxToolCalls, LIMITS.maxToolCalls);
  const maxStageRuns = kind === 'chat' ? 0 : bounded(overrides.maxStageRuns ?? envValue(kind, 'MAX_STAGE_RUNS'), defaults.maxStageRuns, LIMITS.maxStageRuns);
  const maxStageAttempts = kind === 'chat' ? 0 : bounded(overrides.maxStageAttempts ?? envValue(kind, 'MAX_STAGE_ATTEMPTS'), defaults.maxStageAttempts, LIMITS.maxStageAttempts);
  const minimumRecursion = kind === 'chat' ? (maxToolCalls * 2) + 8 : (maxToolCalls * 4) + (maxStageRuns * 3) + 16;
  const requestedRecursion = bounded(overrides.recursionLimit ?? envValue(kind, 'RECURSION_LIMIT'), Math.max(defaults.recursionLimit, minimumRecursion), LIMITS.recursionLimit);
  const recursionLimit = Math.min(LIMITS.recursionLimit.max, Math.max(minimumRecursion, requestedRecursion));
  return Object.freeze({ kind, maxToolCalls, maxStageRuns, maxStageAttempts, recursionLimit, maxObservationItems: Math.min(12, Math.max(6, Math.ceil(maxToolCalls / 3))) });
}

export const MAX_TOOL_CALLS = DEFAULTS.generation.maxToolCalls;
export const MAX_CHAT_TOOL_CALLS = DEFAULTS.chat.maxToolCalls;
export const MAX_STAGE_RUNS = DEFAULTS.generation.maxStageRuns;
