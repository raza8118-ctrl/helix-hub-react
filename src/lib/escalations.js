// Escalation tracker (roadmap 7.4): issues raised to a supervisor / manager, tracked until resolved, with history.
// Minimum fields only; all text checked for patient details; claim # wiped 90 days after closing.
// Everyone sees what they raised or were assigned; “Manage escalations” sees and changes all.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { addDays, today } from './helpers';
import { daysBetween } from './deadlines';
import { phiIssues } from './appealAI';
import { addWorkdays } from './clientQueries';

export const ESC_CLEAR_AFTER_DAYS = 90;
export const ESC_TYPES = [
  { value: 'payer',       label: 'Payer issue' },
  { value: 'client',      label: 'Client issue' },
  { value: 'system',      label: 'System / software down' },
  { value: 'access',      label: 'Access / login' },
  { value: 'claim_stuck', label: 'Claim stuck' },
  { value: 'process',     label: 'Process question' },
  { value: 'other',       label: 'Other' },
];
// days = working days to the target date (0 = same day)
export const ESC_SEVERITIES = [
  { value: 'critical', label: 'Critical', badge: 'badge-red',    days: 0 },
  { value: 'high',     label: 'High',     badge: 'badge-red',    days: 1 },
  { value: 'medium',   label: 'Medium',   badge: 'badge-yellow', days: 3 },
  { value: 'low',      label: 'Low',      badge: 'badge-gray',   days: 3 },
];
export const ESC_STATUSES = [
  { value: 'open',        label: 'Open',        badge: 'badge-blue' },
  { value: 'in_progress', label: 'In progress', badge: 'badge-yellow' },
  { value: 'resolved',    label: 'Resolved',    badge: 'badge-green' },
  { value: 'closed',      label: 'Closed',      badge: 'badge-gray' },
];
const EVENT_LABELS = { raised: 'Raised', edited: 'Edited', assigned: 'Assigned', status: 'Status changed', reopened: 'Reopened', note: 'Note' };

export const escTypeLabel = v => ESC_TYPES.find(t => t.value === v)?.label ?? 'Other';
export const severityOf = v => ESC_SEVERITIES.find(s => s.value === v) ?? ESC_SEVERITIES[2];
export const escStatusOf = v => ESC_STATUSES.find(s => s.value === v) ?? ESC_STATUSES[0];
export const escEventLabel = k => EVENT_LABELS[k] ?? k;
export const escRef = id => `E-${String(id).padStart(4, '0')}`;

const now = () => new Date().toISOString();

/** Target date from the severity: Critical today, High +1 working day, others +3. */
export const targetFor = severity => { const d = severityOf(severity).days; return d ? addWorkdays(today(), d) : today(); };
export const isOpenEsc = e => e.status === 'open' || e.status === 'in_progress';
export const isOverdueEsc = e => isOpenEsc(e) && !!e.target_date && e.target_date < today();
export function escAgeDays(e) {
  const end = isOpenEsc(e) ? today() : (e.resolved_at ?? e.closed_at ?? e.updated_at).slice(0, 10);
  return Math.max(0, daysBetween(e.created_at.slice(0, 10), end));
}

// ── Access ─────────────────────────────────────────────────────────────────

export const canManageEsc = user => hasAccess(user, 'escalations_manage');
export const isMine = (user, e) => e.raised_by === user.emp_id || e.assigned_to === user.emp_id;
export const canChangeEsc = (user, e) => canManageEsc(user) || isMine(user, e);

/** Patient-detail check for typed text. Returns an error message or ''. */
export function escTextProblem(text, label = 'This') {
  const issues = phiIssues(text);
  return issues.length ? `${label} looks like it has ${issues.join(', ')}. Use the claim # field and leave out patient details.` : '';
}

// ── Loading ────────────────────────────────────────────────────────────────

/** All escalations (paged), or null when the 7.4 database update hasn't been run. */
export async function loadEscalations() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db('escalations').select('*').order('id', { ascending: false }).range(from, from + 999);
    if (error) return from === 0 ? null : out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadEscEvents(id) {
  const { data } = await db('escalation_events').select('*').eq('escalation_id', id).order('created_at');
  return data ?? [];
}

/** Client queries (7.3) flagged ⚑ escalated and still open — shown read-only beside escalations. [] if not set up. */
export async function loadEscalatedQueries() {
  const { data, error } = await db('client_queries').select('id,client_id,category,question,owner_emp_id,asked_on,status,escalated')
    .eq('escalated', true).in('status', ['open', 'waiting']);
  return error ? [] : data ?? [];
}

// ── Changes ────────────────────────────────────────────────────────────────

