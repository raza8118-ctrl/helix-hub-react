// Medicare trackers (roadmap 7.5): ADRs, overpayments / credit balances and the RTP / suspense monitor.
// One config per tracker (fields, statuses, due dates) drives a shared editor and list. Same PHI rules as the
// Smart Worklist: minimum fields, patient columns dropped from uploads in the browser, notes checked for patient
// details, claim # / DCN wiped 90 days after an item is closed. Deadlines are labelled “check current CMS rules”.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { addDays, today } from './helpers';
import { daysBetween } from './deadlines';
import { phiIssues } from './appealAI';
import { PHI_HEADER, toDate, toMoney } from './worklist';

export const MEDICARE_CLEAR_AFTER_DAYS = 90;
export const ADR_DUE_DAYS = 45;
export const ADR_WARN_DAYS = 10;
export const REFUND_DUE_DAYS = 60;
export const CREDIT_REPORT_DAYS = 30;
export const RTP_AGE_BUCKETS = [
  { key: '0-2', label: '0–2 days', max: 2 }, { key: '3-7', label: '3–7', max: 7 }, { key: '8-14', label: '8–14', max: 14 },
  { key: '15-30', label: '15–30', max: 30 }, { key: '30+', label: '30+', max: Infinity },
];

// done = the item is finished (closed_at / resolved_at set, claim # wiped 90 days later)
export const TRACKERS = {
  adr: {
    table: 'medicare_adrs', ref: 'ADR', statusKey: 'status', closedKey: 'closed_at', label: 'ADR',
    statuses: [
      { value: 'received',   label: 'ADR received',      badge: 'badge-blue' },
      { value: 'requested',  label: 'Records requested', badge: 'badge-yellow' },
      { value: 'records_in', label: 'Records received',  badge: 'badge-blue' },
      { value: 'submitted',  label: 'Submitted',         badge: 'badge-purple' },
      { value: 'approved',   label: 'Approved',          badge: 'badge-green', done: true },
      { value: 'partial',    label: 'Partly approved',   badge: 'badge-yellow' },
      { value: 'denied',     label: 'Denied',            badge: 'badge-red' },
      { value: 'appealed',   label: 'Appealed',          badge: 'badge-purple' },
      { value: 'closed',     label: 'Closed',            badge: 'badge-gray', done: true },
    ],
    // date fields filled in automatically when the status moves on
    statusDates: { requested: 'requested_on', records_in: 'received_on', submitted: 'submitted_on', approved: 'decision_on', partial: 'decision_on', denied: 'decision_on' },
    fields: [
      { key: 'client_id', label: 'Client', type: 'client', required: true },
      { key: 'payer_id', label: 'MAC / payer', type: 'payer' },
      { key: 'claim_number', label: 'Claim # (optional)', type: 'claim' },
      { key: 'amount', label: '$ at risk', type: 'money' },
      { key: 'adr_date', label: 'ADR letter date', type: 'date', required: true },
      { key: 'due_date', label: 'Response due', type: 'date', from: 'adr_date', days: ADR_DUE_DAYS, hint: `Letter + ${ADR_DUE_DAYS} days — check current CMS rules` },
      { key: 'requested_on', label: 'Records requested from client', type: 'date' },
      { key: 'received_on', label: 'Records received', type: 'date' },
      { key: 'submitted_on', label: 'Submitted on', type: 'date' },
      { key: 'submit_method', label: 'Sent by', type: 'select', options: [
        { value: 'esmd', label: 'esMD' }, { value: 'portal', label: 'MAC portal' }, { value: 'fax', label: 'Fax' }, { value: 'mail', label: 'Mail' }] },
      { key: 'decision_on', label: 'Decision date', type: 'date' },
    ],
  },
  overpayment: {
    table: 'medicare_overpayments', ref: 'OP', statusKey: 'status', closedKey: 'closed_at', label: 'Overpayment',
    statuses: [
      { value: 'identified', label: 'Identified',             badge: 'badge-blue' },
      { value: 'validated',  label: 'Validated',              badge: 'badge-yellow' },
      { value: 'disputed',   label: 'Disputed / appealed',    badge: 'badge-purple' },
      { value: 'requested',  label: 'Refund requested',       badge: 'badge-yellow' },
      { value: 'refunded',   label: 'Refunded / offset',      badge: 'badge-green', done: true },
      { value: 'closed',     label: 'Closed',                 badge: 'badge-gray', done: true },
    ],
    statusDates: { refunded: 'refunded_on' },
    fields: [
      { key: 'kind', label: 'What', type: 'select', required: true, options: [
        { value: 'overpayment', label: 'Payer overpayment / recoupment' }, { value: 'credit_balance', label: 'Credit balance' },
        { value: 'refund_request', label: 'Refund request' }] },
      { key: 'source', label: 'Found from', type: 'select', options: [
        { value: 'payer_letter', label: 'Payer letter' }, { value: 'era_offset', label: 'ERA offset (WO / FB)' },
        { value: 'internal', label: 'Internal review' }, { value: 'credit_report', label: 'Credit balance report' }] },
      { key: 'client_id', label: 'Client', type: 'client', required: true },
      { key: 'payer_id', label: 'Payer', type: 'payer' },
      { key: 'claim_number', label: 'Claim # (optional)', type: 'claim' },
      { key: 'amount', label: 'Amount $', type: 'money', required: true },
      { key: 'reason', label: 'Reason', type: 'select', options: [
        { value: 'duplicate', label: 'Duplicate payment' }, { value: 'msp', label: 'Secondary / MSP' }, { value: 'wrong_payer', label: 'Wrong payer' },
        { value: 'rate', label: 'Rate / adjustment' }, { value: 'other', label: 'Other' }] },
      { key: 'identified_on', label: 'Identified on', type: 'date', required: true },
      { key: 'due_date', label: 'Refund due', type: 'date', from: 'identified_on', days: REFUND_DUE_DAYS, hint: `Identified + ${REFUND_DUE_DAYS} days (60-day rule) — check current rules` },
      { key: 'refund_method', label: 'Refund method', type: 'select', options: [
        { value: 'check', label: 'Check' }, { value: 'offset', label: 'Offset' }, { value: 'recoupment', label: 'Immediate recoupment' }] },
      { key: 'refunded_on', label: 'Refunded on', type: 'date' },
      { key: 'refunded_amount', label: 'Refunded $', type: 'money' },
    ],
  },
  rtp: {
    table: 'medicare_rtp_items', ref: 'RTP', statusKey: 'work_status', closedKey: 'resolved_at', label: 'RTP / suspense claim',
    statuses: [
      { value: 'new',       label: 'New',                 badge: 'badge-blue' },
      { value: 'working',   label: 'Working',             badge: 'badge-yellow' },
      { value: 'released',  label: 'Corrected / released', badge: 'badge-green', done: true },
      { value: 'cancelled', label: 'Cancelled',           badge: 'badge-gray', done: true },
      { value: 'no_action', label: 'No action needed',    badge: 'badge-gray', done: true },
    ],
    statusDates: {},
    fields: [
      { key: 'client_id', label: 'Client', type: 'client', required: true },
      { key: 'claim_number', label: 'Claim # / DCN', type: 'claim', required: true },
      { key: 'location', label: 'Status / location', type: 'text', hint: 'e.g. T B9997 (RTP) or S B6001 (suspense)' },
      { key: 'reason_code', label: 'Reason code', type: 'text', hint: 'FISS reason code' },
      { key: 'amount', label: 'Amount $', type: 'money' },
      { key: 'in_status_since', label: 'In this status since', type: 'date' },
    ],
  },
};

