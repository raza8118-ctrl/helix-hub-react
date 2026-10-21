// Follow-up tickler (roadmap 6.5): worklist follow-up dates (6.4) + personal reminders in one list.
// Same PHI rules as the Smart Worklist: minimum fields, no free text, claim # wiped 90 days after done / due.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { addDays, today, isWknd } from './helpers';
import { daysBetween } from './deadlines';
import { isDone, updateItem } from './worklist';

export const CLEAR_REMINDERS_AFTER = 90;
export const REMINDER_ACTIONS = [
  { value: 'call_back',              label: 'Call back' },
  { value: 'check_status',           label: 'Check claim status' },
  { value: 'expect_payment',         label: 'Expect payment' },
  { value: 'expect_records_request', label: 'Expect records request' },
  { value: 'appeal_decision',        label: 'Appeal decision due' },
  { value: 'auth_decision',          label: 'Auth decision due' },   // 9.2
  { value: 'other',                  label: 'Other' },
];
export const actionLabel = v => REMINDER_ACTIONS.find(a => a.value === v)?.label ?? 'Follow up';

const now = () => new Date().toISOString();
const changed = () => window.dispatchEvent(new Event('helix:followups-changed'));   // refreshes the sidebar count

// ── Dates ──────────────────────────────────────────────────────────────────

export const BUCKETS = [
  { value: 'overdue', label: 'Overdue',   icon: '🔴' },
  { value: 'today',   label: 'Today',     icon: '🟠' },
  { value: 'week',    label: 'This week', icon: '🟡' },
  { value: 'later',   label: 'Later',     icon: '⚪' },
];
export function bucketOf(due) {
  const day = today();
  if (due < day) return 'overdue';
  if (due === day) return 'today';
  return daysBetween(day, due) <= 7 ? 'week' : 'later';
}

/** Snooze choices from today: +1 day, +3 days, next Monday. */
export function snoozeOptions() {
  const day = today();
  let monday = addDays(day, 1);
  while (new Date(`${monday}T00:00:00`).getDay() !== 1) monday = addDays(monday, 1);
  const workday = d => { let x = d; while (isWknd(x)) x = addDays(x, 1); return x; };
  return [
    { label: '+1 day', date: workday(addDays(day, 1)) },
    { label: '+3 days', date: workday(addDays(day, 3)) },
    { label: 'Next Monday', date: monday },
  ];
}

// ── Loading ────────────────────────────────────────────────────────────────

/** true when the 6.5 database update has been run. */
export async function followupsReady() {
  const { error } = await db('followups').select('id').limit(1);
  return !error;
}

/**
 * Everything one person has to follow up: open reminders + worklist claims with a follow-up date that aren't finished.
 * Returns [{ key, kind: 'reminder' | 'worklist', due, payer_id, payer_name, client_id, claim_number, what, row }].
 */
export async function loadMyFollowups(empId) {
  const [rem, wl] = await Promise.all([
    db('followups').select('*').eq('emp_id', empId).eq('status', 'open'),
    db('worklist_items').select('*').eq('assigned_to', empId).eq('active', true).eq('cleared', false).not('follow_up', 'is', null),
  ]);
  const out = [];
  for (const r of rem.error ? [] : rem.data ?? []) {
    out.push({ key: `r${r.id}`, kind: 'reminder', due: r.due_date, payer_id: r.payer_id, payer_name: null, client_id: r.client_id,
      claim_number: r.claim_number, what: actionLabel(r.action), row: r });
  }
  for (const i of wl.error ? [] : wl.data ?? []) {
    if (isDone(i.status)) continue;
    out.push({ key: `w${i.id}`, kind: 'worklist', due: i.follow_up, payer_id: i.payer_id, payer_name: i.payer_name, client_id: i.client_id,
      claim_number: i.claim_number, what: 'Worklist follow-up', row: i });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** How many follow-ups are due (today or earlier) and overdue — for the sidebar badge and the sign-in pop-up. */
export async function dueCounts(empId) {
  const day = today();
  const [rem, wl] = await Promise.all([
    db('followups').select('due_date').eq('emp_id', empId).eq('status', 'open').lte('due_date', day),
    db('worklist_items').select('follow_up,status').eq('assigned_to', empId).eq('active', true).eq('cleared', false).lte('follow_up', day),
  ]);
  const dates = [
    ...(rem.error ? [] : rem.data ?? []).map(r => r.due_date),
    ...(wl.error ? [] : wl.data ?? []).filter(i => !isDone(i.status)).map(i => i.follow_up),
  ];
  return { due: dates.length, overdue: dates.filter(d => d < day).length };
}

// ── Changes ────────────────────────────────────────────────────────────────

export async function addReminder({ empId, clientId, payerId, claimNumber, action, dueDate }, user) {
  const rows = await S.set('followups', {
    emp_id: empId, client_id: clientId || null, payer_id: payerId || null, claim_number: claimNumber?.trim() || null,
    action: action || 'other', due_date: dueDate, status: 'open', created_by: user.emp_id, updated_by: user.emp_id,
  });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: 'followup_add', entityType: 'followup', entityId: rows[0].id });
  changed();
  return rows[0];
}

