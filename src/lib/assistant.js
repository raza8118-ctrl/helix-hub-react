// Ask Helix (roadmap 9.1): an AI assistant that answers from Helix Hub's own reference data — Payer Directory, published
// SOPs, Denial Navigator and Payer Updates — through tools that run in the browser. PHI-free mode is always on: the
// question is de-identified locally before it is sent (patient words block sending; dates / numbers / IDs / phones /
// emails become placeholders). The reference data holds no patient information. Nothing is saved; usage is logged
// with counts only. Browser call with the Settings key, same as 5.3 / 8.1.
import { db, kv } from './supabase';
import { logAudit } from './audit';
import { loadStepContext, loadDenialSteps } from './denialSteps';
import { loadDenialCodes, normCode, typeOf } from './denials';
import { searchPayers } from './payers';
import { loadSopLibrary } from './sops';
import { loadSopVersionMeta, loadSopVersions, versionStates } from './sopVersions';
import { loadBulletins } from './payerUpdates';
import { labelOf, DEPARTMENTS, LIMIT_TYPES } from './payerOptions';

const MODEL = 'claude-opus-5-5';
export const MAX_LOOKUPS = 8;
export const MAX_QUESTIONS = 10;      // then a new conversation (history is append-only)
const RESULT_LIMIT = 12000;           // characters per tool result

// ── PHI-free mode ──────────────────────────────────────────────────────────

const PATIENT_WORDS = /\b(dob|d\.o\.b|date\s+of\s+birth|born\s+on|mrn|medical\s+record|member\s*(id|#|number|no)|subscriber\s*(id|#)|mbi|hicn|ssn|social\s+security|patient'?s?\s+name|pt\.?\s+name)\b/gi;
// Denial codes stay as typed (CO-16, PR 1, N290, MA130)
const DENIAL_CODE = /^((CO|PR|OA|PI|CR)[-\s]?[A-Z]?\d{1,3}|(MA|M|N)\d{1,4})$/i;
const REPLACEMENTS = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/g, ph: '[EMAIL]' },
  { re: /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}\b/g, ph: '[PHONE]' },
  { re: /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/g, ph: '[DATE]' },
  { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,?\s+\d{4})?\b/gi, ph: '[DATE]' },
  { re: /\b[A-Z]*\d+[A-Z]+\d+[A-Z0-9]*\b/gi, ph: '[ID]' },
  { re: /\b\d{5,}\b/g, ph: '[NUMBER]' },
];

/**
 * De-identifies a question in the browser. Returns { blocked: [words] } when patient words are present (do not send),
 * otherwise { text, replaced } — replaced = how many values became placeholders.
 */
export function deidentify(question) {
  const words = [...new Set([...String(question).matchAll(PATIENT_WORDS)].map(m => m[0].toLowerCase()))];
  if (words.length) return { blocked: words };
  let text = String(question);
  let replaced = 0;
  for (const { re, ph } of REPLACEMENTS) {
    text = text.replace(re, m => (DENIAL_CODE.test(m.trim()) ? m : (replaced += 1, ph)));
  }
  return { text: text.trim(), replaced };
}

// ── Reference data (loaded once per page) ──────────────────────────────────

/** Everything the tools search. Parts that aren't set up come back empty. */
export async function loadKnowledge(user) {
  const [ctx, codes, steps, lib, meta, bulletins] = await Promise.all([
    loadStepContext(), loadDenialCodes(), loadDenialSteps(), loadSopLibrary(), loadSopVersionMeta(user), loadBulletins(),
  ]);
  // SOPs readers can see: the current published version (or, before versions existed, status published)
  const versionsBySop = {};
  (meta?.versions ?? []).forEach(v => { (versionsBySop[v.sop_id] ??= []).push(v); });
  const tasks = Object.fromEntries((lib?.tasks ?? []).map(t => [t.id, t]));
  const software = Object.fromEntries((lib?.software ?? []).map(s => [s.id, s]));
  const sops = (lib?.sops ?? []).filter(s => s.active !== false).flatMap(s => {
    const vs = versionsBySop[s.id];
    const current = vs?.length ? versionStates(vs).current : null;
    if (vs?.length && !current) return [];
    if (!vs?.length && s.status !== 'published') return [];
    const task = tasks[s.task_id];
    return [{ id: s.id, title: current?.title ?? s.title, summary: current?.summary ?? s.summary, client_id: s.client_id,
      task: task?.name ?? '', software: software[task?.software_id]?.name ?? '', versioned: !!vs?.length, row: s }];
  });
  const updates = (bulletins ?? []).filter(b => b.active !== false)
    .flatMap(b => b.updates.filter(u => u.status === 'active').map(u => ({ ...u, bulletin: { id: b.id, title: b.title, issuer: b.issuer } })));
  return { clients: ctx.clients, payers: ctx.payers.filter(p => p.active !== false), codes: (codes ?? []).filter(c => c.active !== false), steps: steps ?? [], sops, updates };
}

