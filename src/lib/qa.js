// QA Audit module (roadmap 7.1): scorecards, error categories, audits with agent acknowledgement / dispute, sampling
// from the Smart Worklist, and results. Same PHI rules as the Smart Worklist: minimum fields, claim # wiped 90 days
// after the audit is closed, comments checked for patient details. Daily Report quality % is NOT touched.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { addDays, today } from './helpers';
import { phiIssues } from './appealAI';

export const QA_CLEAR_AFTER_DAYS = 90;
export const DEFAULT_PASS_MARK = 95;

export const QA_STATUSES = [
  { value: 'queued',       label: 'To audit',             badge: 'badge-gray' },
  { value: 'draft',        label: 'Draft',                badge: 'badge-yellow' },
  { value: 'sent',         label: 'Waiting for agent',    badge: 'badge-blue' },
  { value: 'acknowledged', label: 'Acknowledged',         badge: 'badge-green' },
  { value: 'disputed',     label: 'Disputed',             badge: 'badge-red' },
  { value: 'resolved',     label: 'Dispute resolved',     badge: 'badge-purple' },
];
export const qaStatusOf = v => QA_STATUSES.find(s => s.value === v) ?? QA_STATUSES[1];
export const RESULTS = [
  { value: 'pass', label: '✓ Pass' },
  { value: 'fail', label: '✗ Fail' },
  { value: 'na',   label: 'N/A' },
];
const AGENT_STATUSES = ['sent', 'acknowledged', 'disputed', 'resolved'];   // what the agent sees
export const isClosed = a => a.status === 'acknowledged' || a.status === 'resolved';

const now = () => new Date().toISOString();

// ── Who can do what ────────────────────────────────────────────────────────

/** Do QA audits: “Do QA audits” (admin / manager / supervisor by default, grantable) or the QA flag on the Team page. */
export const canAudit = user => hasAccess(user, 'qa_audit') || !!user?.is_qa;
export const canManageQa = user => hasAccess(user, 'qa_manage');
/** Admins, managers and QA see everyone; supervisors only their own team and supervisees. */
export const seesEveryone = user => ['admin', 'manager'].includes(user?.role) || !!user?.is_qa;
export function scopePeople(user, users) {
  const others = users.filter(u => u.emp_id !== user.emp_id);
  if (seesEveryone(user)) return others;
  return others.filter(u => (user.team && u.team === user.team) || (u.supervisor_ids ?? []).includes(user.emp_id));
}

