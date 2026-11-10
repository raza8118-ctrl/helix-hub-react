// Master Library (PO 2026-11-10): the shared library every company reads (the master copy workspace, co_master__…,
// readable by any signed-in user since migration 51; only the owner can change it). Company pages show master + company
// items together: master items are read-only; where both have the same item, the company version is shown on top.
import { supabase, getActiveCompany } from './supabase';

export const MASTER_PREFIX = 'co_master__';

/** True while the owner is editing the master itself — then nothing is merged (the master IS the company). */
export const inMasterWorkspace = () => getActiveCompany()?.prefix === MASTER_PREFIX;

/** Rows of a master table (filters = exact matches), or null when it can't be read (e.g. migration 51 not run). */
export async function masterGet(table, filters = {}) {
  let q = supabase.from(MASTER_PREFIX + table).select('*');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data, error } = await q;
  return error ? null : (data ?? []);
}

/** Master rows get their own ids in merged lists ('m-12'), so they never clash with the company's ids. */
const asMaster = row => ({ ...row, id: `m-${row.id}`, _rawId: row.id, _src: 'master' });
export const isMasterRow = row => row?._src === 'master';
/** The row as stored in the master (real id), for loading its details. */
export const masterRaw = row => (isMasterRow(row) ? { ...row, id: row._rawId } : row);

// ── Payers: the same payer = same name, or one's name is the other's alias ──
const norm = s => String(s ?? '').trim().toLowerCase();
export function samePayer(a, b) {
  const an = norm(a.name);
  const bn = norm(b.name);
  if (!an || !bn) return false;
  return an === bn || (b.aliases ?? []).some(x => norm(x) === an) || (a.aliases ?? []).some(x => norm(x) === bn);
}

/** company rows (with _master when the master has the same payer) + master-only rows. */
export function mergePayers(company, master) {
  const used = new Set();
  const out = (company ?? []).map(c => {
    const m = (master ?? []).find(x => x.active !== false && !used.has(x.id) && samePayer(c, x));
    if (m) used.add(m.id);
    return { ...c, _src: 'company', _master: m ? asMaster(m) : null };
  });
  for (const m of master ?? []) if (!used.has(m.id)) out.push(asMaster(m));
  return out;
}

// ── Denial codes: the same code = same type + code ──
const normCode = code => String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
export function mergeCodes(company, master) {
  const key = r => `${r.code_type}|${normCode(r.code)}`;
  const byKey = new Map((master ?? []).filter(m => m.active !== false).map(m => [key(m), m]));
  const used = new Set();
  const out = (company ?? []).map(c => {
    const m = byKey.get(key(c));
    if (m) used.add(m.id);
    return { ...c, _src: 'company', _master: m ? asMaster(m) : null };
  });
  for (const m of master ?? []) if (!used.has(m.id)) out.push(asMaster(m));
  return out;
}
