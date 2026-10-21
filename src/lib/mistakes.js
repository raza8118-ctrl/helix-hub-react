// Error library “Mistakes & fixes” (roadmap 7.2): common mistakes with how to fix them now and how to avoid them,
// linked to QA error categories (7.1), SOPs, clients, payers and denial codes. General know-how only — never tied to a
// specific claim; every text field is checked for patient details. Anyone can suggest; editors publish.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { addDays, today } from './helpers';
import { daysBetween } from './deadlines';
import { phiIssues } from './appealAI';

export const MISTAKE_RECHECK_DAYS = 180;
export const SEEN_DAYS = 90;
export const SEVERITIES = [
  { value: 'high',   label: 'High',   badge: 'badge-red' },
  { value: 'medium', label: 'Medium', badge: 'badge-yellow' },
  { value: 'low',    label: 'Low',    badge: 'badge-gray' },
];
export const severityOf = v => SEVERITIES.find(s => s.value === v) ?? SEVERITIES[1];
export const TEXT_FIELDS = [
  { key: 'what_happened',  label: 'What goes wrong' },
  { key: 'why_it_matters', label: 'Why it matters' },
  { key: 'fix_steps',      label: 'How to fix it now', steps: true },
  { key: 'prevent_steps',  label: 'How to avoid it', steps: true },
];

const now = () => new Date().toISOString();

/** Edit / publish: “Edit error library” (admin / manager, grantable) or the QA flag. */
export const canEditMistakes = user => hasAccess(user, 'mistakes_edit') || !!user?.is_qa;

/** One step per line (leading “1.” / “-” / “•” removed). */
export const stepsOf = text => (text ?? '').split('\n').map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);

export const needsRecheck = m => !m.verified_at || daysBetween(m.verified_at.slice(0, 10), today()) > MISTAKE_RECHECK_DAYS;

// ── Loading ────────────────────────────────────────────────────────────────

/** All entries, or null when the 7.2 database update hasn't been run. */
export async function loadMistakes() {
  const { data, error } = await db('qa_mistakes').select('*');
  if (error) return null;
  return (data ?? []).sort((a, b) => a.title.localeCompare(b.title));
}

/** { mistake_id: n } — failed QA checkpoints pointing to each entry, work date in the last 90 days. */
export async function seenCounts() {
  const { data, error } = await db('qa_audits').select('results,status,work_date').eq('active', true).gte('work_date', addDays(today(), -SEEN_DAYS));
  if (error) return {};
  const out = {};
  for (const a of data ?? []) {
    if (a.status === 'queued' || a.status === 'draft') continue;
    for (const r of a.results ?? []) {
      if (r.mistake_id && r.result === 'fail' && !r.overturned) out[r.mistake_id] = (out[r.mistake_id] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * Search + filters. opts: query, team, categoryId, clientId, payerId, severity ('ALL' or a value),
 * status ('published' | 'suggested' | 'ALL'), showInactive.
 * A client / payer filter keeps entries for that client / payer plus the general ones.
 */
export function filterMistakes(list, { query = '', team = 'ALL', categoryId = 'ALL', clientId = 'ALL', payerId = 'ALL', severity = 'ALL', status = 'published', showInactive = false } = {}) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rank = { high: 0, medium: 1, low: 2 };
  return list.filter(m => (showInactive || m.active !== false)
    && (status === 'ALL' || m.status === status)
    && (team === 'ALL' || !m.team || m.team === team)
    && (categoryId === 'ALL' || m.category_id === categoryId)
    && (clientId === 'ALL' || m.client_id == null || m.client_id === clientId)
    && (payerId === 'ALL' || m.payer_id == null || m.payer_id === payerId)
    && (severity === 'ALL' || m.severity === severity)
    && words.every(w => [m.title, m.denial_code, ...TEXT_FIELDS.map(f => m[f.key])].some(t => (t ?? '').toLowerCase().includes(w))))
    .sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1) || a.title.localeCompare(b.title));
}

// ── Changes ────────────────────────────────────────────────────────────────

/** Checks an entry before saving. Returns an error message or ''. */
export function checkMistake(m) {
  if (!m.title?.trim()) return 'Type a short title for the mistake.';
  if (!m.what_happened?.trim() && !m.fix_steps?.trim()) return 'Say what goes wrong or how to fix it.';
  for (const f of [{ key: 'title', label: 'Title' }, ...TEXT_FIELDS]) {
    const issues = phiIssues(m[f.key]);
    if (issues.length) return `${f.label}: this looks like it has ${issues.join(', ')}. Describe the mistake in general terms — no patient or claim details.`;
  }
  return '';
}

const fields = m => ({
  title: m.title.trim(), team: m.team || null, category_id: m.category_id || null, severity: m.severity || 'medium',
  what_happened: m.what_happened?.trim() || null, why_it_matters: m.why_it_matters?.trim() || null,
  fix_steps: m.fix_steps?.trim() || null, prevent_steps: m.prevent_steps?.trim() || null,
  sop_id: m.sop_id || null, client_id: m.client_id || null, payer_id: m.payer_id || null,
  denial_code: m.denial_code?.trim().toUpperCase() || null,
});

/** New entry: editors publish straight away; everyone else's goes in as a suggestion. */
export async function addMistake(m, user) {
  const editor = canEditMistakes(user);
  const rows = await S.set('qa_mistakes', {
    ...fields(m), status: editor ? 'published' : 'suggested', suggested_by: editor ? null : user.emp_id,
    ...(editor ? { verified_at: now(), verified_by: user.emp_id } : {}), created_by: user.emp_id, updated_by: user.emp_id,
  });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: editor ? 'mistake_add' : 'mistake_suggest', entityType: 'qa_mistake', entityId: rows[0].id });
  return rows[0];
}

