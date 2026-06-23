import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { scopeToSupervisor, getSupervisorPerms, logAudit } from '../../lib/helpers';

export default function SupervisorTeam({ user }) {
  const [allUsers, setAllUsers]   = useState([]);
  const [resetReqs, setResetReqs] = useState([]);
  const [perms, setPerms]         = useState(null);
  const [loading, setLoading]     = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [u, rr, p] = await Promise.all([
      S.get('users'),
      S.get('reset_requests'),
      getSupervisorPerms(),
    ]);
    setAllUsers(u ?? []);
    setResetReqs(rr ?? []);
    setPerms(p);
    setLoading(false);
  }

  const myTeam = scopeToSupervisor(allUsers, user).filter(u => u.role === 'employee');
  const teamEmpIds = new Set(myTeam.map(u => u.emp_id));
  const pendingResets = (resetReqs ?? []).filter(r => r.status === 'pending' && teamEmpIds.has(r.emp_id));

  async function approveReset(rr) {
    const temp = `Temp@${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await S.update('users', { password: temp }, { emp_id: rr.emp_id });
    await S.update('reset_requests', { status: 'approved', temp_password: temp }, { id: rr.id });
    logAudit({ actor: user, action: 'reset_password', targetEmpId: rr.emp_id, targetName: rr.emp_name });
    window.alert(`Password reset approved.\nEmployee: ${rr.emp_name ?? rr.emp_id}\nTemp password: ${temp}\n\nShare securely.`);
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Team</div>
          <div className="page-subtitle">
            {myTeam.length} assigned employee{myTeam.length === 1 ? '' : 's'}
            {pendingResets.length > 0 && (
              <span className="col-red" style={{ marginLeft: 8 }}>· {pendingResets.length} reset request(s)</span>
            )}
          </div>
        </div>
        <button className="btn-sm" onClick={load}>↺ Refresh</button>
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
                      {perms?.resetPassword ? (
                        <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => approveReset(rr)}>
                          Approve & Reset
                        </button>
                      ) : (
                        <span className="text-muted text-sm">Disabled by admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Roster */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Team Roster</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Emp ID</th>
                <th>Name</th>
                <th>Process</th>
                <th className="right">Target</th>
                <th className="center">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && myTeam.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No employees assigned to you yet</td></tr>
              )}
              {myTeam.map(u => (
                <tr key={u.emp_id} style={!u.active ? { opacity: 0.5 } : undefined}>
                  <td className="bold text-sm">{u.emp_id}</td>
                  <td>{u.name ?? '—'}</td>
                  <td>{u.access || u.process || '—'}</td>
                  <td className="right">{u.target ?? '—'}</td>
                  <td className="center">
                    <span className={`badge ${u.active !== false ? 'badge-green' : 'badge-red'}`}>
                      {u.active !== false ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
