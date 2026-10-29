// Suggested Payer Directory changes from payer bulletins (roadmap 8.3). Claude re-reads a bulletin PDF for directory
// facts only (contacts, payer IDs, base filing / appeal limits, notes) with the quoted evidence; the browser matches
// the payer and compares with the current directory (add vs change, identical dropped). Nothing reaches the directory
// until someone with “Edit Payer Directory” approves it — then it is written like a normal payer-card edit (history).
import { supabase, db, S, kv } from './supabase';
import { logAudit } from './audit';
import { assertAiAllowed } from './companyFeatures';
import { hasAccess } from './access';
import { matchPayerName } from './worklist';
import { DEPARTMENTS, TRANSACTIONS, LIMIT_TYPES, MEASURED_FROM, NOTE_CATEGORIES, labelOf } from './payerOptions';

const MODEL = 'claude-opus-5-5';
const now = () => new Date().toISOString();
const digits = s => String(s ?? '').replace(/\D/g, '');
const same = (a, b, phone) => (phone ? digits(a) === digits(b) : String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase());

export const canApproveSuggestions = user => hasAccess(user, 'payers_edit');

// title = the payer card section title (so approved changes read the same in its 🕘 History)
// key = the fields that identify “the same row” in the directory; phone = compared by digits only
export const SUGGESTION_SECTIONS = {
  contact: {
    table: 'payer_contacts', entity: 'payer_contact', title: 'Contacts', icon: '☎️', key: ['department'],
    fields: [
      { key: 'department', label: 'Department', type: 'select', options: DEPARTMENTS, required: true },
      { key: 'phone', label: 'Phone', phone: true }, { key: 'fax', label: 'Fax', phone: true }, { key: 'email', label: 'Email' },
      { key: 'portal_url', label: 'Portal / website link' }, { key: 'attention_line', label: 'Attention line' },
      { key: 'mailing_address', label: 'Mailing address', type: 'textarea' }, { key: 'hours', label: 'Hours' },
    ],
  },
  payer_id: {
    table: 'payer_ids', entity: 'payer_electronic_id', title: 'Payer IDs', icon: '🔢', key: ['transaction_type', 'clearinghouse'],
    fields: [
      { key: 'electronic_payer_id', label: 'Payer ID', required: true }, { key: 'clearinghouse', label: 'Clearinghouse (blank = direct)' },
      { key: 'transaction_type', label: 'Used for', type: 'select', options: TRANSACTIONS },
    ],
  },
  limit: {
    table: 'payer_limits', entity: 'payer_limit', title: 'Filing & appeal limits', icon: '⏳', key: ['limit_type', 'level'],
    fields: [
      { key: 'limit_type', label: 'Limit', type: 'select', options: LIMIT_TYPES, required: true },
      { key: 'level', label: 'Level (appeals / recons)', type: 'number' }, { key: 'days', label: 'Days allowed', type: 'number', required: true },
      { key: 'measured_from', label: 'Counted from', type: 'select', options: MEASURED_FROM },
    ],
  },
  note: {
    table: 'payer_notes', entity: 'payer_note', title: 'Tips & notes', icon: '📝', key: null,
    fields: [
      { key: 'note', label: 'Note', type: 'textarea', required: true },
      { key: 'category', label: 'Category', type: 'select', options: NOTE_CATEGORIES },
    ],
  },
};

/** Plain text of one value for display (“Claims”, “90”). */
export function showValue(section, key, v) {
  const f = SUGGESTION_SECTIONS[section].fields.find(x => x.key === key);
  if (v == null || v === '') return '—';
  return f?.options ? labelOf(f.options, v) : String(v);
}

// ── AI ─────────────────────────────────────────────────────────────────────

const SYSTEM = `You read payer bulletins for a US healthcare revenue-cycle company and find facts that belong in its
Payer Directory. Return a suggestion ONLY when the document states a concrete new or changed value for one of:
- contact: a phone, fax, email, portal / website link, mailing address, attention line or hours for a department
  (claims, auth, appeals, provider_relations, eligibility, other)
- payer_id: an electronic payer ID, with the clearinghouse if named and what it is used for
- limit: a timely filing (TFL), corrected claim (CCTFL), appeal (AFL) or reconsideration (RECON) limit in days, with the
  appeal level and what it is counted from if stated
- note: another rule staff must remember that fits none of the above (one or two sentences)
Use "" for anything not stated. Never guess or reformat numbers beyond copying them. Quote the sentence that states the
fact in "evidence" and give the 1-based page number. Skip anything that is not a directory fact.`;

