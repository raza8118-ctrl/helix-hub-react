// SOP Library (roadmap Phase 3) — Category → Software → Task → SOP.
// Shared by the library page and its editor pop-ups. No patient data (PHI) is stored here.
import { db } from './supabase';

export const SOP_STATUSES = [
  { value: 'draft',     label: 'Draft',     badge: 'badge-yellow' },
  { value: 'published', label: 'Published', badge: 'badge-green' },
];
export const statusOf = value => SOP_STATUSES.find(s => s.value === value) ?? SOP_STATUSES[0];

// Starting categories — the migration seeds them for 3Gen; added companies get an "Add" button
export const STARTER_CATEGORIES = ['EMR', 'Clearinghouse', 'Payments/ERA', 'Payer portals', 'Medicare DDE', 'Other'];

// Standard software (roadmap 3.7) — offered by "Add standard software". Login links are left for editors to add
// (many are client-specific). category must be one of STARTER_CATEGORIES.
export const STARTER_SOFTWARE = [
  { category: 'EMR',           name: 'WellSky (Kinnser)',        vendor: 'Home health / hospice EMR' },
  { category: 'EMR',           name: 'Axxess',                   vendor: 'Home health / hospice EMR' },
  { category: 'EMR',           name: 'HCHB',                     vendor: 'Homecare Homebase', notes: 'Login link is client-specific.' },
  { category: 'Clearinghouse', name: 'Waystar',                  vendor: 'Claims, claim status, remits' },
  { category: 'Clearinghouse', name: 'Inovalon',                 vendor: 'ABILITY network — clearinghouse and Medicare system access' },
  { category: 'Payments/ERA',  name: 'ECHO Health',              vendor: 'Virtual card / EFT payments and ERAs' },
  { category: 'Payments/ERA',  name: 'PaySpan',                  vendor: 'EFT / ERA enrolment and remits' },
  { category: 'Payer portals', name: 'Availity',                 vendor: 'Multi-payer portal (eligibility, claims, auths)' },
  { category: 'Payer portals', name: 'NaviNet',                  vendor: 'Multi-payer portal' },
  { category: 'Payer portals', name: 'Palmetto GBA eServices',   vendor: 'Medicare MAC portal' },
  { category: 'Payer portals', name: 'myCGS',                    vendor: 'Medicare MAC portal' },
  { category: 'Payer portals', name: 'NGSConnex',                vendor: 'Medicare MAC portal' },
  { category: 'Medicare DDE',  name: 'FISS DDE – Palmetto GBA',  vendor: 'Medicare Part A incl. home health & hospice' },
  { category: 'Medicare DDE',  name: 'FISS DDE – CGS',           vendor: 'Medicare Part A incl. home health & hospice' },
  { category: 'Medicare DDE',  name: 'FISS DDE – NGS',           vendor: 'Medicare Part A incl. home health & hospice' },
];

/** Standard software not yet in the library (same name in any category, any letter case, counts as present). */
export function missingStarterSoftware(lib) {
  const have = new Set((lib?.software ?? []).map(sw => (sw.name ?? '').trim().toLowerCase()));
  return STARTER_SOFTWARE.filter(s => !have.has(s.name.toLowerCase()));
}