/** Done: a reminder is closed; a worklist claim gets the chosen worklist status (counts as worked today). */
export async function markDone(f, user, worklistStatus = 'followup') {
  let ok;
  if (f.kind === 'reminder') {
    ok = await S.update('followups', { status: 'done', done_at: now(), updated_by: user.emp_id, updated_at: now() }, { id: f.row.id });
    if (ok) logAudit({ actor: user, action: 'followup_done', entityType: 'followup', entityId: f.row.id });
  } else {
    ok = await updateItem(f.row, { status: worklistStatus, ...(isDone(worklistStatus) ? {} : { follow_up: null }) }, user);
  }
  if (ok) changed();
  return !!ok;
}

export async function snooze(f, date, user) {
  let ok;
  if (f.kind === 'reminder') {
    ok = await S.update('followups', { due_date: date, snoozed_count: (f.row.snoozed_count ?? 0) + 1, updated_by: user.emp_id, updated_at: now() }, { id: f.row.id });
  } else {
    ok = await updateItem(f.row, { follow_up: date }, user);
  }
  if (ok) {
    logAudit({ actor: user, action: 'followup_snooze', entityType: f.kind === 'reminder' ? 'followup' : 'worklist_item', entityId: f.row.id });
    changed();
  }
  return !!ok;
}

/** Wipes the claim # of this person's reminders done (or due) more than 90 days ago. */
export async function clearOldReminders(empId, user) {
  const cutoff = addDays(today(), -CLEAR_REMINDERS_AFTER);
  const { data } = await db('followups').select('id,status,done_at,due_date').eq('emp_id', empId).eq('cleared', false).not('claim_number', 'is', null);
  const old = (data ?? []).filter(r => (r.status === 'done' ? (r.done_at ?? '').slice(0, 10) : r.due_date) < cutoff).map(r => r.id);
  if (!old.length) return 0;
  const { error } = await db('followups').update({ claim_number: null, cleared: true, updated_at: now() }).in('id', old);
  if (error) return 0;
  logAudit({ actor: user, action: 'followup_clear', entityType: 'followup', details: { count: old.length } });
  return old.length;
}

/** Team overview: per person overdue / due today / done today (reminders + worklist follow-ups). */
export async function teamCounts(empIds) {
  if (!empIds.length) return {};
  const day = today();
  const start = new Date(`${day}T00:00:00`).toISOString();
  const [rem, wl] = await Promise.all([
    db('followups').select('emp_id,status,due_date,done_at').in('emp_id', empIds).or(`status.eq.open,done_at.gte.${start}`),
    db('worklist_items').select('assigned_to,follow_up,status').in('assigned_to', empIds).eq('active', true).eq('cleared', false).lte('follow_up', day),
  ]);
  const out = Object.fromEntries(empIds.map(e => [e, { overdue: 0, today: 0, doneToday: 0 }]));
  for (const r of rem.error ? [] : rem.data ?? []) {
    const c = out[r.emp_id];
    if (!c) continue;
    if (r.status === 'done') c.doneToday++;
    else if (r.due_date < day) c.overdue++;
    else if (r.due_date === day) c.today++;
  }
  for (const i of wl.error ? [] : wl.data ?? []) {
    const c = out[i.assigned_to];
    if (!c || isDone(i.status)) continue;
    if (i.follow_up < day) c.overdue++; else c.today++;
  }
  return out;
}

// ── Opening the tab + browser notifications (6.5) ───────────────────────────

let openTabNext = false;
/** “Open” on the sign-in pop-up: go to Smart Worklist → ⏰ Follow-ups. */
export function openFollowups() {
  openTabNext = true;
  window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_worklist' }));
}
export const peekOpenFollowups = () => openTabNext;
export function clearOpenFollowups() { openTabNext = false; }

// Per-computer preference (a convenience setting — no claim data); storage may be blocked
const NOTIFY_KEY = 'hh_followup_notify';
export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
export function notifyEnabled() {
  try { return notifySupported() && localStorage.getItem(NOTIFY_KEY) === 'on' && Notification.permission === 'granted'; } catch { return false; }
}
/** Asks the browser for permission and remembers the choice on this computer. Returns true when switched on. */
export async function setNotify(on) {
  try {
    if (!on) { localStorage.removeItem(NOTIFY_KEY); return false; }
    if (!notifySupported()) return false;
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return false;
    localStorage.setItem(NOTIFY_KEY, 'on');
    return true;
  } catch { return false; }
}
