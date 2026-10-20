// Appeal Builder (roadmap Phase 5). 5.1 = the appeal form.
// PHI rules (CLAUDE.md rule 6): nothing here is saved to the database, logged or put in browser storage.
// The form lives in memory only while Helix Hub is open, and is wiped on refresh, sign-out or "Clear form".
// Every field has a placeholder token; identifiers (names, dates, IDs, claim / auth numbers) only ever leave
// this computer as placeholders (5.3 AI wording), and real values are filled in locally.

// ── Fields ─────────────────────────────────────────────────────────────────

export const APPEAL_LEVELS = [
  { value: 'first',     label: 'First-level appeal',  limit: { type: 'AFL', level: 1 } },
  { value: 'second',    label: 'Second-level appeal', limit: { type: 'AFL', level: 2 } },
  { value: 'recon',     label: 'Reconsideration',     limit: { type: 'RECON', level: null } },
  { value: 'corrected', label: 'Corrected claim',     limit: { type: 'CCTFL', level: null } },
];
export const levelOf = v => APPEAL_LEVELS.find(l => l.value === v) ?? APPEAL_LEVELS[0];

// id = identifier (PHI): always sent as its placeholder, never as the real value
export const BASE_FIELDS = [
  { key: 'denial_date',  label: 'Denial / EOB date', type: 'date', token: '[DENIAL_DATE]',  id: true },
  { key: 'claim_number', label: 'Claim #',           type: 'text', token: '[CLAIM_NUMBER]', id: true },
  { key: 'dos_from',     label: 'Date of service — from', type: 'date', token: '[DOS_FROM]', id: true },
  { key: 'dos_to',       label: 'Date of service — to',   type: 'date', token: '[DOS_TO]',   id: true },
];
export const PATIENT_FIELDS = [
  { key: 'patient_name', label: 'Patient name',  type: 'text', token: '[PATIENT_NAME]', id: true },
  { key: 'patient_dob',  label: 'Date of birth', type: 'date', token: '[PATIENT_DOB]',  id: true },
  { key: 'member_id',    label: 'Member ID',     type: 'text', token: '[MEMBER_ID]',    id: true },
];
export const DISAGREE_FIELD = { key: 'disagree', label: 'Why we disagree', type: 'textarea', token: '[WHY_WE_DISAGREE]', id: false };

export const RECORD_OPTIONS = [
  'Plan of care (485)', 'Visit notes', 'Physician order', 'Face-to-face encounter', 'OASIS assessment',
  'Hospice certification / election statement', 'Discharge summary', 'Other records',
];

export const DENIAL_TYPES = [
  { value: 'auth', label: 'Authorization', categories: ['Authorization'], facts: [
    { key: 'auth_number',        label: 'Auth #',                 type: 'text', token: '[AUTH_NUMBER]',        id: true },
    { key: 'auth_approval_date', label: 'Approval date',          type: 'date', token: '[AUTH_APPROVAL_DATE]', id: true },
    { key: 'auth_from',          label: 'Auth valid from',        type: 'date', token: '[AUTH_FROM]',          id: true },
    { key: 'auth_to',            label: 'Auth valid to',          type: 'date', token: '[AUTH_TO]',            id: true },
    { key: 'auth_units',         label: 'Visits / units approved', type: 'text', token: '[AUTH_UNITS]',        id: false },
  ] },
  { value: 'timely', label: 'Timely filing', categories: ['Timely filing'], facts: [
    { key: 'original_submission_date', label: 'Original submission date', type: 'date', token: '[ORIGINAL_SUBMISSION_DATE]', id: true },
    { key: 'acceptance_report_number', label: 'Clearinghouse acceptance report #', type: 'text', token: '[ACCEPTANCE_REPORT_NUMBER]', id: true },
    { key: 'acceptance_date',          label: 'Acceptance report date',   type: 'date', token: '[ACCEPTANCE_DATE]',     id: true },
    { key: 'payer_receipt_date',       label: 'Payer receipt date',       type: 'date', token: '[PAYER_RECEIPT_DATE]',  id: true },
  ] },
  { value: 'necessity', label: 'Medical necessity / records', categories: ['Documentation / records'], facts: [
    { key: 'records',    label: 'Records being sent', type: 'checklist', token: '[RECORDS_LIST]', id: false, options: RECORD_OPTIONS },
    { key: 'order_date', label: 'Physician order date', type: 'date', token: '[ORDER_DATE]', id: true },
  ] },
  { value: 'eligibility', label: 'Eligibility / COB', categories: ['Eligibility', 'Coordination of benefits'], facts: [
    { key: 'elig_check_date',     label: 'Eligibility checked on', type: 'date', token: '[ELIGIBILITY_CHECK_DATE]', id: true },
    { key: 'elig_source',         label: 'Checked in (portal / system)', type: 'text', token: '[ELIGIBILITY_SOURCE]', id: false },
    { key: 'primary_eob_date',    label: 'Primary EOB date', type: 'date', token: '[PRIMARY_EOB_DATE]', id: true },
    { key: 'primary_paid_amount', label: 'Primary paid amount ($)', type: 'text', token: '[PRIMARY_PAID_AMOUNT]', id: false },
  ] },
  { value: 'duplicate', label: 'Duplicate', categories: ['Duplicate'], facts: [
    { key: 'original_claim_number', label: 'Original claim #', type: 'text', token: '[ORIGINAL_CLAIM_NUMBER]', id: true },
    { key: 'not_duplicate_reason',  label: 'Why this isn’t a duplicate', type: 'textarea', token: '[NOT_DUPLICATE_REASON]', id: false },
  ] },
  { value: 'coding', label: 'Coding / billing', categories: ['Coding'], facts: [
    { key: 'what_wrong',     label: 'What was wrong',     type: 'textarea', token: '[WHAT_WAS_WRONG]',     id: false },
    { key: 'what_corrected', label: 'What was corrected', type: 'textarea', token: '[WHAT_WAS_CORRECTED]', id: false },
  ] },
  { value: 'other', label: 'Other', categories: [], facts: [
    { key: 'other_facts', label: 'Key facts', type: 'textarea', token: '[OTHER_FACTS]', id: false },
  ] },
];
export const denialTypeOf = v => DENIAL_TYPES.find(t => t.value === v) ?? DENIAL_TYPES[DENIAL_TYPES.length - 1];