// One entry per level: its table, parent link and the fields its editor pop-up shows
export const SOP_LEVELS = {
  category: {
    table: 'sop_categories', one: 'Category', entity: 'sop_category', parentKey: null, nameKey: 'name',
    fields: [{ key: 'name', label: 'Category name', required: true, hint: 'e.g. Clearinghouse' }],
  },
  software: {
    table: 'sop_software', one: 'Software', entity: 'sop_software', parentKey: 'category_id', nameKey: 'name',
    fields: [
      { key: 'category_id', label: 'Category', type: 'parent', required: true },
      { key: 'name',        label: 'Software name', required: true, hint: 'e.g. Waystar' },
      { key: 'vendor',      label: 'Vendor / also known as', hint: 'e.g. WellSky (Kinnser)' },
      { key: 'portal_url',  label: 'Login page link', hint: 'https://… (never put passwords here)' },
      { key: 'notes',       label: 'Notes', type: 'textarea', hint: 'Who has access, which clients use it…' },
    ],
  },
  task: {
    table: 'sop_tasks', one: 'Task', entity: 'sop_task', parentKey: 'software_id', nameKey: 'name',
    fields: [
      { key: 'software_id', label: 'Software', type: 'parent', required: true },
      { key: 'name',        label: 'Task name', required: true, hint: 'e.g. Check claim status' },
    ],
  },
  sop: {
    table: 'sops', one: 'SOP', entity: 'sop', parentKey: 'task_id', nameKey: 'title',
    fields: [
      { key: 'task_id', label: 'Task', type: 'parent', required: true },
      { key: 'title',   label: 'SOP title', required: true, hint: 'e.g. Claim status check in Waystar' },
      { key: 'summary', label: 'Short summary', type: 'textarea', hint: 'One or two lines: what this SOP covers' },
      { key: 'owner',   label: 'Owner (keeps it up to date)', type: 'user' },
      // 3.4: null = common SOP for all clients. Shown once the 3.4 database update has been run.
      { key: 'client_id', label: 'Applies to', type: 'client', needsVersions: true },
      // Before 3.4 the status was set by hand; with versions it follows "Publish new version"
      { key: 'status',  label: 'Status', type: 'select', options: SOP_STATUSES, hideWithVersions: true },
    ],
  },
};

/** The editor fields that apply, depending on whether the 3.4 database update has been run. */
export const activeFields = (level, versionsReady) => SOP_LEVELS[level].fields
  .filter(f => !(f.needsVersions && !versionsReady) && !(f.hideWithVersions && versionsReady));

/**
 * All four tables (plus the clients list when available), or null when the 3.1 database update hasn't been run yet.
 */
