// Coding Assistant rules (PO 2026-11-11) — no AI. Loads the Master Library's ICD-10-CM data (migration 55) for a list of
// codes and runs the pure rules in codingRulesCore.js: valid / retired / header (+ billable child codes) / 7th character
// needed (+ choices), Excludes1 between any two codes, and "Code first" / "Use additional code" sequencing.
import { supabase } from './supabase';
import { MASTER_PREFIX } from './masterLibrary';
import { icdChildren } from './icd10';
import { evaluateCodes, parentsOf, cleanIcd } from './codingRulesCore';

export { noteRefs, refMatches, seventhChoices } from './codingRulesCore';

const m = t => supabase.from(MASTER_PREFIX + t);

/** items: [{ code, role?, reason?, phrase?, source? }] in the coder's order → { rows, moved } (see evaluateCodes). */
export async function checkCodes(items) {
  const list = items.map(i => ({ ...i, code: cleanIcd(i.code) })).filter(i => i.code);
  if (!list.length) return { rows: [], moved: false };
  const codes = [...new Set(list.map(i => i.code))];
  const parents = [...new Set(codes.flatMap(parentsOf))];
  const [{ data: rowsData }, { data: notesData }] = await Promise.all([
    m('ref_codes').select('code,description,long_description,billable,retired,retired_on,fiscal_year').eq('code_set', 'icd10').in('code', codes),
    m('icd_notes').select('code,note_type,note').in('code', parents),
  ]);
  const byCode = new Map((rowsData ?? []).map(r => [r.code, r]));
  const headers = (rowsData ?? []).filter(r => r.billable === false && !r.retired).map(r => r.code);
  const children = new Map(await Promise.all(headers.map(async c => [c, await icdChildren(c, 30)])));
  return evaluateCodes(list, { byCode, notes: notesData ?? [], children });
}
