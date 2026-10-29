import { S } from './supabase.js';
import { hasAccess } from './access.js';

/**
 * Fire-and-forget — records who did what, when, on which record (Audit Log page).
 * entityType/entityId name the record (e.g. 'allocation', 42).
 * NEVER put patient data (PHI) in details — only IDs, counts and setting names.
 */
export function logAudit({ actor, action, targetEmpId = null, targetName = null, entityType = null, entityId = null, details = null }) {
  // Owner Console: the Helix Hub owner's master key — never recorded as if the person themselves did it
  const via = actor?.isOwner ? ` (via Helix Hub owner${actor.ownerUsername ? ` ${actor.ownerUsername}` : ''})` : '';
  const row = {
    actor_emp_id: actor?.emp_id,
    actor_name:   (actor?.name ?? actor?.emp_id) + via,
    actor_role:   actor?.role,
    action,
    target_emp_id: targetEmpId,
    target_name:   targetName,
    details:       actor?.isOwner ? { ...(details ?? {}), via_owner: actor.ownerUsername ?? true } : details,
    created_at: new Date().toISOString(),
  };
  if (!entityType) { S.set('audit_log', row).catch(() => {}); return; }
  const entity_id = entityId != null ? String(entityId) : null;
  S.set('audit_log', { ...row, entity_type: entityType, entity_id }).then(ok => {
    // Entity columns arrive with the step 0.4 migration — until then keep them in details
    if (!ok) S.set('audit_log', { ...row, details: { ...(row.details ?? {}), entity_type: entityType, entity_id } });
  }).catch(() => {});
}

/** Admins always; anyone else only if an admin granted "View Audit Log". */
export function canViewAudit(user) {
  return hasAccess(user, 'audit_view');
}
