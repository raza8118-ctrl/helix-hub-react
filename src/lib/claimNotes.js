// Claim Note Generator (roadmap 6.1). Notes are built in the browser from dropdowns and each client's note format;
// they are never saved or logged. Formats hold {PLACEHOLDERS} only — there is no patient-name placeholder.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { addDays, today } from './helpers';

export const ACTIONS = [
  { value: 'call',      label: 'Called payer',                    icon: '📞' },
  { value: 'portal',    label: 'Checked portal / clearinghouse',  icon: '🌐' },
  { value: 'submit',    label: 'Submitted / rebilled claim',      icon: '📤' },
  { value: 'corrected', label: 'Sent corrected claim',            icon: '✏️' },
  { value: 'appeal',    label: 'Sent appeal / reconsideration',   icon: '✉️' },
  { value: 'records',   label: 'Sent records / requested info',   icon: '📄' },
  { value: 'escalate',  label: 'Escalated',                       icon: '⬆️' },
  { value: 'adjust',    label: 'Write-off / adjustment request',  icon: '🧾' },
];
export const actionOf = v => ACTIONS.find(a => a.value === v) ?? ACTIONS[0];

// Claim status: the words used in the note, the fields it asks for and the suggested follow-up (days from today)
export const STATUSES = [
  { value: '',           label: '— Not checked —',  text: '',               followDays: null, fields: [] },
  { value: 'paid',       label: 'Paid',             text: 'paid',           followDays: null, fields: ['paid_amount', 'paid_date', 'check_number'] },
  { value: 'partial',    label: 'Partially paid',   text: 'partially paid', followDays: 7,    fields: ['paid_amount', 'paid_date', 'check_number'] },
  { value: 'denied',     label: 'Denied',           text: 'denied',         followDays: 3,    fields: ['denial_codes'] },
  { value: 'in_process', label: 'In process',       text: 'in process',     followDays: 14,   fields: ['expected_time'] },
  { value: 'no_claim',   label: 'No claim on file', text: 'not on file',    followDays: 2,    fields: [] },
  { value: 'pending',    label: 'Pending info',     text: 'pending info',   followDays: 7,    fields: ['info_needed'] },
];
export const statusOf = v => STATUSES.find(s => s.value === v) ?? STATUSES[0];

export const STATUS_FIELDS = {
  paid_amount:   { label: 'Paid amount ($)',            type: 'text', placeholder: 'e.g. 1,250.00' },
  paid_date:     { label: 'Paid date',                  type: 'date' },
  check_number:  { label: 'Check / EFT #',              type: 'text' },
  denial_codes:  { label: 'Denial code(s)',             type: 'text', placeholder: 'e.g. CO-197 N54' },
  expected_time: { label: 'Expected processing time',   type: 'text', placeholder: 'e.g. 7–10 business days' },
  info_needed:   { label: 'What’s needed',              type: 'text', placeholder: 'e.g. itemized bill, COB update' },
};

export const NEXT_STEPS = [
  'Follow up', 'Send appeal', 'Send reconsideration', 'Rebill claim', 'Send corrected claim', 'Send records',
  'Bill patient / secondary', 'Escalate to supervisor', 'Request write-off', 'Close – paid',
];

export const DATE_STYLES = [
  { value: 'mdy2', label: '10/20/26' },
  { value: 'mdy4', label: '10/20/2026' },
  { value: 'iso',  label: '2026-10-20' },
];
export const formatDate = (iso, style) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return style === 'iso' ? iso : style === 'mdy4' ? `${m}/${d}/${y}` : `${m}/${d}/${y.slice(2)}`;
};

/** Follow-up date suggested by a status (yyyy-mm-dd), or '' when none applies. */
export const suggestFollowUp = status => {
  const days = statusOf(status).followDays;
  return days == null ? '' : addDays(today(), days);
};

export const emptyNote = () => ({
  client_id: '', payer_id: '', action: 'call', status: '', rep: '', ref: '', phone: '',
  paid_amount: '', paid_date: '', check_number: '', denial_codes: '', expected_time: '', info_needed: '',
  next_step: '', follow_up: '', followTouched: false, extra: '',
});

// ── Placeholders ───────────────────────────────────────────────────────────

export const NOTE_TOKENS = [
  { token: '{DATE}', label: 'Today' }, { token: '{USER}', label: 'You (initials or full name)' },
  { token: '{CLIENT}', label: 'Client' }, { token: '{PAYER}', label: 'Payer' }, { token: '{PHONE}', label: 'Phone called' },
  { token: '{ACTION}', label: 'What was done' }, { token: '{REP}', label: 'Rep name' }, { token: '{REF}', label: 'Call reference #' },
  { token: '{STATUS}', label: 'Claim status' }, { token: '{STATUS_DETAILS}', label: 'Status details (paid / denied / ETA / needs)' },
  { token: '{PAID_AMOUNT}', label: 'Paid amount' }, { token: '{PAID_DATE}', label: 'Paid date' }, { token: '{CHECK}', label: 'Check / EFT #' },
  { token: '{DENIAL_CODES}', label: 'Denial code(s)' }, { token: '{DENIAL_REASON}', label: 'Denial reason' },
  { token: '{EXPECTED_TIME}', label: 'Expected time' }, { token: '{INFO_NEEDED}', label: 'Info needed' },
  { token: '{NEXT_STEP}', label: 'Next step' }, { token: '{FOLLOW_UP}', label: 'Follow-up date' }, { token: '{EXTRA}', label: 'Extra note' },
];
const KNOWN = new Set(NOTE_TOKENS.map(t => t.token));
const TOKEN_RE = /\{[A-Z_]+\}/g;

