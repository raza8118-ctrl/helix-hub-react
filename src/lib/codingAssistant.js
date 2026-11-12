// Coding Assistant – Phase A (PO 2026-11-11). The coder pastes diagnosis statements ONLY. A browser check blocks anything
// that looks like a patient identifier before a single character is sent. The AI (through helix-ai — the key stays on the
// server, nothing is stored there) only suggests ICD-10-CM codes; the rules step (codingRules.js, no AI) checks them
// against the Master Library. The pasted text is never stored or logged anywhere — usage counts only.
import { assertAiAllowed } from './companyFeatures';
import { aiFetch, AI_MODEL } from './ai';
import { logAudit } from './audit';
import { db } from './supabase';

// ── 1. Patient-identifier check: src/lib/phiCheck.js (pure, tested with npm test) ─────────────
export { findIdentifiers } from './phiCheck';
import { findIdentifiers } from './phiCheck';

export const MAX_TEXT = 4000;

// ── 2. AI suggestions (text only, through helix-ai) ─────────────────────────────────────
const SYSTEM = `You are an expert ICD-10-CM coder for a US home health and hospice revenue-cycle company.
The user gives diagnosis statements only (no patient details). Suggest the ICD-10-CM codes (FY2027 code set) that the
statements support — nothing that is not supported by the text, no procedure codes.
Rules: use complete, billable codes when the text supports the detail (include the 7th character when the category needs one,
with X placeholders); otherwise give the closest code and let the coder refine it. One entry per condition. Mark exactly one
code as "primary" (the main reason for care) and the rest "secondary". "phrase" = the exact words from the statements that the
code comes from. "reason" = one short plain-English sentence. Return at most 15 codes. Never invent patient details.`;

const SCHEMA = {
  type: 'object',
  properties: {
    codes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' }, reason: { type: 'string' }, phrase: { type: 'string' }, role: { type: 'string', enum: ['primary', 'secondary'] },
        },
        required: ['code', 'reason', 'phrase', 'role'],
        additionalProperties: false,
      },
    },
  },
  required: ['codes'],
  additionalProperties: false,
};

const CODE_SHAPE = /^[A-TV-Z][0-9][0-9A-Z](?:\.?[0-9A-Z]{1,4})?$/;
export const cleanCode = v => String(v ?? '').trim().toUpperCase().replace(/[\s.]/g, '');

/**
 * Sends the (already checked) statements and returns [{ code, reason, phrase, role }] — codes without the dot, only valid
 * shapes, one primary. Throws Error with a plain-English message. Only counts are logged (never the text or the codes).
 */
