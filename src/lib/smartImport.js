// Smart Import (PO 2026-11-10): one import for every reference list — Master Library (owner) and company imports.
// Files are read in the browser only (never sent to any outside service). Nothing is saved until the user clicks Import;
// nothing is ever deleted; updates only fill empty fields unless "Overwrite existing values" is ticked.
import { db, getActiveCompany } from './supabase';
import { logAudit } from './audit';
import { ownerLog } from './owner';
import { getOwnerSession } from './company';
import { inMasterWorkspace } from './masterLibrary';

export const ACCEPT = '.xlsx,.xls,.csv';

/** Header text in a comparable form: "Payer  Name:" → "payer name". */
export const normHeader = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** The file's headers as one string — used to recognise the same layout next time (saved matchings). */
export const headerSignature = headers => headers.map(normHeader).filter(Boolean).join('|');
const cell = v => (v == null ? '' : String(v).trim());

/** Every sheet as rows of text cells. → [{ name, rows }] */
export async function readWorkbook(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, dateNF: 'mm/dd/yyyy' })
      .map(r => r.map(cell)),
  })).filter(s => s.rows.some(r => r.some(Boolean)));
}

// How well one header matches a field: 3 = exact synonym, 2 = synonym inside the header, 0 = no match
function score(header, field) {
  const h = normHeader(header);
  if (!h) return 0;
  const syns = [field.label, field.key.replace(/_/g, ' '), ...(field.synonyms ?? [])].map(normHeader);
  if (syns.includes(h)) return 3;
  if (syns.some(s => s.length > 2 && (h.includes(s) || (h.length > 3 && s.includes(h))))) return 2;
  return 0;
}

/** The row (among the first 25) that looks most like a header row: the most cells matching a field. */
export function detectHeaderRow(rows, fields) {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 25).forEach((r, i) => {
    const s = r.filter(Boolean).reduce((t, h) => t + (fields.some(f => score(h, f) === 3) ? 2 : fields.some(f => score(h, f) > 0) ? 1 : 0), 0);
    if (s > bestScore) { best = i; bestScore = s; }
  });
  return best;
}

/** field key → column number (or null), best matches first, each column used once. */
export function autoMatch(headers, fields) {
  const pairs = [];
  fields.forEach(f => headers.forEach((h, i) => { const s = score(h, f); if (s) pairs.push({ f: f.key, i, s }); }));
  pairs.sort((a, b) => b.s - a.s);
  const out = Object.fromEntries(fields.map(f => [f.key, null]));
  const used = new Set();
  for (const p of pairs) {
    if (out[p.f] != null || used.has(p.i)) continue;
    out[p.f] = p.i;
    used.add(p.i);
  }
  return out;
}

/** Rows under the header → [{ rowNum, values }] (blank rows skipped). constants = one value for every row. */
export function mapRows(rows, headerRow, mapping, constants = {}) {
  const out = [];
  rows.slice(headerRow + 1).forEach((r, i) => {
    if (!r.some(Boolean)) return;
    const values = {};
    for (const [key, col] of Object.entries(mapping)) if (col != null) values[key] = cell(r[col]);
    for (const [key, v] of Object.entries(constants)) if (v !== '' && v != null && !values[key]) values[key] = v;
    out.push({ rowNum: headerRow + i + 2, values });
  });
  return out;
}

/** "Download sample file": the field names as headers and one example row. */
export async function downloadSample(type) {
  const XLSX = await import('xlsx');
  const fields = type.fields.filter(f => !f.hidden);
  const ws = XLSX.utils.aoa_to_sheet([fields.map(f => f.label), fields.map(f => f.example ?? '')]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type.sheetName ?? type.title.slice(0, 31));
  XLSX.writeFile(wb, `Helix Hub sample – ${type.title}.xlsx`);
}