export const statusOf = (kind, v) => TRACKERS[kind].statuses.find(s => s.value === v) ?? TRACKERS[kind].statuses[0];
export const itemRef = (kind, id) => `${TRACKERS[kind].ref}-${String(id).padStart(4, '0')}`;
/** Done = finished status, or (RTP) no longer on the latest FISS upload. */
export const isDone = (kind, item) => !!statusOf(kind, item[TRACKERS[kind].statusKey]).done || (kind === 'rtp' && item.in_fiss === false);
export const optionLabel = (kind, key, v) => TRACKERS[kind].fields.find(f => f.key === key)?.options?.find(o => o.value === v)?.label ?? v ?? '';

const now = () => new Date().toISOString();

// ── Dates ──────────────────────────────────────────────────────────────────

/** Days left to the due date (negative = overdue), or null. */
export const daysLeft = item => (item.due_date ? daysBetween(today(), item.due_date) : null);
/** ADR waiting on the client: days since records were requested. */
export const waitingDays = item => (item.status === 'requested' && item.requested_on ? daysBetween(item.requested_on, today()) : null);
export const rtpAge = item => Math.max(0, daysBetween(item.in_status_since ?? item.created_at.slice(0, 10), today()));
export const rtpBucket = days => RTP_AGE_BUCKETS.find(b => days <= b.max).key;