export async function suggestCodes(text, user) {
  const found = findIdentifiers(text);
  if (found.length) throw new Error('The text still contains patient details — remove them first.');   // safety net
  assertAiAllowed();
  let ok = false, count = 0;
  try {
    const res = await aiFetch({
      model: AI_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Diagnosis statements:\n${String(text).slice(0, MAX_TEXT)}` }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = String(body?.error?.message ?? body?.message ?? '');   // the AI service's own wording (never contains our text)
      throw new Error(res.status === 401 ? 'The AI key in Settings was rejected — an admin needs to update it.'
        : res.status === 429 ? 'The AI service is busy — please try again in a minute.'
        : /credit balance/i.test(msg) ? 'The company’s AI account is out of credit — an admin needs to top it up (Anthropic → Plans & Billing).'
        : `The AI request failed (${res.status})${msg ? `: ${msg}` : ''}. Please try again.`);
    }
    const json = await res.json();
    if (json.stop_reason === 'refusal') throw new Error('The AI declined these statements — code them by hand.');
    if (json.stop_reason === 'max_tokens') throw new Error('The AI answer was cut off — try fewer statements at a time.');
    const out = [...(json.content ?? [])].reverse().find(b => b.type === 'text')?.text;
    let parsed;
    try { parsed = JSON.parse(out ?? ''); } catch (e) { throw new Error('The AI answer couldn’t be read — please try again.', { cause: e }); }
    const seen = new Set();
    const codes = (Array.isArray(parsed?.codes) ? parsed.codes : [])
      .map(c => ({ code: cleanCode(c.code), reason: String(c.reason ?? '').slice(0, 300), phrase: String(c.phrase ?? '').slice(0, 200), role: c.role === 'primary' ? 'primary' : 'secondary' }))
      .filter(c => CODE_SHAPE.test(c.code) && !seen.has(c.code) && seen.add(c.code))
      .slice(0, 15);
    // exactly one primary, first in the list
    const p = Math.max(0, codes.findIndex(c => c.role === 'primary'));
    codes.forEach((c, i) => { c.role = i === p ? 'primary' : 'secondary'; });
    if (codes.length) codes.unshift(...codes.splice(p, 1));
    ok = true; count = codes.length;
    return codes;
  } catch (e) {
    if (e.message === 'NO_KEY') throw new Error('No AI key is saved for this company — an admin adds it in Settings.', { cause: e });
    throw e;
  } finally {
    logAudit({ actor: user, action: 'coding_assistant_ai', entityType: 'coding_assistant', details: { ok, codes: count } });
  }
}

// ── 3. Save the final list (codes only) + QA stats (migration 56) ───────────────────────────

/**
 * Saves the coder's final list — codes and counts only, never the pasted text. rows = checkCodes() rows in order,
 * ai = the AI's suggested codes. → { ok } or { error }
 */
export async function saveCodingResult({ user, rows, ai, fy }) {
  const final = rows.map(r => r.code);
  const kept = final.filter(c => ai.includes(c)).length;
  const changed = rows.filter(r => r.source === 'ai_edited').length;
  const added = rows.filter(r => r.source === 'coder').length;
  const row = {
    emp_id: user.emp_id, coder_name: user.name ?? null,
    codes: rows.map((r, i) => ({ code: r.code, order: i + 1, status: r.status, conflict: r.conflicts.length > 0, sequencing: r.seq.length > 0, source: r.source ?? 'ai' })),
    ai_codes: ai, final_codes: final, ai_count: ai.length, final_count: final.length, kept, changed, added,
    removed: Math.max(0, ai.length - kept - changed), problems: rows.filter(r => r.status !== 'valid' || r.conflicts.length).length, fiscal_year: fy ?? null,
  };
  const { error } = await db('coding_results').insert(row);
  if (error) return { error: /coding_results/.test(error.message) ? 'Saving needs the Coding Assistant database update (migration 56).' : 'Could not save — please try again.' };
  logAudit({ actor: user, action: 'coding_assistant_save', entityType: 'coding_assistant', details: { final: final.length, ai: ai.length, kept, changed, added, problems: row.problems } });
  return { ok: true };
}

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * QA stats for this week (Mon →) and this month: per coder — lists saved, codes, share of AI codes kept, lists with
 * problems — and the AI codes most often changed or removed. → { week, month, corrected } or null (not set up).
 */
export async function loadCodingStats() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = mon < first ? mon : first;
  const rows = [];
  for (let at = 0; at < 10000; at += 1000) {
    const { data, error } = await db('coding_results').select('emp_id,coder_name,ai_codes,final_codes,ai_count,final_count,kept,changed,added,removed,problems,created_at')
      .gte('created_at', from.toISOString()).order('created_at').range(at, at + 999);
    if (error) return null;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const per = list => {
    const m = new Map();
    for (const r of list) {
      const p = m.get(r.emp_id) ?? { emp_id: r.emp_id, name: r.coder_name || r.emp_id, lists: 0, codes: 0, ai: 0, kept: 0, problems: 0 };
      p.lists++; p.codes += r.final_count; p.ai += r.ai_count; p.kept += r.kept; if (r.problems) p.problems++;
      m.set(r.emp_id, p);
    }
    return [...m.values()].sort((a, b) => b.lists - a.lists);
  };
  const corrected = new Map();
  for (const r of rows) for (const c of r.ai_codes ?? []) if (!(r.final_codes ?? []).includes(c)) corrected.set(c, (corrected.get(c) ?? 0) + 1);
  return {
    week: per(rows.filter(r => r.created_at >= mon.toISOString())), month: per(rows.filter(r => r.created_at >= first.toISOString())),
    corrected: [...corrected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    weekLabel: ymd(mon), monthLabel: ymd(first),
  };
}
