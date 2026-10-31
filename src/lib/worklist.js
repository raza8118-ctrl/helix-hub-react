// Smart Worklist (roadmap 6.4). PO decision 2026-10-20: no BAA with Supabase → only the minimum claim fields are stored.
// Patient name, DOB, member ID, MRN and address columns are dropped in the browser on upload and never saved;
// claim # and dates of service are wiped when a worklist is closed or 90 days after upload. No free-text notes on claims.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { matchPayer } from './payers';
import { loadPayerInfo } from './denialSteps';
import { fromKeyOf, daysBetween } from './deadlines';
import { addDays, today } from './helpers';

export const CLEAR_AFTER_DAYS = 90;
const now = () => new Date().toISOString();

// ── Columns ────────────────────────────────────────────────────────────────

// Fields we keep, with the header patterns that find them (first match wins, each header used once)
export const FIELDS = [
  { key: 'claim_number', label: 'Claim #',          re: /claim\s*(#|no\b|num|number|id\b)|^icn|^tcn|^ccn|^claim$/i },
  { key: 'payer_name',   label: 'Payer',            re: /payer|insurance|insurer|carrier|financial class|plan name/i },
  { key: 'dos_from',     label: 'DOS from',         re: /(dos|service).*(from|start|begin)|from\s*date|^dos$|date of service|start of care|^soc$/i },
  { key: 'dos_to',       label: 'DOS to',           re: /(dos|service).*(to|thru|through|end)|thru\s*date|through\s*date|to\s*date/i },
  { key: 'billed',       label: 'Billed $',         re: /billed\s*(amt|amount|\$)?$|total\s*charges?|charges?$|amount\s*billed/i },
  { key: 'balance',      label: 'Balance $',        re: /balance|outstanding|open\s*(amt|amount)|ar\s*(amt|amount)|amount\s*due|expected/i },
  { key: 'aging_days',   label: 'Aging (days)',     re: /aging|days\s*(out|old|outstanding|in ar)|^age$|^days$/i },
  { key: 'denial_date',  label: 'Denial date',      re: /denial\s*date|denied\s*(on|date)|remit\s*date|eob\s*date|era\s*date/i },
  // 10.2 (optional): CARC / RARC codes are not patient data; saved only when the file has the column
  { key: 'denial_code',  label: 'Denial code (CARC / RARC)', re: /carc|rarc|reason\s*code|denial\s*code|adj(ustment)?\s*(reason|code)|remark\s*code/i },
  { key: 'last_billed',  label: 'Last billed date', re: /last\s*(billed|bill|submit)|billed\s*date|submission\s*date|submit(ted)?\s*date|claim\s*date/i },
];

// Columns that identify the patient — always dropped and listed as such
export const PHI_HEADER = /patient|member|subscriber|insured|beneficiary|\bdob\b|birth|\bmrn\b|medical\s*record|\bssn\b|social|address|street|city|\bzip\b|postal|phone|e-?mail|first\s*name|last\s*name|^name$|full\s*name|\bmbi\b|\bhicn\b|account\s*(#|no|num)/i;

/** Suggested column for each field, plus which headers will be dropped (patient vs other). */
export function detectColumns(headers) {
  const used = new Set();
  const map = {};
  for (const f of FIELDS) {
    const h = headers.find(x => !used.has(x) && !PHI_HEADER.test(x) && f.re.test(x));
    if (h) { map[f.key] = h; used.add(h); }
  }
  return map;
}
export function droppedColumns(headers, map) {
  const kept = new Set(Object.values(map).filter(Boolean));
  const dropped = headers.filter(h => !kept.has(h));
  return { patient: dropped.filter(h => PHI_HEADER.test(h)), other: dropped.filter(h => !PHI_HEADER.test(h)) };
}

// ── Reading values ──────────────────────────────────────────────────────────

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return ymd(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return null;
}
export function toMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const toInt = v => { const n = parseInt(String(v ?? '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

/** Reads the first sheet. Returns { headers, rows } (rows are raw objects — kept in memory only until upload). */
export async function readWorklistFile(file) {
  const XLSX = await import('xlsx');
  // CSV / text: keep every cell as typed (raw). Otherwise "2026-08-01" becomes UTC midnight and lands a day early in US
  // time zones, and claim numbers lose leading zeros; toDate / toMoney / toInt read the text. Excel files unchanged.
  const isText = /\.(csv|txt|tsv)$/i.test(file.name ?? '');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true, raw: isText });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!rows.length) return { error: 'The file is empty.' };
  return { headers: Object.keys(rows[0]), rows };
}

/** Best payer for a name from the file (exact name / alias, or a close start-of-name match). */
export function matchPayerName(payers, name) {
  if (!String(name ?? '').trim()) return null;
  let best = null;
  for (const p of payers) {
    if (p.active === false) continue;
    const m = matchPayer(p, String(name));
    if (m && m.score <= 1 && (!best || m.score < best.score)) best = { payer: p, score: m.score };
  }
  return best?.payer ?? null;
}

/**
 * Raw rows → items with ONLY the minimum fields (everything else is left behind in the browser).
 * Rows without a claim # and without a balance are skipped.
 */
export function buildItems(rows, map, payers, clientId) {
  const items = [];
  let skipped = 0;
  const payerCache = new Map();   // the same payer name appears on many rows — match it once
  for (const r of rows) {
    const get = k => (map[k] ? r[map[k]] : '');
    const claim = String(get('claim_number') ?? '').trim();
    const balance = toMoney(get('balance'));
    if (!claim && balance == null) { skipped++; continue; }
    const payerName = String(get('payer_name') ?? '').trim();
    if (!payerCache.has(payerName)) payerCache.set(payerName, matchPayerName(payers, payerName));
    const payer = payerCache.get(payerName);
    items.push({
      claim_number: claim || null, payer_name: payerName || null, payer_id: payer?.id ?? null, client_id: clientId || null,
      dos_from: toDate(get('dos_from')), dos_to: toDate(get('dos_to')), billed: toMoney(get('billed')), balance,
      aging_days: toInt(get('aging_days')), denial_date: toDate(get('denial_date')), last_billed: toDate(get('last_billed')),
      ...(map.denial_code ? { denial_code: String(get('denial_code') ?? '').trim().toUpperCase().slice(0, 40) || null } : {}),   // 10.2
    });
  }
  return { items, skipped };
}

// ── Deadlines and priority ─────────────────────────────────────────────────

/**
 * Deadline from the payer / client limits: appeal (AFL) from the denial date when there is one, otherwise timely filing
 * (TFL) from the date of service. Adds { deadline, deadline_type } to each item (null when no limit is recorded).
 */
export async function addDeadlines(items, clientId) {
  const payerIds = [...new Set(items.map(i => i.payer_id).filter(Boolean))];
  const limitsByPayer = {};
  await Promise.all(payerIds.map(async id => { limitsByPayer[id] = (await loadPayerInfo(id, clientId || null)).limits; }));
  const pick = (limits, type) => (limits ?? []).find(l => l.limit_type === type && (l.level ?? 1) === 1 && l.days != null && !l.plan_id)
    ?? (limits ?? []).find(l => l.limit_type === type && l.days != null);
  return items.map(i => {
    const limits = limitsByPayer[i.payer_id];
    const dates = { denial: i.denial_date, dos: i.dos_to || i.dos_from, discharge: i.dos_to, paid: null };
    for (const [type, when] of [['AFL', i.denial_date], ['TFL', true]]) {
      if (!when) continue;
      const l = pick(limits, type);
      const start = l && dates[fromKeyOf(l.measured_from).key];
      if (l && start) return { ...i, deadline: addDays(start, l.days), deadline_type: type };
    }
    return { ...i, deadline: null, deadline_type: null };
  });
}

export const DEFAULT_WEIGHTS = { deadline: 1, dollars: 1, payer: 1 };
export const BANDS = {
  high:   { label: 'High',   icon: '🔴', badge: 'badge-red' },
  medium: { label: 'Medium', icon: '🟠', badge: 'badge-orange' },
  low:    { label: 'Low',    icon: '🟢', badge: 'badge-green' },
};
const money = n => '$' + Math.round(n).toLocaleString('en-US');

/**
 * Priority of every item in a worklist (worked out in the browser so weight changes apply at once).
 * Returns the items with { score, band, reason, daysLeft } added, highest first.
 */
export function prioritise(items, { weights = DEFAULT_WEIGHTS, starred = [] } = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const total = (w.deadline + w.dollars + w.payer) || 1;
  const balances = items.map(i => Math.max(0, i.balance ?? 0)).sort((a, b) => a - b);
  // Percentile of a balance within the worklist (binary search: how many balances are smaller)
  const below = b => { let lo = 0, hi = balances.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (balances[mid] < b) lo = mid + 1; else hi = mid; } return lo; };
  const pct = b => (balances.length > 1 ? (below(b) / (balances.length - 1)) * 100 : 50);
  const day = today();
  const starredSet = new Set((starred ?? []).map(String));
  return items.map(i => {
    const daysLeft = i.deadline ? daysBetween(day, i.deadline) : null;
    const d = daysLeft == null
      ? (i.aging_days >= 120 ? 60 : i.aging_days >= 90 ? 45 : i.aging_days >= 60 ? 30 : 15)
      : daysLeft <= 0 ? 100 : daysLeft <= 7 ? 90 : daysLeft <= 14 ? 75 : daysLeft <= 30 ? 55 : daysLeft <= 60 ? 35 : 15;
    const m = pct(Math.max(0, i.balance ?? 0));
    const p = i.payer_id != null && starredSet.has(String(i.payer_id)) ? 100 : 0;
    const score = Math.round((w.deadline * d + w.dollars * m + w.payer * p) / total);
    const band = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    const reason = [
      daysLeft == null ? (i.aging_days != null ? `aging ${i.aging_days} days` : 'no deadline on file')
        : daysLeft < 0 ? `${i.deadline_type} past due by ${-daysLeft} days` : `${i.deadline_type} in ${daysLeft} days`,
      i.balance != null && money(i.balance),
      p ? '★ priority payer' : null,
    ].filter(Boolean).join(' · ');
    return { ...i, score, band, reason, daysLeft };
  }).sort((a, b) => b.score - a.score || (b.balance ?? 0) - (a.balance ?? 0));
}

// ── Statuses ───────────────────────────────────────────────────────────────

export const ITEM_STATUSES = [
  { value: 'new',          label: 'Not worked yet' },
  { value: 'followup',     label: 'Worked – follow-up' },
  { value: 'appealed',     label: 'Appealed' },
  { value: 'rebilled',     label: 'Rebilled / corrected' },
  { value: 'paid',         label: 'Paid' },
  { value: 'denied_final', label: 'Denied – no further action' },
  { value: 'closed',       label: 'Closed' },
];
export const itemStatusOf = v => ITEM_STATUSES.find(s => s.value === v) ?? ITEM_STATUSES[0];
export const isDone = v => ['paid', 'denied_final', 'closed'].includes(v);

// ── Database ───────────────────────────────────────────────────────────────

/** Worklists, or null when the 6.4 database update hasn't been run. */
export async function loadWorklists() {
  const { data, error } = await db('worklists').select('*');
  if (error) return null;
  return (data ?? []).sort((a, b) => (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''));
}

/** Every item of the given worklists (paged — the server returns at most 1,000 rows per request). */
export async function loadItems({ worklistIds = null, assignedTo = null } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db('worklist_items').select('*').eq('active', true);
    if (worklistIds) q = q.in('worklist_id', worklistIds.length ? worklistIds : [-1]);
    if (assignedTo) q = q.eq('assigned_to', assignedTo);
    const { data, error } = await q.order('id').range(from, from + 999);
    if (error) return out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Saves a new worklist and its items (500 per request). Returns the worklist row, or null. */
export async function saveWorklist(meta, items, user, onProgress) {
  const rows = await S.set('worklists', { ...meta, status: 'open', row_count: items.length, uploaded_by: user.emp_id, created_by: user.emp_id, updated_by: user.emp_id });
  if (!rows?.length) return null;
  const wl = rows[0];
  let saved = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map(it => ({
      worklist_id: wl.id, claim_number: it.claim_number, payer_id: it.payer_id, payer_name: it.payer_name, client_id: it.client_id,
      dos_from: it.dos_from, dos_to: it.dos_to, billed: it.billed, balance: it.balance, aging_days: it.aging_days,
      denial_date: it.denial_date, last_billed: it.last_billed, deadline: it.deadline, deadline_type: it.deadline_type,
      status: 'new', active: true, updated_by: user.emp_id,
      ...('denial_code' in it ? { denial_code: it.denial_code } : {}),   // 10.2
    }));
    let r = await S.set('worklist_items', chunk);
    // 10.2: the denial code column arrives with 20261021w — until then the claims are saved without it
    if (!r && chunk.some(c => 'denial_code' in c)) r = await S.set('worklist_items', chunk.map(c => { const copy = { ...c }; delete copy.denial_code; return copy; }));
    saved += r?.length ?? 0;
    onProgress?.(`Saving claims… ${saved.toLocaleString()} of ${items.length.toLocaleString()}`);
  }
  logAudit({ actor: user, action: 'worklist_upload', entityType: 'worklist', entityId: wl.id, details: { rows: saved, dropped_columns: meta.dropped_columns ?? 0 } });
  return wl;
}

export async function saveWorklistSettings(wl, patch, user) {
  const ok = await S.update('worklists', { ...patch, updated_by: user.emp_id, updated_at: now() }, { id: wl.id });
  if (ok) logAudit({ actor: user, action: 'worklist_settings', entityType: 'worklist', entityId: wl.id });
  return !!ok;
}

/** Assigns items to one person (or unassigns with empId = null), 200 ids per request. */
export async function assignItems(ids, empId, user, worklistId) {
  let done = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db('worklist_items').update({ assigned_to: empId, updated_by: user.emp_id, updated_at: now() }).in('id', ids.slice(i, i + 200));
    if (!error) done += Math.min(200, ids.length - i);
  }
  logAudit({ actor: user, action: 'worklist_assign', entityType: 'worklist', entityId: worklistId, details: { claims: done, unassign: empId == null } });
  return done;
}

/**
 * Splits prioritised items among people: by count (round-robin, highest priority first) or by dollars (each claim goes
 * to whoever has the smallest total so far). Returns { emp_id: [item ids] }.
 */
export function planSplit(items, empIds, mode = 'count') {
  const plan = Object.fromEntries(empIds.map(e => [e, []]));
  const totals = Object.fromEntries(empIds.map(e => [e, 0]));
  items.forEach((it, i) => {
    const to = mode === 'dollars'
      ? empIds.reduce((a, b) => (totals[b] < totals[a] ? b : a))
      : empIds[i % empIds.length];
    plan[to].push(it.id);
    totals[to] += Math.max(0, it.balance ?? 0);
  });
  return plan;
}

/** Status / follow-up change by the person working the claim. Any status other than "new" counts as worked today. */
export async function updateItem(item, patch, user) {
  const worked = patch.status && patch.status !== 'new';
  const rows = await S.update('worklist_items', {
    ...patch, ...(worked ? { worked_at: now(), worked_by: user.emp_id } : {}), updated_by: user.emp_id, updated_at: now(),
  }, { id: item.id });
  if (rows?.length && patch.status) logAudit({ actor: user, action: 'worklist_item_status', entityType: 'worklist_item', entityId: item.id, details: { status: patch.status } });
  return rows?.[0] ?? null;
}

/** Closes a worklist and wipes claim # and dates of service on its items (rows, statuses and $ are kept). */
export async function closeAndClear(wl, user, { auto = false } = {}) {
  const { error } = await db('worklist_items').update({ claim_number: null, dos_from: null, dos_to: null, cleared: true, updated_at: now() }).eq('worklist_id', wl.id);
  if (error) return false;
  await S.update('worklists', { status: 'closed', closed_at: wl.closed_at ?? now(), cleared_at: now(), updated_by: user.emp_id, updated_at: now() }, { id: wl.id });
  logAudit({ actor: user, action: 'worklist_close_clear', entityType: 'worklist', entityId: wl.id, details: { automatic: auto } });
  return true;
}

/** Worklists older than CLEAR_AFTER_DAYS that still hold claim details. */
export const dueForClearing = worklists => (worklists ?? []).filter(w => !w.cleared_at
  && w.uploaded_at && daysBetween(w.uploaded_at.slice(0, 10), today()) >= CLEAR_AFTER_DAYS);

/** Claims this person worked on a day, grouped by the Daily Report task they count towards: { task: n }. */
export async function workedCounts(empId, date) {
  const start = new Date(`${date}T00:00:00`).toISOString();
  const end = new Date(`${addDays(date, 1)}T00:00:00`).toISOString();
  const { data, error } = await db('worklist_items').select('worklist_id').eq('worked_by', empId).gte('worked_at', start).lt('worked_at', end);
  if (error || !data?.length) return {};
  const ids = [...new Set(data.map(r => r.worklist_id))];
  const { data: lists } = await db('worklists').select('id,count_task').in('id', ids);
  const taskOf = Object.fromEntries((lists ?? []).map(l => [l.id, l.count_task]));
  const out = {};
  for (const r of data) {
    const t = taskOf[r.worklist_id];
    if (t) out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}
