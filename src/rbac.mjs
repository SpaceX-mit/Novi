export const ROLES = Object.freeze({ viewer: 10, editor: 20, admin: 30, owner: 40 });

export function can(role, required) {
  return (ROLES[role] || 0) >= (ROLES[required] || Number.MAX_SAFE_INTEGER);
}

export function roleFor(state, user) {
  if (user.id === 'local') return 'owner';
  const membership = (state.memberships || []).find((item) => item.userId === user.id && item.tenantId === user.tenantId && item.status === 'active');
  return membership?.role || user.role || 'viewer';
}

export function membershipFor(state, tenantId, userId) {
  return (state.memberships || []).find((item) => item.tenantId === tenantId && item.userId === userId && item.status === 'active') || null;
}

export function assertRole(state, user, required) {
  const role = roleFor(state, user);
  return can(role, required) ? { ok: true, role } : { ok: false, role, required };
}