// ── Tools (run in the browser) ─────────────────────────────────────────────

const str = description => ({ type: 'string', description });
const tool = (name, description, props) => ({
  name, description, strict: true,
  input_schema: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false },
});

export const TOOLS = [
  tool('search_payers', 'Find payers in the Payer Directory by name or alias (e.g. "BCBSTX", "Aetna Medicare").', { query: str('Payer name or alias') }),
  tool('get_payer', 'Full Payer Directory card for one payer: contacts by department (phone, fax, portal, mailing address), electronic payer IDs, plans, timely filing / appeal / reconsideration limits and notes. Give client_name to apply that client\'s contract limits; "" for standard limits.', {
    payer_id: { type: 'integer', description: 'payer_id from search_payers' }, client_name: str('Client (agency) name, or ""'),
  }),
  tool('search_sops', 'Search published SOPs (step-by-step guides) by words in the title, summary, software or task.', { query: str('Words to search for') }),
  tool('get_sop', 'The published content of one SOP: purpose, before you start, numbered steps, expected result, troubleshooting.', {
    sop_id: { type: 'integer', description: 'sop_id from search_sops' },
  }),
  tool('search_denial_codes', 'Find CARC / RARC denial codes by code (e.g. "CO-16", "N290", "197") or by words in the reason.', { query: str('Code or words') }),
  tool('get_denial_steps', 'What to do for a denial code: the plain-English reason and the layered steps — client-specific, payer-specific and common. Use "" when no client or payer is named.', {
    code: str('Denial code, e.g. "CO-197" or "N290"'), client_name: str('Client name or ""'), payer_name: str('Payer name or ""'),
  }),
  tool('search_payer_updates', 'Recent payer changes taken from payer bulletins (payer, effective date, what changed, action needed).', {
    query: str('Words to search for, or ""'), payer_name: str('Payer name or ""'),
  }),
  tool('list_clients', 'The client (agency) names Helix Hub knows.', {}),
];

const words = q => String(q ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
const hasAll = (texts, q) => { const w = words(q); return w.length > 0 && w.every(x => texts.some(t => (t ?? '').toLowerCase().includes(x))); };
const findClient = (k, name) => (name?.trim() ? k.clients.find(c => c.name.toLowerCase() === name.trim().toLowerCase())
  ?? k.clients.find(c => c.name.toLowerCase().includes(name.trim().toLowerCase())) : null);
const findPayer = (k, name) => (name?.trim() ? searchPayers(k.payers, name, 1)[0] ?? null : null);
const live = r => (r.error ? [] : (r.data ?? []).filter(x => x.active !== false));
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));

