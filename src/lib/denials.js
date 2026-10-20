// Denial library (roadmap 4.1): CARC / RARC / group codes with plain-English reasons.
// Official X12 wording comes only from the lists a company imports; plain reasons are our own words.
// Pasted ERA/EOB lines are searched here in the browser and never saved or logged.
import { db, S } from './supabase';
import { logAudit } from './audit';

export const CODE_TYPES = [
  { value: 'carc',  label: 'CARC',  long: 'Claim adjustment reason code' },
  { value: 'rarc',  label: 'RARC',  long: 'Remark code' },
  { value: 'group', label: 'Group', long: 'Group code' },
  { value: 'other', label: 'Other', long: 'Other code (e.g. FISS reason code, payer-specific)' },
];
export const typeOf = value => CODE_TYPES.find(t => t.value === value) ?? CODE_TYPES[3];

export const CATEGORIES = [
  'Eligibility', 'Authorization', 'Coding', 'Timely filing', 'Duplicate', 'Documentation / records',
  'Coordination of benefits', 'Medicare HH & Hospice', 'Patient responsibility', 'Other',
];

// Built-in meaning of the group codes, shown next to any CARC pasted with one
export const GROUP_CODES = {
  CO: 'Contractual obligation — the provider writes this off; don’t bill the patient.',
  PR: 'Patient responsibility — the patient (or their secondary insurance) can be billed.',
  OA: 'Other adjustment — neither CO nor PR applies; check the reason code.',
  PI: 'Payer-initiated reduction — the payer reduced it; usually not billable to the patient.',
  CR: 'Correction / reversal of an earlier claim (older ERAs).',
};

const now = () => new Date().toISOString();
export const normCode = code => String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Codes table, or null when the 4.1 database update hasn't been run. */
export async function loadDenialCodes() {
  const { data, error } = await db('denial_codes').select('*');
  if (error) return null;
  return data ?? [];
}

// ── Code parsing (pasted ERA / EOB lines) ─────────────────────────────────

const RARC_RE = /^(MA|M|N)\d{1,4}$/;
const CARC_RE = /^([A-Z]\d{1,2}|\d{1,3})$/;
const OTHER_RE = /^\d{4,6}$/;                       // e.g. FISS reason codes
const PAIR_RE = /^(CO|PR|OA|PI|CR)[-:]?([A-Z0-9]{1,6})$/;

/** One pasted token → { group, type, code } or null when it isn't a code. */
function parseToken(raw) {
  const t = normCode(raw).replace(/[.,;:]+$/, '');
  if (!t) return null;
  if (GROUP_CODES[t]) return { group: t, type: 'group', code: t };
  const pair = t.match(PAIR_RE);
  if (pair) return { group: pair[1], type: 'carc', code: pair[2] };
  if (RARC_RE.test(t)) return { group: null, type: 'rarc', code: t };
  if (CARC_RE.test(t)) return { group: null, type: 'carc', code: t };
  if (OTHER_RE.test(t)) return { group: null, type: 'other', code: t };
  return null;
}

/** All codes in a pasted line ("CO-16 N290 MA130"), or null if the text isn't only codes. */
export function parseCodeLine(text) {
  // Money amounts on a pasted ERA line ("CO-45 120.00", "$35.10") are skipped
  const tokens = String(text ?? '').split(/[\s,;|/]+/).filter(t => t && !/^-?\$?\d+\.\d{1,2}$/.test(t));
  // "CO 16" (group and code separated by a space) → join them
  const merged = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = normCode(tokens[i]);
    if (GROUP_CODES[t] && tokens[i + 1] && /^[A-Z0-9]{1,6}$/i.test(tokens[i + 1]) && !GROUP_CODES[normCode(tokens[i + 1])]) {
      merged.push(`${t}-${tokens[i + 1]}`);
      i++;
    } else merged.push(tokens[i]);
  }
  const parsed = merged.map(parseToken);
  if (!parsed.length || parsed.some(p => !p)) return null;
  return parsed;
}

/** Library entry for a parsed code (numeric codes also match 'other', e.g. FISS reason codes). */
export function findCode(codes, { type, code }) {
  const active = codes.filter(c => c.active !== false);
  return active.find(c => c.code_type === type && normCode(c.code) === code)
    ?? (type === 'carc' || type === 'other'
      ? active.find(c => (c.code_type === 'other' || c.code_type === 'carc') && normCode(c.code) === code)
      : null)
    ?? null;
}

const typeRank = { group: 0, carc: 1, rarc: 2, other: 3 };
const codeSort = (a, b) => (typeRank[a.code_type] - typeRank[b.code_type])
  || normCode(a.code).localeCompare(normCode(b.code), undefined, { numeric: true });

