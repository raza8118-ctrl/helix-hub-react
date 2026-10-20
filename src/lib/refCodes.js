// Code lookup (roadmap 6.3): revenue codes, HIPPS and ICD-10-CM reference lists (CARC / RARC stay in the Denial library).
// Searches run in the database (ICD-10-CM has ~74,000 codes) and are never saved or logged. Reference data only — no PHI.
import { db, S } from './supabase';
import { logAudit } from './audit';

export const CODE_SETS = [
  { value: 'revenue', label: 'Revenue', long: 'Revenue code (UB-04)' },
  { value: 'hipps',   label: 'HIPPS',   long: 'HIPPS code' },
  { value: 'icd10',   label: 'ICD-10',  long: 'ICD-10-CM diagnosis code' },
];
export const setOf = v => CODE_SETS.find(s => s.value === v) ?? CODE_SETS[0];

const now = () => new Date().toISOString();

/** Stored form: upper case, no spaces; ICD-10 without the dot; revenue codes padded to 4 digits. */
export function normRef(set, code) {
  let c = String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (set === 'icd10') c = c.replace(/\./g, '');
  if (set === 'revenue' && /^\d{1,3}$/.test(c)) c = c.padStart(4, '0');
  return c;
}
/** Shown form: ICD-10 gets its dot back (I509 → I50.9). */
export const displayRef = (set, code) => (set === 'icd10' && code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code);

/** What a search looks like: { set, code } for a code-shaped query, or null for a word search. */
export function detectCode(query) {
  const q = String(query ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!q) return null;
  if (/^\d{3,4}X?$/.test(q)) return { set: 'revenue', code: normRef('revenue', q.replace(/X$/, '')) };
  if (/^[1-4][A-L][A-C][1-3]1?$/.test(q)) return { set: 'hipps', code: q };
  if (/^[A-TV-Z]\d[0-9A-Z](\.?[0-9A-Z]{0,4})$/.test(q)) return { set: 'icd10', code: normRef('icd10', q) };
  return null;
}

// ── HIPPS decoder (home health PDGM) ────────────────────────────────────────

const HIPPS_POS1 = { 1: 'Community admission, early period', 2: 'Institutional admission, early period', 3: 'Community admission, late period', 4: 'Institutional admission, late period' };
const HIPPS_POS2 = {
  A: 'MMTA – Other', B: 'Neuro rehabilitation', C: 'Wound', D: 'Complex nursing interventions',
  E: 'Musculoskeletal rehabilitation', F: 'Behavioral health', G: 'MMTA – Surgical aftercare',
  H: 'MMTA – Cardiac and circulatory', I: 'MMTA – Endocrine', J: 'MMTA – GI/GU', K: 'MMTA – Infectious disease',
  L: 'MMTA – Respiratory',
};
const HIPPS_POS3 = { A: 'Low functional impairment', B: 'Medium functional impairment', C: 'High functional impairment' };
const HIPPS_POS4 = { 1: 'No comorbidity adjustment', 2: 'Low comorbidity adjustment', 3: 'High comorbidity adjustment' };

/** Explains a home health PDGM HIPPS code position by position, or null when it isn't one. */
export function decodeHipps(code) {
  const c = String(code ?? '').toUpperCase();
  if (!/^[1-4][A-L][A-C][1-3]1?$/.test(c)) return null;
  return [
    { pos: 1, char: c[0], meaning: HIPPS_POS1[c[0]] },
    { pos: 2, char: c[1], meaning: `Clinical group: ${HIPPS_POS2[c[1]]}` },
    { pos: 3, char: c[2], meaning: HIPPS_POS3[c[2]] },
    { pos: 4, char: c[3], meaning: HIPPS_POS4[c[3]] },
    { pos: 5, char: c[4] ?? '1', meaning: 'Fixed last character (always 1)' },
  ];
}

// ── Search ─────────────────────────────────────────────────────────────────

/** true when the 6.3 database update has been run. */
export async function refCodesReady() {
  const { error } = await db('ref_codes').select('id').limit(1);
  return !error;
}

/**
 * Database search. set = 'ALL' or a code set. A code-shaped query matches codes starting with it;
 * words match descriptions. Returns up to `limit` rows.
 */