/** Runs one tool. Returns { result (JSON-able), sources: [{ kind, id, label }] }. */
async function runTool(name, input, k) {
  switch (name) {
    case 'search_payers': {
      const list = searchPayers(k.payers, input.query, 8);
      return { result: list.map(p => clean({ payer_id: p.id, name: p.name, aliases: p.aliases, payer_type: p.payer_type })), sources: [] };
    }
    case 'get_payer': {
      const p = k.payers.find(x => x.id === input.payer_id);
      if (!p) return { result: { error: 'No payer with that payer_id — use search_payers first.' }, sources: [] };
      const client = findClient(k, input.client_name);
      const [contacts, ids, plans, limits, notes] = await Promise.all(
        ['payer_contacts', 'payer_ids', 'payer_plans', 'payer_limits', 'payer_notes'].map(t => db(t).select('*').eq('payer_id', p.id)));
      const planName = id => live(plans).find(x => x.id === id)?.plan_name;
      const allLimits = live(limits);
      const key = l => `${l.limit_type}|${l.level ?? ''}|${l.plan_id ?? ''}`;
      const overrides = client ? allLimits.filter(l => l.client_id === client.id) : [];
      const chosen = [...allLimits.filter(l => l.client_id == null && !overrides.some(o => key(o) === key(l))), ...overrides];
      return {
        result: clean({
          payer: p.name, payer_type: p.payer_type, aliases: p.aliases,
          client_applied: client ? client.name : (input.client_name?.trim() ? `"${input.client_name}" not found — standard limits shown` : ''),
          contacts: live(contacts).map(c => clean({ department: labelOf(DEPARTMENTS, c.department), plan: planName(c.plan_id), phone: c.phone, ext_or_ivr: c.phone_ext,
            fax: c.fax, email: c.email, portal: c.portal_url, attention: c.attention_line, mailing_address: c.mailing_address, hours: c.hours, notes: c.notes })),
          payer_ids: live(ids).map(i => clean({ payer_id: i.electronic_payer_id, clearinghouse: i.clearinghouse || 'Direct to payer', used_for: i.transaction_type,
            plan: planName(i.plan_id), enrollment_required: i.enrollment_required || null, notes: i.notes })),
          plans: live(plans).map(x => clean({ plan: x.plan_name, line_of_business: x.line_of_business, state: x.state })),
          limits: chosen.map(l => clean({ limit: labelOf(LIMIT_TYPES, l.limit_type), level: l.level, days: l.days, counted_from: l.measured_from,
            plan: planName(l.plan_id), client_contract: l.client_id ? client?.name : null, notes: l.notes })),
          notes: live(notes).map(n => clean({ category: n.category, note: n.note, pinned: n.pinned || null })),
        }),
        sources: [{ kind: 'payer', id: p.id, label: p.name }],
      };
    }
    case 'search_sops': {
      const list = k.sops.filter(s => hasAll([s.title, s.summary, s.software, s.task], input.query)).slice(0, 10);
      return {
        result: list.map(s => clean({ sop_id: s.id, title: s.title, summary: s.summary, software: s.software, task: s.task,
          client: s.client_id ? k.clients.find(c => c.id === s.client_id)?.name : 'All clients' })),
        sources: [],
      };
    }
    case 'get_sop': {
      const s = k.sops.find(x => x.id === input.sop_id);
      if (!s) return { result: { error: 'No published SOP with that sop_id — use search_sops first.' }, sources: [] };
      let content = s.row;
      if (s.versioned) {
        const current = versionStates(await loadSopVersions(s.id) ?? []).current;
        if (current?.snapshot) content = { ...s.row, ...current.snapshot };
      }
      const steps = (Array.isArray(content.steps) ? content.steps : []).map((st, i) => clean({ n: i + 1, step: st?.text, tip: st?.tip })).filter(st => st.step);
      return {
        result: clean({ title: content.title, software: s.software, task: s.task, purpose: content.purpose, before_you_start: content.prerequisites,
          steps, expected_result: content.expected_result, if_it_goes_wrong: content.troubleshooting }),
        sources: [{ kind: 'sop', id: s.id, label: content.title }],
      };
    }
    case 'search_denial_codes': {
      const q = String(input.query ?? '').trim();
      const n = normCode(q).replace(/^(CO|PR|OA|PI|CR)[-:]?/, '');
      const list = k.codes.filter(c => normCode(c.code) === n || hasAll([c.code, c.plain_reason, c.official_text, c.category], q)).slice(0, 10);
      return { result: list.map(c => clean({ code: c.code, type: typeOf(c.code_type).label, reason: c.plain_reason ?? c.official_text, category: c.category })), sources: [] };
    }
    case 'get_denial_steps': {
      const n = normCode(input.code).replace(/^(CO|PR|OA|PI|CR)[-:]?/, '');
      const code = k.codes.find(c => normCode(c.code) === n);
      if (!code) return { result: { error: `Code "${input.code}" is not in the Denial library.` }, sources: [] };
      const client = findClient(k, input.client_name);
      const payer = findPayer(k, input.payer_name);
      const entry = (scope, target) => k.steps.find(s => s.active !== false && s.code_id === code.id && s.scope === scope
        && (scope === 'common' || String(scope === 'client' ? s.client_id : s.payer_id) === String(target)));
      const layer = (label, e) => (e ? clean({ layer: label, steps: e.steps, notes: e.notes, linked_sop: e.sop_id ? k.sops.find(x => x.id === e.sop_id)?.title : null }) : null);
      return {
        result: clean({
          code: code.code, type: typeOf(code.code_type).label, reason: code.plain_reason ?? code.official_text,
          client_applied: client?.name, payer_applied: payer?.name,
          layers: [client && layer(`Client: ${client.name}`, entry('client', client.id)), payer && layer(`Payer: ${payer.name}`, entry('payer', payer.id)),
            layer('Common 3Gen steps', entry('common'))].filter(Boolean),
        }),
        sources: [{ kind: 'denial', id: code.id, label: code.code }],
      };
    }
    case 'search_payer_updates': {
      const payer = findPayer(k, input.payer_name);
      const list = k.updates.filter(u => (!payer || u.payer_id === payer.id || hasAll([u.payer_name], input.payer_name))
        && (!String(input.query ?? '').trim() || hasAll([u.payer_name, u.change_text, u.action_needed, u.bulletin.title], input.query)))
        .sort((a, b) => (b.effective_date ?? '').localeCompare(a.effective_date ?? '')).slice(0, 15);
      return {
        result: list.map(u => clean({ payer: k.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name, effective_date: u.effective_date,
          change: u.change_text, action_needed: u.action_needed, teams: u.teams, bulletin: u.bulletin.title })),
        sources: list.length ? [{ kind: 'updates', id: 'updates', label: 'Payer Updates' }] : [],
      };
    }
    case 'list_clients':
      return { result: k.clients.map(c => c.name), sources: [] };
    default:
      return { result: { error: `Unknown tool ${name}` }, sources: [] };
  }
}

