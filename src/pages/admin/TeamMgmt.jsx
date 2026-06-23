import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { ACCESSES, DEFAULT_PROJECT } from '../../lib/constants';
import { DEFAULT_SUPERVISOR_PERMS, subProcessesOf, logAudit, today, effectiveTarget } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const ROLES     = ['employee', 'supervisor', 'manager', 'admin'];
const BLANK     = {
  emp_id: '', name: '', password: '', access: 'MCO',
  role: 'employee', target: '', processes: ['MCO'], supervisor_ids: [], team_emp_ids: [],
  supervised_processes: [], supervised_projects: [], all_projects: false,
  permissions: DEFAULT_SUPERVISOR_PERMS,
  ramp_enabled: false, ramp_schedule: [],
};

const PERM_LABELS = {
  resetPassword:  'Reset employee password',
  bypassDeadline: 'Bypass deadline / attendance',
  editCounts:     'Edit submitted counts',
  editQuality:    'Edit quality score',
  pinEmployee:    'Pin employee for close monitoring',
};

function rampWeek(u) {
  if (!u.ramp_enabled || !Array.isArray(u.ramp_schedule) || !u.ramp_schedule.length || !u.ramp_start_date) return null;
  const weeksElapsed = Math.floor((new Date(today()) - new Date(u.ramp_start_date)) / (7 * 86400000));
  if (weeksElapsed < 0 || weeksElapsed >= u.ramp_schedule.length) return null;
  return { week: weeksElapsed + 1, total: u.ramp_schedule.length };
}

function SortableRow({ u, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: u.emp_id });
  return (
    <tr
      ref={setNodeRef}
      style={{
        opacity: !u.active ? 0.5 : isDragging ? 0.6 : undefined,
        transform: CSS.Transform.toString(transform),
        transition,
        background: isDragging ? 'var(--bg-hover, rgba(0,0,0,0.04))' : undefined,
      }}
    >
      <td style={{ width: 28, cursor: 'grab', touchAction: 'none', color: 'var(--text-muted)' }} {...attributes} {...listeners}>⠿</td>
      {children}
    </tr>
  );
}

