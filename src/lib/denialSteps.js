// Denial Navigator layered steps (roadmap 4.2): Client → Payer → Common 3Gen steps for each denial code,
// plus what the Payer Directory already knows (appeals contact, limits, forms, pinned notes). No PHI here.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { SOP_RECHECK_DAYS } from './sops';

export const SCOPES = [
  { value: 'client', label: 'Client steps', icon: '🟨' },
  { value: 'payer',  label: 'Payer rule',   icon: '🟦' },
  { value: 'common', label: 'Common 3Gen steps', icon: '⬜' },
];
export const scopeOf = value => SCOPES.find(s => s.value === value) ?? SCOPES[2];

const now = () => new Date().toISOString();

/** All step entries, or null when the 4.2 database update hasn't been run. */
export async function loadDenialSteps() {
  const { data, error } = await db('denial_steps').select('*');
  if (error) return null;
  return data ?? [];
}

/** Clients, payers and SOP titles for the pickers and the "linked SOP" choice (each empty if not set up). */
export async function loadStepContext() {
  const [clients, payers, sops] = await Promise.all([
    db('clients').select('id,name,active'),
    db('payers').select('*'),
    db('sops').select('id,title,client_id,status,active'),
  ]);
  const byName = (a, b) => (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? '');
  return {
    clients: (clients.data ?? []).filter(c => c.active !== false).sort(byName),
    payers: (payers.data ?? []).sort(byName),
    sops: (sops.data ?? []).sort(byName),
  };
}

const targetKey = scope => (scope === 'client' ? 'client_id' : scope === 'payer' ? 'payer_id' : null);

/** The active entry for a code in one layer (targetId = client or payer id; ignored for common). */
export function layerEntry(steps, codeId, scope, targetId = null) {
  const key = targetKey(scope);
  return (steps ?? []).find(s => s.active !== false && s.code_id === codeId && s.scope === scope
    && (!key || String(s[key]) === String(targetId))) ?? null;
}

/** True when the entry has never been verified, or not within the SOP re-check period (180 days). */
export function stepsNeedRecheck(row) {
  if (!row?.verified_at) return true;
  return Date.now() - new Date(row.verified_at).getTime() > SOP_RECHECK_DAYS * 86400000;
}

/** Adds or edits one layer entry. Returns the saved row, or { error }. */
export async function saveSteps(all, existing, { codeId, scope, targetId, steps, sopId, notes }, user) {
  const clash = !existing && layerEntry(all, codeId, scope, targetId);
  if (clash) return { error: 'Steps already exist for this layer — edit them instead.' };
  const payload = {
    code_id: codeId, scope, client_id: scope === 'client' ? targetId : null, payer_id: scope === 'payer' ? targetId : null,
    steps, sop_id: sopId ?? null, notes: notes || null, updated_by: user.emp_id, updated_at: now(),
  };
  const rows = existing
    ? await S.update('denial_steps', payload, { id: existing.id })
    : await S.set('denial_steps', { ...payload, active: true, created_by: user.emp_id });
  if (!rows?.length) return { error: 'Could not save. Please try again.' };
  logAudit({ actor: user, action: existing ? 'denial_steps_edit' : 'denial_steps_add', entityType: 'denial_step', entityId: rows[0].id, details: { code_id: codeId, scope } });
  return rows[0];
}

export async function verifySteps(row, user) {
  const ok = await S.update('denial_steps', { verified_at: now(), verified_by: user.emp_id }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'denial_steps_verify', entityType: 'denial_step', entityId: row.id });
  return !!ok;
}

export async function setStepsActive(row, active, user) {
  const ok = await S.update('denial_steps', { active, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: active ? 'denial_steps_activate' : 'denial_steps_deactivate', entityType: 'denial_step', entityId: row.id });
  return !!ok;
}

// ── What the Payer Directory knows ─────────────────────────────────────────

const payerInfoCache = new Map();   // `${payerId}|${clientId}` → promise

/**
 * Appeals contacts, appeal / corrected-claim / recon limits (client override first), appeal-type forms and pinned
 * Claims/Appeals notes for a payer. Cached for the session; pass fresh = true to reload.
 */
export function loadPayerInfo(payerId, clientId = null, fresh = false) {
  const key = `${payerId}|${clientId ?? ''}`;
  if (!fresh && payerInfoCache.has(key)) return payerInfoCache.get(key);
  const p = (async () => {
    const [contacts, limits, forms, notes] = await Promise.all([
      db('payer_contacts').select('*').eq('payer_id', payerId),
      db('payer_limits').select('*').eq('payer_id', payerId),
      db('payer_forms').select('*').eq('payer_id', payerId),
      db('payer_notes').select('*').eq('payer_id', payerId),
    ]);
    const live = r => (r.error ? [] : (r.data ?? []).filter(x => x.active !== false));
    // Limits: a client's override replaces the base limit of the same type + level
    const allLimits = live(limits).filter(l => ['AFL', 'CCTFL', 'RECON'].includes(l.limit_type));
    const chosen = allLimits.filter(l => l.client_id == null).map(base => {
      const override = clientId != null && allLimits.find(o => String(o.client_id) === String(clientId)
        && o.limit_type === base.limit_type && (o.level ?? null) === (base.level ?? null) && (o.plan_id ?? null) === (base.plan_id ?? null));
      return override ? { ...override, isOverride: true } : base;
    });
    // Client overrides that have no base limit
    allLimits.filter(o => clientId != null && String(o.client_id) === String(clientId)
      && !chosen.some(c => c.id === o.id)
      && !allLimits.some(b => b.client_id == null && b.limit_type === o.limit_type && (b.level ?? null) === (o.level ?? null) && (b.plan_id ?? null) === (o.plan_id ?? null)))
      .forEach(o => chosen.push({ ...o, isOverride: true }));
    const order = { AFL: 0, RECON: 1, CCTFL: 2 };
    return {
      contacts: live(contacts).filter(c => c.department === 'appeals'),
      limits: chosen.sort((a, b) => order[a.limit_type] - order[b.limit_type] || (a.level ?? 0) - (b.level ?? 0)),
      forms: live(forms).filter(f => !f.superseded_at && ['appeal', 'recon', 'corrected_claim'].includes(f.form_type) && f.file_path),
      notes: live(notes).filter(n => n.pinned && ['claims', 'appeals'].includes(String(n.category ?? '').toLowerCase())),
    };
  })();
  payerInfoCache.set(key, p);
  return p;
}