// ── Saved matchings (import_templates, per company / master library) ──────────────────────
export async function loadTemplates(typeId) {
  const { data, error } = await db('import_templates').select('*').eq('data_type', typeId).neq('active', false).order('name');
  return error ? null : data;
}
export async function saveTemplate(typeId, { name, signature, mapping, constants, headerRow }, user) {
  const { data, error } = await db('import_templates').insert({
    data_type: typeId, name: name.trim(), signature, mapping, constants, header_row: headerRow, created_by: user.emp_id, updated_by: user.emp_id,
  }).select();
  return error ? null : data?.[0];
}

// ── Preview: new rows, updates, duplicates skipped, errors ──────────────────────────────────
/**
 * input: { records: [{ rowNum, values }] } (or a built-in file's parse result). type: { normalize, validate, keyOf, fields, loadExisting(records) → Map(key → row) }.
 * → { adds: [{ rowNum, values }], updates: [{ rowNum, values, existing, patch }], dups: [{ rowNum, label, why }], errors: [{ rowNum, label, why }] }
 */
export async function buildPreview(type, input, { overwrite = false } = {}, onProgress) {
  // a type with linked tables (payers) builds its own preview in the same shape; input may carry a built-in file's data
  if (type.preview) return type.preview(input, { overwrite }, onProgress);
  const records = input.records ?? [];
  const clean = [];
  const errors = [];
  for (const r of records) {
    const values = type.normalize ? type.normalize(r.values) : r.values;
    const why = type.validate?.(values) ?? null;
    if (why) errors.push({ rowNum: r.rowNum, label: type.labelOf?.(values) ?? '', why });
    else clean.push({ rowNum: r.rowNum, values });
  }
  const existing = await type.loadExisting(clean.map(r => r.values), onProgress);
  const seen = new Set();
  const adds = [], updates = [], dups = [];
  const fieldKeys = type.fields.filter(f => !f.keyOnly).map(f => f.key);
  for (const r of clean) {
    const key = type.keyOf(r.values);
    if (seen.has(key)) { dups.push({ rowNum: r.rowNum, values: r.values, label: type.labelOf(r.values), why: 'Same item appears earlier in this file' }); continue; }
    seen.add(key);
    const cur = existing.get(key);
    if (!cur) { adds.push(r); continue; }
    const patch = {};
    for (const k of fieldKeys) {
      const v = r.values[k];
      if (v === '' || v == null) continue;
      const old = cur[k];
      const empty = old == null || old === '' || (Array.isArray(old) && !old.length);
      if (String(old ?? '') === String(v)) continue;
      if (empty || overwrite) patch[k] = v;
    }
    if (Object.keys(patch).length) updates.push({ ...r, existing: cur, patch });
    else dups.push({ rowNum: r.rowNum, values: r.values, label: type.labelOf(r.values), why: overwrite ? 'Already the same' : 'Already there (empty fields only are filled)' });
  }
  return { adds, updates, dups, errors };
}

/** Saves a preview (type.save writes the rows), then logs it. → { added, updated, ...extra } */
export async function runImport(type, preview, { fileName, options = {} }, user, onProgress) {
  const stamp = { import_file: fileName, imported_at: new Date().toISOString() };
  const result = await type.save(preview, { stamp, options, user }, onProgress);
  const details = { file: fileName, type: type.id, ...result, skipped: preview.dups.length, errors: preview.errors.length };
  logAudit({ actor: user, action: 'smart_import', entityType: type.entity ?? type.id, details });
  if (inMasterWorkspace() || user?.isOwner) {
    const owner = getOwnerSession();
    if (owner && inMasterWorkspace()) ownerLog(owner, 'master_import', 'MASTER', `${type.title}: ${fileName}`, details);
  }
  return result;
}

/** True when the company tables already have the import_file / imported_at columns (migration 53). */
export async function stampsReady(table) {
  const { error } = await db(table).select('import_file').limit(1);
  return !error;
}

export const companyLabel = () => (inMasterWorkspace() ? 'the Master Library' : (getActiveCompany()?.name ?? 'your company'));