export async function loadSopLibrary() {
  const tables = ['sop_categories', 'sop_software', 'sop_tasks', 'sops'];
  const [results, clients] = await Promise.all([
    Promise.all(tables.map(t => db(t).select('*'))),
    db('clients').select('id,name,active'),
  ]);
  if (results.some(r => r.error)) return null;
  const [categories, software, tasks, sops] = results.map(r => r.data ?? []);
  const clientList = (clients.data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return { categories, software, tasks, sops, clients: clientList };
}

// Client-specific SOPs first (3.4), then the manual order
const bySort = (a, b) => (b.client_id != null) - (a.client_id != null)
  || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  || (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? '');

const has = (text, q) => (text ?? '').toLowerCase().includes(q);

/**
 * Nested Category → Software → Task → SOP tree for display.
 * opts: query (search text), categoryId ('ALL' or id), showInactive, canSeeDrafts, status ('ALL' | 'draft' | 'published'),
 * clientId ('ALL' or a client id → that client's SOPs plus the common ones).
 * While searching, only matching branches are kept: a software/task whose own name matches keeps everything under it.
 */
export function buildSopTree(lib, { query = '', categoryId = 'ALL', showInactive = false, canSeeDrafts = false, status = 'ALL', clientId = 'ALL' } = {}) {
  const q = query.trim().toLowerCase();
  const visible = r => showInactive || r.active !== false;
  const sopVisible = s => visible(s)
    && (canSeeDrafts || s.status === 'published')
    && (status === 'ALL' || s.status === status)
    && (clientId === 'ALL' || s.client_id == null || String(s.client_id) === String(clientId));

  return lib.categories
    .filter(visible)
    .filter(c => categoryId === 'ALL' || String(c.id) === String(categoryId))
    .sort(bySort)
    .map(cat => {
      const catHit = q && has(cat.name, q);
      const software = lib.software
        .filter(sw => sw.category_id === cat.id && visible(sw))
        .sort(bySort)
        .map(sw => {
          const swHit = catHit || (q && (has(sw.name, q) || has(sw.vendor, q)));
          const tasks = lib.tasks
            .filter(t => t.software_id === sw.id && visible(t))
            .sort(bySort)
            .map(t => {
              const taskHit = swHit || (q && has(t.name, q));
              const sops = lib.sops
                .filter(s => s.task_id === t.id && sopVisible(s))
                .sort(bySort)
                .filter(s => !q || taskHit || has(s.title, q) || has(s.summary, q));
              return { ...t, sops, keep: !q || taskHit || sops.length > 0 };
            })
            .filter(t => t.keep);
          return { ...sw, tasks, keep: !q || swHit || tasks.length > 0 };
        })
        .filter(sw => sw.keep);
      return { ...cat, software, keep: !q || catHit || software.length > 0 };
    })
    .filter(c => c.keep);
}

/** Total SOPs in a (sub)tree — for the counts next to each heading. */
export const countSops = node =>
  node.sops ? node.sops.length
  : (node.tasks ?? node.software ?? []).reduce((n, child) => n + countSops(child), 0);

// ── SOP page template (roadmap 3.2) ─────────────────────────────────────────

// Text sections of an SOP page, in display order (Steps and Who uses it are drawn separately)
export const SOP_SECTIONS = [
  { key: 'purpose',         label: 'Purpose',             hint: 'Why this SOP exists and when to use it' },
  { key: 'audience',        label: 'Who uses it' },
  { key: 'prerequisites',   label: 'Before you start',    hint: 'Access, documents or information you need first' },
  { key: 'steps',           label: 'Steps' },
  { key: 'expected_result', label: 'What you should see', hint: 'The result that tells you it worked' },
  { key: 'troubleshooting', label: 'If it goes wrong',    hint: 'Common problems and what to do about each' },
];

// An SOP should be checked again this many days after it was last verified
export const SOP_RECHECK_DAYS = 180;

/** True once the 3.2 database update has been run (the template columns come back with the row). */
export const hasSopTemplate = sop => sop != null && 'steps' in sop;

/**
 * Steps as a clean list — company copies made by "Sync structure" may hold null.
 * Each step: { text, tip, images: [{ path, width, height }], video: { path, duration } | null } (media from 3.3).
 */
export const sopSteps = sop => (Array.isArray(sop?.steps) ? sop.steps : [])
  .map(s => ({
    text: s?.text ?? '',
    tip: s?.tip ?? '',
    images: (Array.isArray(s?.images) ? s.images : s?.image ? [s.image] : []).filter(img => img?.path),
    video: s?.video?.path ? s.video : null,
  }));

/** True once the 3.3 database update has been run (screenshots / videos can be stored). */
export const hasSopMedia = sop => sop != null && 'walkthrough_video' in sop;

/** True when the SOP has never been verified, or not within SOP_RECHECK_DAYS. */
export function sopNeedsRecheck(sop) {
  if (!sop?.last_verified_at) return true;
  return Date.now() - new Date(sop.last_verified_at).getTime() > SOP_RECHECK_DAYS * 86400000;
}

/** Whether a template section has anything in it (empty ones are hidden from readers). */
export function sopSectionFilled(sop, key) {
  if (key === 'audience') return (sop.audience_teams ?? []).length > 0 || !!sop.audience_notes?.trim();
  if (key === 'steps') return sopSteps(sop).some(s => s.text.trim());
  return !!sop[key]?.trim();
}

// ── Opening the library from another page (6.6 Portal launchpad “📚 How-to”) ──

let searchNext = '';
/** Opens the SOP Library with this search typed in (e.g. a software name → all its tasks and SOPs). */
export function openSopLibrary(query) {
  searchNext = query ?? '';
  window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_sops' }));
}
/** The waiting search; cleared once the library has shown it. */
export const peekSopLibrarySearch = () => searchNext;
export function clearSopLibrarySearch() { searchNext = ''; }