export async function editMistake(row, m, user) {
  const ok = await S.update('qa_mistakes', { ...fields(m), updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'mistake_edit', entityType: 'qa_mistake', entityId: row.id });
  return !!ok;
}

export async function publishMistake(row, user) {
  const ok = await S.update('qa_mistakes', { status: 'published', verified_at: now(), verified_by: user.emp_id, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'mistake_publish', entityType: 'qa_mistake', entityId: row.id });
  return !!ok;
}

export async function verifyMistake(row, user) {
  const ok = await S.update('qa_mistakes', { verified_at: now(), verified_by: user.emp_id }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'mistake_verify', entityType: 'qa_mistake', entityId: row.id });
  return !!ok;
}

export async function setMistakeActive(row, active, user) {
  const ok = await S.update('qa_mistakes', { active, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: active ? 'mistake_activate' : 'mistake_deactivate', entityType: 'qa_mistake', entityId: row.id });
  return !!ok;
}

// ── Starter entries (our wording — editors adjust; cat = a 7.1 starter QA category) ──

export const STARTER_MISTAKES = [
  { title: 'Wrong timely filing limit used', team: 'AR', cat: 'Deadline missed (TFL / AFL)', severity: 'high',
    what_happened: 'The standard payer limit was used when the client contract has a shorter (or longer) limit, so the claim was worked too late or written off too early.',
    why_it_matters: 'A missed filing limit is usually lost money with no appeal right.',
    fix_steps: 'Open the payer card and check the client override for the limit\nIf still in time, submit or appeal today and note the deadline\nIf past the limit, ask your supervisor before any write-off',
    prevent_steps: 'Always pick the client on the payer card before reading the limit\nUse AR Tools → Filing & appeal deadlines' },
  { title: 'Sent a new claim instead of a corrected claim', team: 'AR', cat: 'Wrong action taken', severity: 'high',
    what_happened: 'A claim that needed a correction was sent again as a new (original) claim.',
    why_it_matters: 'The payer denies it as a duplicate and the real correction is delayed, sometimes past the filing limit.',
    fix_steps: 'Check the payer status of the duplicate\nSend a corrected claim (replacement, frequency 7) that points to the original claim\nNote the reference and set a follow-up',
    prevent_steps: 'If the payer already has the claim on file, it is a correction, not a new claim\nFollow the corrected-claim SOP for the payer' },
  { title: 'Appealed when a corrected claim was needed', team: 'AR', cat: 'Wrong action taken', severity: 'medium',
    what_happened: 'A denial caused by our own billing error (code, modifier, units) was appealed instead of corrected.',
    why_it_matters: 'The appeal is upheld, time is lost and the appeal level is used up.',
    fix_steps: 'Read the denial reason in the Denial Navigator\nCorrect the billing error and send a corrected claim\nNote why the appeal was not used',
    prevent_steps: 'Check the Denial Navigator “What to do” before choosing appeal or correction' },
  { title: 'Payment posted to the wrong line', team: 'Billing/Posting', cat: 'Posting error (amount / adjustment)', severity: 'high',
    what_happened: 'The ERA payment was applied to a different service line or claim than the one paid.',
    why_it_matters: 'One line shows a false balance and another a false credit; AR and patient statements are wrong.',
    fix_steps: 'Reverse the posting\nRe-post each amount to the line shown on the ERA / EOB\nCheck the batch still balances',
    prevent_steps: 'Match service date, code and billed amount before posting each line' },
  { title: 'Contractual adjustment posted as patient responsibility', team: 'Billing/Posting', cat: 'Posting error (amount / adjustment)', severity: 'medium',
    what_happened: 'A CO (contractual) amount was left as a patient balance instead of being adjusted off.',
    why_it_matters: 'The patient is billed for an amount they do not owe.',
    fix_steps: 'Move the CO amount to the contractual adjustment code\nCheck that only PR amounts remain as patient balance',
    prevent_steps: 'CO = adjust off, PR = patient responsibility — check the group code on every line' },
  { title: 'Authorization not checked before the visit', team: 'Auth', cat: 'Authorization not checked', severity: 'high',
    what_happened: 'Services started without checking whether the payer needs an authorization.',
    why_it_matters: 'Visits without a valid auth are denied and often cannot be billed.',
    fix_steps: 'Check the payer auth rules today\nRequest a retro auth if the payer allows it\nTell the client which visits are at risk',
    prevent_steps: 'Run the auth check at referral for every new admission and every payer change' },
  { title: 'Wrong payer billed first', team: 'Billing/Posting', cat: 'Wrong payer or plan', severity: 'medium',
    what_happened: 'The secondary payer was billed as primary (or Medicare was billed when another payer is primary).',
    why_it_matters: 'Denial for other insurance primary, or a later recoupment.',
    fix_steps: 'Confirm the payer order (eligibility, MSP questionnaire)\nBill the primary payer first\nBill the secondary with the primary EOB',
    prevent_steps: 'Check coordination of benefits at intake and on every eligibility re-check' },
  { title: 'Claim note missing the call reference number', team: 'AR', cat: 'Note missing or incomplete', severity: 'low',
    what_happened: 'A payer call was noted without the representative name or call reference number.',
    why_it_matters: 'We cannot prove what the payer said when we reopen or appeal.',
    fix_steps: 'If the call was today, add the rep and reference from your call log',
    prevent_steps: 'Use AR Tools → Claim Note Generator; it asks for the rep and reference' },
];

/** Adds starter entries not yet present (same title, any letter case = present). categories = 7.1 QA categories. */
export async function addStarterMistakes(existing, categories, user) {
  const have = new Set(existing.map(m => m.title.trim().toLowerCase()));
  const catId = name => categories.find(c => c.name.trim().toLowerCase() === name.toLowerCase())?.id ?? null;
  const rows = STARTER_MISTAKES.filter(s => !have.has(s.title.toLowerCase())).map(({ cat, ...s }) => ({
    ...s, category_id: catId(cat), status: 'published', verified_at: now(), verified_by: user.emp_id,
    created_by: user.emp_id, updated_by: user.emp_id,
  }));
  if (!rows.length) return 0;
  const saved = await S.set('qa_mistakes', rows);
  if (saved?.length) logAudit({ actor: user, action: 'mistake_starter_add', entityType: 'qa_mistake', details: { count: saved.length } });
  return saved?.length ?? 0;
}
export const missingStarterMistakes = existing => STARTER_MISTAKES.filter(s => !existing.some(m => m.title.trim().toLowerCase() === s.title.toLowerCase())).length;
