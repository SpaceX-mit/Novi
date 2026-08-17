export const PLANS = {
  free: { label: 'Free preview', monthlyPriceUsd: 0, audience: 'Evaluate the core workflow', monthlyGenerations: 5, monthlySourceQueries: 20 },
  personal: { label: 'Personal Knowledge', monthlyPriceUsd: 29, audience: 'Students, engineers, and technical managers', monthlyGenerations: 30, monthlySourceQueries: 150 },
  pro: { label: 'Pro Research', monthlyPriceUsd: 99, audience: 'Researchers, doctoral students, and architects', monthlyGenerations: 100, monthlySourceQueries: 500 },
  enterprise: { label: 'Enterprise', monthlyPriceUsd: 1000, priceQualifier: 'starting at', audience: 'R&D teams and governed knowledge programs', monthlyGenerations: 1000, monthlySourceQueries: 5000 },
};

export const LOCAL_MONTHLY_GENERATIONS = Object.freeze({ development: 1000, release: 100 });

const period = () => new Date().toISOString().slice(0, 7);

export function usageFor(state, tenantId) {
  const currentPeriod = period();
  return (state.usage || []).find((entry) => entry.tenantId === tenantId && entry.period === currentPeriod)
    || { tenantId, period: currentPeriod, generations: 0, sourceQueries: 0 };
}

export function planFor(user) { return PLANS[user.plan] ? user.plan : 'free'; }

export function localMonthlyGenerationLimit(env = process.env) {
  return env.NODE_ENV === 'production' || env.NOVI_RELEASE_BUILD === 'true'
    ? LOCAL_MONTHLY_GENERATIONS.release
    : LOCAL_MONTHLY_GENERATIONS.development;
}

export function limitsFor(user, env = process.env) {
  const limits = PLANS[planFor(user)];
  return user.tenantId === 'local' ? { ...limits, monthlyGenerations: localMonthlyGenerationLimit(env) } : limits;
}

export function consumeGeneration(state, user, env = process.env) {
  const plan = planFor(user);
  const limits = limitsFor(user, env);
  const usage = usageFor(state, user.tenantId);
  if (usage.generations >= limits.monthlyGenerations) return { allowed: false, plan, usage, limits };
  const existing = (state.usage || []).find((entry) => entry.tenantId === user.tenantId && entry.period === usage.period);
  if (existing) existing.generations += 1; else { state.usage ||= []; state.usage.push({ ...usage, generations: 1 }); }
  return { allowed: true, plan, usage: { ...usage, generations: usage.generations + 1 }, limits };
}

export function consumeSourceQuery(state, user) {
  const plan = planFor(user);
  const limits = PLANS[plan];
  const usage = usageFor(state, user.tenantId);
  if (usage.sourceQueries >= limits.monthlySourceQueries) return { allowed: false, plan, usage, limits };
  const existing = (state.usage || []).find((entry) => entry.tenantId === user.tenantId && entry.period === usage.period);
  if (existing) existing.sourceQueries += 1; else { state.usage ||= []; state.usage.push({ ...usage, sourceQueries: 1 }); }
  return { allowed: true, plan, usage: { ...usage, sourceQueries: usage.sourceQueries + 1 }, limits };
}

export function refundGeneration(state, user, chargedPeriod = period()) {
  const usage = (state.usage || []).find((entry) => entry.tenantId === user.tenantId && entry.period === chargedPeriod);
  if (usage) usage.generations = Math.max(0, usage.generations - 1);
}

export function refundSourceQuery(state, user, chargedPeriod = period()) {
  const usage = (state.usage || []).find((entry) => entry.tenantId === user.tenantId && entry.period === chargedPeriod);
  if (usage) usage.sourceQueries = Math.max(0, usage.sourceQueries - 1);
}

export function billingSnapshot(state, user) {
  const plan = planFor(user);
  const subscription = (state.subscriptions || []).find((item) => item.tenantId === user.tenantId) || { status: 'not_configured', plan: 'free' };
  return { plan, planLabel: PLANS[plan].label, limits: limitsFor(user), catalog: Object.entries(PLANS).map(([id, value]) => ({ id, ...value })), usage: usageFor(state, user.tenantId), period: period(), paymentProvider: process.env.NOVI_PAYMENT_CHECKOUT_URL ? 'configured' : 'not_configured', subscription };
}
