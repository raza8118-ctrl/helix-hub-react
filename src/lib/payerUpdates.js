// Payer Updates Feed (roadmap 8.1): upload a payer bulletin PDF → Claude extracts one row per change (payer, effective
// date, what changed, category, teams affected, action needed) → reviewed and saved. Bulletins hold no patient data:
// the uploader confirms that every time and the PDF text is scanned locally for patient words before anything is sent.
// Only the PDF and the fixed instructions below go to the AI (browser call with the Settings key, same as 5.3).
import { supabase, db, S, getTablePrefix } from './supabase';
import { logAudit } from './audit';
import { assertAiAllowed } from './companyFeatures';
import { aiFetch } from './ai';
import { hasAccess } from './access';
import { loadPdfjs } from './pdfjs';
import { matchPayerName } from './worklist';
import { TEAMS } from './constants';
import { addDays, today } from './helpers';
import { daysBetween } from './deadlines';

const BUCKET = 'payer-bulletins';
const MODEL = 'claude-opus-5-5';
export const MAX_BULLETIN_BYTES = 30 * 1024 * 1024;
export const MAX_BULLETIN_PAGES = 100;

export const UPDATE_CATEGORIES = [
  { value: 'billing',       label: 'Billing / claims' },
  { value: 'authorization', label: 'Authorization' },
  { value: 'coding',        label: 'Coding' },
  { value: 'fee_schedule',  label: 'Fee schedule / payment' },
  { value: 'policy',        label: 'Policy / coverage' },
  { value: 'forms_portals', label: 'Forms / portals' },
  { value: 'credentialing', label: 'Credentialing' },
  { value: 'other',         label: 'Other' },
];
export const categoryLabel = v => UPDATE_CATEGORIES.find(c => c.value === v)?.label ?? 'Other';

export const canEditUpdates = user => hasAccess(user, 'payer_updates_edit');
const now = () => new Date().toISOString();
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

// ── Patient-word scan (in the browser — nothing is sent) ───────────────────

const PATIENT_WORDS = /\b(patient\s*name|date\s*of\s*birth|d\.o\.b\.?|dob|member\s*(id|#|number)|subscriber\s*(id|#)|mbi|hicn|mrn|medical\s*record\s*(number|#)|ssn|social\s*security)\b/gi;

/** Checks a PDF before upload: { pages, hits: [{ page, words }] } or { error }. */
export async function scanBulletin(file) {
  if (!file) return { error: 'Choose a PDF.' };
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return { error: 'Only PDF bulletins can be uploaded.' };
  if (file.size > MAX_BULLETIN_BYTES) return { error: 'The PDF is larger than 30 MB.' };
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    if (doc.numPages > MAX_BULLETIN_PAGES) return { error: `The PDF has ${doc.numPages} pages — the limit is ${MAX_BULLETIN_PAGES}. Split it in File Tools first.` };
    const hits = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const text = (await (await doc.getPage(p)).getTextContent()).items.map(i => i.str).join(' ');
      const words = [...new Set([...text.matchAll(PATIENT_WORDS)].map(m => m[0].toLowerCase()))];
      if (words.length) hits.push({ page: p, words });
    }
    return { pages: doc.numPages, hits };
  } catch {
    return { error: 'This PDF could not be read. It may be damaged or password-protected.' };
  }
}

// ── AI extraction ──────────────────────────────────────────────────────────

