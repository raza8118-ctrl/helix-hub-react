import { useState, useEffect } from 'react';
import { db } from '../../lib/supabase';
import { hasAccess } from '../../lib/access';
import { DEFAULT_TASKS } from '../../lib/constants';
import { loadStepContext } from '../../lib/denialSteps';
import { loadWorklists, loadItems, dueForClearing, closeAndClear, CLEAR_AFTER_DAYS } from '../../lib/worklist';
import WorklistUpload from './WorklistUpload';
import WorklistManage from './WorklistManage';
import MyWorklist from './MyWorklist';
import Followups from './Followups';
import { peekOpenFollowups, clearOpenFollowups } from '../../lib/followups';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/**
 * 📋 Smart Worklist (roadmap 6.4): aging / RTP claims prioritised by deadline, dollars and payer, assigned and worked
 * claim by claim. Only minimum claim fields are stored (no patient details); claim # and DOS are wiped on close or after
 * 90 days. Supervisors manage worklists for their own team; admins / managers manage all.
 */
export default function SmartWorklist({ user }) {
  const canManage = hasAccess(user, 'worklist_manage');
  const isSupervisor = user.role === 'supervisor';
  const [worklists, setWorklists] = useState(undefined);   // undefined = loading, null = not set up
  const [myItems, setMyItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [ctx, setCtx] = useState({ clients: [], payers: [], sops: [] });
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState(() => (peekOpenFollowups() ? 'followups' : 'mine'));   // 6.5: sign-in pop-up opens Follow-ups
  const [view, setView] = useState(null);                  // null | 'upload' | worklist id
  const [listItems, setListItems] = useState({ id: null, items: null });
  const [showClosed, setShowClosed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    (async () => {
      let lists = await loadWorklists();
      // Claim # and DOS are wiped automatically 90 days after upload (done by the first manager who opens the page)
      if (lists && canManage) {
        const due = dueForClearing(lists);
        for (const wl of due) await closeAndClear(wl, user, { auto: true });
        if (due.length) lists = await loadWorklists();
      }
      if (!alive) return;
      setWorklists(lists);
      if (lists) {
        const openIds = lists.filter(w => !w.cleared_at).map(w => w.id);
        const mine = await loadItems({ worklistIds: openIds, assignedTo: empId });
        if (alive) setMyItems(mine);
      }
    })();
    return () => { alive = false; };
  }, [empId, canManage, user, reloadKey]);

  // Clients / payers are needed by everyone (6.5 reminders); people and tasks only by managers
  useEffect(() => {
    let alive = true;
    clearOpenFollowups();
    loadStepContext().then(c => { if (alive) setCtx(c); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!canManage) return undefined;
    db('users').select('emp_id,name,team,role,active,supervisor_ids').then(({ data }) => {
      if (alive) setUsers((data ?? []).filter(u => u.active !== false).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
    });
    db('task_configs').select('name').then(({ data }) => {
      const names = new Set([...Object.values(DEFAULT_TASKS).flat().map(t => t.name), ...(data ?? []).map(r => r.name)]);
      if (alive) setTasks([...names].sort());
    });
    return () => { alive = false; };
  }, [canManage]);

  // Worklist opened for managing: load all its claims
  const openId = typeof view === 'number' ? view : null;
  useEffect(() => {
    let alive = true;
    if (openId != null) loadItems({ worklistIds: [openId] }).then(items => { if (alive) setListItems({ id: openId, items }); });
    return () => { alive = false; };
  }, [openId, reloadKey]);

  // Supervisors see their own team's worklists and assign to their own team
  const visible = (worklists ?? []).filter(w => !isSupervisor || w.team === user.team || w.uploaded_by === empId || !w.team);
  const people = users.filter(u => !isSupervisor || u.team === user.team || (u.supervisor_ids ?? []).includes(empId));
  const reload = () => setReloadKey(k => k + 1);

  if (worklists === undefined) return <div style={{ maxWidth: 1100, margin: '0 auto' }}><div className="card text-muted">Loading…</div></div>;

  const opened = openId != null ? visible.find(w => w.id === openId) : null;
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">📋 Smart Worklist</div>
          <div className="page-subtitle">Claims in priority order — deadline, dollars and payer — assigned and worked one by one.</div>
        </div>
      </div>

      {worklists === null && (
        <div className="card text-muted">
          The Smart Worklist isn’t set up yet. An admin needs to run the worklist database update
          (<code>20261021j_worklists.sql</code>) in Supabase.
        </div>
      )}

      {worklists && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['mine', '🙋 My worklist'], ['followups', '⏰ Follow-ups'], ...(canManage ? [['manage', '🛠 Manage worklists']] : [])].map(([id, label]) => (
              <button key={id} className={tab === id ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={tab === id}
                onClick={() => { setTab(id); setView(null); }}>{label}</button>
            ))}
          </div>

          {tab === 'followups' && <Followups user={user} ctx={ctx} people={people} canManage={canManage} />}

          {tab === 'mine' && (
            <MyWorklist user={user} worklists={worklists} items={myItems}
              onItemChanged={row => setMyItems(list => list.map(i => (i.id === row.id ? row : i)))} />
          )}

          {tab === 'manage' && canManage && view === 'upload' && (
            <WorklistUpload ctx={ctx} tasks={tasks} user={user} isSupervisor={isSupervisor}
              onCancel={() => setView(null)} onDone={wl => { reload(); setView(wl.id); }} />
          )}

          {tab === 'manage' && canManage && opened && (
            listItems.id === opened.id && listItems.items
              ? <WorklistManage worklist={opened} items={listItems.items} people={people} ctx={ctx} user={user}
                  onBack={() => setView(null)} onChanged={reload} />
              : <div className="card text-muted">Loading claims…</div>
          )}

          {tab === 'manage' && canManage && view == null && (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <button className="btn-primary btn-sm" onClick={() => setView('upload')}>⬆ Upload a worklist</button>
                <label className="row text-sm text-muted" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
                  <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed
                </label>
              </div>
              <div className="text-sm text-muted mb-16">
                🔒 Claim # and dates of service are wiped automatically {CLEAR_AFTER_DAYS} days after upload, or when you close a worklist.
              </div>
              {visible.filter(w => showClosed || w.status !== 'closed').length === 0 && (
                <div className="card text-muted" style={{ textAlign: 'center' }}>No worklists yet — upload an aging or RTP file to start.</div>
              )}
              {visible.filter(w => showClosed || w.status !== 'closed').map(w => (
                <div key={w.id} className="card mb-16" style={w.status === 'closed' ? { opacity: 0.65 } : undefined}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="card-title" onClick={() => setView(w.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textAlign: 'left' }}>
                      📋 {w.name} ›
                    </button>
                    {w.team && <span className="badge badge-blue">{w.team}</span>}
                    {w.status === 'closed' && <span className="badge badge-gray">Closed{w.cleared_at ? ' – details cleared' : ''}</span>}
                    <span className="text-sm text-muted">{(w.row_count ?? 0).toLocaleString()} claims · uploaded {fmtDate(w.uploaded_at)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
