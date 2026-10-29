// AI wording for appeal letters (roadmap 5.3). PHI rule (CLAUDE.md rule 6): only the template — which holds
// placeholders, never real values — and non-identifying facts are sent. Identifiers (names, DOB, member ID, claim /
// auth numbers, every date) never leave this computer; real values are filled in locally afterwards.
// Calls the Claude API from the browser with the company's AI key (same approach as callAI in helpers.js).
import { kv } from './supabase';
import { assertAiAllowed } from './companyFeatures';
import { logAudit } from './audit';
import { denialTypeOf, levelOf } from './appeals';
import { TOKEN_GROUPS, checkTemplate } from './appealTemplates';

export const STYLES = [
  { value: 'firm',    label: 'Firm and formal',        hint: 'Professional, assertive, clearly requests reprocessing' },
  { value: 'neutral', label: 'Neutral',                hint: 'Plain, polite business letter' },
  { value: 'short',   label: 'Short and to the point', hint: 'As brief as possible while keeping every fact' },
];

const MODEL = 'claude-opus-5-5';
const TOKEN_RE = /\[[A-Z0-9_]+\]/g;
const ALL_TOKENS = TOKEN_GROUPS.flatMap(g => g.tokens);
const IDENTIFIER_TOKENS = new Set(ALL_TOKENS.filter(t => t.id).map(t => t.token));

// ── PHI check for anything typed by a person ────────────────────────────────

