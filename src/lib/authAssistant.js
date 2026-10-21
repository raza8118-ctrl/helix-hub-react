// Auth assistant (roadmap 9.2): a sourced authorization checklist for client + payer + service + request type, built
// by Claude from Helix Hub data only (payer auth rules, auth contacts and notes, auth SOPs, authorization payer
// updates) through the Ask Helix lookups. The request has no patient fields and no dates — only these selections are
// sent. Follow-ups use the 6.5 reminders (“Auth decision due”).
import { logAudit } from './audit';
import { converse } from './assistant';
import { addReminder } from './followups';
import { addWorkdays } from './clientQueries';
import { today } from './helpers';
import { AUTH_SERVICES, labelOf } from './payerOptions';

export const REQUEST_TYPES = [
  { value: 'initial',   label: 'Initial request' },
  { value: 'extension', label: 'Extension / concurrent review' },
  { value: 'retro',     label: 'Retro (after the service started)' },
];
export const NEEDED = {
  yes: { label: 'Auth needed', badge: 'badge-red' },
  after_visits: { label: 'Needed after a number of visits', badge: 'badge-yellow' },
  notify: { label: 'Notification only', badge: 'badge-yellow' },
  no: { label: 'No auth needed', badge: 'badge-green' },
  unknown: { label: 'Not recorded in Helix Hub', badge: 'badge-gray' },
};
const DEFAULT_FOLLOWUP_DAYS = 3;

const SYSTEM = `You are Helix, preparing an authorization checklist for 3Gen's authorization team (US home health,
hospice and related agencies). Use only what the lookups return: search the payer, then get_auth_rules (with the
service), get_payer for the authorization contact, search_sops / get_sop for an authorization SOP for this payer or
its portal, and search_payer_updates for recent authorization changes. Never fill gaps from general knowledge — if
Helix Hub has no rule, set auth_needed to "unknown" and list what is missing. Copy phone / fax numbers, portal links
and day counts exactly as returned. For a retro request, say whether retro is allowed and the window. Steps are short
imperative lines. The claim note is one or two lines with no patient details (payer, service, how submitted, expected
decision, follow-up). Use 0 for unknown day counts.`;

const list = { type: 'array', items: { type: 'string' } };
const SCHEMA = {
  type: 'object',
  properties: {
    auth_needed: { type: 'string', enum: Object.keys(NEEDED) },
    auth_needed_detail: { type: 'string' },
    submit_method: { type: 'string' },
    submit_details: { type: 'string' },
    documents: list,
    decision_days: { type: 'integer' },
    valid_days: { type: 'integer' },
    retro: { type: 'string' },
    steps: list,
    watch_out: list,
    missing: list,
    claim_note: { type: 'string' },
  },
  required: ['auth_needed', 'auth_needed_detail', 'submit_method', 'submit_details', 'documents', 'decision_days', 'valid_days',
    'retro', 'steps', 'watch_out', 'missing', 'claim_note'],
  additionalProperties: false,
};

/**
 * Builds the checklist. req = { client (row or null), payer (row), planName, service, requestType }.
 * Returns { checklist, sources } or throws Error (NO_KEY when no AI key is saved in Settings).
 */
export async function buildChecklist(req, knowledge, user, onLookup) {
  const ask = [
    `Payer: ${req.payer.name} (payer_id ${req.payer.id})`,
    req.planName && `Plan: ${req.planName}`,
    `Client: ${req.client?.name ?? 'not specified'}`,
    `Service: ${labelOf(AUTH_SERVICES, req.service)} (service code ${req.service})`,
    `Request type: ${labelOf(REQUEST_TYPES, req.requestType)}`,
    'Build the authorization checklist.',
  ].filter(Boolean).join('\n');
  let ok = false;
  let lookups = 0;
  try {
    const r = await converse({ system: SYSTEM, messages: [{ role: 'user', content: ask }], format: { type: 'json_schema', schema: SCHEMA }, knowledge, onLookup });
    lookups = r.lookups;
    let checklist;
    try { checklist = JSON.parse(r.text); } catch { throw new Error('The checklist couldn’t be read — please try again.'); }
    ok = true;
    return { checklist, sources: r.sources };
  } finally {
    // Usage record only — the selections are not logged
    logAudit({ actor: user, action: 'auth_checklist', entityType: 'assistant', details: { lookups, ok } });
  }
}

/** Plain text of the checklist for 📋 Copy. */
export function checklistText(c, req) {
  const lines = [
    `Auth checklist — ${req.payer.name}${req.planName ? ` (${req.planName})` : ''} · ${labelOf(AUTH_SERVICES, req.service)} · ${labelOf(REQUEST_TYPES, req.requestType)}`,
    `${NEEDED[c.auth_needed]?.label ?? c.auth_needed}${c.auth_needed_detail ? ` — ${c.auth_needed_detail}` : ''}`,
    c.submit_method && `Submit: ${c.submit_method}${c.submit_details ? ` — ${c.submit_details}` : ''}`,
    c.documents?.length && `Documents: ${c.documents.join('; ')}`,
    c.decision_days ? `Decision usually in ${c.decision_days} working days` : null,
    c.valid_days ? `Valid for ${c.valid_days} days` : null,
    c.retro && `Retro: ${c.retro}`,
    c.steps?.length && `Steps:\n${c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    c.watch_out?.length && `Watch out: ${c.watch_out.join('; ')}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** ⏰ “Auth decision due” reminder — today + the decision days (working days), or 3 when unknown. */
export async function addAuthFollowup(req, decisionDays, user) {
  const due = addWorkdays(today(), decisionDays > 0 ? decisionDays : DEFAULT_FOLLOWUP_DAYS);
  const row = await addReminder({ empId: user.emp_id, clientId: req.client?.id ?? null, payerId: req.payer.id, claimNumber: '', action: 'auth_decision', dueDate: due }, user);
  return row ? due : null;
}