const SYSTEM = `You read payer bulletins, provider newsletters and policy updates for a US healthcare revenue-cycle company
that bills home health, hospice and other agencies. Your readers are AR callers, authorization, billing / payment
posting, coding and credentialing staff who need to know what changed and what to do.

Return one row per distinct change that affects how claims are billed, authorized, coded, paid, appealed or credentialed.
Skip marketing, greetings, event invitations and general news that needs no action.

For each row:
- payer_name: the payer or plan the change applies to, as written (use the bulletin's issuer if the change is general).
- effective_date: YYYY-MM-DD when the bulletin states one; "" when it does not. Never guess a date.
- change: what changed, in plain English, one or two short sentences.
- category: the closest category.
- teams: the teams that must act or know (one or more).
- action_needed: what our staff should do differently, starting with a verb; "" if it is information only.
- source_page: the PDF page number the change is on (1-based).

Also return the bulletin's title, issuer and published date (YYYY-MM-DD or ""). Use only what the document says.`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    issuer: { type: 'string' },
    published_date: { type: 'string' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          payer_name: { type: 'string' },
          effective_date: { type: 'string' },
          change: { type: 'string' },
          category: { type: 'string', enum: UPDATE_CATEGORIES.map(c => c.value) },
          teams: { type: 'array', items: { type: 'string', enum: TEAMS } },
          action_needed: { type: 'string' },
          source_page: { type: 'integer' },
        },
        required: ['payer_name', 'effective_date', 'change', 'category', 'teams', 'action_needed', 'source_page'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'issuer', 'published_date', 'rows'],
  additionalProperties: false,
};

const toBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(new Error('The PDF could not be read.'));
  r.readAsDataURL(file);
});

/**
 * Sends the bulletin PDF to Claude. Returns { bulletin: { title, issuer, published_on }, rows } with payers matched
 * to the Payer Directory, or throws Error with a plain-English message (NO_KEY when no AI key is saved in Settings).
 */
export async function extractBulletin(file, payers, pages, user) {
  assertAiAllowed();   // Owner Console: AI can be switched off per company
  let ok = false;
  let found = 0;
  try {
    const data = await toBase64(file);
    // Stage 4: through the helix-ai server function — the key stays on the server (NO_KEY thrown when none is saved)
    const res = await aiFetch({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
          { type: 'text', text: 'Extract the changes from this payer bulletin.' },
        ],
      }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(res.status === 401 ? 'The AI key in Settings was rejected — an admin needs to update it.'
        : res.status === 429 ? 'The AI service is busy — please try again in a minute.'
        : res.status === 413 ? 'The PDF is too large for the AI — split it in File Tools and upload the parts.'
        : err.error?.message ?? `AI request failed (${res.status}).`);
    }
    const json = await res.json();
    if (json.stop_reason === 'refusal') throw new Error('The AI declined to read this document — add the rows by hand.');
    if (json.stop_reason === 'max_tokens') throw new Error('The bulletin has too many changes for one read — split the PDF in File Tools and upload the parts.');
    const text = [...(json.content ?? [])].reverse().find(b => b.type === 'text')?.text;
    let parsed;
    try { parsed = JSON.parse(text ?? ''); } catch { throw new Error('The AI answer couldn’t be read — please try again.'); }
    const rows = (parsed.rows ?? []).map(r => {
      const payer = matchPayerName(payers, r.payer_name);
      return {
        key: Math.random().toString(36).slice(2), payer_id: payer?.id ?? null, payer_name: String(r.payer_name ?? '').trim(),
        effective_date: isYmd(r.effective_date) ? r.effective_date : '', change_text: String(r.change ?? '').trim(),
        category: UPDATE_CATEGORIES.some(c => c.value === r.category) ? r.category : 'other',
        teams: (r.teams ?? []).filter(t => TEAMS.includes(t)), action_needed: String(r.action_needed ?? '').trim(),
        source_page: Number.isInteger(r.source_page) && r.source_page > 0 ? r.source_page : null,
      };
    }).filter(r => r.change_text);
    found = rows.length;
    ok = true;
    return {
      bulletin: { title: String(parsed.title ?? '').trim(), issuer: String(parsed.issuer ?? '').trim(), published_on: isYmd(parsed.published_date) ? parsed.published_date : '' },
      rows,
    };
  } finally {
    // Usage record only — never the bulletin text
    logAudit({ actor: user, action: 'bulletin_extract_ai', entityType: 'payer_bulletin', details: { pages, rows: found, ok } });
  }
}