export async function searchRefCodes(query, { set = 'ALL', limit = 50, showInactive = false } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const detected = detectCode(q);
  let req = db('ref_codes').select('*');
  if (set !== 'ALL') req = req.eq('code_set', set);
  if (!showInactive) req = req.eq('active', true);
  if (detected && (set === 'ALL' || set === detected.set)) {
    req = req.ilike('code', `${detected.code}%`);
  } else {
    const words = q.replace(/[%_,()]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
    for (const w of words) req = req.ilike('description', `%${w}%`);
  }
  const { data, error } = await req.order('code').limit(limit);
  if (error) return [];
  return data ?? [];
}

// ── Editing ────────────────────────────────────────────────────────────────

export async function saveRefCode(existing, values, user) {
  const code = normRef(values.code_set, values.code);
  const { data: clash } = await db('ref_codes').select('id,active').eq('code_set', values.code_set).eq('code', code);
  if ((clash ?? []).some(r => r.id !== existing?.id)) return { error: `${setOf(values.code_set).label} ${displayRef(values.code_set, code)} is already in the list.` };
  const payload = { ...values, code, updated_by: user.emp_id, updated_at: now() };
  const rows = existing
    ? await S.update('ref_codes', payload, { id: existing.id })
    : await S.set('ref_codes', { ...payload, source: 'manual', active: true, created_by: user.emp_id });
  if (!rows?.length) return { error: 'Could not save. Please try again.' };
  logAudit({ actor: user, action: existing ? 'ref_code_edit' : 'ref_code_add', entityType: 'ref_code', entityId: rows[0].id });
  return rows[0];
}

export async function verifyRefCode(row, user) {
  const ok = await S.update('ref_codes', { verified_at: now(), verified_by: user.emp_id }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'ref_code_verify', entityType: 'ref_code', entityId: row.id });
  return !!ok;
}

export async function setRefActive(row, active, user) {
  const ok = await S.update('ref_codes', { active, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: active ? 'ref_code_activate' : 'ref_code_deactivate', entityType: 'ref_code', entityId: row.id });
  return !!ok;
}

// ── Import (CMS ICD-10-CM text file, or any Excel / CSV with Code + Description) ─────

/** Every code of one set (paged — the server returns at most 1,000 rows per request). */
async function loadWholeSet(set, onProgress) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db('ref_codes').select('id,code,description,retired,list_year').eq('code_set', set).order('id').range(from, from + 999);
    if (error) throw new Error('load');
    out.push(...(data ?? []));
    onProgress?.(`Reading the current list… ${out.length.toLocaleString()} codes`);
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Reads an import file. .txt = CMS format: one code per line, then spaces, then the description
 * (e.g. "I509    Heart failure, unspecified"). Excel / CSV need a Code and a Description column.
 * Returns { rows: [{ code, description }] } or { error }.
 */
export async function readRefFile(file, set) {
  if (/\.txt$/i.test(file.name)) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).map(line => line.match(/^\s*([A-Z0-9.]{3,8})\s+(.+?)\s*$/i)).filter(Boolean)
      .map(m => ({ code: normRef(set, m[1]), description: m[2] }));
    return rows.length ? { rows } : { error: 'No codes were found in this text file.' };
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!json.length) return { error: 'The file is empty.' };
  const headers = Object.keys(json[0]);
  const codeH = headers.find(h => /code/i.test(h));
  const descH = headers.find(h => h !== codeH && /desc|text|name|meaning/i.test(h));
  if (!codeH || !descH) return { error: 'The file needs a “Code” column and a “Description” column.' };
  const rows = json.map(r => ({ code: normRef(set, r[codeH]), description: String(r[descH] ?? '').trim() })).filter(r => r.code);
  return { rows };
}

/** Compares the file with the current list: { added, changed, same, missing, existing }. */
export async function compareRefImport(set, rows, onProgress) {
  const existing = await loadWholeSet(set, onProgress);
  const byCode = new Map(existing.map(r => [r.code, r]));
  const seen = new Set();
  const added = [], changed = [];
  let same = 0;
  for (const r of rows) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    const cur = byCode.get(r.code);
    if (!cur) added.push(r);
    else if ((cur.description ?? '') !== r.description || cur.retired) changed.push({ row: r, existing: cur });
    else same++;
  }
  const missing = existing.filter(r => !seen.has(r.code) && !r.retired);
  return { added, changed, same, missing };
}

