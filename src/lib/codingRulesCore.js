// Coding Assistant rules — the pure part (PO 2026-11-11). No imports and no database: codingRules.js loads the Master
// Library data and calls evaluateCodes(); the Node tests (npm test) call it with small fixtures. Codes have no dot.

export const cleanIcd = v => String(v ?? '').trim().toUpperCase().replace(/[\s.]/g, '');
/** S72001A → S72, S720, S7200, S72001, S72001A */
export const parentsOf = code => { const c = cleanIcd(code); const out = []; for (let i = 3; i <= c.length; i++) out.push(c.slice(0, i)); return out; };
const dot = c => (c && c.length > 3 ? `${c.slice(0, 3)}.${c.slice(3)}` : c);

/** Code references inside a note: "I46.-", "I97.13-", "E87.70", ranges "O00-O07" → [{ from, to }] (no dot, no dash). */
export function noteRefs(note) {
  const out = [];
  const re = /\b([A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{0,4})?)(?:\s*-\s*([A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{0,4})?))?-?/g;
  for (const x of String(note ?? '').matchAll(re)) {
    const from = cleanIcd(x[1]).replace(/-+$/, '');
    const to = x[2] ? cleanIcd(x[2]).replace(/-+$/, '') : null;
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
 * items: [{ code, … }] in the coder's order. data: { byCode: Map(code → ref_codes row), notes: [{ code, note_type, note }]
 * (of every parent of every code), children: Map(code → [child rows]) for header codes }.
 * → { rows: [{ ...item, code, desc, status: 'valid' | 'more_digits' | 'invalid', why, needs7th, seventh, children,
 *              conflicts: [{ with, from, note }], seq: [string], hints: [string] }], moved }
 */
export function evaluateCodes(items, { byCode, notes, children = new Map() }) {
  const notesOf = c => notes.filter(n => parentsOf(c).includes(n.code));
  const rows = items.map(i => ({ ...i, code: cleanIcd(i.code) })).filter(i => i.code).map(item => {
    const r = byCode.get(item.code);
    const own = notesOf(item.code);
    const base = { ...item, desc: r?.long_description || r?.description || '', conflicts: [], seq: [], hints: [], children: [], seventh: [], needs7th: false };
    if (!r) return { ...base, status: 'invalid', why: 'Not in the ICD-10-CM list — check the code.' };
    if (r.retired) return { ...base, status: 'invalid', why: `Retired${r.retired_on ? ` on ${r.retired_on}` : ''} — pick a current code.` };
    if (r.billable === false) {
      const sev = own.find(n => /^7th character/i.test(n.note_type) && seventhChoices(n.note).length);
      return {
        ...base, status: 'more_digits', needs7th: !!sev, seventh: sev ? seventhChoices(sev.note) : [],
        children: (children.get(item.code) ?? []).filter(k => !k.retired),
        why: sev ? 'Needs a 7th character (and X placeholders if the code is short) — pick the full code.' : 'Header — not billable. Pick a more specific code.',
      };
    }
    return { ...base, status: 'valid', why: '' };
  });

  // Excludes1: a note on a code (or its category) that names another chosen code → conflict on both
  for (const a of rows) {
    for (const n of notesOf(a.code).filter(x => x.note_type === 'Excludes1')) {
      for (const b of rows) {
        if (b.code === a.code || !noteRefs(n.note).some(ref => refMatches(ref, b.code))) continue;
        if (!a.conflicts.some(c => c.with === b.code)) a.conflicts.push({ with: b.code, from: n.code, note: n.note });
        if (!b.conflicts.some(c => c.with === a.code)) b.conflicts.push({ with: a.code, from: n.code, note: n.note });
      }
    }
  }

  // Sequencing: "Code first X" on A → X before A; "Use additional code X" on A → A before X. One note per pair.
  const before = new Map(rows.map(r => [r.code, new Set()]));   // code → codes that must come before it
  const why = new Map();                                          // "first|then" → Set of rule names
  const add = (first, then, rule) => { before.get(then).add(first); const k = `${first}|${then}`; why.set(k, (why.get(k) ?? new Set()).add(rule)); };
  for (const a of rows) {
    let firstMatched = false;
    const unmatchedFirst = [];
    for (const n of notesOf(a.code)) {
      if (n.note_type !== 'Code first' && n.note_type !== 'Use additional code') continue;
      const hits = rows.filter(b => b.code !== a.code && noteRefs(n.note).some(ref => refMatches(ref, b.code)));
      for (const b of hits) {
        if (n.note_type === 'Code first') { add(b.code, a.code, 'Code first'); firstMatched = true; }
        else add(a.code, b.code, 'Use additional code');
      }
      if (!hits.length && n.note_type === 'Code first') unmatchedFirst.push(n.note);
    }
    if (!firstMatched && a.status !== 'invalid') a.hints = unmatchedFirst.map(t => `Code first (if documented): ${t}`);
  }
  for (const [k, rules] of why) {
    const [first, then] = k.split('|');
    rows.find(r => r.code === then).seq.push(`Goes after ${dot(first)} — ${[...rules].join(' / ')}`);
  }
  // stable order: keep the coder's order, but never put a code before one it must follow (a loop keeps the coder's order)
  const order = [];
  const left = [...rows];
  while (left.length) {
    const i = left.findIndex(r => [...before.get(r.code)].every(c => order.some(o => o.code === c) || !left.some(l => l.code === c)));
    order.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return { rows: order, moved: order.some((r, i) => r !== rows[i]) };
}