/** An empty row for adding by hand. */
export const blankUpdate = () => ({
  key: Math.random().toString(36).slice(2), payer_id: null, payer_name: '', effective_date: '', change_text: '',
  category: 'other', teams: [], action_needed: '', source_page: null,
});

/** Rows needing attention before saving: { [key]: ['payer', 'date'] }. */
export function rowWarnings(rows) {
  return Object.fromEntries(rows.map(r => [r.key, [!r.payer_id && !r.payer_name.trim() && 'payer', !r.effective_date && 'date'].filter(Boolean)]));
}

// ── Saving & loading ───────────────────────────────────────────────────────

/**
 * Loads bulletins + their active rows, or null when the 8.1 database update hasn't been run.
 * includeRetired (8.2): also the retired changes (the search list shows them on request).
 */
export async function loadBulletins({ includeRetired = false } = {}) {
  const { data, error } = await db('payer_bulletins').select('*').order('uploaded_at', { ascending: false }).limit(300);
  if (error) return null;
  const ids = (data ?? []).map(b => b.id);
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    let q = db('payer_updates').select('*').in('bulletin_id', ids.slice(i, i + 200));
    if (!includeRetired) q = q.eq('status', 'active');
    const { data: u } = await q;
    rows.push(...(u ?? []));
  }
  return (data ?? []).map(b => ({ ...b, updates: rows.filter(r => r.bulletin_id === b.id) }));
}

