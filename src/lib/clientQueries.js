// Client Query Log (roadmap 7.3): questions we send a client, chased until answered, with aging.
// Same PHI rules as the Smart Worklist: minimum fields, texts checked for patient details, claim # wiped 90 days after
// a query is closed. Everyone sees all queries; people change their own (“Manage client queries” changes anyone's).
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { addDays, today, isWknd } from './helpers';
import { daysBetween } from './deadlines';
import { phiIssues } from './appealAI';

export const CHASE_EVERY_WORKDAYS = 3;
export const QUERY_CLEAR_AFTER_DAYS = 90;

export const QUERY_CATEGORIES = [
  { value: 'documentation', label: 'Documentation' },
  { value: 'authorization', label: 'Authorization' },
  { value: 'demographics',  label: 'Demographics / insurance' },
  { value: 'coding',        label: 'Coding' },
  { value: 'billing_hold',  label: 'Billing hold' },
  { value: 'credentialing', label: 'Credentialing' },
  { value: 'payment',       label: 'Payment / refund' },
  { value: 'other',         label: 'Other' },
];
export const QUERY_STATUSES = [
  { value: 'open',      label: 'Open',              badge: 'badge-blue' },
  { value: 'waiting',   label: 'Waiting on client', badge: 'badge-yellow' },
  { value: 'answered',  label: 'Answered',          badge: 'badge-green' },
  { value: 'closed',    label: 'Closed',            badge: 'badge-gray' },
  { value: 'cancelled', label: 'Cancelled',         badge: 'badge-gray' },
];
export const ASKED_VIA = [
  { value: 'email', label: 'Email' }, { value: 'portal', label: 'Client portal' },
  { value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' },
];
export const AGE_BUCKETS = [
  { key: '0-2', label: '0–2 days', max: 2 }, { key: '3-7', label: '3–7', max: 7 }, { key: '8-14', label: '8–14', max: 14 },
  { key: '15-30', label: '15–30', max: 30 }, { key: '30+', label: '30+', max: Infinity },
];
const EVENT_LABELS = {
  asked: 'Asked', edited: 'Edited', chased: 'Chased', answered: 'Answered', closed: 'Closed', cancelled: 'Cancelled',
  reopened: 'Reopened', escalated: 'Escalated', unescalated: 'Escalation removed', assigned: 'Reassigned', note: 'Note',
};

export const categoryLabel = v => QUERY_CATEGORIES.find(c => c.value === v)?.label ?? 'Other';
export const statusOf = v => QUERY_STATUSES.find(s => s.value === v) ?? QUERY_STATUSES[0];
export const viaLabel = v => ASKED_VIA.find(a => a.value === v)?.label ?? v;
export const eventLabel = k => EVENT_LABELS[k] ?? k;
export const queryRef = id => `Q-${String(id).padStart(4, '0')}`;

const now = () => new Date().toISOString();

// ── Dates & aging ──────────────────────────────────────────────────────────

/** n working days (Mon–Fri) after a date. */
export function addWorkdays(date, n) {
  let d = date;
  for (let left = n; left > 0;) { d = addDays(d, 1); if (!isWknd(d)) left -= 1; }
  return d;
}

export const isOpen = q => q.status === 'open' || q.status === 'waiting';

/** Days from asked to answered (or closed / cancelled), or to today while still open. */
export function ageDays(q) {
  const end = isOpen(q) ? today() : (q.answered_at ?? q.closed_at ?? q.updated_at ?? now()).slice(0, 10);
  return Math.max(0, daysBetween(q.asked_on, end));
}
export const ageBucket = days => AGE_BUCKETS.find(b => days <= b.max).key;
export const isOverdue = q => isOpen(q) && !!q.expected_on && q.expected_on < today();
/** Unanswered and 3 working days since it was asked or last chased. */
export const chaseDue = q => isOpen(q) && addWorkdays((q.last_chased_at ?? q.asked_on).slice(0, 10), CHASE_EVERY_WORKDAYS) <= today();

// ── Access ─────────────────────────────────────────────────────────────────

export const canManageQueries = user => hasAccess(user, 'queries_manage');
export const canChange = (user, q) => canManageQueries(user) || q.owner_emp_id === user.emp_id || q.created_by === user.emp_id;

/** Patient-detail check for anything typed. Returns an error message or ''. */
export function textProblem(text, label = 'This') {
  const issues = phiIssues(text);
  return issues.length ? `${label} looks like it has ${issues.join(', ')}. Use the claim # field and describe the question without patient details.` : '';
}

// ── Loading ────────────────────────────────────────────────────────────────

/** All queries (paged), or null when the 7.3 database update hasn't been run. */
export async function loadQueries() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db('client_queries').select('*').order('id', { ascending: false }).range(from, from + 999);
    if (error) return from === 0 ? null : out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadEvents(queryId) {
  const { data } = await db('client_query_events').select('*').eq('query_id', queryId).order('created_at');
  return data ?? [];
}

// ── Changes ────────────────────────────────────────────────────────────────

const addEvent = (queryId, kind, note, user) => S.set('client_query_events', { query_id: queryId, kind, note: note?.trim() || null, emp_id: user.emp_id });

/** Checks a new / edited query. Returns an error message or ''. */
export function checkQuery(q) {
  if (!q.client_id) return 'Choose the client.';
  if (!q.question?.trim()) return 'Type the question.';
  if (!q.owner_emp_id) return 'Choose who follows it up.';
  if (q.expected_on && q.expected_on < q.asked_on) return 'The expected answer date is before the asked date.';
  return textProblem(q.question, 'The question') || textProblem(q.contact_name, 'The contact name');
}

const fields = q => ({
  client_id: q.client_id, team: q.team || null, category: q.category || 'other', priority: q.priority || 'normal',
  payer_id: q.payer_id || null, claim_number: q.claim_number?.trim() || null, question: q.question.trim(),
  asked_via: q.asked_via || 'email', asked_on: q.asked_on, expected_on: q.expected_on || null,
  contact_name: q.contact_name?.trim() || null,
});

export async function addQuery(q, user) {
  const rows = await S.set('client_queries', {
    ...fields(q), owner_emp_id: q.owner_emp_id, status: 'open', created_by: user.emp_id, updated_by: user.emp_id,
  });
  if (!rows?.length) return null;
  await addEvent(rows[0].id, 'asked', null, user);
  logAudit({ actor: user, action: 'query_add', entityType: 'client_query', entityId: rows[0].id });
  return rows[0];
}

/** One change + its history line + the audit log. */
async function change(q, patch, kind, note, user, action, details = null) {
  const rows = await S.update('client_queries', { ...patch, updated_by: user.emp_id, updated_at: now() }, { id: q.id });
  if (!rows?.length) return null;
  await addEvent(q.id, kind, note, user);
  logAudit({ actor: user, action, entityType: 'client_query', entityId: q.id, details });
  return rows[0];
}

export const editQuery = (q, values, user) => change(q, fields(values), 'edited', null, user, 'query_edit');
export const chaseQuery = (q, user) => change(q, { status: 'waiting', chase_count: (q.chase_count ?? 0) + 1, last_chased_at: now() }, 'chased', null, user, 'query_chase');
export const answerQuery = (q, answer, user) => change(q, { status: 'answered', answer: answer.trim(), answered_at: now() }, 'answered', answer, user, 'query_answer');
export const closeQuery = (q, user) => change(q, { status: 'closed', closed_at: now() }, 'closed', null, user, 'query_close');
export const cancelQuery = (q, note, user) => change(q, { status: 'cancelled', closed_at: now() }, 'cancelled', note, user, 'query_cancel');
export const reopenQuery = (q, note, user) => change(q, { status: 'open', closed_at: null, answered_at: null }, 'reopened', note, user, 'query_reopen');
export const escalateQuery = (q, on, note, user) => change(q, { escalated: on }, on ? 'escalated' : 'unescalated', note, user, 'query_escalate', { escalated: on });
export const assignQuery = (q, empId, user) => change(q, { owner_emp_id: empId }, 'assigned', null, user, 'query_assign', { to: empId });
export async function addNote(q, note, user) {
  const ok = await addEvent(q.id, 'note', note, user);
  return !!ok;
}

/** Wipes the claim # of queries closed / cancelled more than 90 days ago (run when the page opens). */
export async function clearOldQueries(user) {
  const cutoff = new Date(`${addDays(today(), -QUERY_CLEAR_AFTER_DAYS)}T00:00:00`).toISOString();
  const { data } = await db('client_queries').select('id').eq('cleared', false).not('claim_number', 'is', null).lt('closed_at', cutoff);
  const ids = (data ?? []).map(r => r.id);
  if (!ids.length) return 0;
  const { error } = await db('client_queries').update({ claim_number: null, cleared: true, updated_at: now() }).in('id', ids);
  if (error) return 0;
  logAudit({ actor: user, action: 'query_clear', entityType: 'client_query', details: { count: ids.length } });
  return ids.length;
}

/** Ready-to-paste chase message — reference, client, category, asked date and the question only. */
export function chaseMessage(q, clientName, user) {
  const asked = new Date(`${q.asked_on}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return [
    `Hello${q.contact_name ? ` ${q.contact_name}` : ''},`,
    '',
    `Following up on our query ${queryRef(q.id)} (${categoryLabel(q.category)}) sent on ${asked}${q.chase_count ? ` — reminder ${q.chase_count + 1}` : ''}:`,
    '',
    q.question,
    '',
    `Could you please reply when you can? Please quote ${queryRef(q.id)} in your answer.`,
    '',
    'Thank you,',
    `${user.name ?? ''} — 3Gen Consulting${clientName ? ` (for ${clientName})` : ''}`,
  ].join('\n');
}

// ── Aging ──────────────────────────────────────────────────────────────────

/** Per key (client_id or owner_emp_id): { key, open, buckets {…}, overdue, escalated, answered, avgDays }. */
export function agingBy(queries, key) {
  const by = {};
  for (const q of queries) {
    if (q.status === 'cancelled') continue;
    const k = q[key];
    const r = (by[k] ??= { key: k, open: 0, buckets: Object.fromEntries(AGE_BUCKETS.map(b => [b.key, 0])), overdue: 0, escalated: 0, answeredDays: [] });
    if (isOpen(q)) {
      r.open += 1;
      r.buckets[ageBucket(ageDays(q))] += 1;
      if (isOverdue(q)) r.overdue += 1;
      if (q.escalated) r.escalated += 1;
    } else if (q.answered_at) {
      r.answeredDays.push(ageDays(q));
    }
  }
  return Object.values(by).map(({ answeredDays, ...r }) => ({
    ...r, answered: answeredDays.length,
    avgDays: answeredDays.length ? Math.round((answeredDays.reduce((t, d) => t + d, 0) / answeredDays.length) * 10) / 10 : null,
  }));
}
