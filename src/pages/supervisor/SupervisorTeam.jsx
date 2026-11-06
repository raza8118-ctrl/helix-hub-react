import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { scopeToSupervisor, permsFor, logAudit } from '../../lib/helpers';
import { alertDialog, confirmDialog } from '../../components/shared/Dialog';
import { tempPassword } from '../../lib/owner';
import { Pill, Button } from '../../components/ui';

export default function SupervisorTeam({ user }) {
  const [allUsers, setAllUsers]   = useState([]);
  const [resetReqs, setResetReqs] = useState([]);
  const perms = permsFor(user);
  const [loading, setLoading]     = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [u, rr] = await Promise.all([
      S.get('users'),
      S.get('reset_requests'),
    ]);
    setAllUsers(u ?? []);
    setResetReqs(rr ?? []);
    setLoading(false);
  }

  const myTeam = scopeToSupervisor(allUsers, user).filter(u => u.role === 'employee');
  const teamEmpIds = new Set(myTeam.map(u => u.emp_id));
  const pendingResets = (resetReqs ?? []).filter(r => r.status === 'pending' && teamEmpIds.has(r.emp_id));

  async function approveReset(rr) {
    if (!await confirmDialog({ title: 'Reset password?', message: `A temporary password will be created for ${rr.emp_name ?? rr.emp_id}.`, tone: 'warning', confirmText: 'Reset Password' })) return;
    const temp = tempPassword();
    await S.update('users', { password: temp }, { emp_id: rr.emp_id });
    await S.update('reset_requests', { status: 'approved' }, { id: rr.id });   // shown once below, never saved
    logAudit({ actor: user, action: 'reset_password', targetEmpId: rr.emp_id, targetName: rr.emp_name });
    await alertDialog({ title: 'Password reset', message: `Employee: ${rr.emp_name ?? rr.emp_id}\nTemporary password: ${temp}\n\nShare it securely.`, tone: 'success' });
    await load();
  }

  return (
    <div className="fg-page">
      {/* Summary + actions (the page title is in the top bar) */}
      <div className="fg-bar">
        <div className="fg-filters">
          <span className="tm-count">{myTeam.length} assigned employee{myTeam.length === 1 ? '' : 's'}</span>
          {pendingResets.length > 0 && (
            <span className="col-red tm-resets">· {pendingResets.length} reset request(s)</span>
          )}
        </div>
        <div className="fg-actions">
          <Button size="sm" onClick={load}>↺ Refresh</Button>
        </div>
      </div>

      {/* Password reset approvals */}
      {pendingResets.length > 0 && (
        <div className="card fg-card fg-tracker tm-reset">
          <div className="card-header">
            <div className="card-title tm-reset-t">⚠ Password Reset Requests</div>
            <Pill tone="warn">{pendingResets.length} pending</Pill>
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
                        <Button size="xs" variant="primary" onClick={() => approveReset(rr)}>
                          Approve & Reset
                        </Button>
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
      <div className="card fg-card fg-tracker">
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
                <tr><td colSpan={5} className="fg-empty">No employees assigned to you yet</td></tr>
              )}
              {myTeam.map(u => (
                <tr key={u.emp_id} className={!u.active ? 'tm-faded' : undefined}>
                  <td className="bold text-sm">{u.emp_id}</td>
                  <td>{u.name ?? '—'}</td>
                  <td>{u.access || u.process || '—'}</td>
                  <td className="right">{u.target ?? '—'}</td>
                  <td className="center">
                    <Pill tone={u.active !== false ? 'good' : 'bad'}>
                      {u.active !== false ? 'Active' : 'Disabled'}
                    </Pill>
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
