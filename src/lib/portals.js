// Portal launchpad (roadmap 6.6): every login link a client's work needs, in one place.
// Links come from the SOP Library software (3.1), the Payer Directory portal links (1.1) and a manager's own links.
// NEVER credentials — no username / password is stored, and access notes that mention passwords are refused.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { daysBetween } from './deadlines';
import { today } from './helpers';

export const PORTAL_RECHECK_DAYS = 180;
export const PORTAL_GROUPS = [
  { value: 'software', label: 'Client software', icon: '💻', hint: 'EMR, clearinghouse, Medicare DDE…' },
  { value: 'payer',    label: 'Payer portals',   icon: '🏥', hint: 'Claim status, eligibility, appeals' },
  { value: 'custom',   label: 'Other links',     icon: '🔗', hint: 'Fax portal, document drop…' },
];

const now = () => new Date().toISOString();

// ── Links ──────────────────────────────────────────────────────────────────

/** A clean http(s) link, or null when it isn't one (adds https:// when missing; refuses user:password@ links). */
export function cleanUrl(text) {
  const t = (text ?? '').trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.href;
  } catch { return null; }
}

// Passwords never go into Helix Hub — not in a note and not inside a link
const SECRET_WORDS = /\b(password|passwd|passcode|passphrase|pwd)\b|\bpin\s*[:=#]|[?&](pass|pwd|password|token)=/i;
export const mentionsSecret = text => SECRET_WORDS.test(text ?? '');

/** true when the link has never been checked or was last checked more than 180 days ago. */
export const needsRecheck = row => !row?.verified_at || daysBetween(row.verified_at.slice(0, 10), today()) > PORTAL_RECHECK_DAYS;

// ── Loading ────────────────────────────────────────────────────────────────

/**
 * Everything the launchpad needs. rows = null until the 6.6 database update has been run.
 * software / tasks / sops come from the SOP Library (empty if not set up); contacts = Payer Directory rows with a portal.
 */
export async function loadLaunchpad() {
  const [rows, software, tasks, sops, contacts] = await Promise.all([
    db('client_portals').select('*'),
    db('sop_software').select('id,name,vendor,portal_url,category_id,active'),
    db('sop_tasks').select('id,software_id,active'),
    db('sops').select('id,task_id,client_id,status,active'),
    db('payer_contacts').select('id,payer_id,department,portal_url,active').not('portal_url', 'is', null),
  ]);
  const ok = r => (r.error ? [] : r.data ?? []);
  return {
    rows: rows.error ? null : rows.data ?? [],
    software: ok(software).filter(s => s.active !== false),
    tasks: ok(tasks).filter(t => t.active !== false),
    sops: ok(sops).filter(s => s.active !== false),
    contacts: ok(contacts).filter(c => c.active !== false && c.portal_url?.trim()),
  };
}

// Claims portal first, then appeals, then any other department
const DEPT_ORDER = ['claims', 'appeals', 'eligibility', 'auth', 'provider_relations'];
const deptRank = d => { const i = DEPT_ORDER.indexOf(d); return i < 0 ? DEPT_ORDER.length : i; };

/** The Payer Directory portal link for a payer (claims department preferred), or null. */
export function directoryPortal(data, payerId) {
  const list = data.contacts.filter(c => c.payer_id === payerId).sort((a, b) => deptRank(a.department) - deptRank(b.department));
  return list[0] ?? null;
}

/** How many SOPs the readers can open for a software (common + this client's). */
function sopCount(data, softwareId, clientId, canSeeDrafts) {
  const taskIds = new Set(data.tasks.filter(t => t.software_id === softwareId).map(t => t.id));
  return data.sops.filter(s => taskIds.has(s.task_id) && (canSeeDrafts || s.status === 'published')
    && (s.client_id == null || s.client_id === clientId)).length;
}

/**
 * Tiles for one client: [{ key, group, name, sub, url, note, softwareId, sopCount, row, standard }].
 * With the 6.6 table: this client's links + the all-client links (showInactive for managers).
 * Without it (or `fallback`): every software login link + every Payer Directory portal link, read-only.
 */
export function buildTiles(data, payers, { clientId = null, showInactive = false, canSeeDrafts = false } = {}) {
  const swById = Object.fromEntries(data.software.map(s => [s.id, s]));
  const payerById = Object.fromEntries((payers ?? []).map(p => [p.id, p]));
  const tiles = [];

  if (data.rows == null) {
    for (const s of data.software) {
      if (!s.portal_url) continue;
      tiles.push({ key: `s${s.id}`, group: 'software', name: s.name, sub: s.vendor, url: cleanUrl(s.portal_url), note: null,
        softwareId: s.id, sopCount: sopCount(data, s.id, clientId, canSeeDrafts), row: null, standard: true });
    }
    const seen = new Set();
    for (const c of [...data.contacts].sort((a, b) => deptRank(a.department) - deptRank(b.department))) {
      if (seen.has(c.payer_id) || !payerById[c.payer_id]) continue;
      seen.add(c.payer_id);
      tiles.push({ key: `c${c.id}`, group: 'payer', name: payerById[c.payer_id].name, sub: payerById[c.payer_id].payer_type,
        url: cleanUrl(c.portal_url), note: null, softwareId: null, sopCount: 0, row: null, standard: true });
    }
    return tiles;
  }

  for (const r of data.rows) {
    if (r.client_id != null && r.client_id !== clientId) continue;
    if (r.active === false && !showInactive) continue;
    let name = r.label?.trim() || '';
    let sub = null;
    let standardUrl = null;
    if (r.kind === 'software') {
      const s = swById[r.software_id];
      name ||= s?.name ?? 'Software (removed)';
      sub = s?.vendor ?? null;
      standardUrl = s?.portal_url ?? null;
    } else if (r.kind === 'payer') {
      const p = payerById[r.payer_id];
      name ||= p?.name ?? 'Payer (removed)';
      sub = p?.payer_type ?? null;
      standardUrl = directoryPortal(data, r.payer_id)?.portal_url ?? null;
    }
    tiles.push({
      key: `p${r.id}`, group: r.kind, name, sub, url: cleanUrl(r.url || standardUrl), note: r.access_note,
      softwareId: r.kind === 'software' ? r.software_id : null,
      sopCount: r.kind === 'software' ? sopCount(data, r.software_id, clientId, canSeeDrafts) : 0,
      row: r, standard: !r.url, allClients: r.client_id == null,
    });
  }
  return tiles;
}

// ── ⭐ Favourites (this browser only — a convenience, no claim data) ─────────

const starKey = empId => `hh_portal_stars_${empId}`;
export function readStars(empId) {
  try { return new Set(JSON.parse(localStorage.getItem(starKey(empId)) || '[]')); } catch { return new Set(); }
}
export function writeStars(empId, stars) {
  try { localStorage.setItem(starKey(empId), JSON.stringify([...stars])); } catch { /* storage blocked */ }
}

/** Starred first, then the manager's order, then by name. */
export function sortTiles(tiles, stars) {
  return [...tiles].sort((a, b) => (stars.has(b.key) - stars.has(a.key))
    || ((a.row?.sort_order ?? 0) - (b.row?.sort_order ?? 0))
    || a.name.localeCompare(b.name));
}

// ── Changes (managers: “Manage portal links”) ──────────────────────────────

/** Checks a link before saving. Returns an error message or ''. */
export function checkPortal(p) {
  if (p.kind === 'software' && !p.software_id) return 'Choose the software.';
  if (p.kind === 'payer' && !p.payer_id) return 'Choose the payer.';
  if (p.kind === 'custom' && !p.label?.trim()) return 'Type a name for the link.';
  if (p.kind === 'custom' && !p.url?.trim()) return 'Type the link.';
  if (p.url?.trim() && !cleanUrl(p.url)) return 'That doesn’t look like a web link (https://…). Links with a user name or password in them are not allowed.';
  if (mentionsSecret(p.access_note) || mentionsSecret(p.url) || mentionsSecret(p.label)) {
    return 'Never put passwords or PINs in Helix Hub. Say how to get access instead (e.g. “Ask your supervisor”).';
  }
  return '';
}

const fields = p => ({
  client_id: p.client_id ?? null, kind: p.kind, software_id: p.kind === 'software' ? p.software_id : null,
  payer_id: p.kind === 'payer' ? p.payer_id : null, label: p.label?.trim() || null,
  url: p.url?.trim() ? cleanUrl(p.url) : null, access_note: p.access_note?.trim() || null,
});

export async function addPortal(p, user, sortOrder = 0) {
  const rows = await S.set('client_portals', {
    ...fields(p), sort_order: sortOrder, verified_at: now(), verified_by: user.emp_id,
    created_by: user.emp_id, updated_by: user.emp_id,
  });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: 'portal_add', entityType: 'client_portal', entityId: rows[0].id });
  return rows[0];
}

export async function editPortal(row, p, user) {
  const ok = await S.update('client_portals', { ...fields(p), updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'portal_edit', entityType: 'client_portal', entityId: row.id });
  return !!ok;
}

export async function verifyPortal(row, user) {
  const ok = await S.update('client_portals', { verified_at: now(), verified_by: user.emp_id }, { id: row.id });
  if (ok) logAudit({ actor: user, action: 'portal_verify', entityType: 'client_portal', entityId: row.id });
  return !!ok;
}

export async function setPortalActive(row, active, user) {
  const ok = await S.update('client_portals', { active, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (ok) logAudit({ actor: user, action: active ? 'portal_activate' : 'portal_deactivate', entityType: 'client_portal', entityId: row.id });
  return !!ok;
}

/** Moves a link up / down within its group (rewrites sort_order for that group's links). */
export async function movePortal(groupRows, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= groupRows.length) return false;
  const list = [...groupRows];
  [list[index], list[to]] = [list[to], list[index]];
  const changes = list.map((r, i) => ({ r, i })).filter(({ r, i }) => (r.sort_order ?? 0) !== i);
  const results = await Promise.all(changes.map(({ r, i }) => S.update('client_portals', { sort_order: i }, { id: r.id })));
  return results.every(Boolean);
}
