// Credentialing assistant (roadmap 9.3): providers (agencies + practitioners), payer enrollments and expiring items,
// one “Due soon” list (CAQH every 120 days, revalidations, expirables, enrollments stuck in process), a per-provider
// status checklist and an AI enrollment checklist built from Helix Hub data only. No patient data; practitioner SSN /
// DOB / home address are deliberately not stored. Everyone views; “Manage credentialing” edits; rows never deleted.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { addDays, today } from './helpers';
import { daysBetween } from './deadlines';
import { converse } from './assistant';

export const CAQH_DAYS = 120;
export const STUCK_DAYS = 30;
export const WINDOW_DAYS = 90;
export const MEDICARE_REVAL_YEARS = 5;

const opts = list => list.map(([value, label, extra]) => ({ value, label, ...extra }));
export const KINDS = opts([['agency', 'Agency / group'], ['individual', 'Individual practitioner']]);
export const PROVIDER_TYPES = opts([['agency', 'Agency / group'], ['physician', 'Physician'], ['np', 'Nurse practitioner'],
  ['therapist', 'Therapist (PT / OT / ST)'], ['rn', 'RN'], ['other', 'Other']]);
export const ENROLL_STATUSES = opts([
  ['not_started', 'Not started', { badge: 'badge-gray' }], ['submitted', 'Application submitted', { badge: 'badge-blue' }],
  ['in_process', 'In process', { badge: 'badge-yellow' }], ['approved', 'Approved / participating', { badge: 'badge-green' }],
  ['denied', 'Denied', { badge: 'badge-red' }], ['termed', 'Termed', { badge: 'badge-gray' }],
]);
export const ITEM_TYPES = opts([['state_license', 'State license'], ['accreditation', 'Accreditation (CHAP / ACHC / TJC)'],
  ['liability', 'Liability insurance'], ['medicare_reval', 'Medicare revalidation'], ['medicaid_reval', 'Medicaid revalidation'],
  ['clia', 'CLIA certificate'], ['dea', 'DEA registration'], ['board_cert', 'Board certification'], ['other', 'Other']]);
export const CHECKLIST_REQUESTS = opts([['new', 'New enrollment / credentialing'], ['reval', 'Revalidation / re-credentialing'],
  ['change', 'Add a location / change of information']]);
export const labelOf = (list, v) => list.find(o => o.value === v)?.label ?? v ?? '';
export const statusOf = v => ENROLL_STATUSES.find(s => s.value === v) ?? ENROLL_STATUSES[0];

export const canEditCred = user => hasAccess(user, 'credentialing_edit');
const now = () => new Date().toISOString();
const addYears = (date, n) => { const d = new Date(`${date}T00:00:00`); d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0, 10); };
/** Suggested Medicare revalidation date: approval + 5 years (the MAC notice wins). */
export const suggestReval = effectiveOn => (effectiveOn ? addYears(effectiveOn, MEDICARE_REVAL_YEARS) : '');

// ── Editors (one config per record kind) ───────────────────────────────────

