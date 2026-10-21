// 📌 Notice Board (roadmap 10.3): lasting notices by category and audience, with show-from / until dates, pinning and
// must-read tracking. Beside the existing Announcements (which are not changed). Text is checked for patient details.
// Never deleted — archiving turns a notice off.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { hasAccess } from './access';
import { today } from './helpers';
import { phiIssues } from './appealAI';

export const CATEGORIES = [
  { value: 'process', label: 'Process change',    icon: '🔧' },
  { value: 'client',  label: 'Client news',       icon: '🏢' },
  { value: 'payer',   label: 'Payer news',        icon: '🏥' },
  { value: 'system',  label: 'System / IT',       icon: '💻' },
  { value: 'hr',      label: 'HR / events',       icon: '🎉' },
  { value: 'wins',    label: 'Wins & shout-outs', icon: '🏆' },
];
export const categoryOf = v => CATEGORIES.find(c => c.value === v) ?? CATEGORIES[0];

const now = () => new Date().toISOString();
const changed = () => window.dispatchEvent(new Event('helix:board-changed'));   // refreshes the sidebar count

/** Post / edit notices: “Post to the notice board”. Everyone as audience: admins / managers or “Post Announcements”. */
export const canPost = user => hasAccess(user, 'board_post');
export const canPostEveryone = user => ['admin', 'manager'].includes(user?.role) || hasAccess(user, 'page_announcements');

/** Showing now: not archived, show-from reached, until not passed. */
export const isLive = n => n.active !== false && n.show_from <= today() && (!n.show_until || n.show_until >= today());
/** For this person: no team picked (everyone), the person's team listed, or the person has no team. */
export const forMe = (n, user) => !(n.teams ?? []).length || !user.team || n.teams.includes(user.team);

// ── Loading ────────────────────────────────────────────────────────────────

/** { notices, reads: { notice_id: [emp_id] } }, or null when the 10.3 database update hasn't been run. */
export async function loadBoard() {
  const [n, r] = await Promise.all([db('board_notices').select('*'), db('board_reads').select('notice_id,emp_id')]);
  if (n.error) return null;
  const reads = {};
  for (const x of r.data ?? []) (reads[x.notice_id] ??= []).push(x.emp_id);
  return {
    notices: (n.data ?? []).sort((a, b) => (b.pinned - a.pinned) || b.show_from.localeCompare(a.show_from) || b.id - a.id),
    reads,
  };
}

/** Live must-read notices for this person not yet read — the sidebar count. 0 if not set up. */
export async function unreadMustRead(user) {
  const day = today();
  const [n, r] = await Promise.all([
    db('board_notices').select('id,teams,show_from,show_until,active,must_read').eq('active', true).eq('must_read', true).lte('show_from', day),
    db('board_reads').select('notice_id').eq('emp_id', user.emp_id),
  ]);
  if (n.error) return 0;
  const read = new Set((r.data ?? []).map(x => x.notice_id));
  return (n.data ?? []).filter(x => isLive(x) && forMe(x, user) && !read.has(x.id)).length;
}

// ── Changes ────────────────────────────────────────────────────────────────

/** Checks a notice before saving. Returns an error message or ''. */
export function checkNotice(v, user) {
  if (!v.title?.trim()) return 'Type a title.';
  if (v.show_until && v.show_until < v.show_from) return 'The “until” date is before the “from” date.';
  if (!(v.teams ?? []).length && !canPostEveryone(user)) return 'Choose the team(s) this notice is for.';
  if (!canPostEveryone(user) && user.team && v.teams.some(t => t !== user.team)) return 'You can post to your own team only.';
  for (const [label, text] of [['The title', v.title], ['The text', v.body]]) {
    const issues = phiIssues(text);
    if (issues.length) return `${label} looks like it has ${issues.join(', ')}. Notices can’t hold patient or claim details.`;
  }
  return '';
}

const fields = v => ({
  title: v.title.trim(), body: v.body?.trim() || null, category: v.category || 'process', teams: v.teams ?? [],
  client_id: v.client_id || null, pinned: !!v.pinned, must_read: !!v.must_read, show_from: v.show_from || today(),
  show_until: v.show_until || null, sop_id: v.sop_id || null, payer_id: v.payer_id || null, payer_update_id: v.payer_update_id || null,
});

export async function saveNotice(row, v, user) {
  const saved = row
    ? (await S.update('board_notices', { ...fields(v), updated_by: user.emp_id, updated_at: now() }, { id: row.id }))?.[0]
    : (await S.set('board_notices', { ...fields(v), posted_by: user.emp_id, updated_by: user.emp_id }))?.[0];
  if (saved) { logAudit({ actor: user, action: row ? 'board_edit' : 'board_post', entityType: 'board_notice', entityId: saved.id }); changed(); }
  return saved ?? null;
}

export async function setNoticeFlags(n, patch, user) {
  const ok = await S.update('board_notices', { ...patch, updated_by: user.emp_id, updated_at: now() }, { id: n.id });
  if (ok) {
    logAudit({ actor: user, action: 'active' in patch ? (patch.active ? 'board_restore' : 'board_archive') : 'board_edit', entityType: 'board_notice', entityId: n.id });
    changed();
  }
  return !!ok;
}

export async function markNoticeRead(n, user) {
  const ok = await S.set('board_reads', { notice_id: n.id, emp_id: user.emp_id, read_at: now() }, ['notice_id', 'emp_id']);
  if (ok) { logAudit({ actor: user, action: 'board_read', entityType: 'board_notice', entityId: n.id }); changed(); }
  return !!ok;
}