async function uploadPdf(file) {
  const prefix = getTablePrefix();
  const folder = prefix ? `${prefix.replace(/_+$/, '')}/` : '';
  const path = `${folder}${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: 'application/pdf' });
  if (error) { console.error('bulletin upload error', error.message); return null; }
  return path;
}

/** Checks the bulletin + rows before saving. Returns an error message or ''. */
export function checkBulletin(bulletin, rows) {
  if (!bulletin.title?.trim()) return 'Type the bulletin title.';
  if (!rows.length) return 'Add at least one change.';
  const bad = rows.findIndex(r => !r.change_text.trim());
  if (bad >= 0) return `Row ${bad + 1}: say what changed (or delete the row).`;
  return '';
}

/** Uploads the PDF, saves the bulletin and its rows. Returns the bulletin or null. */
export async function saveBulletin(file, bulletin, rows, { pages, ai }, user) {
  const path = await uploadPdf(file);
  if (!path) return null;
  const saved = (await S.set('payer_bulletins', {
    title: bulletin.title.trim(), issuer: bulletin.issuer?.trim() || null, published_on: bulletin.published_on || null,
    file_path: path, file_name: file.name, pages: pages ?? null, extracted_by_ai: !!ai, uploaded_by: user.emp_id, updated_by: user.emp_id,
  }))?.[0];
  if (!saved) return null;
  const ok = await S.set('payer_updates', rows.map(r => ({
    bulletin_id: saved.id, payer_id: r.payer_id || null, payer_name: r.payer_name.trim() || null,
    effective_date: r.effective_date || null, change_text: r.change_text.trim(), category: r.category || 'other',
    teams: r.teams ?? [], action_needed: r.action_needed?.trim() || null, source_page: r.source_page || null,
    created_by: user.emp_id, updated_by: user.emp_id,
  })));
  if (!ok) return null;
  logAudit({ actor: user, action: 'bulletin_save', entityType: 'payer_bulletin', entityId: saved.id, details: { rows: rows.length, ai: !!ai } });
  changed();   // 8.2: sidebar count
  return saved;
}

/** Short-lived (60 s) link to open the PDF, or null. */
export async function bulletinLink(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) { console.error('bulletinLink error', error.message); return null; }
  return data?.signedUrl ?? null;
}

/** Turns a bulletin off (hidden from the feed; never deleted). */
export async function setBulletinActive(b, active, user) {
  const ok = await S.update('payer_bulletins', { active, updated_by: user.emp_id, updated_at: now() }, { id: b.id });
  if (ok) logAudit({ actor: user, action: active ? 'bulletin_activate' : 'bulletin_deactivate', entityType: 'payer_bulletin', entityId: b.id });
  return !!ok;
}

// ── Feed: for my team, reads, search (roadmap 8.2) ─────────────────────────

export const NEW_DAYS = 30;            // “For my team” = changes added in the last 30 days
export const SOON_DAYS = 14;           // “Starts in N days” badge
export const EFFECTIVE_FILTERS = [
  { value: 'ANY',    label: 'Any date' },
  { value: 'NEXT30', label: 'Next 30 days' },
  { value: 'NOW',    label: 'Already in effect' },
  { value: 'FUTURE', label: 'Future' },
];
const changed = () => window.dispatchEvent(new Event('helix:payer-updates-changed'));   // refreshes the sidebar count

/** A change concerns a person when it lists their team, lists no team, or the person has no team. */
export const forTeam = (u, team) => !team || !(u.teams ?? []).length || u.teams.includes(team);
/** Days until the change takes effect (negative = already in effect), or null without a date. */
export const startsIn = u => (u.effective_date ? daysBetween(today(), u.effective_date) : null);
export const isNew = u => u.created_at >= new Date(`${addDays(today(), -NEW_DAYS)}T00:00:00`).toISOString();

export function matchesEffective(u, filter) {
  const d = startsIn(u);
  if (filter === 'ANY') return true;
  if (d == null) return false;
  if (filter === 'NEXT30') return d >= 0 && d <= 30;
  if (filter === 'NOW') return d <= 0;
  return d > 0;
}

/** Every read: { [update_id]: [emp_id] } — or {} when the 8.2 database update hasn't been run. */
export async function loadReads() {
  const out = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db('payer_update_reads').select('update_id,emp_id').range(from, from + 999);
    if (error) return from === 0 ? null : out;
    for (const r of data ?? []) (out[r.update_id] ??= []).push(r.emp_id);
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function markUpdateRead(u, user) {
  const ok = await S.set('payer_update_reads', { update_id: u.id, emp_id: user.emp_id, read_at: new Date().toISOString() }, ['update_id', 'emp_id']);
  if (ok) { logAudit({ actor: user, action: 'payer_update_read', entityType: 'payer_update', entityId: u.id }); changed(); }
  return !!ok;
}

/** New changes for this person not yet read — for the sidebar count. 0 if not set up. */
export async function unreadForMe(user) {
  const since = new Date(`${addDays(today(), -NEW_DAYS)}T00:00:00`).toISOString();
  const [ups, reads, bulletins] = await Promise.all([
    db('payer_updates').select('id,teams,bulletin_id').eq('status', 'active').gte('created_at', since),
    db('payer_update_reads').select('update_id').eq('emp_id', user.emp_id),
    db('payer_bulletins').select('id').eq('active', false),
  ]);
  if (ups.error || reads.error) return 0;
  const read = new Set((reads.data ?? []).map(r => r.update_id));
  const off = new Set((bulletins.data ?? []).map(b => b.id));
  return (ups.data ?? []).filter(u => !off.has(u.bulletin_id) && !read.has(u.id) && forTeam(u, user.team)).length;
}

export async function editUpdate(u, v, user) {
  const ok = await S.update('payer_updates', {
    payer_id: v.payer_id || null, payer_name: v.payer_name?.trim() || null, effective_date: v.effective_date || null,
    change_text: v.change_text.trim(), category: v.category || 'other', teams: v.teams ?? [], action_needed: v.action_needed?.trim() || null,
    updated_by: user.emp_id, updated_at: new Date().toISOString(),
  }, { id: u.id });
  if (ok) { logAudit({ actor: user, action: 'payer_update_edit', entityType: 'payer_update', entityId: u.id }); changed(); }
  return !!ok;
}

export async function retireUpdate(u, retire, user) {
  const ok = await S.update('payer_updates', { status: retire ? 'retired' : 'active', updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: u.id });
  if (ok) { logAudit({ actor: user, action: retire ? 'payer_update_retire' : 'payer_update_restore', entityType: 'payer_update', entityId: u.id }); changed(); }
  return !!ok;
}