/** The last N quarter ends (YYYY-MM-DD), newest first. */
export function quarterEnds(n = 4) {
  const out = [];
  const d = new Date(`${today()}T00:00:00`);
  let y = d.getFullYear();
  let q = Math.floor(d.getMonth() / 3);   // the current quarter isn't over yet → start with the previous one
  for (let i = 0; i < n; i++) {
    q -= 1;
    if (q < 0) { q = 3; y -= 1; }
    const end = new Date(y, q * 3 + 3, 0);
    out.push(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`);
  }
  return out;
}

// ── Access ─────────────────────────────────────────────────────────────────

export const canManageMedicare = user => hasAccess(user, 'medicare_manage');
export const canChangeItem = (user, item) => canManageMedicare(user) || item.owner_emp_id === user.emp_id || item.created_by === user.emp_id;

export function noteProblem(text) {
  const issues = phiIssues(text);
  return issues.length ? `This looks like it has ${issues.join(', ')}. Use the claim # field and leave out patient details.` : '';
}

// ── Loading ────────────────────────────────────────────────────────────────

async function loadAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db(table).select('*').order('id', { ascending: false }).range(from, from + 999);
    if (error) return from === 0 ? null : out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** { adr, overpayment, rtp, uploads } — null when the 7.5 database update hasn't been run. */
export async function loadMedicare() {
  const [adr, overpayment, rtp, uploads] = await Promise.all([
    loadAll('medicare_adrs'), loadAll('medicare_overpayments'), loadAll('medicare_rtp_items'),
    db('medicare_rtp_uploads').select('*').order('uploaded_at', { ascending: false }).limit(200),
  ]);
  if (adr == null) return null;
  return { adr, overpayment: overpayment ?? [], rtp: rtp ?? [], uploads: uploads.data ?? [] };
}

export async function loadItemEvents(kind, id) {
  const { data } = await db('medicare_events').select('*').eq('tracker', kind).eq('item_id', id).order('created_at');
  return data ?? [];
}

// ── Changes ────────────────────────────────────────────────────────────────

const addEvent = (kind, id, evKind, note, user) => S.set('medicare_events', { tracker: kind, item_id: id, kind: evKind, note: note?.trim() || null, emp_id: user.emp_id });

/** Checks an item before saving. Returns an error message or ''. */
export function checkItem(kind, v) {
  for (const f of TRACKERS[kind].fields) {
    if (f.required && (v[f.key] == null || v[f.key] === '')) return `${f.label.replace(' (optional)', '')} is needed.`;
  }
  if (v.amount != null && v.amount !== '' && !Number.isFinite(Number(v.amount))) return 'The amount must be a number.';
  return '';
}

const clean = (kind, v) => Object.fromEntries(TRACKERS[kind].fields.map(f => {
  const x = v[f.key];
  if (x === '' || x == null) return [f.key, null];
  if (f.type === 'money') return [f.key, Number(x)];
  if (f.type === 'claim' || f.type === 'text') return [f.key, String(x).trim()];
  return [f.key, x];
}));

export async function addItem(kind, v, user) {
  const t = TRACKERS[kind];
  const rows = await S.set(t.table, { ...clean(kind, v), owner_emp_id: v.owner_emp_id || user.emp_id, created_by: user.emp_id, updated_by: user.emp_id });
  if (!rows?.length) return null;
  await addEvent(kind, rows[0].id, 'added', null, user);
  logAudit({ actor: user, action: 'medicare_add', entityType: `medicare_${kind}`, entityId: rows[0].id });
  return rows[0];
}

async function change(kind, item, patch, evKind, note, user, action, details = null) {
  const rows = await S.update(TRACKERS[kind].table, { ...patch, updated_by: user.emp_id, updated_at: now() }, { id: item.id });
  if (!rows?.length) return null;
  await addEvent(kind, item.id, evKind, note, user);
  logAudit({ actor: user, action, entityType: `medicare_${kind}`, entityId: item.id, details });
  return rows[0];
}

export const editItem = (kind, item, v, user) => change(kind, item, clean(kind, v), 'edited', null, user, 'medicare_edit');
export const assignItem = (kind, item, empId, user) => change(kind, item, { owner_emp_id: empId }, 'assigned', null, user, 'medicare_assign', { to: empId });
export const addItemNote = (kind, item, note, user) => addEvent(kind, item.id, 'note', note, user).then(r => {
  if (r) logAudit({ actor: user, action: 'medicare_note', entityType: `medicare_${kind}`, entityId: item.id });
  return !!r;
});

/** Moves the status on: fills that status's date (if empty) and sets / clears the closed date. */
export function setItemStatus(kind, item, status, note, user) {
  const t = TRACKERS[kind];
  const patch = { [t.statusKey]: status };
  const dateKey = t.statusDates[status];
  if (dateKey && !item[dateKey]) patch[dateKey] = today();
  if (kind === 'adr' && ['approved', 'partial', 'denied'].includes(status)) patch.decision = status;
  const done = !!statusOf(kind, status).done;
  patch[t.closedKey] = done ? (item[t.closedKey] ?? now()) : null;
  return change(kind, item, patch, 'status', `${statusOf(kind, status).label}${note ? ` — ${note}` : ''}`, user, 'medicare_status', { status });
}

/** Wipes claim # / DCN of items closed / resolved more than 90 days ago (run when the page opens). */
export async function clearOldMedicare(user) {
  const cutoff = new Date(`${addDays(today(), -MEDICARE_CLEAR_AFTER_DAYS)}T00:00:00`).toISOString();
  let total = 0;
  for (const kind of Object.keys(TRACKERS)) {
    const t = TRACKERS[kind];
    const { data } = await db(t.table).select('id').eq('cleared', false).not('claim_number', 'is', null).lt(t.closedKey, cutoff);
    const ids = (data ?? []).map(r => r.id);
    if (!ids.length) continue;
    const { error } = await db(t.table).update({ claim_number: null, cleared: true, updated_at: now() }).in('id', ids);
    if (!error) total += ids.length;
  }
  if (total) logAudit({ actor: user, action: 'medicare_clear', entityType: 'medicare', details: { count: total } });
  return total;
}

// ── RTP / suspense upload ──────────────────────────────────────────────────

export const RTP_FIELDS = [
  { key: 'claim_number',    label: 'Claim # / DCN',       re: /\bdcn\b|claim|^icn|^ccn|document\s*control/i, required: true },
  { key: 'location',        label: 'Status / location',   re: /s\s*\/\s*loc|status.*loc|location|^status$|^loc$/i },
  { key: 'reason_code',     label: 'Reason code',         re: /reason/i },
  { key: 'amount',          label: 'Amount $',            re: /amount|charges?|billed|total/i },
  { key: 'in_status_since', label: 'In status since',     re: /status\s*date|date\s*in\s*status|since|recei?v(ed)?\s*date|^date$/i },
];

/** Suggested column for each field (patient columns never), plus the dropped headers. */
export function detectRtpColumns(headers) {
  const used = new Set();
  const map = {};
  for (const f of RTP_FIELDS) {
    const h = headers.find(x => !used.has(x) && !PHI_HEADER.test(x) && f.re.test(x));
    if (h) { map[f.key] = h; used.add(h); }
  }
  const kept = new Set(Object.values(map));
  const dropped = headers.filter(h => !kept.has(h));
  return { map, patient: dropped.filter(h => PHI_HEADER.test(h)), other: dropped.filter(h => !PHI_HEADER.test(h)) };
}

/** Minimum fields only, one row per claim # (later rows win); rows without a claim # are skipped. */
export function buildRtpRows(rows, map) {
  const out = new Map();
  let skipped = 0;
  for (const r of rows) {
    const claim = String(r[map.claim_number] ?? '').trim();
    if (!claim) { skipped += 1; continue; }
    out.set(claim.toUpperCase(), {
      claim_number: claim,
      location: map.location ? String(r[map.location] ?? '').trim() || null : null,
      reason_code: map.reason_code ? String(r[map.reason_code] ?? '').trim() || null : null,
      amount: map.amount ? toMoney(r[map.amount]) : null,
      in_status_since: map.in_status_since ? toDate(r[map.in_status_since]) : null,
    });
  }
  return { items: [...out.values()], skipped };
}

/**
 * Applies one FISS snapshot for a client: new claims added, known ones updated (back on the list if they had dropped
 * off), claims on the list before but missing now → “Cleared from FISS”. Returns { added, updated, cleared } or null.
 */
export async function applyRtpUpload(clientId, items, existing, fileRows, user) {
  const upload = (await S.set('medicare_rtp_uploads', { client_id: clientId, file_rows: fileRows, uploaded_by: user.emp_id }))?.[0];
  if (!upload) return null;
  const mine = existing.filter(i => i.client_id === clientId && !i.cleared && i.claim_number);
  const byClaim = new Map(mine.map(i => [i.claim_number.toUpperCase(), i]));
  const seen = new Set();
  const inserts = [];
  const updates = [];
  for (const it of items) {
    const key = it.claim_number.toUpperCase();
    seen.add(key);
    const old = byClaim.get(key);
    if (!old) {
      inserts.push({ ...it, client_id: clientId, first_seen_upload: upload.id, last_seen_upload: upload.id, created_by: user.emp_id, updated_by: user.emp_id });
    } else {
      const back = old.in_fiss === false;
      updates.push({ id: old.id, patch: {
        location: it.location ?? old.location, reason_code: it.reason_code ?? old.reason_code, amount: it.amount ?? old.amount,
        in_status_since: it.in_status_since ?? old.in_status_since, last_seen_upload: upload.id, in_fiss: true,
        ...(back ? { resolved_at: null, work_status: 'new' } : {}), updated_by: user.emp_id, updated_at: now(),
      } });
    }
  }
  const gone = mine.filter(i => i.in_fiss !== false && !seen.has(i.claim_number.toUpperCase()));

  for (let i = 0; i < inserts.length; i += 500) {
    if (!await S.set('medicare_rtp_items', inserts.slice(i, i + 500))) return null;
  }
  for (let i = 0; i < updates.length; i += 25) {
    await Promise.all(updates.slice(i, i + 25).map(u => S.update('medicare_rtp_items', u.patch, { id: u.id })));
  }
  if (gone.length) {
    const goneIds = gone.map(i => i.id);
    for (let i = 0; i < goneIds.length; i += 200) {
      await db('medicare_rtp_items').update({ in_fiss: false, resolved_at: now(), updated_by: user.emp_id, updated_at: now() }).in('id', goneIds.slice(i, i + 200));
    }
    await S.set('medicare_events', gone.map(i => ({ tracker: 'rtp', item_id: i.id, kind: 'cleared_fiss', note: null, emp_id: user.emp_id })));
  }
  await S.update('medicare_rtp_uploads', { added: inserts.length, updated: updates.length, cleared_count: gone.length }, { id: upload.id });
  logAudit({ actor: user, action: 'rtp_upload', entityType: 'medicare_rtp_upload', entityId: upload.id,
    details: { rows: fileRows, added: inserts.length, updated: updates.length, cleared: gone.length } });
  return { added: inserts.length, updated: updates.length, cleared: gone.length };
}
