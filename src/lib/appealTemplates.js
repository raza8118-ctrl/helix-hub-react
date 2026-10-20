// Appeal letter templates (roadmap 5.2). Templates hold placeholders only — real values are filled in the browser,
// and filled letters are never saved or logged. A line starting with "?" is dropped when any placeholder in it is empty.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { APPEAL_LEVELS, BASE_FIELDS, PATIENT_FIELDS, DISAGREE_FIELD, DENIAL_TYPES } from './appeals';

export const ANY_TYPE = 'any';
export const TEMPLATE_TYPES = [{ value: ANY_TYPE, label: 'Any denial type' }, ...DENIAL_TYPES.map(t => ({ value: t.value, label: t.label }))];
export const templateTypeLabel = v => TEMPLATE_TYPES.find(t => t.value === v)?.label ?? v;
export const levelLabel = v => (v ? APPEAL_LEVELS.find(l => l.value === v)?.label ?? v : 'Any level');

// Every placeholder a template can use, grouped for the picker. id = identifier (PHI) — filled only locally.
export const FRAME_TOKENS = [
  { token: '[TODAY]', label: 'Today’s date', id: false },
  { token: '[SENDER_NAME]', label: 'Your name', id: false },
  { token: '[PAYER_APPEALS_ADDRESS]', label: 'Payer appeals address', id: false },
  { token: '[PAYER_APPEALS_FAX]', label: 'Payer appeals fax', id: false },
];
export const TOKEN_GROUPS = [
  { label: 'Letter', tokens: FRAME_TOKENS },
  { label: 'Claim and denial', tokens: [
    { token: '[CLIENT_NAME]', label: 'Client (provider)', id: false },
    { token: '[PAYER_NAME]', label: 'Payer', id: false },
    { token: '[DENIAL_CODES]', label: 'Denial code(s)', id: false },
    { token: '[DENIAL_REASON]', label: 'Denial reason', id: false },
    { token: '[APPEAL_LEVEL]', label: 'Appeal level', id: false },
    ...BASE_FIELDS.map(f => ({ token: f.token, label: f.label, id: f.id })),
  ] },
  { label: 'Patient', tokens: PATIENT_FIELDS.map(f => ({ token: f.token, label: f.label, id: f.id })) },
  ...DENIAL_TYPES.map(t => ({ label: `Key facts — ${t.label}`, tokens: t.facts.map(f => ({ token: f.token, label: f.label, id: f.id })) })),
  { label: 'Other', tokens: [{ token: DISAGREE_FIELD.token, label: DISAGREE_FIELD.label, id: false }] },
];
const KNOWN = new Set(TOKEN_GROUPS.flatMap(g => g.tokens.map(t => t.token)));
const TOKEN_RE = /\[[A-Z0-9_]+\]/g;

// Made-up values for the template editor preview (never real patients)
export const SAMPLE_VALUES = {
  '[TODAY]': '10/20/2026', '[SENDER_NAME]': 'Alex Example', '[PAYER_APPEALS_ADDRESS]': 'Attn: Appeals\nPO Box 0000\nAnytown, ST 00000',
  '[PAYER_APPEALS_FAX]': '(000) 000-0000', '[CLIENT_NAME]': 'Sample Home Health', '[PAYER_NAME]': 'Sample Health Plan',
  '[DENIAL_CODES]': 'CO-197', '[DENIAL_REASON]': 'Prior authorization was missing.', '[APPEAL_LEVEL]': 'First-level appeal',
  '[DENIAL_DATE]': '09/01/2026', '[CLAIM_NUMBER]': 'C0000000', '[DOS_FROM]': '08/01/2026', '[DOS_TO]': '08/30/2026',
  '[PATIENT_NAME]': 'Jane Sample', '[PATIENT_DOB]': '01/01/1950', '[MEMBER_ID]': 'A000000',
  '[AUTH_NUMBER]': 'AUTH0000', '[AUTH_APPROVAL_DATE]': '07/28/2026', '[AUTH_FROM]': '08/01/2026', '[AUTH_TO]': '09/29/2026',
  '[AUTH_UNITS]': '12 visits', '[RECORDS_LIST]': 'Plan of care (485), Visit notes', '[WHY_WE_DISAGREE]': 'The authorization covered these dates.',
};

/**
 * Fills a template. values = { '[TOKEN]': 'value' }. Optional ("?") lines with an empty token are dropped.
 * Returns { lines: [[{ text } | { token, value }]], text (filled; empty tokens left as placeholders), missing: [tokens] }.
 */
