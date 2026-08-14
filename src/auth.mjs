import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export function validateCredentials(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  const errors = {};
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'A valid email is required';
  if (password.length < 10 || password.length > 200) errors.password = 'Password must be 10-200 characters';
  return { email, password, errors };
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, encoded) {
  const [, salt, expected] = String(encoded).split('$');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export class AuthService {
  constructor(store) { this.store = store; }

  async register(input) {
    const { email, password, errors } = validateCredentials(input);
    if (Object.keys(errors).length) return { errors };
    return this.store.update((state) => {
      state.users ||= [];
      if (state.users.some((user) => user.email === email)) return { conflict: true };
      const user = { id: randomUUID(), tenantId: randomUUID(), email, passwordHash: hashPassword(password), plan: 'free', role: 'owner', createdAt: new Date().toISOString() };
      state.users.push(user);
      state.organizations ||= [];
      state.organizations.push({ id: user.tenantId, name: `${email.split('@')[0]}'s workspace`, ownerId: user.id, createdAt: user.createdAt });
      state.memberships ||= [];
      state.memberships.push({ id: randomUUID(), tenantId: user.tenantId, userId: user.id, role: 'owner', status: 'active', createdAt: user.createdAt });
      return { user: publicUser(user) };
    });
  }

  async login(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { invalid: true };
    const email = normalizeEmail(input.email);
    const password = String(input.password || '');
    const state = await this.store.read();
    const user = (state.users || []).find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) return { invalid: true };
    const memberships = (state.memberships || []).filter((item) => item.userId === user.id && item.status === 'active');
    const requestedTenant = input.tenantId && memberships.some((item) => item.tenantId === input.tenantId) ? input.tenantId : user.tenantId;
    const membership = memberships.find((item) => item.tenantId === requestedTenant);
    const token = randomBytes(32).toString('base64url');
    await this.store.update((next) => {
      next.sessions = (next.sessions || []).filter((session) => session.expiresAt > Date.now());
      next.sessions.push({ tokenHash: hashToken(token), userId: user.id, tenantId: requestedTenant, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    });
    return { token, user: { ...publicUser(user), tenantId: requestedTenant, role: membership?.role || user.role || 'viewer' } };
  }

  async authenticate(token) {
    if (!token) return null;
    const now = Date.now();
    const state = await this.store.read();
    const session = (state.sessions || []).find((item) => item.tokenHash === hashToken(token) && item.expiresAt > now);
    if (!session) return null;
    const user = (state.users || []).find((item) => item.id === session.userId);
    const membership = (state.memberships || []).find((item) => item.userId === session.userId && item.tenantId === session.tenantId && item.status === 'active');
    return user && membership ? { ...publicUser(user), tenantId: session.tenantId, role: membership.role, tokenHash: session.tokenHash } : null;
  }

  async logout(token) {
    if (!token) return;
    await this.store.update((state) => { state.sessions = (state.sessions || []).filter((item) => item.tokenHash !== hashToken(token)); });
  }

  async oidcLogin(profile) {
    return this.store.update((state) => {
      state.users ||= [];
      let user = state.users.find((candidate) => candidate.oidcSub === profile.sub);
      if (!user) {
        const emailMatch = state.users.find((candidate) => candidate.email === profile.email);
        if (emailMatch && process.env.NOVI_OIDC_ALLOW_EMAIL_LINK !== 'true') return { invalid: true, code: 'OIDC_EMAIL_LINK_DISABLED' };
        user = emailMatch;
      }
      if (!user) {
        const now = new Date().toISOString();
        user = { id: randomUUID(), tenantId: randomUUID(), email: profile.email, name: profile.name, oidcSub: profile.sub, plan: 'free', role: 'owner', createdAt: now };
        state.users.push(user);
        state.organizations ||= []; state.organizations.push({ id: user.tenantId, name: `${profile.name || profile.email.split('@')[0]}'s workspace`, ownerId: user.id, createdAt: now });
        state.memberships ||= []; state.memberships.push({ id: randomUUID(), tenantId: user.tenantId, userId: user.id, role: 'owner', status: 'active', createdAt: now });
      } else if (!user.oidcSub) user.oidcSub = profile.sub;
      const membership = (state.memberships || []).find((item) => item.userId === user.id && item.tenantId === user.tenantId && item.status === 'active');
      if (!membership) return { invalid: true };
      const token = randomBytes(32).toString('base64url');
      state.sessions ||= []; state.sessions.push({ tokenHash: hashToken(token), userId: user.id, tenantId: user.tenantId, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      return { token, user: { ...publicUser(user), tenantId: user.tenantId, role: membership.role } };
    });
  }

  async switchTenant(token, tenantId) {
    const current = await this.authenticate(token);
    if (!current || !tenantId) return { invalid: true };
    const state = await this.store.read();
    const membership = (state.memberships || []).find((item) => item.userId === current.id && item.tenantId === tenantId && item.status === 'active');
    if (!membership) return { invalid: true };
    const newToken = randomBytes(32).toString('base64url');
    await this.store.update((next) => {
      const now = Date.now();
      next.sessions = (next.sessions || []).filter((session) => session.expiresAt > now && session.tokenHash !== hashToken(token));
      next.sessions.push({ tokenHash: hashToken(newToken), userId: current.id, tenantId, expiresAt: now + 30 * 24 * 60 * 60 * 1000 });
    });
    const user = nextUser(state, current.id);
    return { token: newToken, user: { ...publicUser(user), tenantId, role: membership.role } };
  }
}

const nextUser = (state, id) => (state.users || []).find((user) => user.id === id);

export const publicUser = (user) => ({ id: user.id, tenantId: user.tenantId, email: user.email, plan: user.plan || 'free', role: user.role || 'owner', createdAt: user.createdAt });
export const bearerToken = (req) => {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) return bearer;
  const cookies = String(req.headers.cookie || '').split(';').map((part) => part.trim().split('='));
  return cookies.find(([name]) => name === 'novi_session')?.[1] || null;
};
