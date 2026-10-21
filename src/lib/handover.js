// Shift handover notes (roadmap 7.4): one handover per person per shift date — done today, carry-over items,
// watch out, blockers — read by the team on the next shift; carry-over items can be taken, done or escalated.
// Minimum fields only; all text checked for patient details; item claim # wiped 90 days after done.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { addDays, today, yesterday } from './helpers';
import { phiIssues } from './appealAI';
import { addEscalation } from './escalations';

export const TEAM_DAYS = 2;            // “For my team” shows handovers of the last 2 shift dates
export const ITEM_CLEAR_AFTER_DAYS = 90;
export const NOTE_FIELDS = [
  { key: 'done_note',     label: 'Done today',  hint: 'e.g. Worked the Aetna aging list, 40 of 55 claims' },
  { key: 'watch_note',    label: 'Watch out',   hint: 'e.g. Availity slow after 2 PM — use the payer phone line' },
  { key: 'blockers_note', label: 'Blockers',    hint: 'e.g. No access to the client EMR since this morning' },
];
export const ITEM_STATUSES = [
  { value: 'open',   label: 'Not taken yet', badge: 'badge-yellow' },
  { value: 'picked', label: 'Taken',         badge: 'badge-blue' },
  { value: 'done',   label: 'Done',          badge: 'badge-green' },
];
export const itemStatusOf = v => ITEM_STATUSES.find(s => s.value === v) ?? ITEM_STATUSES[0];

const now = () => new Date().toISOString();

/** A handover can be changed until the end of the day after its shift date. */
export const isEditable = h => !h || h.shift_date >= yesterday();
/** The shift dates “For my team” covers: today and the day before. */
export const teamDates = () => Array.from({ length: TEAM_DAYS }, (_, i) => addDays(today(), -i));

export function handoverTextProblem(text, label) {
  const issues = phiIssues(text);
  return issues.length ? `${label}: this looks like it has ${issues.join(', ')}. Use the claim # field and leave out patient details.` : '';
}

/** Checks the notes and items before saving. Returns an error message or ''. */
export function checkHandover(h, items) {
  for (const f of NOTE_FIELDS) { const p = handoverTextProblem(h[f.key], f.label); if (p) return p; }
  for (const [i, it] of items.entries()) {
    if (!it.what?.trim()) return `Carry-over item ${i + 1}: say what is left to do (or remove the item).`;
    const p = handoverTextProblem(it.what, `Carry-over item ${i + 1}`);
    if (p) return p;
  }
  return '';
}

// ── Loading ────────────────────────────────────────────────────────────────

/** true when the 7.4 database update has been run. */
export async function handoverReady() {
  const { error } = await db('handovers').select('id').limit(1);
  return !error;
}

const activeItems = async ids => {
  if (!ids.length) return [];
  const { data } = await db('handover_items').select('*').in('handover_id', ids).eq('active', true).order('sort_order');
  return data ?? [];
};

/** My handover for a shift date (or null) + its items. */
export async function loadMyHandover(empId, date) {
  const { data } = await db('handovers').select('*').eq('emp_id', empId).eq('shift_date', date).limit(1);
  const h = data?.[0] ?? null;
  return { handover: h, items: h ? await activeItems([h.id]) : [] };
}

/**
 * Submitted handovers between two shift dates, with items and reads: [{ ...handover, items, reads: [emp_id] }].
 * empIds = whose handovers (null = everyone).
 */
export async function loadHandovers(from, to, empIds = null) {
  let q = db('handovers').select('*').eq('status', 'submitted').gte('shift_date', from).lte('shift_date', to);
  if (empIds) q = q.in('emp_id', empIds.length ? empIds : ['-']);
  const { data } = await q.order('shift_date', { ascending: false });
  const list = data ?? [];
  const ids = list.map(h => h.id);
  const [items, reads] = await Promise.all([
    activeItems(ids),
    ids.length ? db('handover_reads').select('*').in('handover_id', ids).then(r => r.data ?? []) : [],
  ]);
  return list.map(h => ({
    ...h, items: items.filter(i => i.handover_id === h.id), reads: reads.filter(r => r.handover_id === h.id).map(r => r.emp_id),
  }));
}

// ── Changes ────────────────────────────────────────────────────────────────