/** Saves an import. Missing codes are only marked retired when retireMissing is true. Nothing is deleted. */
export async function applyRefImport(set, diff, { listYear, retireMissing }, user, onProgress) {
  let added = 0, updated = 0, retired = 0;
  for (let i = 0; i < diff.added.length; i += 500) {
    const rows = await S.set('ref_codes', diff.added.slice(i, i + 500).map(r => ({
      code_set: set, code: r.code, description: r.description, list_year: listYear || null, source: 'import',
      active: true, retired: false, created_by: user.emp_id, updated_by: user.emp_id,
    })));
    added += rows?.length ?? 0;
    onProgress?.(`Adding new codes… ${added.toLocaleString()} of ${diff.added.length.toLocaleString()}`);
  }
  for (const [i, { row, existing }] of diff.changed.entries()) {
    const ok = await S.update('ref_codes', {
      description: row.description, retired: false, list_year: listYear || existing.list_year, updated_by: user.emp_id, updated_at: now(),
    }, { id: existing.id });
    if (ok) updated++;
    if (i % 50 === 0) onProgress?.(`Updating changed codes… ${i + 1} of ${diff.changed.length}`);
  }
  if (retireMissing) {
    const ids = diff.missing.map(r => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db('ref_codes').update({ retired: true, updated_by: user.emp_id, updated_at: now() }).in('id', ids.slice(i, i + 200));
      if (!error) retired += Math.min(200, ids.length - i);
      onProgress?.(`Marking retired codes… ${retired} of ${ids.length}`);
    }
  }
  logAudit({ actor: user, action: 'ref_code_import', entityType: 'ref_code', details: { code_set: set, added, updated, retired, list_year: listYear || null } });
  return { added, updated, retired };
}

// ── Starter revenue codes (our own short wording — to be verified against the licensed UB-04 manual) ──

export const STARTER_REVENUE = [
  ['0001', 'Total charges line'],
  ['0023', 'Home health PPS rate line — carries the HIPPS code'],
  ['0270', 'Medical / surgical supplies'],
  ['0420', 'Physical therapy — general'], ['0421', 'Physical therapy — visit'], ['0424', 'Physical therapy — evaluation / re-evaluation'],
  ['0430', 'Occupational therapy — general'], ['0431', 'Occupational therapy — visit'], ['0434', 'Occupational therapy — evaluation / re-evaluation'],
  ['0440', 'Speech-language pathology — general'], ['0441', 'Speech-language pathology — visit'], ['0444', 'Speech-language pathology — evaluation / re-evaluation'],
  ['0550', 'Skilled nursing — general'], ['0551', 'Skilled nursing — visit'], ['0559', 'Skilled nursing — other'],
  ['0560', 'Medical social services — general'], ['0561', 'Medical social services — visit'],
  ['0570', 'Home health aide — general'], ['0571', 'Home health aide — visit'],
  ['0651', 'Hospice — routine home care'], ['0652', 'Hospice — continuous home care'], ['0655', 'Hospice — inpatient respite care'],
  ['0656', 'Hospice — general inpatient care'], ['0657', 'Hospice — physician services'],
];

/** Starter revenue codes not yet in the list. */
export async function missingStarterRevenue() {
  const { data } = await db('ref_codes').select('code').eq('code_set', 'revenue').in('code', STARTER_REVENUE.map(r => r[0]));
  const have = new Set((data ?? []).map(r => r.code));
  return STARTER_REVENUE.filter(([code]) => !have.has(code));
}

export async function addStarterRevenue(list, user) {
  const rows = await S.set('ref_codes', list.map(([code, description]) => ({
    code_set: 'revenue', code, description, source: 'starter', active: true, retired: false,
    created_by: user.emp_id, updated_by: user.emp_id,
  })));
  if (!rows?.length) return 0;
  logAudit({ actor: user, action: 'ref_code_starter_add', entityType: 'ref_code', details: { count: rows.length } });
  return rows.length;
}
