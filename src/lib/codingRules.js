// Coding Assistant rules (PO 2026-11-11) — no AI. Checks a list of ICD-10-CM codes against the Master Library's FY data
// (migration 55): valid / retired / header (+ billable child codes) / 7th character needed (+ the category's choices),
// Excludes1 between any two codes, and "Code first" / "Use additional code" sequencing. Codes are stored without the dot.
import { supabase } from './supabase';
import { MASTER_PREFIX } from './masterLibrary';
import { icdParents, icdChildren } from './icd10';

const m = t => supabase.from(MASTER_PREFIX + t);
const clean = v => String(v ?? '').trim().toUpperCase().replace(/[\s.]/g, '');

/** Code references inside a note: "I46.-", "I97.13-", "E87.70", ranges "O00-O07" → [{ from, to }] (no dot, no dash). */
export function noteRefs(note) {
  const out = [];
  const re = /\b([A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{0,4})?)(?:\s*-\s*([A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{0,4})?))?-?/g;
  for (const x of String(note ?? '').matchAll(re)) {
    const from = clean(x[1]).replace(/-+$/, '');
    const to = x[2] ? clean(x[2]).replace(/-+$/, '') : null;
    if (from.length >= 3) out.push({ from, to });
  }
  return out;
}
/** Does code c fall under a reference? (same start, or inside a category range) */
export function refMatches(ref, c) {
  if (!ref.to) return c.startsWith(ref.from);
  const cat = c.slice(0, 3);
  return cat >= ref.from.slice(0, 3) && cat <= ref.to.slice(0, 3);
}

/** "A = initial encounter; D = subsequent encounter…" → [{ char, meaning }] */
export function seventhChoices(note) {
  return String(note ?? '').split(/;\s*/).map(p => p.match(/^\s*([A-Z0-9])\s*=\s*(.+?)\s*$/i)).filter(Boolean)
    .map(x => ({ char: x[1].toUpperCase(), meaning: x[2] }));
}

/**
 * items: [{ code, role?, reason?, phrase?, source? }] in the coder's order (primary first).
 * → { rows: [{ ...item, code, desc, status: 'valid' | 'more_digits' | 'invalid', why, needs7th, seventh, children,
 *              conflicts: [{ with, from, note }], seq: [string], hints: [string] }], moved: bool } — rows in the suggested order.
 */
export async function checkCodes(items) {
  const list = items.map(i => ({ ...i, code: clean(i.code) })).filter(i => i.code);
  if (!list.length) return { rows: [], moved: false };
  const codes = [...new Set(list.map(i => i.code))];
  const parents = [...new Set(codes.flatMap(icdParents))];
  const [{ data: rowsData }, { data: notesData }] = await Promise.all([
    m('ref_codes').select('code,description,long_description,billable,retired,retired_on,fiscal_year').eq('code_set', 'icd10').in('code', codes),
    m('icd_notes').select('code,note_type,note').in('code', parents),
  ]);
  const byCode = new Map((rowsData ?? []).map(r => [r.code, r]));
  const notesOf = c => (notesData ?? []).filter(n => icdParents(c).includes(n.code));

  const rows = await Promise.all(list.map(async item => {
    const r = byCode.get(item.code);
    const notes = notesOf(item.code);
    const base = { ...item, desc: r?.long_description || r?.description || '', conflicts: [], seq: [], hints: [], children: [], seventh: [], needs7th: false };
    if (!r) return { ...base, status: 'invalid', why: 'Not in the ICD-10-CM list — check the code.' };
    if (r.retired) return { ...base, status: 'invalid', why: `Retired${r.retired_on ? ` on ${r.retired_on}` : ''} — not in FY${r.fiscal_year ? r.fiscal_year + 1 : ''} — pick a current code.` };
    if (r.billable === false) {
      const sev = notes.find(n => /^7th character/i.test(n.note_type) && seventhChoices(n.note).length);
      const children = await icdChildren(item.code, 30);
      return {
        ...base, status: 'more_digits', needs7th: !!sev, seventh: sev ? seventhChoices(sev.note) : [],
        children: children.filter(k => !k.retired),
        why: sev ? 'Needs a 7th character (and X placeholders if the code is short) — pick the full code.' : 'Header — not billable. Pick a more specific code.',
      };
    }
    return { ...base, status: 'valid', why: '' };
  }));

  // Excludes1: a note on a code (or its category) that names another chosen code
  for (const a of rows) {
    for (const n of notesOf(a.code).filter(x => x.note_type === 'Excludes1')) {
      for (const b of rows) {
        if (b === a || b.code === a.code) continue;
        if (noteRefs(n.note).some(ref => refMatches(ref, b.code)) && !a.conflicts.some(c => c.with === b.code)) {
          a.conflicts.push({ with: b.code, from: n.code, note: n.note });
          if (!b.conflicts.some(c => c.with === a.code)) b.conflicts.push({ with: a.code, from: n.code, note: n.note });
        }
      }
    }
  }

  // Sequencing: "Code first X" on A → X before A; "Use additional code X" on A → A before X
  const before = new Map(rows.map(r => [r.code, new Set()]));   // code → codes that must come before it
  for (const a of rows) {
    for (const n of notesOf(a.code)) {
      const isFirst = n.note_type === 'Code first';
      const isAdd = n.note_type === 'Use additional code';
      if (!isFirst && !isAdd) continue;
      const hits = rows.filter(b => b !== a && b.code !== a.code && noteRefs(n.note).some(ref => refMatches(ref, b.code)));
      for (const b of hits) {
        if (isFirst) { before.get(a.code).add(b.code); a.seq.push(`Code first: ${b.code} goes before this code`); }
        else { before.get(b.code).add(a.code); b.seq.push(`Use additional code: comes after ${a.code}`); }
      }
      if (!hits.length && isFirst && a.status !== 'invalid') a.hints.push(`Code first (if documented): ${n.note}`);
    }
  }
  // "Code first (if documented)" hints only matter when none of the code's Code first notes is already satisfied
  for (const a of rows) if (a.seq.some(s => s.startsWith('Code first:'))) a.hints = [];
  // stable order: keep the coder's order, but never put a code before one it must follow
  const order = [];
  const left = [...rows];
  while (left.length) {
    const i = left.findIndex(r => [...before.get(r.code)].every(c => order.some(o => o.code === c) || !left.some(l => l.code === c)));
    order.push(...left.splice(i < 0 ? 0 : i, 1));   // a loop in the rules: keep the coder's order
  }
  const moved = order.some((r, i) => r !== rows[i]);
  return { rows: order, moved };
}