const S_ENUM = list => ({ type: 'string', enum: ['', ...list.map(o => o.value)] });
const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          payer_name: { type: 'string' },
          section: { type: 'string', enum: Object.keys(SUGGESTION_SECTIONS) },
          department: S_ENUM(DEPARTMENTS),
          phone: { type: 'string' }, fax: { type: 'string' }, email: { type: 'string' }, portal_url: { type: 'string' },
          mailing_address: { type: 'string' }, attention_line: { type: 'string' }, hours: { type: 'string' },
          electronic_payer_id: { type: 'string' }, clearinghouse: { type: 'string' }, transaction_type: S_ENUM(TRANSACTIONS),
          limit_type: S_ENUM(LIMIT_TYPES), level: { type: 'string' }, days: { type: 'string' }, measured_from: S_ENUM(MEASURED_FROM),
          note: { type: 'string' }, category: S_ENUM(NOTE_CATEGORIES),
          evidence: { type: 'string' }, source_page: { type: 'integer' },
        },
        required: ['payer_name', 'section', 'department', 'phone', 'fax', 'email', 'portal_url', 'mailing_address', 'attention_line',
          'hours', 'electronic_payer_id', 'clearinghouse', 'transaction_type', 'limit_type', 'level', 'days', 'measured_from',
          'note', 'category', 'evidence', 'source_page'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(new Error('The PDF could not be read.'));
  r.readAsDataURL(blob);
});

async function askClaude(pdf) {
  assertAiAllowed();   // Owner Console: AI can be switched off per company
  const key = await kv.get('anthropic_key');
  if (!key) throw new Error('NO_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(pdf) } },
        { type: 'text', text: 'List the Payer Directory facts in this bulletin.' },
      ] }],
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
  if (json.stop_reason === 'refusal') throw new Error('The AI declined to read this document.');
  if (json.stop_reason === 'max_tokens') throw new Error('The answer was cut off — split the PDF in File Tools and try the parts.');
  const text = [...(json.content ?? [])].reverse().find(b => b.type === 'text')?.text;
  try { return JSON.parse(text ?? '').suggestions ?? []; } catch { throw new Error('The AI answer couldn’t be read — please try again.'); }
}

// ── Comparing with the directory ───────────────────────────────────────────

/** Only the fields of this section, cleaned (numbers as numbers, blanks dropped). */
function cleanValues(section, raw) {
  const out = {};
  for (const f of SUGGESTION_SECTIONS[section].fields) {
    let v = raw[f.key];
    if (v == null || String(v).trim() === '') continue;
    if (f.type === 'number') { v = parseInt(String(v).replace(/[^0-9]/g, ''), 10); if (!Number.isFinite(v)) continue; }
    else v = String(v).trim();
    out[f.key] = v;
  }
  return out;
}

async function directoryRows(section, payerId) {
  const t = SUGGESTION_SECTIONS[section];
  const { data } = await db(t.table).select('*').eq('payer_id', payerId).eq('active', true);
  // Base rows only: no plan-specific rows, no client contract limits
  return (data ?? []).filter(r => r.plan_id == null && (section !== 'limit' || r.client_id == null));
}

/**
 * Compares suggested values with the payer's current directory rows.
 * Returns { action: 'add' | 'update' | 'same', target, changes } (changes = only fields that differ).
 */
export async function compareWithDirectory(section, payerId, values) {
  const t = SUGGESTION_SECTIONS[section];
  if (!payerId) return { action: 'add', target: null, changes: values };
  const rows = await directoryRows(section, payerId);
  if (section === 'note') {
    return rows.some(r => same(r.note, values.note)) ? { action: 'same', target: null, changes: {} } : { action: 'add', target: null, changes: values };
  }
  const target = rows.find(r => t.key.every(k => same(r[k] ?? '', values[k] ?? '')));
  if (!target) return { action: 'add', target: null, changes: values };
  const changes = {};
  for (const f of t.fields) {
    if (values[f.key] == null) continue;
    if (!same(target[f.key], values[f.key], f.phone)) changes[f.key] = values[f.key];
  }
  return Object.keys(changes).length ? { action: 'update', target, changes } : { action: 'same', target, changes: {} };
}

const snapshot = (section, row) => (row ? Object.fromEntries(SUGGESTION_SECTIONS[section].fields.map(f => [f.key, row[f.key] ?? null])) : null);

// ── Making suggestions ─────────────────────────────────────────────────────

async function bulletinPdf(bulletin) {
  const { data, error } = await supabase.storage.from('payer-bulletins').download(bulletin.file_path);
  if (error || !data) throw new Error('The bulletin PDF could not be opened.');
  return data;
}

/**
 * Reads a saved bulletin with AI and stores the directory suggestions (pending). file = the PDF if still in memory
 * (right after saving), otherwise it is downloaded. Returns { added, same } or throws (NO_KEY when no AI key).
 */
