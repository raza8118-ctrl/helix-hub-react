import { useState, useEffect } from 'react';
import { hasAccess } from '../../lib/access';
import { loadTraining, assignmentStatus, stampCompletion } from '../../lib/training';
import { loadSopLibrary } from '../../lib/sops';
import { loadSopVersionMeta } from '../../lib/sopVersions';
import TrainingProgress, { ProgressBar, AssignmentDays } from './TrainingProgress';
import TrainingPathEditor from './TrainingPathEditor';
import SopPage from './SopPage';

const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Loads training data and stamps the finish date on the user's paths that became complete
// (e.g. after acknowledging an SOP in the library), then returns fresh data.
async function loadAndStamp(user) {
  const fresh = await loadTraining();
  const finished = (fresh?.assignments ?? []).filter(a => a.emp_id === user.emp_id && a.active !== false && !a.completed_at
    && assignmentStatus(fresh, a).complete);
  if (!finished.length) return fresh;
  for (const a of finished) await stampCompletion(fresh, a, user);
  return loadTraining();
}

/**
 * 🎓 Training (roadmap 3.5): learning paths by role.
 * My training (everyone) · Team progress ("See training progress") · Manage paths ("Manage learning paths").
 */
export default function Training({ user }) {
  const canManage = hasAccess(user, 'training_manage');
  const canTrack = hasAccess(user, 'training_track');
  const [data, setData] = useState(undefined);       // undefined = loading, null = not set up
  const [tab, setTab] = useState('mine');
  const [sopId, setSopId] = useState(null);          // SOP opened from a path
  const [sopCtx, setSopCtx] = useState(null);        // { lib, meta } for the SOP page

  const empId = user.emp_id;
  const reload = () => loadAndStamp(user).then(setData);
  useEffect(() => {
    let alive = true;
    loadAndStamp(user).then(fresh => { if (alive) setData(fresh); });
    return () => { alive = false; };
  }, [user]);

  // SOP items open the full SOP page here, with the acknowledge button (which completes the item)
  useEffect(() => {
    let alive = true;
    if (sopId != null) {
      Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: empId })]).then(([lib, meta]) => {
        if (alive) setSopCtx({ lib: lib ? { ...lib, versionsReady: meta != null } : null, meta });
      });
    }
    return () => { alive = false; };
  }, [sopId, empId]);

  const reloadSop = () => Promise.all([loadSopLibrary(), loadSopVersionMeta({ emp_id: empId })])
    .then(([lib, meta]) => setSopCtx({ lib: lib ? { ...lib, versionsReady: meta != null } : null, meta }));

  // Back from an SOP: acknowledging it may have finished a path
  function closeSop() {
    setSopId(null);
    setSopCtx(null);
    reload();
  }

  if (sopId != null) {
    const canEditSops = hasAccess(user, 'sops_edit');
    const sop = sopCtx?.lib?.sops.find(s => s.id === sopId);
    const readable = sop && (canEditSops || (sop.active !== false && sop.status === 'published'));
    const names = Object.fromEntries((data?.users ?? []).map(u => [u.emp_id, u.name ?? u.emp_id]));
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {!sopCtx && <div className="card text-muted">Loading SOP…</div>}
        {sopCtx && !readable && (
          <div className="card">
            <button className="btn-sm" onClick={closeSop}>← Back to training</button>
            <p className="text-muted">This SOP isn’t published yet. Please ask your trainer.</p>
          </div>
        )}
        {sopCtx && readable && (
          <SopPage key={sop.id} sop={sop} lib={sopCtx.lib} meta={sopCtx.meta} names={names} user={user} canEdit={canEditSops}
            forceAck backLabel="← Back to training"
            onBack={closeSop} onChanged={reloadSop} onOpenSop={setSopId} />
        )}
      </div>
    );
  }

  const tabs = [
    { id: 'mine', label: '🎓 My training' },
    ...(canTrack ? [{ id: 'team', label: '👥 Team progress' }] : []),
    ...(canManage ? [{ id: 'manage', label: '🛠 Manage paths' }] : []),
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">🎓 Training</div>
          <div className="page-subtitle">Day-by-day learning paths: SOPs to read, tasks to practise and links to watch.</div>
        </div>
      </div>

      {data === undefined && <div className="card text-muted">Loading training…</div>}
      {data === null && (
        <div className="card text-muted">
          Training isn’t set up yet. An admin needs to run the learning paths database update
          (<code>20261021b_learning_paths.sql</code>) in Supabase.
        </div>
      )}

      {data && (
        <>
          {tabs.length > 1 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {tabs.map(t => (
                <button key={t.id} className={tab === t.id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
          )}
          {tab === 'mine' && <MyTraining data={data} user={user} onChanged={reload} onOpenSop={setSopId} />}
          {tab === 'team' && canTrack && <TrainingProgress data={data} user={user} onChanged={reload} onOpenSop={setSopId} />}
          {tab === 'manage' && canManage && <TrainingPathEditor data={data} user={user} onChanged={reload} />}
        </>
      )}
    </div>
  );
}

// The signed-in person's own learning paths
function MyTraining({ data, user, onChanged, onOpenSop }) {
  const mine = data.assignments
    .filter(a => a.emp_id === user.emp_id && a.active !== false)
    .map(a => ({ a, s: assignmentStatus(data, a) }))
    .filter(r => r.s.path)
    .sort((x, y) => x.s.complete - y.s.complete || (y.a.start_date ?? '').localeCompare(x.a.start_date ?? ''));

  if (!mine.length) {
    return <div className="card text-muted" style={{ textAlign: 'center' }}>You don’t have any learning paths yet.</div>;
  }
  return mine.map(({ a, s }) => (
    <div key={a.id} className="card mb-16" style={s.complete ? { borderLeft: '4px solid var(--success)' } : undefined}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="card-title">🎓 {s.path.name}</div>
        {s.path.team && <span className="badge badge-blue">{s.path.team}</span>}
        <span className="text-sm text-muted">started {fmtDay(a.start_date)}</span>
      </div>
      {s.path.description && <div className="text-sm text-muted" style={{ marginTop: 4 }}>{s.path.description}</div>}
      <div style={{ margin: '10px 0' }}><ProgressBar status={s} /></div>
      {s.complete && (
        <div className="text-sm" style={{ marginBottom: 8 }}>
          🎉 Path complete{a.completed_at ? ` on ${fmtDate(a.completed_at)}` : ''} — well done!
        </div>
      )}
      <AssignmentDays data={data} assignment={a} user={user} mode="self" onChanged={onChanged} onOpenSop={onOpenSop} />
    </div>
  ));
}
