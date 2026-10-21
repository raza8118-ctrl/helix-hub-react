import { useState } from 'react';
import { categoryLabel, forTeam, startsIn, isNew, markUpdateRead, SOON_DAYS, NEW_DAYS } from '../../lib/payerUpdates';
import { TEAMS } from '../../lib/constants';

const fmtDate = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date given');

/** “AR: 7 / 9 · Auth: 2 / 4” — who on each listed team has read the change (supervisors / managers). */
function readLine(u, readers, people) {
  const teams = (u.teams ?? []).length ? u.teams : TEAMS;
  return teams.map(t => {
    const members = people.filter(p => p.team === t);
    if (!members.length) return null;
    return `${t}: ${members.filter(p => readers.includes(p.emp_id)).length} / ${members.length}`;
  }).filter(Boolean).join(' · ');
}

/**
 * 🆕 For my team (roadmap 8.2): changes added in the last 30 days that list my team (or no team), newest first,
 * with “Starts in N days” and ✓ Got it. Supervisors / managers also see who has read each one.
 */
export default function UpdatesForTeam({ updates, reads, people, ctx, user, showReaders, onChanged, onOpenPdf }) {
  const [showRead, setShowRead] = useState(false);
  const [busy, setBusy] = useState(null);
  const mine = updates.filter(u => u.status === 'active' && u.bulletin.active !== false && isNew(u) && forTeam(u, user.team))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const readByMe = u => (reads?.[u.id] ?? []).includes(user.emp_id);
  const unread = mine.filter(u => !readByMe(u));
  const list = showRead ? mine : unread;
  const payerName = u => ctx.payers.find(p => p.id === u.payer_id)?.name ?? u.payer_name ?? 'Payer not set';

  async function gotIt(u) {
    setBusy(u.id);
    if (await markUpdateRead(u, user)) onChanged();
    setBusy(null);
  }

  return (
    <>
      <div className="row mb-16" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="text-sm text-muted">
          Changes added in the last {NEW_DAYS} days {user.team ? `for ${user.team}` : '(no team set — showing every team)'} · <b>{unread.length}</b> new
        </span>
        <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={showRead} onChange={e => setShowRead(e.target.checked)} /> Show the ones I've read
        </label>
      </div>
      {reads === null && <div className="card mb-16 text-sm text-muted">Read tracking needs the database update <code>20261021s_payer_update_reads.sql</code>.</div>}
      {list.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>{unread.length || !mine.length ? 'Nothing new for your team. 🎉' : 'You have read every new change.'}</div>}

      {list.map(u => {
        const days = startsIn(u);
        return (
          <div key={u.id} className="card mb-16" style={readByMe(u) ? { opacity: 0.7 } : { borderLeft: '4px solid var(--primary, #3b82f6)' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="bold">{payerName(u)}</span>
              <span className="badge badge-gray">{categoryLabel(u.category)}</span>
              <span className="text-sm">Effective {fmtDate(u.effective_date)}</span>
              {days != null && days >= 0 && days <= SOON_DAYS && <span className="badge badge-yellow">{days === 0 ? 'Starts today' : `Starts in ${days} days`}</span>}
              {days != null && days < 0 && <span className="badge badge-gray">In effect</span>}
              <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{(u.teams ?? []).join(', ') || 'All teams'}</span>
            </div>
            <div style={{ marginTop: 6 }}>{u.change_text}</div>
            {u.action_needed && <div className="text-sm" style={{ marginTop: 4 }}>👉 <b>Action:</b> {u.action_needed}</div>}
            <div className="row text-sm text-muted" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
              <span>From “{u.bulletin.title}”{u.source_page ? `, page ${u.source_page}` : ''}</span>
              {u.bulletin.file_path && <button className="btn-sm" onClick={() => onOpenPdf(u.bulletin)}>Open PDF ↗</button>}
              {showReaders && reads && <span>Read: {readLine(u, reads[u.id] ?? [], people) || '—'}</span>}
              {reads && !readByMe(u) && (
                <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={busy === u.id} onClick={() => gotIt(u)}>✓ Got it</button>
              )}
              {readByMe(u) && <span className="badge badge-green" style={{ marginLeft: 'auto' }}>✓ Read</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