function MultiCheck({ label, options, selected, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
        {options.map(opt => (
          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={e => onChange(e.target.checked ? [...selected, opt] : selected.filter(s => s !== opt))}
            />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function TeamMgmt({ user }) {
  const [allUsers, setAllUsers]       = useState([]);
  const [resetReqs, setResetReqs]     = useState([]);
  const [customProcs, setCustomProcs] = useState([]);
  const [search, setSearch]           = useState('');
  const [procFilter, setProcFilter]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading]         = useState(false);
  const [showForm, setShowForm]       = useState(false);
  const [editUser, setEditUser]       = useState(null);
  const [form, setForm]               = useState(BLANK);
  const [saving, setSaving]           = useState(false);
  const [newProc, setNewProc]         = useState('');
  const [newProcProject, setNewProcProject] = useState(DEFAULT_PROJECT);
  const [rowOrder, setRowOrder]       = useState({});

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [u, rr, cp] = await Promise.all([
      S.get('users'),
      S.get('reset_requests'),
      S.get('processes'),
    ]);
    setAllUsers(u ?? []);
    setResetReqs(rr ?? []);
    setCustomProcs(cp ?? []);
    setLoading(false);
  }

  const allProjects  = [DEFAULT_PROJECT, ...new Set(customProcs.map(p => p.project).filter(p => p && p !== DEFAULT_PROJECT))];
  const procsByProject = Object.fromEntries(allProjects.map(proj => [proj, subProcessesOf(proj, customProcs)]));
  const allProcs     = Object.values(procsByProject).flat();
  const supervisors  = allUsers.filter(u => u.role === 'supervisor' || u.role === 'manager' || u.role === 'admin');
  const pendingResets = (resetReqs ?? []).filter(r => r.status === 'pending');

  const displayUsers = allUsers.filter(u => {
    const q      = search.toLowerCase();
    const nameOk = !q || (u.name ?? '').toLowerCase().includes(q) || (u.emp_id ?? '').toLowerCase().includes(q);
    const procOk = procFilter === 'ALL' || u.access === procFilter || u.access === 'ALL' ||
      u.process === procFilter || u.process === 'ALL' || (u.processes ?? []).includes(procFilter);
    const statusOk = statusFilter === 'all' ||
      (statusFilter === 'active' ? u.active !== false : u.active === false);
    return nameOk && procOk && statusOk;
  });

  const groupedUsers = (() => {
    const groups = {};
    for (const u of displayUsers) {
      const key = u.access || u.process || 'Unassigned';
      (groups[key] ??= []).push(u);
    }
    const orderedKeys = [...allProcs.filter(p => groups[p]), ...Object.keys(groups).filter(k => !allProcs.includes(k))];
    return orderedKeys.map(key => {
      const users = groups[key];
      const savedOrder = rowOrder[key] ?? [];
      const byId = Object.fromEntries(users.map(u => [u.emp_id, u]));
      const sorted = [
        ...savedOrder.filter(id => byId[id]).map(id => byId[id]),
        ...users.filter(u => !savedOrder.includes(u.emp_id)),
      ];
      return [key, sorted];
    });
  })();

  function handleDragEnd(groupKey, event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = (groupedUsers.find(([k]) => k === groupKey)?.[1] ?? []).map(u => u.emp_id);
    const from = ids.indexOf(active.id);
    const to   = ids.indexOf(over.id);
    if (from === -1 || to === -1) return;
    setRowOrder(prev => ({ ...prev, [groupKey]: arrayMove(ids, from, to) }));
  }

  const setF = patch => setForm(prev => ({ ...prev, ...patch }));

  function openCreate() { setEditUser(null); setForm(BLANK); setShowForm(true); }
  function openEdit(u) {
    setEditUser(u);
    setForm({
      emp_id: u.emp_id, name: u.name ?? '',
      password: u.password ?? '', access: u.access || u.process || 'MCO',
      role: u.role ?? 'employee', target: u.target ?? '',
      processes: u.processes ?? [u.access || u.process || 'MCO'],
      supervisor_ids: u.supervisor_ids ?? [],
      team_emp_ids: u.role === 'supervisor'
        ? allUsers.filter(e => e.role === 'employee' && (e.supervisor_ids ?? []).includes(u.emp_id)).map(e => e.emp_id)
        : [],
      supervised_processes: u.supervised_processes ?? [],
      supervised_projects: (u.supervised_projects ?? []).filter(p => p !== 'ALL'),
      all_projects: (u.supervised_projects ?? []).includes('ALL'),
      permissions: { ...DEFAULT_SUPERVISOR_PERMS, ...(u.permissions ?? {}) },
      ramp_enabled: u.ramp_enabled ?? false,
      ramp_schedule: u.ramp_schedule ?? [],
    });
    setShowForm(true);
  }

  async function saveUser() {
    if (!form.emp_id.trim() || !form.name.trim()) return;
    setSaving(true);
    const empId = form.emp_id.trim().toUpperCase();
    const payload = {
      emp_id: empId,
      name: form.name.trim(),
      password: form.password,
      access: form.access,
      role: form.role,
      target: form.target !== '' ? parseInt(form.target) : null,
      processes: form.processes,
      supervisor_ids: form.supervisor_ids,
      supervised_processes: form.role === 'supervisor' ? form.supervised_processes : [],
      supervised_projects: form.role === 'manager' ? (form.all_projects ? ['ALL'] : form.supervised_projects) : [],
      permissions: (form.role === 'supervisor' || form.role === 'manager') ? form.permissions : null,
      active: true,
      ramp_enabled: form.ramp_enabled,
      ramp_schedule: form.ramp_enabled ? form.ramp_schedule.map(Number) : null,
      ramp_start_date: form.ramp_enabled && !editUser?.ramp_enabled ? today() : (editUser?.ramp_start_date ?? null),
    };
    const result = editUser
      ? await S.update('users', payload, { emp_id: editUser.emp_id })
      : await S.set('users', payload);
    setSaving(false);
    if (!result) {
      window.alert('Failed to save user. The ID may already exist, or the save was blocked by a database permission rule.');
      return;
    }
    if (form.role === 'supervisor') {
      // Reconcile the other side of the relationship: each employee's own supervisor_ids
      // array is the source of truth, so adding/removing someone from "Team Members" here
      // means adding/removing this supervisor's emp_id on those employee rows.
      const newTeam = new Set(form.team_emp_ids ?? []);
      const affected = allUsers.filter(e =>
        e.role === 'employee' && ((e.supervisor_ids ?? []).includes(empId) || newTeam.has(e.emp_id))
      );
      await Promise.all(affected.map(e => {
        const cur = new Set(e.supervisor_ids ?? []);
        if (newTeam.has(e.emp_id)) cur.add(empId); else cur.delete(empId);
        return S.update('users', { supervisor_ids: [...cur] }, { emp_id: e.emp_id });
      }));
      logAudit({ actor: user, action: 'assign_team', targetEmpId: empId, targetName: form.name.trim(), details: { team: [...newTeam] } });
    }
    setShowForm(false);
    await load();
  }

  async function toggleActive(u) {
    await S.update('users', { active: !u.active }, { emp_id: u.emp_id });
    setAllUsers(prev => prev.map(x => x.emp_id === u.emp_id ? { ...x, active: !x.active } : x));
  }

  async function approveReset(rr) {
    const temp = `Temp@${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await S.update('users', { password: temp }, { emp_id: rr.emp_id });
    await S.update('reset_requests', { status: 'approved', temp_password: temp }, { id: rr.id });
    logAudit({ actor: user, action: 'reset_password', targetEmpId: rr.emp_id, targetName: rr.emp_name });
    window.alert(`Password reset approved.\nEmployee: ${rr.emp_name ?? rr.emp_id}\nTemp password: ${temp}\n\nShare securely.`);
    await load();
  }

  async function addProcess() {
    const name = newProc.trim().toUpperCase();
    if (!name) return;
    const project = (newProcProject.trim() || DEFAULT_PROJECT).toUpperCase();
    await S.set('processes', { name, project, active: true });
    setNewProc('');
    setNewProcProject(DEFAULT_PROJECT);
    await load();
  }

  async function deleteProcess(id) {
    if (!window.confirm('Delete this custom process?')) return;
    await S.del('processes', { id });
    await load();
  }

  const f = form;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Team Management</div>
          <div className="page-subtitle">
            {allUsers.length} users
            {pendingResets.length > 0 && (
              <span className="col-red" style={{ marginLeft: 8 }}>· {pendingResets.length} reset request(s)</span>
            )}
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Add User</button>
      </div>

      {/* Password reset approvals */}
      {pendingResets.length > 0 && (
        <div className="card mb-16" style={{ borderColor: 'var(--warning)', borderWidth: 2 }}>
          <div className="card-header">
            <div className="card-title" style={{ color: 'var(--warning)' }}>⚠ Password Reset Requests</div>
            <span className="badge badge-yellow">{pendingResets.length} pending</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Employee</th><th>ID</th><th>Requested</th><th>Action</th></tr>
              </thead>
              <tbody>
                {pendingResets.map(rr => (
                  <tr key={rr.id}>
                    <td className="bold">{rr.emp_name ?? rr.emp_id}</td>
                    <td>{rr.emp_id}</td>
                    <td className="text-sm text-muted">
                      {rr.requested_at ? new Date(rr.requested_at).toLocaleString() : '—'}
                    </td>
                    <td>
                      <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => approveReset(rr)}>
                        Approve & Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Process management */}
      <div className="card mb-16">
        <div className="card-header"><div className="card-title">Process / Project Management</div></div>
        {allProjects.map(proj => (
          <div key={proj} style={{ marginBottom: 10 }}>
            <div className="text-sm bold text-muted" style={{ marginBottom: 4 }}>{proj}</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {procsByProject[proj].map(name => {
                const custom = customProcs.find(p => p.name === name && (p.project ?? DEFAULT_PROJECT) === proj);
                return (
                  <span key={name} className={`badge ${custom ? 'badge-yellow' : 'badge-blue'}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {name}
                    {custom && (
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 0, fontSize: 12, lineHeight: 1 }}
                        onClick={() => deleteProcess(custom.id)}>✕</button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input type="text" placeholder="Project (e.g. PMB)" value={newProcProject}
            onChange={e => setNewProcProject(e.target.value)} style={{ maxWidth: 140 }} />
          <input type="text" placeholder="New sub-process name…" value={newProc}
            onChange={e => setNewProc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addProcess()}
            style={{ maxWidth: 200 }} />
          <button className="btn-sm" onClick={addProcess}>Add Sub-Process</button>
        </div>
      </div>

      {/* User list */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">User Directory</div>
          <div className="row" style={{ gap: 8 }}>
            <input type="text" placeholder="Search name / ID…" value={search}
              onChange={e => setSearch(e.target.value)} style={{ maxWidth: 180 }} />
            <select value={procFilter} onChange={e => setProcFilter(e.target.value)} style={{ maxWidth: 140 }}>
              <option value="ALL">All Processes</option>
              {allProcs.map(p => <option key={p}>{p}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 120 }}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        {loading && <div style={{ textAlign: 'center', padding: 24 }}>Loading…</div>}
        {!loading && groupedUsers.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No users found</div>
        )}
        {!loading && groupedUsers.map(([groupKey, users]) => (
          <div key={groupKey} style={{ marginBottom: 18 }}>
            <div className="text-sm bold text-muted" style={{ margin: '10px 0 4px' }}>{groupKey}</div>
            <div className="table-wrap">
              <DndContext sensors={dndSensors} onDragEnd={e => handleDragEnd(groupKey, e)}>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Emp ID</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Process</th>
                      <th className="right">Target</th>
                      <th className="center">Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <SortableContext items={users.map(u => u.emp_id)} strategy={verticalListSortingStrategy}>
                      {users.map(u => (
                        <SortableRow key={u.emp_id} u={u}>
                          <td className="bold text-sm">{u.emp_id}</td>
                          <td>{u.name ?? '—'}</td>
                          <td>
                            <span className={`badge ${u.role === 'admin' ? 'badge-blue' : u.role === 'manager' ? 'badge-purple' : u.role === 'supervisor' ? 'badge-yellow' : 'badge-gray'}`}>
                              {u.role}
                            </span>
                          </td>
                          <td>{u.access || u.process || '—'}</td>
                          <td className="right">{u.target ?? '—'}</td>
                          <td className="center">
                            <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
                              <span className={`badge ${u.active !== false ? 'badge-green' : 'badge-red'}`}>
                                {u.active !== false ? 'Active' : 'Disabled'}
                              </span>
                              {rampWeek(u) && <span className="badge badge-yellow">Ramp Wk {rampWeek(u).week}/{rampWeek(u).total}</span>}
                            </div>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 4 }}>
                              <button className="btn-sm" onClick={() => openEdit(u)}>Edit</button>
                              <button className="btn-sm"
                                style={{ color: u.active !== false ? 'var(--danger)' : 'var(--success)' }}
                                onClick={() => toggleActive(u)}>
                                {u.active !== false ? 'Disable' : 'Enable'}
                              </button>
                            </div>
                          </td>
                        </SortableRow>
                      ))}
                    </SortableContext>
                  </tbody>
                </table>
              </DndContext>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit user modal */}
      {showForm && (
        <Modal title={editUser ? `Edit — ${editUser.emp_id}` : 'Create New User'} onClose={() => setShowForm(false)} wide>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Employee ID</label>
                <input type="text" value={f.emp_id} onChange={e => setF({ emp_id: e.target.value })}
                  placeholder="EMP001" disabled={!!editUser} />
              </div>
              <div className="field">
                <label>Full Name</label>
                <input type="text" value={f.name} onChange={e => setF({ name: e.target.value })} placeholder="Full name" />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="text" value={f.password} onChange={e => setF({ password: e.target.value })} placeholder="Set password" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={f.role} onChange={e => setF({ role: e.target.value })}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Primary Access</label>
                <select value={f.access} onChange={e => setF({ access: e.target.value })}>
                  {ACCESSES.map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Daily Target</label>
                <input type="number" value={f.target} onChange={e => setF({ target: e.target.value })} placeholder="e.g. 100" />
              </div>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={f.ramp_enabled}
                  onChange={e => setF({ ramp_enabled: e.target.checked, ramp_schedule: e.target.checked && f.ramp_schedule.length === 0 ? [''] : f.ramp_schedule })} />
                Ramp-Up Plan (new hire starts below the Daily Target and steps up week by week)
              </label>
              {f.ramp_enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {f.ramp_schedule.map((wk, i) => (
                    <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="text-sm text-muted" style={{ width: 56 }}>Week {i + 1}</span>
                      <input type="number" value={wk} style={{ maxWidth: 120 }}
                        onChange={e => setF({ ramp_schedule: f.ramp_schedule.map((v, j) => j === i ? e.target.value : v) })}
                        placeholder="Target" />
                      <button className="btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => setF({ ramp_schedule: f.ramp_schedule.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                  <button className="btn-sm" style={{ alignSelf: 'flex-start' }}
                    onClick={() => setF({ ramp_schedule: [...f.ramp_schedule, ''] })}>+ Add Week</button>
                  <div className="text-sm text-muted">After the schedule ends, the Daily Target above applies automatically.</div>
                </div>
              )}
            </div>
            <MultiCheck label="Permissions" options={allProcs} selected={f.processes}
              onChange={v => setF({ processes: v })} />
            {f.role === 'employee' && supervisors.length > 0 && (
              <MultiCheck
                label="Supervisor Access (who can see this user)"
                options={supervisors.map(s => s.emp_id)}
                selected={f.supervisor_ids}
                onChange={v => setF({ supervisor_ids: v })}
              />
            )}
            {f.role === 'supervisor' && (
              <>
                <MultiCheck
                  label="Monitored Processes (auto-includes everyone on these processes)"
                  options={allProcs}
                  selected={f.supervised_processes}
                  onChange={v => setF({ supervised_processes: v })}
                />
                <MultiCheck
                  label="Team Members (additional individual employees this supervisor monitors)"
                  options={allUsers.filter(u => u.role === 'employee').map(u => u.emp_id)}
                  selected={f.team_emp_ids}
                  onChange={v => setF({ team_emp_ids: v })}
                />
              </>
            )}
            {f.role === 'manager' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={f.all_projects} onChange={e => setF({ all_projects: e.target.checked })} />
                  All Projects (sees every project, current and future)
                </label>
                {!f.all_projects && (
                  <MultiCheck
                    label="Projects (grants every sub-process under each, including future ones)"
                    options={allProjects}
                    selected={f.supervised_projects}
                    onChange={v => setF({ supervised_projects: v })}
                  />
                )}
              </>
            )}
            {(f.role === 'supervisor' || f.role === 'manager') && (
              <div className="field">
                <label>Permissions</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
                  {Object.keys(DEFAULT_SUPERVISOR_PERMS).map(key => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!f.permissions[key]}
                        onChange={e => setF({ permissions: { ...f.permissions, [key]: e.target.checked } })} />
                      {PERM_LABELS[key] ?? key}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="form-actions">
              <button className="btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveUser}
                disabled={saving || !f.emp_id.trim() || !f.name.trim()}>
                {saving ? 'Saving…' : editUser ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