/** Text search over code, reason, official text, notes and category. */
export function searchCodes(codes, query, { type = 'ALL', category = 'ALL', showRetired = true, showInactive = false, onlyUnverified = false } = {}) {
  const q = query.trim().toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  return codes
    .filter(c => showInactive || c.active !== false)
    .filter(c => type === 'ALL' || c.code_type === type)
    .filter(c => category === 'ALL' || c.category === category)
    .filter(c => showRetired || !c.stopped_on || c.stopped_on > day)
    .filter(c => !onlyUnverified || !c.verified_at)
    .filter(c => !q || [c.code, c.plain_reason, c.official_text, c.notes, c.category]
      .some(v => (v ?? '').toLowerCase().includes(q)) || normCode(c.code) === normCode(q))
    .sort(codeSort);
}

export const isRetired = c => !!c.stopped_on && c.stopped_on <= new Date().toISOString().slice(0, 10);

// ── Editing ──────────────────────────────────────────────────────────────

/** Adds or edits one code. Returns the saved row, or { error }. */
export async function saveCode(codes, existing, values, user) {
  const code = normCode(values.code);
  const clash = codes.find(c => c.id !== existing?.id && c.code_type === values.code_type && normCode(c.code) === code);
  if (clash) return { error: `${typeOf(values.code_type).label} ${code} is already in the library${clash.active === false ? ' (inactive — reactivate it instead)' : ''}.` };
  const payload = { ...values, code, updated_by: user.emp_id, updated_at: now() };
  const rows = existing
    ? await S.update('denial_codes', payload, { id: existing.id })
    : await S.set('denial_codes', { ...payload, source: 'manual', active: true, created_by: user.emp_id });
  if (!rows?.length) return { error: 'Could not save. Please try again.' };
  logAudit({ actor: user, action: existing ? 'denial_code_edit' : 'denial_code_add', entityType: 'denial_code', entityId: rows[0].id });
  return rows[0];
}

export async function verifyCode(row, user) {
  const ok = await S.update('denial_codes', { verified_at: now(), verified_by: user.emp_id }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'denial_code_verify', entityType: 'denial_code', entityId: row.id });
  return !!ok;
}

export async function setCodeActive(row, active, user) {
  const ok = await S.update('denial_codes', { active, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: active ? 'denial_code_activate' : 'denial_code_deactivate', entityType: 'denial_code', entityId: row.id });
  return !!ok;
}

// ── Import (official X12 lists saved as Excel / CSV) ─────────────────────

const pickHeader = (headers, ...words) => headers.find(h => words.some(w => h.toLowerCase().includes(w)));

function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

/**
 * Reads the first sheet of an Excel/CSV file. Needs a Code column and a Description column; optional Type
 * and Stop/Deactivation date columns. "Stop: mm/dd/yyyy" inside the description is also picked up.
 * Returns { rows: [{ code_type|null, code, official_text, stopped_on }], hasType } or { error }.
 */
export async function readImportFile(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!json.length) return { error: 'The file is empty.' };
  const headers = Object.keys(json[0]);
  const codeH = pickHeader(headers, 'code');
  const descH = pickHeader(headers.filter(h => h !== codeH), 'desc', 'text', 'meaning');
  const typeH = pickHeader(headers.filter(h => h !== codeH && h !== descH), 'type');
  const stopH = pickHeader(headers, 'stop', 'deactiv', 'retire', 'end date');
  if (!codeH || !descH) return { error: 'The file needs a “Code” column and a “Description” column.' };
  const types = { carc: 'carc', reason: 'carc', 'claim adjustment': 'carc', rarc: 'rarc', remark: 'rarc', group: 'group', other: 'other' };
  const rows = json.map(r => {
    const text = String(r[descH] ?? '').trim();
    const t = typeH ? String(r[typeH] ?? '').trim().toLowerCase() : '';
    const inlineStop = text.match(/Stop:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
    return {
      code_type: typeH ? (Object.entries(types).find(([k]) => t.includes(k))?.[1] ?? null) : null,
      code: normCode(r[codeH]),
      official_text: text || null,
      stopped_on: toDate(stopH ? r[stopH] : null) ?? toDate(inlineStop),
    };
  }).filter(r => r.code);
  return { rows, hasType: !!typeH };
}