export async function suggestFromBulletin(bulletin, payers, user, file = null) {
  let ok = false;
  let added = 0;
  let unchanged = 0;
  try {
    const raw = await askClaude(file ?? await bulletinPdf(bulletin));
    const { data: existing } = await db('payer_directory_suggestions').select('payer_id,section,proposed').eq('status', 'pending');
    const pendingKeys = new Set((existing ?? []).map(s => `${s.payer_id}|${s.section}|${JSON.stringify(s.proposed)}`));
    const rows = [];
    for (const s of raw) {
      if (!SUGGESTION_SECTIONS[s.section]) continue;
      const values = cleanValues(s.section, s);
      if (SUGGESTION_SECTIONS[s.section].fields.some(f => f.required && values[f.key] == null)) continue;
      const payer = matchPayerName(payers, s.payer_name);
      const cmp = await compareWithDirectory(s.section, payer?.id ?? null, values);
      if (cmp.action === 'same') { unchanged += 1; continue; }
      const proposed = cmp.action === 'update' ? { ...Object.fromEntries((SUGGESTION_SECTIONS[s.section].key ?? []).map(k => [k, cmp.target[k] ?? null])), ...cmp.changes } : values;
      const dedupe = `${payer?.id ?? null}|${s.section}|${JSON.stringify(proposed)}`;
      if (pendingKeys.has(dedupe)) continue;
      pendingKeys.add(dedupe);
      rows.push({
        bulletin_id: bulletin.id, payer_id: payer?.id ?? null, payer_name: String(s.payer_name ?? '').trim() || null,
        section: s.section, action: cmp.action, target_row_id: cmp.target?.id ?? null, proposed,
        current: snapshot(s.section, cmp.target), evidence: String(s.evidence ?? '').trim().slice(0, 1000) || null,
        source_page: Number.isInteger(s.source_page) && s.source_page > 0 ? s.source_page : null, created_by: user.emp_id,
      });
    }
    if (rows.length && !await S.set('payer_directory_suggestions', rows)) throw new Error('Could not save the suggestions. Please try again.');
    added = rows.length;
    ok = true;
    return { added, same: unchanged };
  } finally {
    // Usage record only — never the bulletin text
    logAudit({ actor: user, action: 'directory_suggest', entityType: 'payer_bulletin', entityId: bulletin.id, details: { added, same: unchanged, ok } });
  }
}

// ── Reviewing ──────────────────────────────────────────────────────────────

/** All suggestions (newest first), or null when the 8.3 database update hasn't been run. */
export async function loadSuggestions() {
  const { data, error } = await db('payer_directory_suggestions').select('*').order('created_at', { ascending: false }).limit(1000);
  return error ? null : data ?? [];
}

/** Pending suggestions for one payer (payer card notice). 0 if not set up. */
export async function pendingForPayer(payerId) {
  const { data, error } = await db('payer_directory_suggestions').select('id').eq('payer_id', payerId).eq('status', 'pending');
  return error ? 0 : (data ?? []).length;
}

/**
 * ✓ Approve: compares again with the directory as it is now, then adds the row or updates the matching one (verified
 * today) and logs it like a payer-card edit so it shows in the payer's 🕘 History. Returns an error message or ''.
 */
export async function approveSuggestion(s, values, payer, bulletinTitle, user) {
  const t = SUGGESTION_SECTIONS[s.section];
  const clean = cleanValues(s.section, values);
  const missing = t.fields.filter(f => f.required && clean[f.key] == null);
  if (!payer) return 'Choose the payer first.';
  if (missing.length) return `Please fill in: ${missing.map(f => f.label).join(', ')}.`;
  const cmp = await compareWithDirectory(s.section, payer.id, clean);
  const stamp = { updated_by: user.emp_id, updated_at: now(), verified_at: now(), verified_by: user.emp_id };
  let rowId = cmp.target?.id ?? null;
  if (cmp.action === 'update') {
    if (!await S.update(t.table, { ...cmp.changes, ...stamp }, { id: cmp.target.id })) return 'Could not update the directory. Please try again.';
  } else if (cmp.action === 'add') {
    const saved = await S.set(t.table, { ...clean, ...stamp, payer_id: payer.id, active: true, created_by: user.emp_id });
    if (!saved?.length) return 'Could not add to the directory. Please try again.';
    rowId = saved[0].id;
  }
  if (cmp.action !== 'same') {
    logAudit({
      actor: user, action: cmp.action === 'update' ? 'edit_payer_info' : 'add_payer_info', entityType: t.entity, entityId: rowId,
      details: { payer: payer.name, payer_id: payer.id, section: t.title, source: `bulletin: ${bulletinTitle ?? s.bulletin_id}`, suggestion_id: s.id },
    });
  }
  await S.update('payer_directory_suggestions', {
    status: 'approved', payer_id: payer.id, proposed: clean, decided_by: user.emp_id, decided_at: now(), applied_row_id: rowId,
  }, { id: s.id });
  logAudit({ actor: user, action: 'directory_suggestion_approve', entityType: 'payer_directory_suggestion', entityId: s.id, details: { payer_id: payer.id, applied: cmp.action } });
  return '';
}

export async function rejectSuggestion(s, reason, user) {
  const ok = await S.update('payer_directory_suggestions', { status: 'rejected', reason: reason?.trim() || null, decided_by: user.emp_id, decided_at: now() }, { id: s.id });
  if (ok) logAudit({ actor: user, action: 'directory_suggestion_reject', entityType: 'payer_directory_suggestion', entityId: s.id });
  return !!ok;
}

// ── Opening the review tab from the payer card ─────────────────────────────

let openNext = false;
/** “Review” on the payer card: go to Payer Updates → 🛠 Directory suggestions. */
export function openSuggestions() {
  openNext = true;
  window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_updates' }));
}
export const peekOpenSuggestions = () => openNext;
export function clearOpenSuggestions() { openNext = false; }