/**
 * Saves my handover and its carry-over items (new → insert, changed → update, removed → turned off; never deleted).
 * submit = true → visible to the team. Returns the saved handover or null.
 */
export async function saveHandover(h, items, existingItems, user, { submit = false } = {}) {
  const notes = Object.fromEntries(NOTE_FIELDS.map(f => [f.key, h[f.key]?.trim() || null]));
  const status = submit || h.status === 'submitted' ? 'submitted' : 'draft';
  let saved;
  if (h.id) {
    saved = (await S.update('handovers', { ...notes, status, ...(submit && h.status !== 'submitted' ? { submitted_at: now() } : {}), updated_at: now() }, { id: h.id }))?.[0];
  } else {
    saved = (await S.set('handovers', { ...notes, emp_id: user.emp_id, team: user.team || null, shift_date: h.shift_date, status, ...(submit ? { submitted_at: now() } : {}) }))?.[0];
  }
  if (!saved) return null;

  const keep = new Set(items.filter(i => i.id).map(i => i.id));
  const removed = existingItems.filter(i => !keep.has(i.id));
  const itemFields = (it, i) => ({
    client_id: it.client_id || null, payer_id: it.payer_id || null, claim_number: it.claim_number?.trim() || null,
    what: it.what.trim(), priority: it.priority || 'normal', sort_order: i, updated_at: now(),
  });
  const newRows = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.id);
  const results = await Promise.all([
    ...items.map((it, i) => (it.id ? S.update('handover_items', itemFields(it, i), { id: it.id }) : true)),
    ...removed.map(it => S.update('handover_items', { active: false, updated_at: now() }, { id: it.id })),
    newRows.length ? S.set('handover_items', newRows.map(({ it, i }) => ({ ...itemFields(it, i), handover_id: saved.id }))) : true,
  ]);
  if (!results.every(Boolean)) return null;
  logAudit({ actor: user, action: submit && h.status !== 'submitted' ? 'handover_submit' : 'handover_edit', entityType: 'handover', entityId: saved.id });
  return saved;
}

export async function markRead(h, user) {
  const ok = await S.set('handover_reads', { handover_id: h.id, emp_id: user.emp_id, read_at: now() }, ['handover_id', 'emp_id']);
  if (ok) logAudit({ actor: user, action: 'handover_read', entityType: 'handover', entityId: h.id });
  return !!ok;
}

export async function pickItem(item, user) {
  const ok = await S.update('handover_items', { status: 'picked', picked_by: user.emp_id, picked_at: now(), updated_at: now() }, { id: item.id });
  if (ok) logAudit({ actor: user, action: 'handover_item_pick', entityType: 'handover_item', entityId: item.id });
  return !!ok;
}

export async function doneItem(item, user) {
  const ok = await S.update('handover_items', {
    status: 'done', done_by: user.emp_id, done_at: now(), ...(item.picked_by ? {} : { picked_by: user.emp_id, picked_at: now() }), updated_at: now(),
  }, { id: item.id });
  if (ok) logAudit({ actor: user, action: 'handover_item_done', entityType: 'handover_item', entityId: item.id });
  return !!ok;
}

/** ⚑ Escalate a carry-over item: creates the escalation and links it to the item. */
export async function escalateItem(item, escalation, user) {
  const esc = await addEscalation(escalation, user, { handoverItemId: item.id });
  if (!esc) return null;
  await S.update('handover_items', { escalation_id: esc.id, updated_at: now() }, { id: item.id });
  return esc;
}

/** Wipes the claim # of carry-over items done more than 90 days ago (run when the page opens). */
export async function clearOldItems(user) {
  const cutoff = new Date(`${addDays(today(), -ITEM_CLEAR_AFTER_DAYS)}T00:00:00`).toISOString();
  const { data } = await db('handover_items').select('id').eq('cleared', false).not('claim_number', 'is', null).lt('done_at', cutoff);
  const ids = (data ?? []).map(r => r.id);
  if (!ids.length) return 0;
  const { error } = await db('handover_items').update({ claim_number: null, cleared: true, updated_at: now() }).in('id', ids);
  if (error) return 0;
  logAudit({ actor: user, action: 'handover_item_clear', entityType: 'handover_item', details: { count: ids.length } });
  return ids.length;
}