// ── The conversation ───────────────────────────────────────────────────────

const SYSTEM = `You are Helix, the assistant inside Helix Hub, the internal platform of 3Gen Consulting's revenue-cycle teams
(AR, authorization, billing / posting, coding, credentialing) who work claims for home health, hospice and other agencies.

Answer only from what the tools return: the Payer Directory, published SOPs, the Denial Navigator and Payer Updates. Look
things up before answering — search first, then open the record. If the tools don't have it, say you couldn't find it in
Helix Hub and name the page where it would belong; never fill gaps from general knowledge for phone or fax numbers,
payer IDs, addresses or filing limits. Copy numbers, IDs and limits exactly as returned. When a client contract limit
replaces the standard one, say so.

The user's question was de-identified in their browser: [DATE], [NUMBER], [ID], [PHONE] and [EMAIL] stand for removed
values — work without them and never ask for patient details.

Write for busy staff: lead with the answer in one or two sentences, then short bullet points or numbered steps. Name the
source (payer card, SOP title, denial code, bulletin) for each fact. No headings.`;

async function callClaude(key, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 16000, system: SYSTEM, tools: TOOLS, tool_choice: { type: 'auto' }, messages,
      output_config: { effort: 'medium' }, fallbacks: 'default',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? 'The AI key in Settings was rejected — an admin needs to update it.'
      : res.status === 429 ? 'The AI service is busy — please try again in a minute.'
      : err.error?.message ?? `AI request failed (${res.status}).`);
  }
  return res.json();
}

/**
 * Asks one (already de-identified) question. history = the API messages so far (append-only, never edited — the
 * model's thinking blocks are passed back exactly as returned). onLookup(name) reports progress.
 * Returns { answer, sources, messages (the new history), lookups } or throws Error (NO_KEY when no AI key).
 */
export async function ask(question, history, knowledge, user, onLookup) {
  const key = await kv.get('anthropic_key');
  if (!key) throw new Error('NO_KEY');
  const messages = [...history, { role: 'user', content: question }];
  const sources = new Map();
  let lookups = 0;
  let ok = false;
  try {
    for (let round = 0; round < MAX_LOOKUPS + 2; round++) {
      const json = await callClaude(key, messages);
      messages.push({ role: 'assistant', content: json.content });
      if (json.stop_reason === 'refusal') throw new Error('The AI declined to answer this question.');
      if (json.stop_reason === 'max_tokens') throw new Error('The answer was cut off — please ask a narrower question.');
      const calls = (json.content ?? []).filter(b => b.type === 'tool_use');
      if (json.stop_reason !== 'tool_use' || !calls.length) {
        const answer = (json.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        ok = true;
        return { answer: answer || 'I couldn’t put an answer together — please try rephrasing.', sources: [...sources.values()], messages, lookups };
      }
      // Every tool_use gets a tool_result, all in one user message
      const results = await Promise.all(calls.map(async c => {
        lookups += 1;
        if (lookups > MAX_LOOKUPS) {
          return { type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Lookup limit reached — answer with what you have.' };
        }
        onLookup?.(c.name);
        try {
          const { result, sources: found } = await runTool(c.name, c.input ?? {}, knowledge);
          found.forEach(s => sources.set(`${s.kind}:${s.id}`, s));
          return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(result).slice(0, RESULT_LIMIT) };
        } catch {
          return { type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'This lookup failed.' };
        }
      }));
      messages.push({ role: 'user', content: results });
    }
    throw new Error('The assistant took too many steps — please ask a narrower question.');
  } finally {
    // Usage record only — never the question or the answer
    logAudit({ actor: user, action: 'assistant_ask', entityType: 'assistant', details: { lookups, sources: sources.size, ok } });
  }
}