export const SAMPLE_NOTE_VALUES = {
  '{DATE}': '10/20/26', '{USER}': 'AE', '{CLIENT}': 'Sample Home Health', '{PAYER}': 'Sample Health Plan', '{PHONE}': '800-000-0000',
  '{ACTION}': 'Called payer', '{REP}': 'Sam', '{REF}': 'REF0000', '{STATUS}': 'denied', '{STATUS_DETAILS}': 'CO-197 (prior auth missing)',
  '{DENIAL_CODES}': 'CO-197', '{DENIAL_REASON}': 'prior auth missing', '{NEXT_STEP}': 'Send reconsideration', '{FOLLOW_UP}': '11/03/26',
};

const initialsOf = name => (name ?? '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('');
const money = v => { const s = String(v ?? '').trim(); return s ? (s.startsWith('$') ? s : `$${s}`) : ''; };

/**
 * Placeholder values for one note. ctx = { user, clientName, payerName, denialReason, format } (format for the date /
 * name style). Returns { '{TOKEN}': value }.
 */
export function noteValues(note, ctx) {
  const style = ctx.format?.date_style ?? 'mdy2';
  const st = statusOf(note.status);
  const paidBits = [money(note.paid_amount) && `${money(note.paid_amount)} paid`, note.paid_date && `on ${formatDate(note.paid_date, style)}`,
    note.check_number && `chk/EFT# ${note.check_number.trim()}`].filter(Boolean).join(' ');
  const details = {
    paid: paidBits, partial: paidBits,
    denied: [note.denial_codes.trim(), ctx.denialReason && `(${ctx.denialReason})`].filter(Boolean).join(' '),
    in_process: note.expected_time.trim() && `ETA ${note.expected_time.trim()}`,
    pending: note.info_needed.trim() && `needs ${note.info_needed.trim()}`,
  }[note.status] ?? '';
  return {
    '{DATE}': formatDate(today(), style),
    '{USER}': ctx.format?.name_style === 'full' ? (ctx.user?.name ?? '') : initialsOf(ctx.user?.name ?? ctx.user?.emp_id),
    '{CLIENT}': ctx.clientName ?? '', '{PAYER}': ctx.payerName ?? '', '{PHONE}': note.phone.trim(),
    '{ACTION}': actionOf(note.action).label, '{REP}': note.rep.trim(), '{REF}': note.ref.trim(),
    '{STATUS}': st.text, '{STATUS_DETAILS}': details,
    '{PAID_AMOUNT}': money(note.paid_amount), '{PAID_DATE}': formatDate(note.paid_date, style), '{CHECK}': note.check_number.trim(),
    '{DENIAL_CODES}': note.denial_codes.trim(), '{DENIAL_REASON}': ctx.denialReason ?? '',
    '{EXPECTED_TIME}': note.expected_time.trim(), '{INFO_NEEDED}': note.info_needed.trim(),
    '{NEXT_STEP}': note.next_step, '{FOLLOW_UP}': formatDate(note.follow_up, style), '{EXTRA}': note.extra.trim().replace(/\s*\n+\s*/g, ' '),
  };
}

/** Fills a format: "[ … ]" parts with an empty placeholder are dropped, then tidied (spaces, doubled punctuation). */
export function buildNote(body, values, { upperCase = false } = {}) {
  let text = String(body ?? '').replace(/\[([^\]]*)\]/g, (_, part) => {
    const tokens = part.match(TOKEN_RE) ?? [];
    return tokens.some(t => !String(values[t] ?? '').trim()) ? '' : part;
  });
  text = text.replace(TOKEN_RE, t => String(values[t] ?? '').trim());
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/([.,;:])(?:\s*[.,;:])+/g, '$1')
    .replace(/(^|[.!?]\s)\s*[-–]\s*/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
  return upperCase ? text.toUpperCase() : text;
}

/** Best active format: same client > all clients; same action > any action. */
export function pickFormat(formats, { action, clientId }) {
  const fits = (formats ?? []).filter(f => f.active !== false
    && (f.client_id == null || String(f.client_id) === String(clientId))
    && (f.action === 'any' || f.action === action));
  const score = f => (f.client_id != null ? 4 : 0) + (f.action === action ? 2 : 0);
  return fits.sort((a, b) => score(b) - score(a) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0] ?? null;
}

