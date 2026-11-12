// Coding Assistant – Phase A (PO 2026-11-11). The coder pastes diagnosis statements ONLY. A browser check blocks anything
// that looks like a patient identifier before a single character is sent. The AI (through helix-ai — the key stays on the
// server, nothing is stored there) only suggests ICD-10-CM codes; the rules step (codingRules.js, no AI) checks them
// against the Master Library. The pasted text is never stored or logged anywhere — usage counts only.
import { assertAiAllowed } from './companyFeatures';
import { aiFetch, AI_MODEL } from './ai';
import { logAudit } from './audit';

// ── 1. Patient-identifier check (blocks — nothing is replaced or sent) ─────────────────────
const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MBI_CH = '[AC-HJKMNP-RT-Y]';   // Medicare Beneficiary Identifier letters (no S L O I B Z)
const CHECKS = [
  { kind: 'mbi', what: 'a Medicare number (MBI)', re: new RegExp(`\\b[1-9]${MBI_CH}[${MBI_CH.slice(1, -1)}0-9]\\d-?${MBI_CH}[${MBI_CH.slice(1, -1)}0-9]\\d-?${MBI_CH}{2}\\d{2}\\b`, 'gi') },
  { kind: 'ssn', what: 'a Social Security number', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'date', what: 'a date (date of birth / service)', re: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g },
  { kind: 'date', what: 'a date (date of birth / service)', re: new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b|\\b\\d{1,2}\\s+${MONTHS}\\.?\\s+(?:19|20)\\d{2}\\b`, 'gi') },
  { kind: 'dob', what: 'a date-of-birth word', re: /\b(?:dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date|born(?:\s+on)?)\b/gi },
  { kind: 'phone', what: 'a phone number', re: /(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g },
  { kind: 'email', what: 'an email address', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { kind: 'label', what: 'a patient label (name / MRN / member ID…)', re: /\b(?:patient(?:'s)?\s+name|pt\.?\s+name|name|patient|pt|mrn|medical\s+record(?:\s+(?:number|no|#))?|member\s*(?:id|#|number|no)|subscriber\s*(?:id|#)|policy\s*(?:#|number|no)|account\s*(?:#|number|no)|acct\.?|hicn|mbi|ssn|social\s+security|address|addr|phone|tel)\s*[:#]/gi },
  { kind: 'idword', what: 'an ID word (MRN, member ID, MBI, SSN…)', re: /\b(?:mrn|member\s*id|subscriber\s*id|medicare\s*(?:number|id|#)|medicaid\s*(?:number|id|#)|hicn|mbi|ssn|social\s+security)\b/gi },
  { kind: 'title', what: 'a person’s name (Mr / Mrs / Ms…)', re: /\b(?:Mr|Mrs|Ms|Mx|MR|MRS)\.\s*[A-Z][A-Za-z'-]+|\b(?:Mrs|Miss|MRS|MISS)\s+[A-Z][A-Za-z'-]+/g },   // "MS" alone = multiple sclerosis
  { kind: 'number', what: 'a long number (ID / account / phone)', re: /\b\d{7,}\b/g },
  { kind: 'address', what: 'a street address', re: /\b\d{1,6}\s+(?:[A-Za-z0-9'.-]+\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|circle|cir|highway|hwy|parkway|pkwy|terrace|ter)\b\.?/gi },
  { kind: 'address', what: 'a state + ZIP code', re: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g },
  { kind: 'age', what: 'an age over 89', re: /\b(?:9\d|1[01]\d)\s*-?\s*(?:y\/?o|yo|yrs?|years?)(?:[-\s]old)?\b/gi },
];

/**
 * → [{ kind, what, match, index }] — empty when nothing looks like a patient identifier. Runs in the browser only.
 * ICD-10-CM codes (I50.9, S72.001A) never match: identifiers checked here start with a digit or a word.
 */
export function findIdentifiers(text) {
  const s = String(text ?? '');
  const out = [];
  for (const c of CHECKS) {
    for (const m of s.matchAll(c.re)) out.push({ kind: c.kind, what: c.what, match: m[0], index: m.index });
  }
  // one finding per place in the text
  return out.sort((a, b) => a.index - b.index).filter((f, i, a) => !a.slice(0, i).some(p => f.index < p.index + p.match.length));
}

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
      throw new Error(res.status === 401 ? 'The AI key in Settings was rejected — an admin needs to update it.'
        : res.status === 429 ? 'The AI service is busy — please try again in a minute.'
        : `The AI request failed (${res.status}). Please try again.`);
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