export function fillTemplate(body, values) {
  const missing = new Set();
  const lines = [];
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const optional = /^\s*\?/.test(raw);
    const line = optional ? raw.replace(/^\s*\?\s?/, '') : raw;
    const tokens = line.match(TOKEN_RE) ?? [];
    const empty = tokens.filter(t => !String(values[t] ?? '').trim());
    if (optional && empty.length) continue;
    empty.forEach(t => missing.add(t));
    const parts = [];
    let last = 0;
    line.replace(TOKEN_RE, (tok, at) => {
      if (at > last) parts.push({ text: line.slice(last, at) });
      parts.push({ token: tok, value: String(values[tok] ?? '').trim() });
      last = at + tok.length;
      return tok;
    });
    if (last < line.length) parts.push({ text: line.slice(last) });
    lines.push(parts);
  }
  // Collapse runs of blank lines left by dropped optional lines
  const tidy = lines.filter((p, i) => !(isBlank(p) && (i === 0 || isBlank(lines[i - 1]))));
  const text = tidy.map(p => p.map(x => x.text ?? (x.value || x.token)).join('')).join('\n').trim();
  return { lines: tidy, text, missing: [...missing] };
}
const isBlank = parts => parts.every(p => p.text !== undefined && !p.text.trim());

/** Best active template: same client > any client; same type > any type; same level > any level. */
export function pickTemplate(templates, { type, level, clientId }) {
  const fits = (templates ?? []).filter(t => t.active !== false
    && (t.client_id == null || String(t.client_id) === String(clientId))
    && (t.denial_type === ANY_TYPE || t.denial_type === type)
    && (!t.level || t.level === level));
  const score = t => (t.client_id != null ? 4 : 0) + (t.denial_type === type ? 2 : 0) + (t.level ? 1 : 0);
  return fits.sort((a, b) => score(b) - score(a) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0] ?? null;
}

