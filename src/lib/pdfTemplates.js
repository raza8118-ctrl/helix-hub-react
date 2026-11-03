// PDF to Excel "Clean table" templates (PO request 2026-11-03): the header names and column positions of a report
// layout (e.g. "Waystar RTP Productivity"), which column starts a record, each column's kind and the section names.
// No patient values are stored. Kept per company in rcm_store 'pdf_templates'; saving needs supervisor or above
// (security stage 6), everyone can use them.
import { kv } from './supabase';

const KEY = 'pdf_templates';
const norm = s => s.toLowerCase().replace(/[^a-z0-9/#$]+/g, ' ').trim();

export async function loadTemplates() {
  const list = await kv.get(KEY);
  return Array.isArray(list) ? list : [];
}

/** report: from buildReport(). Replaces a template with the same name. → true / false (not allowed or failed) */
export async function saveTemplate(name, report, user, existing) {
  const t = {
    name: name.trim(),
    headers: report.headers.map(h => ({ text: h.text, x0: Math.round(h.x0 * 10) / 10, x1: Math.round(h.x1 * 10) / 10 })),
    keyColumn: report.keyColumn,
    kinds: Object.fromEntries(report.columns.map(c => [c.name, c.kind])),
    sections: [...new Set(report.rows.map(r => r.section).filter(Boolean))],
    savedBy: user?.emp_id ?? null,
    savedAt: new Date().toISOString(),
  };
  const next = [...existing.filter(x => norm(x.name) !== norm(t.name)), t];
  return (await kv.set(KEY, next)) ? next : null;
}

export async function deleteTemplate(name, existing) {
  const next = existing.filter(x => x.name !== name);
  return (await kv.set(KEY, next)) ? next : null;
}

/** The saved template whose header names match the detected header row (≥ 80% of both), or null. */
export function matchTemplate(templates, report) {
  if (!report?.headers?.length) return null;
  const found = new Set(report.headers.map(h => norm(h.text)));
  let best = null, bestScore = 0;
  for (const t of templates) {
    const names = t.headers.map(h => norm(h.text));
    const hits = names.filter(n => found.has(n)).length;
    const score = Math.min(hits / names.length, hits / found.size);
    if (score >= 0.8 && score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}