/** Compares import rows with the library: { added: [...], changed: [{ row, existing }], same, skipped }. */
export function compareImport(codes, rows, defaultType) {
  const added = [], changed = [];
  let same = 0, skipped = 0;
  const seen = new Set();
  for (const r of rows) {
    const type = r.code_type ?? defaultType;
    if (!type) { skipped++; continue; }
    const key = `${type}|${r.code}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const existing = codes.find(c => c.code_type === type && normCode(c.code) === r.code);
    const row = { ...r, code_type: type };
    if (!existing) added.push(row);
    else if ((existing.official_text ?? null) !== (r.official_text ?? null) || (existing.stopped_on ?? null) !== (r.stopped_on ?? null)) {
      changed.push({ row, existing });
    } else same++;
  }
  return { added, changed, same, skipped };
}

/** Saves an import: new codes added, changed ones get the new official text / stop date only. */
export async function applyImport(diff, user) {
  let added = 0, updated = 0;
  if (diff.added.length) {
    for (let i = 0; i < diff.added.length; i += 500) {
      const rows = await S.set('denial_codes', diff.added.slice(i, i + 500).map(r => ({
        code_type: r.code_type, code: r.code, official_text: r.official_text, stopped_on: r.stopped_on,
        source: 'import', active: true, created_by: user.emp_id, updated_by: user.emp_id,
      })));
      added += rows?.length ?? 0;
    }
  }
  for (const { row, existing } of diff.changed) {
    const ok = await S.update('denial_codes', {
      official_text: row.official_text, stopped_on: row.stopped_on, updated_by: user.emp_id, updated_at: now(),
    }, { id: existing.id });
    if (ok) updated++;
  }
  logAudit({ actor: user, action: 'denial_import', entityType: 'denial_code', details: { added, updated, unchanged: diff.same } });
  return { added, updated };
}

// ── Starter set (our own plain-English wording; to be verified by the team) ──

const G = 'group', C = 'carc', R = 'rarc';
export const STARTER_CODES = [
  { t: G, c: 'CO', cat: 'Other', r: 'Contractual obligation: the amount is the provider’s write-off under the contract or rules. Do not bill the patient.' },
  { t: G, c: 'PR', cat: 'Patient responsibility', r: 'Patient responsibility: the patient (or their secondary insurance) can be billed for this amount.' },
  { t: G, c: 'OA', cat: 'Other', r: 'Other adjustment: neither the provider nor the patient is clearly responsible — read the reason code.' },
  { t: G, c: 'PI', cat: 'Other', r: 'Payer-initiated reduction: the payer reduced the amount; usually not billable to the patient.' },
  { t: G, c: 'CR', cat: 'Other', r: 'Correction / reversal of an earlier claim payment (seen on older ERAs).' },
  { t: C, c: '1', cat: 'Patient responsibility', r: 'Applied to the patient’s deductible. Bill the patient or their secondary plan.' },
  { t: C, c: '2', cat: 'Patient responsibility', r: 'Patient’s coinsurance share. Bill the patient or their secondary plan.' },
  { t: C, c: '3', cat: 'Patient responsibility', r: 'Patient’s co-payment. Bill the patient or their secondary plan.' },
  { t: C, c: '4', cat: 'Coding', r: 'The procedure code and modifier don’t match, or a required modifier is missing. Check the modifier and correct the claim.' },
  { t: C, c: '5', cat: 'Coding', r: 'The procedure code or type of bill doesn’t match the place of service. Check POS / TOB and correct the claim.' },
  { t: C, c: '11', cat: 'Coding', r: 'The diagnosis doesn’t support the procedure billed. Check the diagnosis codes against the documentation.' },
  { t: C, c: '16', cat: 'Documentation / records', r: 'The claim is missing information or has a billing error. The remark code (RARC) says what — fix it and resubmit.' },
  { t: C, c: '18', cat: 'Duplicate', r: 'Duplicate claim or service — the payer already has it. Check whether the original was paid or is still processing.' },
  { t: C, c: '22', cat: 'Coordination of benefits', r: 'Another payer may be primary (coordination of benefits). Confirm the primary payer and bill them first.' },
  { t: C, c: '23', cat: 'Coordination of benefits', r: 'Adjusted because of what the earlier (primary) payer paid or allowed.' },
  { t: C, c: '26', cat: 'Eligibility', r: 'Service was before the patient’s coverage started. Check eligibility and the correct payer for that date.' },
  { t: C, c: '27', cat: 'Eligibility', r: 'Service was after the patient’s coverage ended. Check eligibility and the correct payer for that date.' },
  { t: C, c: '29', cat: 'Timely filing', r: 'Filed too late — the timely filing limit has passed. Look for proof of timely filing before writing off.' },
  { t: C, c: '31', cat: 'Eligibility', r: 'The payer can’t identify the patient as their member. Check name, DOB and member ID against the card.' },
  { t: C, c: '45', cat: 'Other', r: 'Charge is above the allowed amount / fee schedule. The difference is usually a contractual write-off.' },
  { t: C, c: '50', cat: 'Documentation / records', r: 'Not considered medically necessary by the payer. Review documentation; an appeal with records may be needed.' },
  { t: C, c: '96', cat: 'Other', r: 'Non-covered charge. The remark code usually says why.' },
  { t: C, c: '97', cat: 'Coding', r: 'Bundled — the payment is included in another service already paid. Check bundling rules / modifiers.' },
  { t: C, c: '109', cat: 'Eligibility', r: 'Not covered by this payer — send the claim to the correct payer or contractor.' },
  { t: C, c: '119', cat: 'Eligibility', r: 'The benefit maximum for this period has been reached.' },
  { t: C, c: '140', cat: 'Eligibility', r: 'Patient name and member ID don’t match the payer’s records. Correct the demographics and resubmit.' },
  { t: C, c: '151', cat: 'Documentation / records', r: 'The payer says the information sent doesn’t support this many services / this frequency.' },
  { t: C, c: '167', cat: 'Coding', r: 'The diagnosis isn’t covered. Check the diagnosis coding and the payer’s coverage rules.' },
  { t: C, c: '197', cat: 'Authorization', r: 'Prior authorization / pre-certification / notification was missing. Check for an auth on file.' },
  { t: C, c: '198', cat: 'Authorization', r: 'More was billed than the authorization allows (visits, units or dates).' },
  { t: C, c: '204', cat: 'Eligibility', r: 'The service isn’t covered under the patient’s current benefit plan.' },
  { t: C, c: '242', cat: 'Eligibility', r: 'Services not provided by a network / primary care provider for this plan.' },
  { t: C, c: '253', cat: 'Other', r: 'Medicare sequestration — the federal payment reduction. A contractual write-off, not a denial.' },
  { t: C, c: 'A1', cat: 'Other', r: 'General denial — the remark code(s) explain the actual reason.' },
  { t: C, c: 'B7', cat: 'Other', r: 'The provider wasn’t certified / eligible to be paid for this service on this date. Check enrolment and certification.' },
  { t: C, c: 'B9', cat: 'Medicare HH & Hospice', r: 'The patient is enrolled in hospice. Check the hospice election dates and whether the service is related.' },
  { t: R, c: 'N290', cat: 'Other', r: 'Rendering provider identifier (e.g. NPI) is missing or invalid. Correct the provider details and resubmit.' },
  { t: R, c: 'MA130', cat: 'Documentation / records', r: 'The claim had incomplete or invalid information and can’t be appealed — send a new, corrected claim.' },
  { t: R, c: 'M51', cat: 'Coding', r: 'Procedure code(s) missing, incomplete or invalid. Correct the codes and resubmit.' },
  { t: R, c: 'N130', cat: 'Other', r: 'Check the plan’s benefit documents / guidelines for coverage information.' },
  { t: R, c: 'N211', cat: 'Other', r: 'Alert: this decision can’t be appealed.' },
  { t: R, c: 'MA04', cat: 'Coordination of benefits', r: 'Secondary payment needs the primary payer’s information. Send the primary EOB / ERA with the claim.' },
  { t: R, c: 'N479', cat: 'Coordination of benefits', r: 'The other payer’s explanation of benefits (EOB) is missing. Attach it and resubmit.' },
  { t: R, c: 'N30', cat: 'Eligibility', r: 'The patient isn’t eligible for this service.' },
  { t: R, c: 'N54', cat: 'Authorization', r: 'The claim doesn’t match what was pre-certified / authorized.' },
  { t: R, c: 'M86', cat: 'Duplicate', r: 'Already paid for the same or a similar service in this time frame.' },
  { t: R, c: 'M127', cat: 'Documentation / records', r: 'The patient’s medical record for this service is missing. Send the records.' },
  { t: R, c: 'N115', cat: 'Other', r: 'Decision based on a Local Coverage Determination (LCD). Check the LCD requirements.' },
  { t: R, c: 'N386', cat: 'Other', r: 'Decision based on a National Coverage Determination (NCD). Check the NCD requirements.' },
];

/** Starter codes not yet in the library (any active or inactive entry with the same type + code counts). */
export function missingStarterCodes(codes) {
  return STARTER_CODES.filter(s => !codes.some(c => c.code_type === s.t && normCode(c.code) === normCode(s.c)));
}

/** Adds the picked starter codes, marked as source 'starter' (unverified). Returns how many were added. */
export async function addStarterCodes(picked, user) {
  const rows = await S.set('denial_codes', picked.map(s => ({
    code_type: s.t, code: normCode(s.c), plain_reason: s.r, category: s.cat, source: 'starter', active: true,
    created_by: user.emp_id, updated_by: user.emp_id,
  })));
  if (!rows?.length) return 0;
  logAudit({ actor: user, action: 'denial_starter_add', entityType: 'denial_code', details: { count: rows.length } });
  return rows.length;
}
