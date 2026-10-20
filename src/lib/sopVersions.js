// SOP versions, acknowledgements and read tracking (roadmap 3.4).
// rcm.sops is the editors' working copy; publishing freezes it into rcm.sop_versions.
// Readers see the CURRENT version: the newest one whose effective date has arrived.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { today } from './helpers';

// What a version freezes (everything a reader sees on the SOP page)
export const SNAPSHOT_KEYS = [
  'title', 'summary', 'purpose', 'audience_teams', 'audience_notes', 'prerequisites',
  'steps', 'expected_result', 'troubleshooting', 'walkthrough_video',
];

// Library list: version facts without the (large) snapshot, plus the title/summary readers see
const META_COLUMNS = 'id,sop_id,version_no,change_note,effective_date,requires_ack,published_by,published_at,'
  + 'title:snapshot->>title,summary:snapshot->>summary,audience_teams:snapshot->audience_teams';

/**
 * Version list (no snapshots) and this user's reads, or null when the 3.4 database update hasn't been run.
 */
export async function loadSopVersionMeta(user) {
  const [versions, reads] = await Promise.all([
    db('sop_versions').select(META_COLUMNS),
    db('sop_reads').select('id,sop_id,version_id,acknowledged_at').eq('emp_id', user.emp_id),
  ]);
  if (versions.error || reads.error) return null;
  return { versions: versions.data ?? [], myReads: reads.data ?? [] };
}

/** All versions of one SOP, with snapshots, oldest first. */
export async function loadSopVersions(sopId) {
  const { data, error } = await db('sop_versions').select('*').eq('sop_id', sopId);
  if (error) return null;
  return (data ?? []).sort((a, b) => a.version_no - b.version_no);
}

/**
 * Splits one SOP's versions by date: { current, upcoming: [...], archived: [...], latest }.
 * current = newest version (by number) already in effect; upcoming = not yet in effect.
 */
export function versionStates(versions) {
  const day = today();
  const sorted = [...(versions ?? [])].sort((a, b) => a.version_no - b.version_no);
  const live = sorted.filter(v => v.effective_date <= day);
  const current = live[live.length - 1] ?? null;
  return {
    current,
    upcoming: sorted.filter(v => v.effective_date > day),
    archived: live.filter(v => v !== current),
    latest: sorted[sorted.length - 1] ?? null,
  };
}

/** The SOP as readers see a version: the row's identity (task, client, owner…) with the frozen content. */
export const sopAsVersion = (sop, version) => version?.snapshot ? { ...sop, ...version.snapshot, version } : sop;

/** True when the working copy differs from the newest published version (or nothing is published yet). */
export function hasUnpublishedChanges(sop, latest) {
  if (!latest?.snapshot) return true;
  const pick = o => JSON.stringify(SNAPSHOT_KEYS.map(k => o?.[k] ?? null));
  return pick(sop) !== pick(latest.snapshot);
}

/** Whether this user is expected to acknowledge a version (its teams, or everyone when none are ticked). */
export function mustAcknowledge(user, version) {
  if (!version?.requires_ack) return false;
  const teams = version.snapshot?.audience_teams ?? version.audience_teams ?? [];
  return !teams?.length || teams.includes(user.team);
}

/** Publishes the working copy as the next version. Returns the new version row, or null. */
export async function publishSopVersion(sop, { changeNote, effectiveDate, requiresAck }, versions, user) {
  const versionNo = Math.max(0, ...(versions ?? []).map(v => v.version_no)) + 1;
  const snapshot = Object.fromEntries(SNAPSHOT_KEYS.map(k => [k, sop[k] ?? null]));
  const rows = await S.set('sop_versions', {
    sop_id: sop.id, version_no: versionNo, snapshot, change_note: changeNote,
    effective_date: effectiveDate, requires_ack: requiresAck, published_by: user.emp_id,
  });
  if (!rows?.length) return null;
  if (sop.status !== 'published') {
    await S.update('sops', { status: 'published', updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: sop.id });
  }
  logAudit({
    actor: user, action: 'sop_publish_version', entityType: 'sop', entityId: sop.id,
    details: { version: versionNo, effective_date: effectiveDate, requires_ack: requiresAck },
  });
  return rows[0];
}

/** Counts one opening of a version by this user (first/last opened, how many times). */
export async function recordSopRead(sopId, versionId, user) {
  const { data } = await db('sop_reads').select('id,view_count').eq('version_id', versionId).eq('emp_id', user.emp_id);
  const now = new Date().toISOString();
  if (data?.length) {
    await S.update('sop_reads', { last_viewed_at: now, view_count: (data[0].view_count ?? 0) + 1 }, { id: data[0].id });
    return data[0].id;
  }
  const rows = await S.set('sop_reads', { sop_id: sopId, version_id: versionId, emp_id: user.emp_id });
  return rows?.[0]?.id ?? null;
}

/** "I have read and understood" — returns true when saved. */
export async function acknowledgeSop(sopId, version, user) {
  const now = new Date().toISOString();
  const { data } = await db('sop_reads').select('id').eq('version_id', version.id).eq('emp_id', user.emp_id);
  const ok = data?.length
    ? await S.update('sop_reads', { acknowledged_at: now, last_viewed_at: now }, { id: data[0].id })
    : await S.set('sop_reads', { sop_id: sopId, version_id: version.id, emp_id: user.emp_id, acknowledged_at: now });
  if (!ok) return false;
  logAudit({ actor: user, action: 'sop_acknowledge', entityType: 'sop', entityId: sopId, details: { version: version.version_no } });
  return true;
}

/**
 * Current versions this user still has to acknowledge, from the library data.
 * visibleSops = the SOPs the user can see. Returns [{ sop, version }].
 */
export function pendingAcknowledgements(visibleSops, meta, user) {
  if (!meta) return [];
  const acked = new Set(meta.myReads.filter(r => r.acknowledged_at).map(r => r.version_id));
  const bySop = {};
  meta.versions.forEach(v => { (bySop[v.sop_id] ??= []).push(v); });
  return visibleSops.flatMap(sop => {
    const { current } = versionStates(bySop[sop.id]);
    return current && mustAcknowledge(user, current) && !acked.has(current.id) ? [{ sop, version: current }] : [];
  });
}

/**
 * Tracking for one version: everyone expected to acknowledge it (active users of its teams, or all),
 * plus anyone else who opened it. Rows: { emp_id, name, team, expected, opened, lastOpened, views, acknowledged }.
 */
export async function loadSopTracking(version) {
  const [users, reads] = await Promise.all([
    db('users').select('emp_id,name,team,active'),
    db('sop_reads').select('*').eq('version_id', version.id),
  ]);
  if (users.error || reads.error) return null;
  const teams = version.snapshot?.audience_teams ?? [];
  const readOf = Object.fromEntries((reads.data ?? []).map(r => [r.emp_id, r]));
  return (users.data ?? [])
    .map(u => {
      const r = readOf[u.emp_id];
      const expected = version.requires_ack && u.active !== false && (!teams.length || teams.includes(u.team));
      return {
        emp_id: u.emp_id, name: u.name ?? u.emp_id, team: u.team ?? '', expected,
        opened: r?.first_viewed_at ?? null, lastOpened: r?.last_viewed_at ?? null,
        views: r?.view_count ?? 0, acknowledged: r?.acknowledged_at ?? null,
      };
    })
    .filter(row => row.expected || row.opened)
    .sort((a, b) => (!!a.acknowledged - !!b.acknowledged) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}
