import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  companyUsers, companyUserForSignIn, setUserPassword, setUserActive, setUserRole, companyAudit, ownerLog, tempPassword, codeOf,
} from '../../lib/owner';
import { confirmDialog, promptDialog, alertDialog } from '../../components/shared/Dialog';
import CopyButton from '../../components/shared/CopyButton';
import Modal from '../../components/shared/Modal';

/**
 * Owner Command Center → People (PO 2026-11-09): every user in every company in one table.
 * Reset password · switch off / on · change role · sign in as. Each action goes to the owner log AND the company's Audit Log.
 * Switching off and a new password end that person's sessions (existing database triggers); a role change does too (migration 46).
 */
const ROLES = ['employee', 'supervisor', 'manager', 'admin'];
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const fmtWhen = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not in 120 days');
const MAX_ROWS = 300;
const keyOf = c => c.prefix || 'home';

export default function OwnerPeople({ owner, rows, onOpen, onNotice }) {
  const [people, setPeople] = useState(undefined);   // undefined = loading
  const [failed, setFailed] = useState([]);          // companies whose users couldn't load
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('all');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('active');
  const [roleFor, setRoleFor] = useState(null);      // { u, role } while the change-role box is open
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const lists = await Promise.all(rows.map(c => companyUsers(c.prefix ?? '')));
    setFailed(rows.filter((c, i) => lists[i] === null).map(c => c.name));
    setPeople(rows.flatMap((c, i) => (lists[i] ?? []).map(u => ({ ...u, company: c }))));
  }, [rows]);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && load());
    return () => { alive = false; };
  }, [load]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (people ?? []).filter(u =>
      (company === 'all' || keyOf(u.company) === company)
      && (role === 'all' || (u.role ?? 'employee') === role)
      && (status === 'all' || (status === 'active' ? u.active !== false : u.active === false))
      && (!term || `${u.name ?? ''} ${u.emp_id}`.toLowerCase().includes(term)));
  }, [people, q, company, role, status]);

  const who = u => `${u.name ?? u.emp_id} (${u.emp_id})`;

  async function resetPassword(u) {
    const c = u.company;
    if (!await confirmDialog({ title: `Reset ${u.name ?? u.emp_id}'s password?`, message: `${c.name}. A new temporary password is created and shown to you once. They are signed out and can change it in their Profile.`, tone: 'warning', confirmText: 'Reset password' })) return;
    const temp = tempPassword();
    if (!await setUserPassword(c.prefix ?? '', u.emp_id, temp)) { onNotice(false, 'Could not reset the password. Please try again.'); return; }
    companyAudit(c.prefix ?? '', owner, 'owner_reset_password', { emp_id: u.emp_id, name: u.name });
    ownerLog(owner, 'owner_reset_password', codeOf(c), who(u));
    await alertDialog({ title: 'New temporary password', message: `${who(u)} at ${c.name}:\n\n${temp}\n\nCopy it now — it won't be shown again.`, tone: 'success' });
  }

  async function toggleUser(u) {
    const c = u.company;
    const on = u.active === false;
    if (!await confirmDialog(on
      ? { title: `Switch ${u.name ?? u.emp_id} back on?`, message: `${c.name}. They will be able to sign in again.`, confirmText: 'Switch on' }
      : { title: `Switch ${u.name ?? u.emp_id} off?`, message: `${c.name}. They can't sign in, and if they are signed in now they are signed out within about 2 minutes. No data is deleted.`, tone: 'danger', confirmText: 'Switch off' })) return;
    if (!await setUserActive(c.prefix ?? '', u.emp_id, on)) { onNotice(false, 'Could not change the user. Please try again.'); return; }
    companyAudit(c.prefix ?? '', owner, on ? 'activate_user' : 'deactivate_user', { emp_id: u.emp_id, name: u.name });
    ownerLog(owner, on ? 'owner_user_activate' : 'owner_user_deactivate', codeOf(c), who(u));
    onNotice(true, `${who(u)} at ${c.name} switched ${on ? 'on' : 'off'}.`);
    load();
  }

  async function saveRole(e) {
    e.preventDefault();
    const { u, role: next } = roleFor;
    setBusy(true);
    const r = await setUserRole(owner, codeOf(u.company), u.emp_id, next);
    setBusy(false);
    if (r.error) { onNotice(false, r.error === 'NOT_SET_UP' ? 'Changing roles needs the People database update (migration 46) first.' : r.error); return; }
    if (r.data?.ok === false) { onNotice(false, r.data.error === 'not_found' ? 'That user no longer exists.' : 'Could not change the role.'); return; }
    setRoleFor(null);
    onNotice(true, r.data?.unchanged ? `${who(u)} is already ${cap(next)}.` : `${who(u)} at ${u.company.name} is now ${cap(next)} (was ${cap(r.data?.from)}). They were signed out so the new role applies.`);
    load();
  }

  async function signInAs(u) {
    const c = u.company;
    const reason = await promptDialog({
      title: `Sign in as ${u.name ?? u.emp_id}?`,
      message: `You'll see ${c.name} exactly as ${u.name ?? u.emp_id} does. Everything you do is logged as "via Helix Hub owner ${owner.username}" in ${c.name}'s Audit Log and in your owner log.\n\nReason (optional):`,
      placeholder: 'e.g. Checking a reported problem',
      confirmText: 'Sign in as',
    });
    if (reason === null) return;
    const full = await companyUserForSignIn(c.prefix ?? '', u.emp_id);
    if (!full) { onNotice(false, 'Could not load that user. Please try again.'); return; }
    onOpen(c, { asUser: full, reason });
  }

  const total = people?.length ?? 0;

  return (
    <div className="fg-page">
      <div className="fg-bar">
        <div className="fg-filters">
          <label className="fg-f"><span>Search</span>
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or ID" aria-label="Search by name or ID" />
          </label>
          <label className="fg-f"><span>Company</span>
            <select value={company} onChange={e => setCompany(e.target.value)}>
              <option value="all">All companies</option>
              {rows.map(c => <option key={keyOf(c)} value={keyOf(c)}>{c.name}</option>)}
            </select>
          </label>
          <label className="fg-f"><span>Role</span>
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="all">All roles</option>
              {ROLES.map(r => <option key={r} value={r}>{cap(r)}</option>)}
            </select>
          </label>
          <label className="fg-f"><span>Status</span>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="off">Switched off</option>
              <option value="all">All</option>
            </select>
          </label>
          <span className="fg-date">{people === undefined ? 'Loading…' : `${shown.length} of ${total} people`}</span>
        </div>
      </div>

      {failed.length > 0 && <div className="ot-warn" role="alert">Couldn't load the users of: {failed.join(', ')}.</div>}

      <div className="card fg-card fg-tracker">
        <div className="table-wrap">
          <table className="op-table">
            <thead>
              <tr><th>Name</th><th>Company</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="right">Actions</th></tr>
            </thead>
            <tbody>
              {people === undefined && <tr><td colSpan={6}><div className="loading-row"><div className="spinner" /> Loading everyone…</div></td></tr>}
              {people !== undefined && !shown.length && <tr><td colSpan={6} className="center text-muted">No one matches these filters.</td></tr>}
              {shown.slice(0, MAX_ROWS).map(u => (
                <tr key={`${keyOf(u.company)}:${u.emp_id}`} className={u.active === false ? 'op-off' : ''}>
                  <td>
                    <div className="bold">{u.name ?? '—'}</div>
                    <div className="op-id"><code>{u.emp_id}</code><CopyButton value={u.emp_id} title={`Copy ${u.emp_id}`} /></div>
                  </td>
                  <td>{u.company.name}</td>
                  <td>{cap(u.role ?? 'employee')}</td>
                  <td><span className={`badge ${u.active === false ? 'badge-gray' : 'badge-green'}`}>{u.active === false ? 'Off' : 'Active'}</span></td>
                  <td className="text-sm text-muted">{fmtWhen(u.last_sign_in)}</td>
                  <td className="right">
                    <div className="op-actions">
                      <button type="button" className="btn-sm" onClick={() => signInAs(u)} disabled={u.active === false} title="See the app as this person">Sign in as</button>
                      <button type="button" className="btn-sm" onClick={() => setRoleFor({ u, role: u.role ?? 'employee' })}>Change role</button>
                      <button type="button" className="btn-sm" onClick={() => resetPassword(u)}>Reset password</button>
                      <button type="button" className="btn-sm" onClick={() => toggleUser(u)} style={u.active === false ? {} : { color: 'var(--danger)' }}>
                        {u.active === false ? 'Switch on' : 'Switch off'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > MAX_ROWS && <p className="text-sm text-muted" style={{ margin: '10px 0 0' }}>Showing the first {MAX_ROWS} — search or filter to narrow it down.</p>}
      </div>

      {roleFor && (
        <Modal title={`Change role — ${roleFor.u.name ?? roleFor.u.emp_id}`} onClose={() => setRoleFor(null)}>
          <form onSubmit={saveRole}>
            <p className="text-sm" style={{ marginTop: 0 }}>{roleFor.u.company.name} · {roleFor.u.emp_id} · now <strong>{cap(roleFor.u.role ?? 'employee')}</strong></p>
            <div className="field">
              <label htmlFor="op-role">New role</label>
              <select id="op-role" value={roleFor.role} onChange={e => setRoleFor(r => ({ ...r, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{cap(r)}</option>)}
              </select>
            </div>
            <p className="text-sm text-muted">They are signed out so the new role applies when they sign in again. Logged in your owner log and in {roleFor.u.company.name}'s Audit Log.</p>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-sm" onClick={() => setRoleFor(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy || roleFor.role === (roleFor.u.role ?? 'employee')}>{busy ? 'Saving…' : 'Change role'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
