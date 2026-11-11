// ICD-10-CM (PO 2026-11-11). The full yearly list lives in the Master Library (migration 55): codes in ref_codes
// (code_set 'icd10', stored without the dot), coding notes in icd_notes, index terms in icd_index, the year's changes in
// icd_changes. Every company reads the master's tables. Reference data only — searches are never saved or logged.
import { supabase } from './supabase';
import { MASTER_PREFIX } from './masterLibrary';

const m = t => supabase.from(MASTER_PREFIX + t);
export const icdDot = code => (code && code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code ?? '');
/** CO-146 / CO-167 (diagnosis inconsistent / not covered): the denials where a diagnosis-code check helps. */
export const isDiagnosisDenial = code => ['146', '167'].includes(String(code ?? '').replace(/^[A-Z]{2}-/i, '').trim());
export const icdClean = v => String(v ?? '').trim().toUpperCase().replace(/[.\s]/g, '');
/** Category → … → the code itself: S72001A → S72, S720, S7200, S72001, S72001A */
export const icdParents = code => { const c = icdClean(code); const out = []; for (let i = 3; i <= c.length; i++) out.push(c.slice(0, i)); return out; };

/** One ICD-10 code from the master, or null. */
export async function icdCode(code) {
  const { data } = await m('ref_codes').select('*').eq('code_set', 'icd10').eq('code', icdClean(code)).limit(1);
  return data?.[0] ?? null;
}

/** Coding notes for the code AND its parents (category notes apply to every code below them), grouped by note type. */
export async function icdNotes(code) {
  const parents = icdParents(code);
  const { data, error } = await m('icd_notes').select('code,note_type,note').in('code', parents).order('id');
  if (error) return null;
  const order = ['7th characters', '7th character note', 'Includes', 'Inclusion term', 'Note', 'Code first', 'Use additional code', 'Code also', 'Excludes1', 'Excludes2'];
  const groups = new Map();
  for (const n of data ?? []) {
    const g = groups.get(n.note_type) ?? [];
    if (!g.some(x => x.note === n.note && x.code === n.code)) g.push({ note: n.note, from: n.code, inherited: n.code !== icdClean(code) });
    groups.set(n.note_type, g);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)))
    .map(([type, notes]) => ({ type, notes: notes.sort((a, b) => a.from.length - b.from.length) }));
}

/** The codes directly below a header (one more character); falls back to any longer billable codes (placeholder X cases). */
export async function icdChildren(code, limit = 60) {
  const c = icdClean(code);
  const { data } = await m('ref_codes').select('code,description,long_description,billable,retired').eq('code_set', 'icd10')
    .like('code', `${c}_`).eq('retired', false).order('code').limit(limit);
  if (data?.length) return data;
  const { data: deeper } = await m('ref_codes').select('code,description,long_description,billable,retired').eq('code_set', 'icd10')
    .like('code', `${c}%`).neq('code', c).eq('billable', true).eq('retired', false).order('code').limit(limit);
  return deeper ?? [];
}

/** Index terms whose path holds every word ("heart failure" → "Failure > heart …"). */
export async function searchIcdIndex(query, limit = 15) {
  const words = String(query ?? '').replace(/[%_,()>]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 5);
  if (!words.length) return [];
  let req = m('icd_index').select('term_path,code,see,see_also');
  for (const w of words) req = req.ilike('term_path', `%${w}%`);
  const { data, error } = await req.order('term_path').limit(200);
  if (error) return [];
  // best first: a main term (before the first ">") that is one of the words, then fewer levels, then shorter
  const lw = words.map(w => w.toLowerCase());
  const score = t => {
    const parts = t.term_path.toLowerCase().split('>').map(s => s.trim());
    const main = parts[0].replace(/\s*\(.*?\)\s*/g, ' ').trim();
    return (lw.some(w => main === w || main.startsWith(`${w} `) || main.startsWith(`${w},`)) ? 0 : 100) + parts.length * 10 + t.term_path.length / 100 + (t.code ? 0 : 5);
  };
  return (data ?? []).sort((a, b) => score(a) - score(b)).slice(0, limit);
}

/** "What changed" for one fiscal year (a few hundred rows). */
export async function icdChanges(fy) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await m('icd_changes').select('change,code,description').eq('fiscal_year', fy).order('change').order('code').range(from, from + 999);
    if (error) return out.length ? out : null;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** The newest fiscal year in the master (for labels like "New FY2027"), or null. */
export async function icdLatestYear() {
  const { data } = await m('icd_changes').select('fiscal_year').order('fiscal_year', { ascending: false }).limit(1);
  if (data?.[0]) return data[0].fiscal_year;
  const { data: c } = await m('ref_codes').select('fiscal_year').eq('code_set', 'icd10').not('fiscal_year', 'is', null).order('fiscal_year', { ascending: false }).limit(1);
  return c?.[0]?.fiscal_year ?? null;
}

/**
 * Is this code OK to bill for a date of service? → { status, row, message }
 *   status: 'ok' | 'header' | 'retired' | 'not_yet' | 'unknown' | 'invalid'
 */
export async function checkIcd(code, dos = null) {
  const c = icdClean(code);
  if (!/^[A-Z][0-9][0-9A-Z]{1,5}$/.test(c)) return { status: 'invalid', message: 'That doesn’t look like an ICD-10-CM code (e.g. I50.9).' };
  const row = await icdCode(c);
  if (!row) return { status: 'unknown', message: `${icdDot(c)} isn’t in the ICD-10-CM list — check for a typo.` };
  const day = dos ? String(dos).slice(0, 10) : null;
  if (row.retired && (!day || !row.retired_on || day >= row.retired_on)) {
    return { status: 'retired', row, message: `${icdDot(c)} was retired${row.retired_on ? ` on ${row.retired_on}` : ''}${day ? ` — not valid for a ${day} date of service` : ''}.` };
  }
  if (row.valid_from && day && day < row.valid_from) {
    return { status: 'not_yet', row, message: `${icdDot(c)} is only valid from ${row.valid_from} — not for a ${day} date of service.` };
  }
  if (row.billable === false) return { status: 'header', row, message: `${icdDot(c)} is a header — not billable. Pick a more specific code.` };
  return { status: 'ok', row, message: `${icdDot(c)} is billable${day ? ` for ${day}` : ''}.` };
}