const PHI_PATTERNS = [
  { re: /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/, why: 'a date' },
  { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, why: 'a date' },
  { re: /\b\d{5,}\b/, why: 'a long number (ID, claim or account number?)' },
  { re: /\b[A-Z]*\d+[A-Z]+\d+[A-Z0-9]*\b/i, why: 'an ID-like code' },
  { re: /\b\d{3}[-.\s)]\s?\d{3}[-.\s]\d{4}\b/, why: 'a phone number' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, why: 'an email address' },
  { re: /\b(dob|date of birth|born|mrn|medical record (number|#)|ssn|social security|member id|subscriber id|mbi|medicare (number|id)|claim (number|#)|patient name|mr\.|mrs\.|ms\.)\b/i, why: 'a patient-detail word' },
];

/** What looks like patient information in a piece of text (empty list = looks fine). */
export function phiIssues(text) {
  const s = String(text ?? '');
  return [...new Set(PHI_PATTERNS.filter(p => p.re.test(s)).map(p => p.why))];
}

// ── What is sent ───────────────────────────────────────────────────────────

/**
 * Everything the AI will see — and nothing else. templateBody = the chosen template (placeholders only, never the
 * edited/filled letter). Returns { templateBody, facts: [{ label, value, freeText }], problems: [{ label, issues }] }.
 */
export function buildAIRequest({ templateBody, form, effectiveType, clientName, payerName, codesText, reasonText, useNotes }) {
  const facts = [
    { label: 'Denial type', value: denialTypeOf(effectiveType).label },
    { label: 'Appeal level', value: levelOf(form.level).label },
    { label: 'Payer', value: payerName ?? '' },
    { label: 'Provider (client)', value: clientName ?? '' },
    { label: 'Denial code(s)', value: codesText ?? '' },
    { label: 'Denial reason', value: reasonText ?? '' },
  ];
  // Only non-identifier key facts of this denial type
  for (const f of denialTypeOf(effectiveType).facts.filter(x => !x.id)) {
    const v = f.type === 'checklist' ? (form[f.key] ?? []).join(', ') : String(form[f.key] ?? '').trim();
    facts.push({ label: f.label, value: v, freeText: f.type === 'textarea' || f.type === 'text' });
  }
  if (useNotes) facts.push({ label: 'Why we disagree (staff notes)', value: String(form.disagree ?? '').trim(), freeText: true });
  const sent = facts.filter(f => f.value);

  const problems = [];
  for (const f of sent.filter(x => x.freeText)) {
    const issues = phiIssues(f.value);
    if (issues.length) problems.push({ label: f.label, issues });
  }
  const templateIssues = checkTemplate(templateBody);
  if (templateIssues.some(w => !w.startsWith('Unknown'))) problems.push({ label: 'Template', issues: templateIssues });
  return { templateBody, facts: sent, problems };
}

const SYSTEM = `You rewrite appeal letters for a US healthcare revenue-cycle team.
You receive a letter template and some facts. The template contains placeholders in square brackets such as [PATIENT_NAME], [CLAIM_NUMBER] or [AUTH_NUMBER]; the real values are filled in later on the user's computer.

Rules:
- Keep every placeholder exactly as written, including the brackets, and keep each one in a sensible place. Do not invent new placeholders.
- Keep the address block, the RE: lines and the signature block, with their placeholders.
- A line that starts with "?" is optional: keep the "?" at the start of that line.
- Use only the facts given. Never invent facts, dates, amounts, numbers, names, policies or regulations.
- Never write patient details yourself — use the placeholders.
- Improve clarity, structure and tone in the requested style. Use plain business English.
Return the full rewritten letter in "letter", and one or two sentences describing what you changed in "notes".`;

const SCHEMA = {
  type: 'object',
  properties: { letter: { type: 'string' }, notes: { type: 'string' } },
  required: ['letter', 'notes'],
  additionalProperties: false,
};

function userMessage(req, style) {
  const s = STYLES.find(x => x.value === style) ?? STYLES[1];
  return `Style: ${s.label} — ${s.hint}.

Facts:
${req.facts.map(f => `- ${f.label}: ${f.value}`).join('\n')}

Letter template:
<template>
${req.templateBody}
</template>`;
}

// ── Checking the answer ──────────────────────────────────────────────────────

/** { ok, errors, warnings } — errors mean the answer must not be used. */
export function validateAILetter(templateBody, letter) {
  const errors = [], warnings = [];
  if (!String(letter ?? '').trim()) return { ok: false, errors: ['The AI returned an empty letter.'], warnings };
  const before = new Set(templateBody.match(TOKEN_RE) ?? []);
  const after = new Set(letter.match(TOKEN_RE) ?? []);
  const lost = [...before].filter(t => IDENTIFIER_TOKENS.has(t) && !after.has(t));
  if (lost.length) errors.push(`These placeholders went missing: ${lost.join(', ')}`);
  const known = new Set(ALL_TOKENS.map(t => t.token));
  const unknown = [...after].filter(t => !known.has(t));
  if (unknown.length) errors.push(`The AI made up placeholders: ${unknown.join(', ')}`);
  const added = [...after].filter(t => known.has(t) && !before.has(t));
  if (added.length) warnings.push(`New placeholders were added: ${added.join(', ')} — check they make sense.`);
  const otherLost = [...before].filter(t => !IDENTIFIER_TOKENS.has(t) && !after.has(t));
  if (otherLost.length) warnings.push(`Not used any more: ${otherLost.join(', ')}`);
  for (const w of checkTemplate(letter)) if (!w.startsWith('Unknown')) warnings.push(`The AI wrote ${w.charAt(0).toLowerCase()}${w.slice(1)}`);
  return { ok: errors.length === 0, errors, warnings };
}

// ── The call ───────────────────────────────────────────────────────────────

/**
 * Asks Claude to reword the template. Returns { letter, notes } or throws Error with a plain-English message
 * (NO_KEY when no AI key is saved in Settings). Only req (placeholders + non-identifier facts) is sent.
 */
export async function improveWording(req, style, user) {
  assertAiAllowed();   // Owner Console: AI can be switched off per company
  const key = await kv.get('anthropic_key');
  if (!key) throw new Error('NO_KEY');
  let ok = false;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMessage(req, style) }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        fallbacks: 'default',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(res.status === 401 ? 'The AI key in Settings was rejected — an admin needs to update it.'
        : res.status === 429 ? 'The AI service is busy — please try again in a minute.'
        : err.error?.message ?? `AI request failed (${res.status}).`);
    }
    const json = await res.json();
    if (json.stop_reason === 'refusal') throw new Error('The AI declined to rewrite this letter — use the template version.');
    if (json.stop_reason === 'max_tokens') throw new Error('The AI answer was cut off — please try again.');
    const text = [...(json.content ?? [])].reverse().find(b => b.type === 'text')?.text;
    let parsed;
    try { parsed = JSON.parse(text ?? ''); } catch { throw new Error('The AI answer couldn’t be read — please try again.'); }
    ok = true;
    return { letter: String(parsed.letter ?? ''), notes: String(parsed.notes ?? '') };
  } finally {
    // Usage record only — never the letter, facts or placeholders
    logAudit({ actor: user, action: 'appeal_ai_wording', entityType: 'appeal', details: { denial_type: req.facts[0]?.value ?? '', style, ok } });
  }
}