export const CRED_RECORDS = {
  provider: {
    table: 'cred_providers', entity: 'cred_provider', one: 'provider',
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: KINDS, required: true },
      { key: 'name', label: 'Name', type: 'text', required: true, hint: 'Agency name or practitioner name' },
      { key: 'provider_type', label: 'Type', type: 'select', options: PROVIDER_TYPES, required: true },
      { key: 'npi', label: 'NPI', type: 'text' },
      { key: 'client_id', label: 'Client (agency)', type: 'client' },
      { key: 'caqh_id', label: 'CAQH ID', type: 'text' },
      { key: 'caqh_attested_on', label: 'Last CAQH attestation', type: 'date', hint: `Next due ${CAQH_DAYS} days later` },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  enrollment: {
    table: 'cred_enrollments', entity: 'cred_enrollment', one: 'enrollment',
    fields: [
      { key: 'payer_id', label: 'Payer', type: 'payer', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ENROLL_STATUSES, required: true },
      { key: 'submitted_on', label: 'Submitted on', type: 'date' },
      { key: 'last_followup_on', label: 'Last follow-up', type: 'date' },
      { key: 'effective_on', label: 'Effective / approved on', type: 'date' },
      { key: 'payer_provider_id', label: 'Payer-assigned provider ID', type: 'text' },
      { key: 'revalidation_due', label: 'Revalidation / re-credentialing due', type: 'date', hint: 'Medicare: approval + 5 years unless the MAC notice says otherwise' },
      { key: 'rep_name', label: 'Payer rep', type: 'text' },
      { key: 'rep_phone', label: 'Rep phone', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  expirable: {
    table: 'cred_expirables', entity: 'cred_expirable', one: 'expiring item',
    fields: [
      { key: 'item_type', label: 'What', type: 'select', options: ITEM_TYPES, required: true },
      { key: 'number', label: 'Number', type: 'text' },
      { key: 'issuer', label: 'Issued by', type: 'text', hint: 'e.g. Texas HHSC, CHAP, insurer name' },
      { key: 'expires_on', label: 'Expires on', type: 'date', required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};

/** Checks required fields. Returns an error message or ''. */
export function checkCred(kind, v) {
  const missing = CRED_RECORDS[kind].fields.filter(f => f.required && (v[f.key] == null || v[f.key] === ''));
  return missing.length ? `Please fill in: ${missing.map(f => f.label).join(', ')}.` : '';
}

const cleanCred = (kind, v) => Object.fromEntries(CRED_RECORDS[kind].fields.map(f => {
  const x = v[f.key];
  if (x == null || x === '') return [f.key, null];
  return [f.key, typeof x === 'string' ? x.trim() : x];
}));

/** Adds (no row) or edits. extra = parent link (provider_id). Returns the saved row or null. */
export async function saveCred(kind, row, values, user, extra = {}) {
  const t = CRED_RECORDS[kind];
  const data = { ...cleanCred(kind, values), ...extra, updated_by: user.emp_id, updated_at: now() };
  const saved = row
    ? (await S.update(t.table, data, { id: row.id }))?.[0]
    : (await S.set(t.table, { ...data, created_by: user.emp_id }))?.[0];
  if (saved) logAudit({ actor: user, action: `${t.entity}_${row ? 'edit' : 'add'}`, entityType: t.entity, entityId: saved.id });
  return saved ?? null;
}

/** Quick update of a few fields (✓ Done buttons). */
export async function patchCred(kind, row, patch, user) {
  const t = CRED_RECORDS[kind];
  const ok = await S.update(t.table, { ...patch, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: `${t.entity}_edit`, entityType: t.entity, entityId: row.id, details: { fields: Object.keys(patch) } });
  return !!ok;
}

export async function setCredActive(kind, row, active, user) {
  const t = CRED_RECORDS[kind];
  const ok = await S.update(t.table, { active, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: `${t.entity}_${active ? 'activate' : 'deactivate'}`, entityType: t.entity, entityId: row.id });
  return !!ok;
}

// ── Loading ────────────────────────────────────────────────────────────────

/** { providers, enrollments, expirables } (all rows), or null when the 9.3 database update hasn't been run. */
export async function loadCred() {
  const [p, e, x] = await Promise.all(['cred_providers', 'cred_enrollments', 'cred_expirables'].map(t => db(t).select('*')));
  if (p.error) return null;
  return {
    providers: (p.data ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    enrollments: e.data ?? [],
    expirables: x.data ?? [],
  };
}

// ── Due soon ───────────────────────────────────────────────────────────────

export const BANDS = [
  { key: 'overdue', label: 'Overdue', icon: '🔴', max: -1 },
  { key: 'd30', label: 'Within 30 days', icon: '🟠', max: 30 },
  { key: 'd60', label: 'Within 60 days', icon: '🟡', max: 60 },
  { key: 'd90', label: 'Within 90 days', icon: '⚪', max: 90 },
];
export const bandOf = days => BANDS.find(b => days <= b.max)?.key ?? null;

/**
 * Everything due within 90 days (or overdue), soonest first:
 * [{ key, type: 'caqh' | 'reval' | 'expirable' | 'stuck', what, provider, due, days, record: { kind, row } }].
 */
export function dueItems(data, payers) {
  const day = today();
  const providers = Object.fromEntries(data.providers.filter(p => p.active !== false).map(p => [p.id, p]));
  const payerName = id => payers.find(p => p.id === id)?.name ?? 'Payer';
  const out = [];
  const push = (type, what, provider, due, record) => {
    const days = daysBetween(day, due);
    if (days <= WINDOW_DAYS) out.push({ key: `${type}${record.row.id}`, type, what, provider, due, days, record });
  };
  for (const p of Object.values(providers)) {
    if (p.kind === 'individual' && (p.caqh_id || p.caqh_attested_on)) {
      push('caqh', p.caqh_attested_on ? 'CAQH re-attestation' : 'CAQH attestation date not recorded', p,
        p.caqh_attested_on ? addDays(p.caqh_attested_on, CAQH_DAYS) : day, { kind: 'provider', row: p });
    }
  }
  for (const e of data.enrollments) {
    const p = providers[e.provider_id];
    if (!p || e.active === false) continue;
    if (e.revalidation_due && e.status === 'approved') push('reval', `Revalidation — ${payerName(e.payer_id)}`, p, e.revalidation_due, { kind: 'enrollment', row: e });
    if (['submitted', 'in_process'].includes(e.status)) {
      const last = e.last_followup_on ?? e.submitted_on ?? e.created_at.slice(0, 10);
      const due = addDays(last, STUCK_DAYS);
      if (due <= day) push('stuck', `Follow up — ${payerName(e.payer_id)} enrollment (${statusOf(e.status).label.toLowerCase()})`, p, due, { kind: 'enrollment', row: e });
    }
  }
  for (const x of data.expirables) {
    const p = providers[x.provider_id];
    if (!p || x.active === false || !x.expires_on) continue;
    push('expirable', `${labelOf(ITEM_TYPES, x.item_type)} expires${x.number ? ` (${x.number})` : ''}`, p, x.expires_on, { kind: 'expirable', row: x });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** Status checklist text for one provider (📋 Copy). */
export function statusChecklist(p, data, payers) {
  const day = today();
  const left = d => { const n = daysBetween(day, d); return n < 0 ? `OVERDUE ${-n}d` : `${n} days left`; };
  const lines = [`Credentialing status — ${p.name}${p.npi ? ` (NPI ${p.npi})` : ''} — ${day}`];
  if (p.kind === 'individual') {
    lines.push(p.caqh_attested_on ? `CAQH: attested ${p.caqh_attested_on}, next due ${addDays(p.caqh_attested_on, CAQH_DAYS)} (${left(addDays(p.caqh_attested_on, CAQH_DAYS))})` : 'CAQH: attestation date not recorded');
  }
  const ens = data.enrollments.filter(e => e.provider_id === p.id && e.active !== false);
  lines.push('', 'Payer enrollments:');
  if (!ens.length) lines.push('  none recorded');
  for (const e of ens) {
    const payer = payers.find(x => x.id === e.payer_id)?.name ?? 'Payer';
    lines.push(`  • ${payer}: ${statusOf(e.status).label}${e.effective_on ? `, effective ${e.effective_on}` : ''}${e.payer_provider_id ? `, ID ${e.payer_provider_id}` : ''}`
      + `${e.revalidation_due ? `, revalidation due ${e.revalidation_due} (${left(e.revalidation_due)})` : ''}`);
  }
  const xs = data.expirables.filter(x => x.provider_id === p.id && x.active !== false);
  lines.push('', 'Licenses & certificates:');
  if (!xs.length) lines.push('  none recorded');
  for (const x of xs) lines.push(`  • ${labelOf(ITEM_TYPES, x.item_type)}${x.number ? ` ${x.number}` : ''}: expires ${x.expires_on ?? '—'}${x.expires_on ? ` (${left(x.expires_on)})` : ''}`);
  return lines.join('\n');
}

// ── AI enrollment checklist ────────────────────────────────────────────────

const SYSTEM = `You are Helix, preparing a payer enrollment / credentialing checklist for 3Gen's credentialing team (US
home health, hospice and related agencies and their practitioners). Use only what the lookups return: search the payer,
get_payer (Provider Relations contacts, portal, notes), search_sops / get_sop for a credentialing or enrollment SOP for
this payer, and search_payer_updates for recent credentialing changes. Never fill gaps from general knowledge — list
what Helix Hub is missing instead. Copy phone numbers, links and day counts exactly. Steps are short imperative lines.`;
const list = { type: 'array', items: { type: 'string' } };
const SCHEMA = {
  type: 'object',
  properties: {
    documents: list, how_to_submit: { type: 'string' }, timeline: { type: 'string' },
    steps: list, follow_up: { type: 'string' }, watch_out: list, missing: list,
  },
  required: ['documents', 'how_to_submit', 'timeline', 'steps', 'follow_up', 'watch_out', 'missing'],
  additionalProperties: false,
};

/**
 * req = { payer, providerType, request }. Only these selections are sent (never provider names or NPIs).
 * Returns { checklist, sources } or throws Error (NO_KEY when no AI key).
 */
export async function buildEnrollmentChecklist(req, knowledge, user, onLookup) {
  const question = [
    `Payer: ${req.payer.name} (payer_id ${req.payer.id})`,
    `Provider type: ${labelOf(PROVIDER_TYPES, req.providerType)}`,
    `Request: ${labelOf(CHECKLIST_REQUESTS, req.request)}`,
    'Build the enrollment checklist.',
  ].join('\n');
  let ok = false;
  let lookups = 0;
  try {
    const r = await converse({ system: SYSTEM, messages: [{ role: 'user', content: question }], format: { type: 'json_schema', schema: SCHEMA }, knowledge, onLookup });
    lookups = r.lookups;
    let checklist;
    try { checklist = JSON.parse(r.text); } catch { throw new Error('The checklist couldn’t be read — please try again.'); }
    ok = true;
    return { checklist, sources: r.sources };
  } finally {
    logAudit({ actor: user, action: 'cred_checklist', entityType: 'assistant', details: { lookups, ok } });
  }
}