/** Denial type suggested by a Denial library category. */
export const typeForCategory = category => DENIAL_TYPES.find(t => t.categories.includes(category))?.value ?? 'other';

// ── Placeholders ───────────────────────────────────────────────────────────

const fmtUS = d => { if (!d) return ''; const [y, m, day] = d.split('-'); return `${m}/${day}/${y}`; };

/**
 * Every placeholder with its real value, for the facts summary (5.1) and later the letter (5.2 / 5.3).
 * ctx = { clientName, payerName, codesText, reasonText }. Returns [{ token, label, value, id }].
 */
export function placeholderMap(form, ctx) {
  const fmt = (f, v) => f.type === 'date' ? fmtUS(v) : f.type === 'checklist' ? (v ?? []).join(', ') : (v ?? '').toString().trim();
  const facts = denialTypeOf(form.denial_type).facts;
  return [
    { token: '[CLIENT_NAME]',  label: 'Client (provider)', value: ctx.clientName ?? '', id: false },
    { token: '[PAYER_NAME]',   label: 'Payer',             value: ctx.payerName ?? '',  id: false },
    { token: '[DENIAL_CODES]', label: 'Denial code(s)',    value: ctx.codesText ?? '',  id: false },
    { token: '[DENIAL_REASON]', label: 'Denial reason',    value: ctx.reasonText ?? '', id: false },
    { token: '[APPEAL_LEVEL]', label: 'Appeal level',      value: levelOf(form.level).label, id: false },
    ...[...PATIENT_FIELDS, ...BASE_FIELDS, ...facts, DISAGREE_FIELD].map(f => ({
      token: f.token, label: f.label, value: fmt(f, form[f.key]), id: f.id,
    })),
  ];
}

/** True when any identifier (PHI) field has a value — shows the "clear when done" banner. */
export function hasIdentifiers(form) {
  const facts = denialTypeOf(form.denial_type).facts;
  return [...PATIENT_FIELDS, ...BASE_FIELDS, ...facts].some(f => f.id && String(form[f.key] ?? '').trim());
}

// ── In-memory store (never in the database or browser storage) ──────────────

export const emptyAppeal = () => ({
  client_id: '', payer_id: '', codes: '', level: 'first', denial_type: '', typeTouched: false,
  denial_date: '', claim_number: '', dos_from: '', dos_to: '',
  patient_name: '', patient_dob: '', member_id: '', disagree: '',
  // key facts of every denial type live side by side so switching type doesn't lose typing
  ...Object.fromEntries(DENIAL_TYPES.flatMap(t => t.facts).map(f => [f.key, f.type === 'checklist' ? [] : ''])),
});

let draft = null;      // { empId, form }
let prefill = null;    // { codes, client_id, payer_id } from "Start an appeal"

/** The current user's in-memory appeal, or a new empty one. */
export function getAppealDraft(empId) {
  if (!draft || draft.empId !== empId) draft = { empId, form: emptyAppeal() };
  return draft.form;
}
export function saveAppealDraft(empId, form) { draft = { empId, form }; }
export function clearAppealDraft() { draft = null; prefill = null; }

/** "✉️ Start an appeal" from the Denial Navigator: remember the code / client / payer, then open the Appeal Builder. */
export function startAppeal({ codes, client_id, payer_id }) {
  prefill = { codes: codes ?? '', client_id: client_id ?? '', payer_id: payer_id ?? '' };
  window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_appeals' }));
}
export const peekPrefill = () => prefill;
export function clearPrefill() { prefill = null; }

// Signing out wipes the form (App.jsx sends this event)
if (typeof window !== 'undefined') window.addEventListener('helix:signed-out', clearAppealDraft);