/** Plain-English warnings for a template body (unknown placeholders, things that look like real patient data). */
export function checkTemplate(body) {
  const warnings = [];
  const unknown = [...new Set((body.match(TOKEN_RE) ?? []).filter(t => !KNOWN.has(t)))];
  if (unknown.length) warnings.push(`Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(body)) warnings.push('Contains what looks like a real date — use a placeholder such as [DOS_FROM] instead.');
  if (/\b[A-Z]*\d{6,}\b/i.test(body)) warnings.push('Contains a long number (an ID or claim number?) — use a placeholder instead.');
  return warnings;
}

// ── Database ───────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

/** Templates, or null when the 5.2 database update hasn't been run. */
export async function loadTemplates() {
  const { data, error } = await db('appeal_templates').select('*');
  if (error) return null;
  return (data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function saveTemplate(existing, values, user) {
  const payload = { ...values, updated_by: user.emp_id, updated_at: now() };
  const rows = existing
    ? await S.update('appeal_templates', payload, { id: existing.id })
    : await S.set('appeal_templates', { ...payload, source: 'manual', active: true, created_by: user.emp_id });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: existing ? 'appeal_template_edit' : 'appeal_template_add', entityType: 'appeal_template', entityId: rows[0].id });
  return rows[0];
}

export async function reviewTemplate(t, user) {
  const ok = await S.update('appeal_templates', { reviewed_at: now(), reviewed_by: user.emp_id }, { id: t.id });
  if (ok) logAudit({ actor: user, action: 'appeal_template_review', entityType: 'appeal_template', entityId: t.id });
  return !!ok;
}

export async function setTemplateActive(t, active, user) {
  const ok = await S.update('appeal_templates', { active, updated_by: user.emp_id, updated_at: now() }, { id: t.id });
  if (ok) logAudit({ actor: user, action: active ? 'appeal_template_activate' : 'appeal_template_deactivate', entityType: 'appeal_template', entityId: t.id });
  return !!ok;
}

// ── Starter letters (our own wording — to be reviewed by the team) ──────────

const HEAD = `[TODAY]

[PAYER_NAME]
[PAYER_APPEALS_ADDRESS]
? Fax: [PAYER_APPEALS_FAX]

RE: [APPEAL_LEVEL]
Patient: [PATIENT_NAME]
? Date of birth: [PATIENT_DOB]
Member ID: [MEMBER_ID]
Claim #: [CLAIM_NUMBER]
Dates of service: [DOS_FROM] – [DOS_TO]
? Denial date: [DENIAL_DATE]
? Denial code(s): [DENIAL_CODES]

To Whom It May Concern:
`;
const FOOT = `
? Additional information: [WHY_WE_DISAGREE]

Please reprocess this claim for payment. If you need any further information, please contact us.

Sincerely,

[SENDER_NAME]
On behalf of [CLIENT_NAME]`;
const letter = body => `${HEAD}\n${body}\n${FOOT}`;

export const STARTER_TEMPLATES = [
  { name: 'Authorization denial appeal', denial_type: 'auth', body: letter(
`We are appealing the denial of the above claim for missing authorization. Authorization was obtained before the services were provided.

Authorization #: [AUTH_NUMBER]
? Approved on: [AUTH_APPROVAL_DATE]
? Authorized dates: [AUTH_FROM] – [AUTH_TO]
? Visits / units approved: [AUTH_UNITS]

The services billed fall within the approved authorization. A copy of the authorization approval is enclosed.`) },
  { name: 'Timely filing denial appeal', denial_type: 'timely', body: letter(
`We are appealing the timely filing denial of the above claim. The claim was submitted within the filing limit.

? Original submission date: [ORIGINAL_SUBMISSION_DATE]
? Clearinghouse acceptance report #: [ACCEPTANCE_REPORT_NUMBER]
? Acceptance report date: [ACCEPTANCE_DATE]
? Payer receipt date: [PAYER_RECEIPT_DATE]

Proof of timely filing is enclosed.`) },
  { name: 'Medical necessity / records appeal', denial_type: 'necessity', body: letter(
`We are appealing the denial of the above claim. The services provided were medically necessary and are supported by the enclosed documentation.

Enclosed records: [RECORDS_LIST]
? Physician order dated: [ORDER_DATE]

Please review the enclosed records and reprocess the claim.`) },
  { name: 'Eligibility / coordination of benefits appeal', denial_type: 'eligibility', body: letter(
`We are appealing the eligibility / coordination of benefits denial of the above claim. The patient’s coverage was verified for the dates of service.

? Eligibility verified on: [ELIGIBILITY_CHECK_DATE]
? Verified through: [ELIGIBILITY_SOURCE]
? Primary payer EOB date: [PRIMARY_EOB_DATE]
? Primary payer paid: $[PRIMARY_PAID_AMOUNT]

Supporting documentation is enclosed.`) },
  { name: 'Duplicate claim denial appeal', denial_type: 'duplicate', body: letter(
`We are appealing the duplicate claim denial of the above claim. This claim is not a duplicate.

? Original claim #: [ORIGINAL_CLAIM_NUMBER]
? [NOT_DUPLICATE_REASON]

Please review and process this claim separately.`) },
  { name: 'Coding / billing reconsideration', denial_type: 'coding', body: letter(
`We are requesting reconsideration of the above claim, which was denied for a coding / billing issue.

? Issue identified: [WHAT_WAS_WRONG]
? Correction made: [WHAT_WAS_CORRECTED]

The corrected information is enclosed.`) },
  { name: 'General denial appeal', denial_type: 'other', body: letter(
`We are appealing the denial of the above claim.
? Denial reason given: [DENIAL_REASON]

? [OTHER_FACTS]

Supporting documentation is enclosed.`) },
  { name: 'Corrected claim cover letter', denial_type: ANY_TYPE, level: 'corrected', body:
`[TODAY]

[PAYER_NAME]
? [PAYER_APPEALS_ADDRESS]

RE: Corrected claim
Patient: [PATIENT_NAME]
Member ID: [MEMBER_ID]
Original claim #: [CLAIM_NUMBER]
Dates of service: [DOS_FROM] – [DOS_TO]

Please find enclosed a corrected claim replacing the original claim above.
? Correction made: [WHAT_WAS_CORRECTED]

Sincerely,

[SENDER_NAME]
On behalf of [CLIENT_NAME]` },
];

/** Starter templates not yet added (matched by name, any letter case). */
export const missingStarterTemplates = templates =>
  STARTER_TEMPLATES.filter(s => !(templates ?? []).some(t => (t.name ?? '').toLowerCase() === s.name.toLowerCase()));

export async function addStarterTemplates(list, user) {
  const rows = await S.set('appeal_templates', list.map(s => ({
    name: s.name, denial_type: s.denial_type, level: s.level ?? null, client_id: null, body: s.body,
    source: 'starter', active: true, created_by: user.emp_id, updated_by: user.emp_id,
  })));
  if (!rows?.length) return 0;
  logAudit({ actor: user, action: 'appeal_starter_add', entityType: 'appeal_template', details: { count: rows.length } });
  return rows.length;
}
