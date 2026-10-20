import { useState, useMemo } from 'react';
import { hasAccess } from '../../lib/access';
import { TEAMS } from '../../lib/constants';
import { assignmentStatus, itemTitle, kindOf, tickItem, untickItem, unassign, dueDateFor } from '../../lib/training';
import { confirmDialog } from '../../components/shared/Dialog';

const fmtDay = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** Progress bar with "x of y" text. */
export function ProgressBar({ status }) {
  return (
    <div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${status.pct}%`, height: '100%', background: status.complete ? 'var(--success)' : 'var(--accent)' }} />
      </div>
      <div className="text-sm text-muted" style={{ marginTop: 4 }}>
        {status.done} of {status.total} done ({status.pct}%)
        {status.complete ? ' · 🎉 Complete' : status.currentDay ? ` · Day ${status.currentDay} of ${status.days}` : ''}
        {status.overdue > 0 && <span style={{ color: 'var(--danger)' }}> · {status.overdue} overdue</span>}
      </div>
    </div>
  );
}

/**
 * One assignment's items, day by day (roadmap 3.5).
 * mode 'self' = the trainee (ticks own tasks/links); 'trainer' = confirms items for them.
 */
export function AssignmentDays({ data, assignment, user, mode, onChanged, onOpenSop }) {
  const [busy, setBusy] = useState(false);
  const status = assignmentStatus(data, assignment);
  const names = Object.fromEntries(data.users.map(u => [u.emp_id, u.name ?? u.emp_id]));
  const isTrainer = mode === 'trainer';

  async function run(fn) {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) onChanged();
  }
  const tick = item => run(() => tickItem(data, assignment, item, user, { byTrainer: isTrainer }));
  async function untick(item) {
    if (!await confirmDialog({ title: 'Undo this tick?', message: itemTitle(data, item), confirmText: 'Undo', tone: 'warning' })) return;
    run(() => untickItem(data, assignment, item, user));
  }

  return Array.from({ length: status.days }, (_, i) => i + 1).map(dayNo => {
    const rows = status.items.filter(r => r.item.day_no === dayNo);
    const due = dueDateFor(assignment.start_date, dayNo);
    const late = rows.some(r => r.overdue);
    return (
      <div key={dayNo} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <span className="bold">Day {dayNo}</span>
          {due && <span className="text-sm text-muted">due {fmtDay(due)}</span>}
          {late && <span className="badge badge-red">Overdue</span>}
          {rows.length > 0 && rows.every(r => r.done) && <span className="badge badge-green">✓ Done</span>}
        </div>
        {rows.length === 0 && <div className="text-sm text-muted">Nothing planned for this day.</div>}
        {rows.map(({ item, done, doneAt, doneBy, overdue }) => {
          const sopRow = item.kind === 'sop' ? data.sops.find(s => s.id === item.sop_id) : null;
          return (
            <div key={item.id} className="row" style={{
              gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '5px 0 5px 10px',
              borderLeft: `3px solid ${done ? 'var(--success)' : overdue ? 'var(--danger)' : 'var(--border)'}`, marginTop: 4,
            }}>
              <span>{done ? '✔️' : kindOf(item.kind).icon}</span>
              <span style={{ flex: '1 1 220px', minWidth: 0, textDecoration: done ? 'line-through' : undefined, opacity: done ? 0.75 : 1 }}>
                {itemTitle(data, item)}
                {item.needs_trainer && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Trainer confirms</span>}
              </span>
              <span className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {item.kind === 'link' && item.url && (
                  <a className="btn-sm" href={item.url} target="_blank" rel="noopener noreferrer">Open link ↗</a>
                )}
                {item.kind === 'sop' && sopRow && (
                  <button className="btn-sm" onClick={() => onOpenSop(item.sop_id)}>Open SOP ›</button>
                )}
                {done && (
                  <span className="text-sm text-muted">
                    ✓ {fmtDate(doneAt)}{doneBy && doneBy !== assignment.emp_id ? ` · confirmed by ${names[doneBy] ?? doneBy}` : ''}
                  </span>
                )}
                {!done && item.kind === 'sop' && (
                  <span className="text-sm text-muted">{sopRow ? 'Open it and click “I have read and understood”' : 'SOP not found'}</span>
                )}
                {!done && item.kind !== 'sop' && (isTrainer || !item.needs_trainer) && (
                  <button className="btn-sm" disabled={busy} onClick={() => tick(item)}>{isTrainer ? 'Confirm done' : 'Mark done'}</button>
                )}
                {!done && item.kind !== 'sop' && !isTrainer && item.needs_trainer && (
                  <span className="text-sm text-muted">Waiting for trainer</span>
                )}
                {done && item.kind !== 'sop' && (isTrainer || (doneBy === user.emp_id && !item.needs_trainer)) && (
                  <button className="btn-sm" disabled={busy} title="Undo this tick" onClick={() => untick(item)}>↶</button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  });
}

/** Team progress (roadmap 3.5): everyone's learning paths, filters, drill-down with trainer confirmation, Excel. */
export default function TrainingProgress({ data, user, onChanged, onOpenSop }) {
  const canManage = hasAccess(user, 'training_manage');
  const [pathId, setPathId] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showDone, setShowDone] = useState(true);
  const [openId, setOpenId] = useState(null);

  const people = useMemo(() => Object.fromEntries(data.users.map(u => [u.emp_id, u])), [data.users]);
  const rows = useMemo(() => data.assignments
    .filter(a => a.active !== false)
    .map(a => ({ a, s: assignmentStatus(data, a), person: people[a.emp_id] }))
    .filter(r => r.s.path)
    .filter(r => pathId === 'ALL' || String(r.a.path_id) === pathId)
    .filter(r => team === 'ALL' || r.person?.team === team)
    .filter(r => !overdueOnly || r.s.overdue > 0)
    .filter(r => showDone || !r.s.complete)
    .sort((x, y) => y.s.overdue - x.s.overdue || (x.person?.name ?? '').localeCompare(y.person?.name ?? '')),
  [data, people, pathId, team, overdueOnly, showDone]);

  const open = rows.find(r => r.a.id === openId);

  async function download() {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows.map(({ a, s, person }) => ({
      Name: person?.name ?? a.emp_id, 'Emp ID': a.emp_id, Team: person?.team ?? '', Path: s.path.name,
      'Start date': a.start_date, 'Done': s.done, 'Total': s.total, '% done': s.pct,
      'Current day': s.complete ? 'Complete' : s.currentDay ?? '', Overdue: s.overdue,
      Finished: a.completed_at ? fmtDate(a.completed_at) : '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Training progress');
    XLSX.writeFile(wb, `training-progress-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function remove(a) {
    if (!await confirmDialog({
      title: 'Remove this assignment?', message: 'The path disappears from their training. Their progress is kept.',
      confirmText: 'Remove', tone: 'warning',
    })) return;
    if (await unassign(a, user)) { setOpenId(null); onChanged(); }
  }

  if (open) {
    return (
      <div>
        <button className="btn-sm" style={{ marginBottom: 12 }} onClick={() => setOpenId(null)}>← Back to team progress</button>
        <div className="card mb-16">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="card-title">{open.person?.name ?? open.a.emp_id} — {open.s.path.name}</div>
            <span className="text-sm text-muted">{open.person?.team ?? ''} · started {fmtDay(open.a.start_date)}</span>
            {canManage && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => remove(open.a)}>Remove assignment</button>}
          </div>
          <div style={{ margin: '10px 0' }}><ProgressBar status={open.s} /></div>
          <AssignmentDays data={data} assignment={open.a} user={user} mode="trainer" onChanged={onChanged} onOpenSop={onOpenSop} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-16">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={pathId} onChange={e => setPathId(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="ALL">All paths</option>
            {data.paths.map(p => <option key={p.id} value={String(p.id)}>{p.name}{p.active === false ? ' (inactive)' : ''}</option>)}
          </select>
          <select value={team} onChange={e => setTeam(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="ALL">All teams</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} /> Overdue only
          </label>
          <label className="row text-sm" style={{ gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show completed
          </label>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={download} disabled={!rows.length}>⬇ Download Excel</button>
        </div>
      </div>

      {rows.length === 0 && <div className="card text-muted" style={{ textAlign: 'center' }}>No one matches these filters.</div>}
      {rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Name', 'Team', 'Path', 'Progress', 'Day', 'Overdue', 'Started', 'Finished'].map(h => (
                  <th key={h} style={{ padding: '6px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, s, person }) => (
                <tr key={a.id} onClick={() => setOpenId(a.id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  title="Open their items">
                  <td style={{ padding: 6 }}>{person?.name ?? a.emp_id}</td>
                  <td style={{ padding: 6 }}>{person?.team ?? '—'}</td>
                  <td style={{ padding: 6 }}>{s.path.name}</td>
                  <td style={{ padding: 6, minWidth: 110 }}>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ width: `${s.pct}%`, height: '100%', background: s.complete ? 'var(--success)' : 'var(--accent)' }} />
                    </div>
                    {s.pct}%
                  </td>
                  <td style={{ padding: 6 }}>{s.complete ? '🎉' : `${s.currentDay ?? '—'} / ${s.days}`}</td>
                  <td style={{ padding: 6 }}>{s.overdue ? <span className="badge badge-red">{s.overdue}</span> : '—'}</td>
                  <td style={{ padding: 6 }}>{fmtDay(a.start_date)}</td>
                  <td style={{ padding: 6 }}>{a.completed_at ? fmtDate(a.completed_at) : s.complete ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