/** Warnings for a format body (unknown placeholders, unbalanced brackets). */
export function checkFormat(body) {
  const warnings = [];
  const unknown = [...new Set((body.match(TOKEN_RE) ?? []).filter(t => !KNOWN.has(t)))];
  if (unknown.length) warnings.push(`Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  if ((body.match(/\[/g) ?? []).length !== (body.match(/\]/g) ?? []).length) warnings.push('The [ and ] brackets don’t match up.');
  if (/\b\d{6,}\b/.test(body)) warnings.push('Contains a long number — formats should hold placeholders, not real IDs.');
  return warnings;
}

// ── Database ───────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

/** Formats, or null when the 6.1 database update hasn't been run. */
export async function loadFormats() {
  const { data, error } = await db('note_formats').select('*');
  if (error) return null;
  return (data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function saveFormat(existing, values, user) {
  const payload = { ...values, updated_by: user.emp_id, updated_at: now() };
  const rows = existing
    ? await S.update('note_formats', payload, { id: existing.id })
    : await S.set('note_formats', { ...payload, source: 'manual', active: true, created_by: user.emp_id });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: existing ? 'note_format_edit' : 'note_format_add', entityType: 'note_format', entityId: rows[0].id });
  return rows[0];
}

export async function reviewFormat(f, user) {
  const ok = await S.update('note_formats', { reviewed_at: now(), reviewed_by: user.emp_id }, { id: f.id });
  if (ok) logAudit({ actor: user, action: 'note_format_review', entityType: 'note_format', entityId: f.id });
  return !!ok;
}

export async function setFormatActive(f, active, user) {
  const ok = await S.update('note_formats', { active, updated_by: user.emp_id, updated_at: now() }, { id: f.id });
  if (ok) logAudit({ actor: user, action: active ? 'note_format_activate' : 'note_format_deactivate', entityType: 'note_format', entityId: f.id });
  return !!ok;
}

// ── Standard formats (3Gen wording — to be reviewed) ─────────────────────────

const NEXT = '[ Next: {NEXT_STEP}.][ F/u {FOLLOW_UP}.][ {EXTRA}]';
export const STARTER_FORMATS = [
  { name: '3Gen standard – call', action: 'call',
    body: `{DATE} {USER} - Called {PAYER}[ @ {PHONE}][, spoke w/ {REP}][, ref# {REF}].[ Claim {STATUS}][ - {STATUS_DETAILS}].${NEXT}` },
  { name: '3Gen standard – portal check', action: 'portal',
    body: `{DATE} {USER} - Checked {PAYER} portal/clearinghouse.[ Claim {STATUS}][ - {STATUS_DETAILS}].${NEXT}` },
  { name: '3Gen standard – submitted / rebilled', action: 'submit',
    body: `{DATE} {USER} - Submitted/rebilled claim to {PAYER}.[ Claim {STATUS}][ - {STATUS_DETAILS}].${NEXT}` },
  { name: '3Gen standard – corrected claim', action: 'corrected',
    body: `{DATE} {USER} - Sent corrected claim to {PAYER}.${NEXT}` },
  { name: '3Gen standard – appeal / recon', action: 'appeal',
    body: `{DATE} {USER} - Sent appeal/recon to {PAYER}[ for {DENIAL_CODES}][ ({DENIAL_REASON})].${NEXT}` },
  { name: '3Gen standard – records / info', action: 'records',
    body: `{DATE} {USER} - Sent records/requested info for {PAYER}[: {INFO_NEEDED}].${NEXT}` },
  { name: '3Gen standard – escalation', action: 'escalate',
    body: `{DATE} {USER} - Escalated claim ({PAYER}).[ Claim {STATUS}][ - {STATUS_DETAILS}].${NEXT}` },
  { name: '3Gen standard – write-off / adjustment', action: 'adjust',
    body: `{DATE} {USER} - Requested write-off/adjustment ({PAYER}).[ Claim {STATUS}][ - {STATUS_DETAILS}].[ Reason: {EXTRA}]` },
];

export const missingStarterFormats = formats =>
  STARTER_FORMATS.filter(s => !(formats ?? []).some(f => (f.name ?? '').toLowerCase() === s.name.toLowerCase()));

export async function addStarterFormats(list, user) {
  const rows = await S.set('note_formats', list.map(s => ({
    name: s.name, client_id: null, action: s.action, body: s.body, date_style: 'mdy2', upper_case: false,
    max_length: null, name_style: 'initials', source: 'starter', active: true, created_by: user.emp_id, updated_by: user.emp_id,
  })));
  if (!rows?.length) return 0;
  logAudit({ actor: user, action: 'note_starter_add', entityType: 'note_format', details: { count: rows.length } });
  return rows.length;
}

// ── Prefill from the Smart Worklist (6.4) — in memory only ──────────────────

let notePrefill = null;   // { client_id, payer_id }

/** Opens AR Tools → Claim Note Generator with the client and payer already picked. */
export function startClaimNote({ client_id, payer_id }) {
  notePrefill = { client_id: client_id != null ? String(client_id) : '', payer_id: payer_id != null ? String(payer_id) : '' };
  window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_artools' }));
}
export const peekNotePrefill = () => notePrefill;
export function clearNotePrefill() { notePrefill = null; }