const addEvent = (id, kind, note, user) => S.set('escalation_events', { escalation_id: id, kind, note: note?.trim() || null, emp_id: user.emp_id });

export function checkEsc(e) {
  if (!e.title?.trim()) return 'Type a short title.';
  if (!e.assigned_to) return 'Choose who it goes to.';
  return escTextProblem(e.title, 'The title') || escTextProblem(e.details, 'The details');
}

const fields = e => ({
  title: e.title.trim(), type: e.type || 'other', severity: e.severity || 'medium', client_id: e.client_id || null,
  payer_id: e.payer_id || null, claim_number: e.claim_number?.trim() || null, details: e.details?.trim() || null,
  assigned_to: e.assigned_to || null, target_date: e.target_date || null,
});

export async function addEscalation(e, user, { handoverItemId = null } = {}) {
  const rows = await S.set('escalations', { ...fields(e), raised_by: user.emp_id, status: 'open', handover_item_id: handoverItemId, updated_by: user.emp_id });
  if (!rows?.length) return null;
  await addEvent(rows[0].id, 'raised', null, user);
  logAudit({ actor: user, action: 'escalation_add', entityType: 'escalation', entityId: rows[0].id, targetEmpId: rows[0].assigned_to });
  return rows[0];
}

async function change(e, patch, kind, note, user, action, details = null) {
  const rows = await S.update('escalations', { ...patch, updated_by: user.emp_id, updated_at: now() }, { id: e.id });
  if (!rows?.length) return null;
  await addEvent(e.id, kind, note, user);
  logAudit({ actor: user, action, entityType: 'escalation', entityId: e.id, details });
  return rows[0];
}

export const editEscalation = (e, values, user) => change(e, fields(values), 'edited', null, user, 'escalation_edit');
export const assignEscalation = (e, empId, user) => change(e, { assigned_to: empId }, 'assigned', null, user, 'escalation_assign', { to: empId });

/** Status change: resolved needs the resolution text; closed sets closed_at. */
export function setEscStatus(e, status, note, user) {
  const patch = { status };
  if (status === 'resolved') Object.assign(patch, { resolution: note.trim(), resolved_at: now() });
  if (status === 'closed') Object.assign(patch, { closed_at: now(), ...(e.resolved_at ? {} : { resolved_at: now() }) });
  return change(e, patch, 'status', status === 'resolved' ? note : `${escStatusOf(status).label}${note ? ` — ${note}` : ''}`, user, 'escalation_status', { status });
}
export const reopenEscalation = (e, note, user) => change(e, { status: 'open', resolved_at: null, closed_at: null }, 'reopened', note, user, 'escalation_reopen');
export const addEscNote = (e, note, user) => addEvent(e.id, 'note', note, user).then(r => !!r);

/** Wipes the claim # of escalations closed more than 90 days ago (run when the page opens). */
export async function clearOldEscalations(user) {
  const cutoff = new Date(`${addDays(today(), -ESC_CLEAR_AFTER_DAYS)}T00:00:00`).toISOString();
  const { data } = await db('escalations').select('id').eq('cleared', false).not('claim_number', 'is', null).lt('closed_at', cutoff);
  const ids = (data ?? []).map(r => r.id);
  if (!ids.length) return 0;
  const { error } = await db('escalations').update({ claim_number: null, cleared: true, updated_at: now() }).in('id', ids);
  if (error) return 0;
  logAudit({ actor: user, action: 'escalation_clear', entityType: 'escalation', details: { count: ids.length } });
  return ids.length;
}

// ── Overview ───────────────────────────────────────────────────────────────

/** { byType: [{ type, open, overdue }], avgResolveDays, open, overdue } */
export function escSummary(list) {
  const byType = {};
  const resolved = [];
  for (const e of list) {
    const t = (byType[e.type] ??= { type: e.type, open: 0, overdue: 0, ages: [] });
    if (isOpenEsc(e)) { t.open += 1; t.ages.push(escAgeDays(e)); if (isOverdueEsc(e)) t.overdue += 1; }
    else if (e.resolved_at) resolved.push(daysBetween(e.created_at.slice(0, 10), e.resolved_at.slice(0, 10)));
  }
  const types = Object.values(byType).map(({ ages, ...t }) => ({ ...t, oldest: ages.length ? Math.max(...ages) : null }));
  return {
    byType: types.filter(t => t.open).sort((a, b) => b.open - a.open),
    open: types.reduce((s, t) => s + t.open, 0), overdue: types.reduce((s, t) => s + t.overdue, 0),
    avgResolveDays: resolved.length ? Math.round((resolved.reduce((s, d) => s + d, 0) / resolved.length) * 10) / 10 : null,
  };
}
