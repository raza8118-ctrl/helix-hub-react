// Per-user feature access.
// Each feature lists the roles that have it by default. An admin can also grant it
// to anyone else on the Team page (stored as users.access_grants = { key: true }).
// Every new module adds its permission here — the Team page and the sidebar pick it up.
export const FEATURES = [
  { key: 'masters_edit', label: 'Edit Clients & Payers', defaultRoles: ['admin', 'manager'] },
  { key: 'audit_view',   label: 'View Audit Log',        defaultRoles: ['admin'] },
  // Viewing the Payer Directory is open to every signed-in user; editing is gated
  { key: 'payers_edit',  label: 'Edit Payer Directory',  defaultRoles: ['admin', 'manager'] },
];

export function hasRoleDefault(role, key) {
  return !!FEATURES.find(f => f.key === key)?.defaultRoles.includes(role);
}

/** Granted individually by an admin (not counting role defaults). */
export function grantsOf(user) {
  const grants = { ...(user?.access_grants ?? {}) };
  if (user?.can_view_audit) grants.audit_view = true;   // step 0.4 column, kept in sync
  return grants;
}

export function hasAccess(user, key) {
  if (!user) return false;
  return hasRoleDefault(user.role, key) || !!grantsOf(user)[key];
}
