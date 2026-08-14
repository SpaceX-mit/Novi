import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLANS } from './billing.mjs';

const validPlan = (plan) => plan && plan !== 'free' && Boolean(PLANS[plan]);
const EVENT_TYPES = new Set(['subscription.active', 'subscription.updated', 'subscription.deleted', 'payment.failed']);

function safeReturnUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(String(value));
    const configured = process.env.NOVI_APP_ORIGIN;
    if (!configured) return undefined;
    const origin = new URL(configured).origin;
    return url.origin === origin ? url.toString() : undefined;
  } catch { return undefined; }
}

function safeCheckoutUrl(value) {
  try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) ? url.toString() : null; }
  catch { return null; }
}

export function signWebhook(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifyWebhook(body, signature, secret) {
  if (!body || !signature || !secret) return false;
  const expected = signWebhook(body, secret);
  const actual = String(signature);
  return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function paymentConfigured() {
  return Boolean(process.env.NOVI_PAYMENT_CHECKOUT_URL && process.env.NOVI_PAYMENT_WEBHOOK_SECRET);
}

export function validatePaymentConfiguration() {
  if (!process.env.NOVI_PAYMENT_CHECKOUT_URL) return true;
  const url = new URL(process.env.NOVI_PAYMENT_CHECKOUT_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('NOVI_PAYMENT_CHECKOUT_URL must be an HTTP(S) URL without embedded credentials');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !local) throw new Error('Production payment endpoint must use HTTPS (HTTP is allowed only for local loopback)');
  if (process.env.NODE_ENV === 'production' && !process.env.NOVI_PAYMENT_WEBHOOK_SECRET) throw new Error('Production payment provider requires NOVI_PAYMENT_WEBHOOK_SECRET');
  return true;
}

export async function createCheckoutSession({ tenantId, userId, plan, email, returnUrl }) {
  if (!validPlan(plan)) return { error: 'A valid paid plan is required' };
  if (!paymentConfigured()) return { unavailable: true };
  const response = await fetch(process.env.NOVI_PAYMENT_CHECKOUT_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${process.env.NOVI_PAYMENT_API_KEY || ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId, userId, email, plan, returnUrl: safeReturnUrl(returnUrl) }),
  });
  if (!response.ok) throw new Error(`Payment provider returned ${response.status}`);
  const payload = await response.json();
  const checkoutUrl = safeCheckoutUrl(payload.checkoutUrl);
  if (!checkoutUrl) throw new Error('Payment provider returned an invalid checkout URL');
  return { checkoutUrl, provider: payload.provider || 'external' };
}

export function applyWebhook(state, event) {
  const eventId = String(event?.id || '');
  if (!eventId || !event?.type) return { error: 'Webhook event id and type are required' };
  if (!EVENT_TYPES.has(String(event.type))) return { error: 'Unsupported webhook event type' };
  state.paymentEvents ||= [];
  if (state.paymentEvents.some((entry) => entry.id === eventId)) return { duplicate: true };
  const data = event.data || {};
  const tenantId = String(data.tenantId || '');
  if (!tenantId) return { error: 'Webhook tenantId is required' };
  const terminal = event.type === 'subscription.deleted' || event.type === 'payment.failed';
  if (!terminal && !validPlan(data.plan)) return { error: 'Active subscription webhook requires a valid plan' };
  if (!terminal && data.subscriptionId === undefined) return { error: 'Subscription webhook requires subscriptionId' };
  const plan = validPlan(data.plan) ? data.plan : 'free';
  const users = state.users.filter((user) => user.tenantId === tenantId);
  if (!users.length) return { error: 'Webhook tenant not found' };
  const active = !terminal;
  for (const user of users) user.plan = active ? plan : 'free';
  state.subscriptions ||= [];
  const existing = state.subscriptions.find((subscription) => subscription.tenantId === tenantId);
  const subscription = { tenantId, subscriptionId: data.subscriptionId || existing?.subscriptionId || null, plan: active ? plan : 'free', status: active ? (data.status || 'active') : 'canceled', updatedAt: new Date().toISOString() };
  if (existing) Object.assign(existing, subscription); else state.subscriptions.push(subscription);
  state.paymentEvents.unshift({ id: eventId, type: event.type, tenantId, receivedAt: new Date().toISOString() });
  state.paymentEvents = state.paymentEvents.slice(0, 5000);
  return { applied: true, subscription };
}