/** Active people (team / QA columns arrive with step 0.3 — loaded without them if that update hasn't been run). */
export async function loadPeople() {
  let { data, error } = await db('users').select('emp_id,name,team,role,active,supervisor_ids,is_qa');
  if (error) ({ data } = await db('users').select('emp_id,name,role,active,supervisor_ids'));
  return (data ?? []).filter(u => u.active !== false).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

// ── Scores ─────────────────────────────────────────────────────────────────

/** A copy of the scorecard's checkpoints for a new audit (later scorecard edits never change old audits). */
export const newResults = checkpoints => checkpoints.filter(c => c.active !== false).map(c => ({
  checkpoint_id: c.id, text: c.text, weight: Number(c.weight) || 1, critical: !!c.critical, result: 'pass',
  category_id: c.category_id ?? null, sop_id: c.sop_id ?? null, comment: '', overturned: false,
}));

/** Overturned fails count as passes. */
export const failed = r => r.result === 'fail' && !r.overturned;

/** { score (0–100, 1 decimal, null if nothing checked), passed, fatal } — a failed critical checkpoint makes it 0. */
export function scoreOf(results, passMark = DEFAULT_PASS_MARK) {
  const checked = results.filter(r => r.result !== 'na');
  const total = checked.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  if (!total) return { score: null, passed: null, fatal: false };
  const fatal = checked.some(r => r.critical && failed(r));
  const got = checked.filter(r => !failed(r)).reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const score = fatal ? 0 : Math.round((got / total) * 1000) / 10;
  return { score, passed: score >= passMark, fatal };
}

/** Patient-detail check for anything typed into an audit. Returns an error message or ''. */
export function commentProblem(text) {
  const issues = phiIssues(text);
  return issues.length ? `This looks like it has ${issues.join(', ')}. Describe the mistake without any patient or claim details.` : '';
}

// ── Loading ────────────────────────────────────────────────────────────────

/** true when the 7.1 database update has been run. */
export async function qaReady() {
  const { error } = await db('qa_audits').select('id').limit(1);
  return !error;
}

const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

/** Categories, scorecards and checkpoints (all, incl. inactive — callers filter). */
export async function loadQaSetup() {
  const [cats, cards, cps] = await Promise.all([
    db('qa_categories').select('*'), db('qa_scorecards').select('*'), db('qa_checkpoints').select('*'),
  ]);
  return {
    categories: (cats.data ?? []).sort(bySort),
    scorecards: (cards.data ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    checkpoints: (cps.data ?? []).sort(bySort),
  };
}

/** Audits (paged): agent = one person's audits; from / to = work dates (inclusive). */
export async function loadAudits({ agent = null, from = null, to = null, statuses = null } = {}) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = db('qa_audits').select('*').eq('active', true);
    if (agent) q = q.eq('agent_emp_id', agent);
    if (from) q = q.gte('work_date', from);
    if (to) q = q.lte('work_date', to);
    if (statuses) q = q.in('status', statuses);
    const { data, error } = await q.order('id', { ascending: false }).range(start, start + 999);
    if (error) return out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export const loadMyAudits = empId => loadAudits({ agent: empId, statuses: AGENT_STATUSES });

// ── Audits ─────────────────────────────────────────────────────────────────

/**
 * Saves an audit (new or existing). send = true → “Waiting for agent”. Returns the saved row or null.
 * a: { id?, scorecard_id, agent_emp_id, client_id, payer_id, claim_number, work_date, results, comment, status? }
 */
export async function saveAudit(a, card, user, { send = false } = {}) {
  const { score, passed, fatal } = scoreOf(a.results, Number(card?.pass_mark ?? DEFAULT_PASS_MARK));
  const row = {
    scorecard_id: a.scorecard_id, agent_emp_id: a.agent_emp_id, auditor_emp_id: user.emp_id,
    client_id: a.client_id || null, payer_id: a.payer_id || null, claim_number: a.claim_number?.trim() || null,
    work_date: a.work_date || null, results: a.results, score, passed, fatal, comment: a.comment?.trim() || null,
    status: send ? 'sent' : 'draft', ...(send ? { sent_at: now() } : {}), updated_by: user.emp_id, updated_at: now(),
  };
  let saved;
  if (a.id) {
    saved = (await S.update('qa_audits', row, { id: a.id }))?.[0];
    if (saved && a.status === 'queued') logAudit({ actor: user, action: 'qa_audit_add', entityType: 'qa_audit', entityId: a.id });
  } else {
    saved = (await S.set('qa_audits', { ...row, source: 'manual', created_by: user.emp_id }))?.[0];
    if (saved) logAudit({ actor: user, action: 'qa_audit_add', entityType: 'qa_audit', entityId: saved.id });
  }
  if (saved && send) logAudit({ actor: user, action: 'qa_audit_send', entityType: 'qa_audit', entityId: saved.id, targetEmpId: a.agent_emp_id });
  return saved ?? null;
}

export async function acknowledgeAudit(a, user) {
  const ok = await S.update('qa_audits', { status: 'acknowledged', ack_at: now(), closed_at: now(), updated_by: user.emp_id, updated_at: now() }, { id: a.id });
  if (ok) logAudit({ actor: user, action: 'qa_audit_ack', entityType: 'qa_audit', entityId: a.id });
  return !!ok;
}

export async function disputeAudit(a, reason, user) {
  const ok = await S.update('qa_audits', { status: 'disputed', dispute_reason: reason.trim(), disputed_at: now(), updated_by: user.emp_id, updated_at: now() }, { id: a.id });
  if (ok) logAudit({ actor: user, action: 'qa_audit_dispute', entityType: 'qa_audit', entityId: a.id });
  return !!ok;
}

/** Settles a dispute. overturnedIds = checkpoint ids that become passes (resolution 'overturned' when any). */
export async function resolveDispute(a, { overturnedIds = [], note = '' }, card, user) {
  const ids = new Set(overturnedIds);
  const results = a.results.map(r => ({ ...r, overturned: r.result === 'fail' && ids.has(r.checkpoint_id) }));
  const { score, passed, fatal } = scoreOf(results, Number(card?.pass_mark ?? DEFAULT_PASS_MARK));
  const resolution = ids.size ? 'overturned' : 'upheld';
  const ok = await S.update('qa_audits', {
    results, score, passed, fatal, status: 'resolved', resolution, resolution_note: note.trim() || null,
    resolved_by: user.emp_id, resolved_at: now(), closed_at: now(), updated_by: user.emp_id, updated_at: now(),
  }, { id: a.id });
  if (ok) logAudit({ actor: user, action: 'qa_audit_resolve', entityType: 'qa_audit', entityId: a.id, details: { resolution } });
  return !!ok;
}

/** Turns an audit off (e.g. a queued claim that won't be audited). Never deleted. */
export async function setAuditActive(a, active, user) {
  const ok = await S.update('qa_audits', { active, updated_by: user.emp_id, updated_at: now() }, { id: a.id });
  if (ok) logAudit({ actor: user, action: active ? 'qa_audit_activate' : 'qa_audit_deactivate', entityType: 'qa_audit', entityId: a.id });
  return !!ok;
}

/** Wipes the claim # of audits closed more than 90 days ago (run when an auditor opens the page). */
export async function clearOldAudits(user) {
  const cutoff = new Date(`${addDays(today(), -QA_CLEAR_AFTER_DAYS)}T00:00:00`).toISOString();
  const { data } = await db('qa_audits').select('id').eq('cleared', false).not('claim_number', 'is', null).lt('closed_at', cutoff);
  const ids = (data ?? []).map(r => r.id);
  if (!ids.length) return 0;
  const { error } = await db('qa_audits').update({ claim_number: null, cleared: true, updated_at: now() }).in('id', ids);
  if (error) return 0;
  logAudit({ actor: user, action: 'qa_audit_clear', entityType: 'qa_audit', details: { count: ids.length } });
  return ids.length;
}

// ── Sampling from the Smart Worklist ───────────────────────────────────────

/** Claims these people worked (any worked status) between two dates, not yet picked for an audit. */
export async function loadWorkedClaims(empIds, from, to) {
  if (!empIds.length) return [];
  const start = new Date(`${from}T00:00:00`).toISOString();
  const end = new Date(`${addDays(to, 1)}T00:00:00`).toISOString();
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db('worklist_items').select('id,worked_by,worked_at,client_id,payer_id,claim_number,status')
      .in('worked_by', empIds).gte('worked_at', start).lt('worked_at', end).eq('active', true).eq('cleared', false)
      .order('id').range(i, i + 999);
    if (error) return null;   // Smart Worklist not set up
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const picked = new Set();
  for (let i = 0; i < out.length; i += 200) {
    const { data } = await db('qa_audits').select('worklist_item_id').in('worklist_item_id', out.slice(i, i + 200).map(r => r.id));
    (data ?? []).forEach(r => picked.add(r.worklist_item_id));
  }
  return out.filter(r => !picked.has(r.id) && r.status !== 'new');
}

/** Random pick per person: mode 'count' = n claims each, 'percent' = n% of each person's claims (at least 1). */
export function pickSample(claims, mode, n) {
  const byPerson = {};
  claims.forEach(c => { (byPerson[c.worked_by] ??= []).push(c); });
  const out = [];
  for (const list of Object.values(byPerson)) {
    const want = mode === 'percent' ? Math.max(1, Math.round((list.length * n) / 100)) : n;
    const pool = [...list];
    for (let i = pool.length - 1; i > 0; i--) {   // Fisher–Yates shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, Math.min(want, pool.length)));
  }
  return out;
}

/** Puts picked claims in the audit queue (“To audit”) with the chosen scorecard. */
export async function queueSample(picks, scorecardId, user) {
  const rows = picks.map(c => ({
    scorecard_id: scorecardId, agent_emp_id: c.worked_by, auditor_emp_id: null, client_id: c.client_id, payer_id: c.payer_id,
    claim_number: c.claim_number, work_date: c.worked_at?.slice(0, 10) ?? null, worklist_item_id: c.id, source: 'sample',
    status: 'queued', created_by: user.emp_id, updated_by: user.emp_id,
  }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const saved = await S.set('qa_audits', rows.slice(i, i + 500));
    added += saved?.length ?? 0;
  }
  if (added) logAudit({ actor: user, action: 'qa_sample', entityType: 'qa_audit', details: { count: added } });
  return added;
}

// ── Results ────────────────────────────────────────────────────────────────

const scored = audits => audits.filter(a => a.score != null && !['queued', 'draft'].includes(a.status));

/** Per person: { emp_id, count, average, passRate, fatal, waiting, disputes }. */
export function summarise(audits) {
  const by = {};
  for (const a of audits) {
    const p = (by[a.agent_emp_id] ??= { emp_id: a.agent_emp_id, list: [], waiting: 0, disputes: 0 });
    if (a.status === 'sent') p.waiting += 1;
    if (a.status === 'disputed') p.disputes += 1;
    p.list.push(a);
  }
  return Object.values(by).map(p => {
    const s = scored(p.list);
    return {
      emp_id: p.emp_id, count: s.length, waiting: p.waiting, disputes: p.disputes,
      average: s.length ? Math.round((s.reduce((t, a) => t + Number(a.score), 0) / s.length) * 10) / 10 : null,
      passRate: s.length ? Math.round((s.filter(a => a.passed).length / s.length) * 100) : null,
      fatal: s.filter(a => a.fatal).length,
    };
  });
}

/** How often each error category / SOP appears in failed checkpoints: [{ id, count }] sorted. */
export function errorCounts(audits, key) {
  const counts = {};
  for (const a of scored(audits)) for (const r of a.results ?? []) {
    if (!failed(r)) continue;
    const id = r[key] ?? 'none';
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return Object.entries(counts).map(([id, count]) => ({ id: id === 'none' ? null : Number(id), count })).sort((a, b) => b.count - a.count);
}

// ── Scorecards & categories (“Manage QA scorecards”) ───────────────────────

export const STARTER_QA_CATEGORIES = [
  'Wrong action taken', 'Note missing or incomplete', 'Wrong follow-up date', 'Deadline missed (TFL / AFL)',
  'Wrong payer or plan', 'Posting error (amount / adjustment)', 'Wrong code or modifier', 'Authorization not checked',
  'SOP not followed', 'Document or attachment missing',
];

// Our own wording — managers adjust them. cat = one of STARTER_QA_CATEGORIES.
export const STARTER_SCORECARDS = [
  { name: 'AR follow-up', team: 'AR', checkpoints: [
    { text: 'Claim status checked in the right place (portal / call / clearinghouse)', cat: 'SOP not followed' },
    { text: 'Correct next action taken for the status / denial', cat: 'Wrong action taken', weight: 2 },
    { text: 'Filing / appeal deadline checked before acting', cat: 'Deadline missed (TFL / AFL)', critical: true },
    { text: 'Claim note complete in the client format (rep, ref #, next step)', cat: 'Note missing or incomplete' },
    { text: 'Follow-up date set correctly', cat: 'Wrong follow-up date' },
  ] },
  { name: 'Payment posting', team: 'Billing/Posting', checkpoints: [
    { text: 'Payment posted to the right claim / line', cat: 'Posting error (amount / adjustment)', critical: true },
    { text: 'Paid, allowed and adjustment amounts match the ERA / EOB', cat: 'Posting error (amount / adjustment)', weight: 2 },
    { text: 'Denials and patient responsibility posted with the right codes', cat: 'Wrong code or modifier' },
    { text: 'Batch balanced to the deposit', cat: 'Posting error (amount / adjustment)' },
  ] },
  { name: 'Authorization', team: 'Auth', checkpoints: [
    { text: 'Eligibility and benefits verified with the right payer / plan', cat: 'Wrong payer or plan', weight: 2 },
    { text: 'Auth requirement checked for the service', cat: 'Authorization not checked', critical: true },
    { text: 'Auth number, dates and units entered correctly', cat: 'Authorization not checked' },
    { text: 'Request sent with all required documents', cat: 'Document or attachment missing' },
    { text: 'Note and follow-up recorded', cat: 'Note missing or incomplete' },
  ] },
  { name: 'Charge entry', team: 'Billing/Posting', checkpoints: [
    { text: 'Correct payer / plan selected', cat: 'Wrong payer or plan', critical: true },
    { text: 'Codes, modifiers and units match the documentation', cat: 'Wrong code or modifier', weight: 2 },
    { text: 'Dates of service and rendering provider correct', cat: 'Wrong action taken' },
    { text: 'Claim scrubbed and submitted on time', cat: 'Deadline missed (TFL / AFL)' },
  ] },
];

const editMeta = user => ({ updated_by: user.emp_id, updated_at: now() });

/** Adds the starter categories and scorecards that aren't there yet (same name, any letter case = present). */
export async function addQaStarters(setup, user) {
  const lower = s => s.trim().toLowerCase();
  const haveCats = new Map(setup.categories.map(c => [lower(c.name), c.id]));
  const newCats = STARTER_QA_CATEGORIES.filter(n => !haveCats.has(lower(n)));
  if (newCats.length) {
    const rows = await S.set('qa_categories', newCats.map((name, i) => ({ name, sort_order: setup.categories.length + i, created_by: user.emp_id, updated_by: user.emp_id })));
    (rows ?? []).forEach(r => haveCats.set(lower(r.name), r.id));
  }
  const haveCards = new Set(setup.scorecards.map(c => lower(c.name)));
  let cards = 0;
  for (const sc of STARTER_SCORECARDS.filter(s => !haveCards.has(lower(s.name)))) {
    const card = (await S.set('qa_scorecards', { name: sc.name, team: sc.team, pass_mark: DEFAULT_PASS_MARK, created_by: user.emp_id, updated_by: user.emp_id }))?.[0];
    if (!card) continue;
    cards += 1;
    await S.set('qa_checkpoints', sc.checkpoints.map((c, i) => ({
      scorecard_id: card.id, text: c.text, weight: c.weight ?? 1, critical: !!c.critical, category_id: haveCats.get(lower(c.cat)) ?? null,
      sort_order: i, created_by: user.emp_id, updated_by: user.emp_id,
    })));
  }
  logAudit({ actor: user, action: 'qa_starter_add', entityType: 'qa_scorecard', details: { categories: newCats.length, scorecards: cards } });
  return { categories: newCats.length, scorecards: cards };
}

const TABLES = {
  category:   { table: 'qa_categories',  entity: 'qa_category' },
  scorecard:  { table: 'qa_scorecards',  entity: 'qa_scorecard' },
  checkpoint: { table: 'qa_checkpoints', entity: 'qa_checkpoint' },
};

/** Adds (no row) or edits one category / scorecard / checkpoint. Returns the saved row or null. */
export async function saveQaItem(kind, row, values, user) {
  const { table, entity } = TABLES[kind];
  if (row) {
    const saved = (await S.update(table, { ...values, ...editMeta(user) }, { id: row.id }))?.[0];
    if (saved) logAudit({ actor: user, action: `${entity}_edit`, entityType: entity, entityId: row.id });
    return saved ?? null;
  }
  const saved = (await S.set(table, { ...values, created_by: user.emp_id, updated_by: user.emp_id }))?.[0];
  if (saved) logAudit({ actor: user, action: `${entity}_add`, entityType: entity, entityId: saved.id });
  return saved ?? null;
}

export async function setQaItemActive(kind, row, active, user) {
  const { table, entity } = TABLES[kind];
  const ok = await S.update(table, { active, ...editMeta(user) }, { id: row.id });
  if (ok) logAudit({ actor: user, action: `${entity}_${active ? 'activate' : 'deactivate'}`, entityType: entity, entityId: row.id });
  return !!ok;
}

/** Moves a checkpoint up / down within its scorecard. */
export async function moveCheckpoint(list, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= list.length) return false;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  const results = await Promise.all(next.map((c, i) => ((c.sort_order ?? 0) === i ? true : S.update('qa_checkpoints', { sort_order: i }, { id: c.id }))));
  return results.every(Boolean);
}
