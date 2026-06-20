import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { ACCESSES } from '../../lib/constants';
import Modal from '../../components/shared/Modal';

const ROLES     = ['employee', 'supervisor', 'manager', 'admin'];
const DEF_PROCS = ['MCO', 'MCD', 'MCR', 'AUTH'];
const BLANK     = {
  emp_id: '', name: '', password: '', access: 'MCO',
  role: 'employee', target: '', processes: ['MCO'], supervisor_ids: [],
};

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

  const allProcs     = [...DEF_PROCS, ...customProcs.map(p => p.name)];
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
    });
    setShowForm(true);
  }

  async function saveUser() {
    if (!form.emp_id.trim() || !form.name.trim()) return;
    setSaving(true);
    const payload = {
      emp_id: form.emp_id.trim().toUpperCase(),
      name: form.name.trim(),
      password: form.password,
      access: form.access,
      role: form.role,
      target: form.target !== '' ? parseInt(form.target) : null,
      processes: form.processes,
      supervisor_ids: form.supervisor_ids,
      active: true,
    };
    if (editUser) {
      await S.update('users', payload, { emp_id: editUser.emp_id });
    } else {
      await S.set('users', payload);
    }
    setSaving(false);
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
    window.alert(`Password reset approved.\nEmployee: ${rr.emp_name ?? rr.emp_id}\nTemp password: ${temp}\n\nShare securely.`);
    await load();
  }

  async function addProcess() {
    const name = newProc.trim().toUpperCase();
    if (!name) return;
    await S.set('processes', { name, active: true });
    setNewProc('');
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
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {DEF_PROCS.map(p => <span key={p} className="badge badge-blue">{p}</span>)}
          {customProcs.map(p => (
            <span key={p.id} className="badge badge-yellow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {p.name}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 0, fontSize: 12, lineHeight: 1 }}
                onClick={() => deleteProcess(p.id)}>✕</button>
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="New process name…" value={newProc}
            onChange={e => setNewProc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addProcess()}
            style={{ maxWidth: 200 }} />
          <button className="btn-sm" onClick={addProcess}>Add Process</button>
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
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
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr>}
              {!loading && displayUsers.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No users found</td></tr>
              )}
              {displayUsers.map(u => (
                <tr key={u.emp_id} style={!u.active ? { opacity: 0.5 } : undefined}>
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
                    <span className={`badge ${u.active !== false ? 'badge-green' : 'badge-red'}`}>
                      {u.active !== false ? 'Active' : 'Disabled'}
                    </span>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <MultiCheck label="Permissions" options={allProcs} selected={f.processes}
              onChange={v => setF({ processes: v })} />
            {supervisors.length > 0 && (
              <MultiCheck
                label="Supervisor Access (who can see this user)"
                options={supervisors.map(s => s.emp_id)}
                selected={f.supervisor_ids}
                onChange={v => setF({ supervisor_ids: v })}
              />
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
