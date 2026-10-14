import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  listCompanies, createCompany, updateCompany, deleteCompany, syncCompanies,
  loadCompany, saveCompany, ownerChangePassword,
} from '../../lib/company';

// Helix Hub owner only — reached from the "Helix Hub owner" link on the login
// screen, never from a company login. Add, rename, activate/deactivate, delete
// companies, and open any company's workspace with full admin access.
const EMPTY = { name: '', code: '', adminId: 'ADMIN', adminName: 'Administrator', adminPassword: '' };

const fmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Number of users in a company (prefix '' = home company), or null if unavailable
async function countUsers(prefix) {
  const { count, error } = await supabase.from(prefix + 'users').select('*', { count: 'exact', head: true });
  return error ? null : count;
}

export default function OwnerConsole({ owner, onOpenCompany, onSignOut, onOwnerUpdate }) {
  const [home, setHome]           = useState(null);
  const [companies, setCompanies] = useState(undefined);   // undefined = loading, null = not installed
  const [userCounts, setUserCounts] = useState({});
  const [form, setForm]           = useState(EMPTY);
  const [editing, setEditing]     = useState(null);        // { code, name, newCode?, isHome }
  const [busy, setBusy]           = useState(false);
  const [msg, setMsg]             = useState(null);        // { ok, text }
  const [pw, setPw]               = useState({ next: '', confirm: '' });
  const [pwMsg, setPwMsg]         = useState(null);

  useEffect(() => { reload(); }, []);

  async function reload() {
    const [h, list] = await Promise.all([loadCompany(), listCompanies()]);
    setHome(h);
    setCompanies(list);
    const all = [h, ...(list ?? [])];
    const counts = await Promise.all(all.map(c => countUsers(c.prefix)));
    setUserCounts(Object.fromEntries(all.map((c, i) => [c.prefix || 'home', counts[i]])));
  }

  async function run(action, okText) {
    setMsg(null);
    setBusy(true);
    const { data, error } = await action();
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error }); return false; }
    if (okText) setMsg({ ok: true, text: typeof okText === 'function' ? okText(data) : okText });
    reload();
    return true;
  }

  const set = key => e => setForm(f => ({
    ...f,
    [key]: e.target.value,
    // Suggest a code from the name until the owner types one
    ...(key === 'name' && !f.codeTouched
      ? { code: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() }
      : {}),
    ...(key === 'code' ? { codeTouched: true } : {}),
  }));

  async function add(e) {
    e.preventDefault();
    const adminId = form.adminId.trim().toUpperCase();
    const ok = await run(
      () => createCompany(owner, form),
      d => `✓ ${d.name} is ready (${d.tables} tables created). Its users sign in with company “${d.name}” or “${d.code}”; the first admin is ${adminId} with the password you set.`,
    );
    if (ok) setForm(EMPTY);
  }

  async function saveEdit() {
    const name = editing.name.trim();
    if (!name) return;
    if (editing.isHome) {
      const ok = await saveCompany({ name, code: editing.newCode });
      setMsg(ok ? { ok: true, text: `✓ Home company saved as ${name}.` } : { ok: false, text: 'Could not save — please try again.' });
      if (ok) { setEditing(null); reload(); }
      return;
    }
    if (await run(() => updateCompany(owner, editing.code, { name }), `✓ Renamed to ${name}.`)) setEditing(null);
  }

  async function toggle(c) {
    if (c.active && !window.confirm(`Deactivate ${c.name}? Its users won't be able to sign in until it's activated again. No data is deleted.`)) return;
    run(() => updateCompany(owner, c.code, { active: !c.active }), `✓ ${c.name} ${c.active ? 'deactivated' : 'activated'}.`);
  }

  async function remove(c) {
    const typed = window.prompt(
      `Permanently delete ${c.name} and ALL of its data (users, reports, targets, settings)? This cannot be undone.\n\nType the company code ${c.code} to confirm:`,
    );
    if (typed == null) return;
    if (typed.trim().toUpperCase() !== c.code) { setMsg({ ok: false, text: 'Code did not match — nothing was deleted.' }); return; }
    run(() => deleteCompany(owner, c.code), d => `✓ ${c.name} deleted (${d.tables_dropped} tables removed).`);
  }

  function sync() {
    run(() => syncCompanies(owner), d => (d.tables_created + d.columns_added)
      ? `✓ Synced: ${d.tables_created} table(s) and ${d.columns_added} column(s) added across companies.`
      : '✓ All companies are already up to date.');
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    const { error } = await ownerChangePassword(owner, pw.next);
    if (error) { setPwMsg({ ok: false, text: error }); return; }
    onOwnerUpdate({ ...owner, password: pw.next });
    setPw({ next: '', confirm: '' });
    setPwMsg({ ok: true, text: '✓ Password changed.' });
  }

  const rows = home ? [{ ...home, isHome: true, active: true }, ...(companies ?? [])] : [];

  return (
    <div className="main-content" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <div className="page-title">Helix Hub · Owner Console</div>
            <div className="page-subtitle">
              Signed in as {owner.name} ({owner.username}). Company admins can't see this page.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>
        </div>

        {/* Companies */}
        <div className="card mb-16">
          <div className="card-header">
            <div className="card-title">Companies</div>
            {Array.isArray(companies) && companies.length > 0 && (
              <button
                className="btn-sm"
                onClick={sync}
                disabled={busy}
                title="Run after a Helix Hub update that adds new tables or columns, so every company gets them"
              >
                ↻ Sync structure
              </button>
            )}
          </div>
          <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
            Every company has its own completely separate users, task targets, processes, reports and settings.
            <strong> Open</strong> signs you in to that company with full admin access, to view or change anything there.
          </p>

          {companies === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}

          {companies === null && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              <strong>One-time setup needed.</strong> Open Supabase → <strong>SQL Editor</strong>, paste the contents of{' '}
              <code>supabase/multi_company_setup.sql</code> from the Helix Hub code, and click <strong>Run</strong>.
              Then refresh this page.
            </div>
          )}

          {companies !== undefined && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Code</th>
                    <th>Users</th>
                    <th>Status</th>
                    <th>Added</th>
                    <th className="right"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(c => {
                    const key = c.prefix || 'home';
                    const isEditing = editing && (editing.isHome ? c.isHome : editing.code === c.code && !c.isHome);
                    return (
                      <tr key={key}>
                        <td className="bold">
                          {isEditing ? (
                            <input
                              value={editing.name}
                              onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                              autoFocus
                              style={{ maxWidth: 220 }}
                            />
                          ) : c.name}
                          {c.isHome && <span className="badge badge-blue" style={{ marginLeft: 8 }}>Home</span>}
                        </td>
                        <td>
                          {isEditing && c.isHome ? (
                            <input
                              value={editing.newCode}
                              onChange={e => setEditing(ed => ({ ...ed, newCode: e.target.value }))}
                              maxLength={16}
                              style={{ maxWidth: 110 }}
                            />
                          ) : <code>{c.code || '—'}</code>}
                        </td>
                        <td>{userCounts[key] ?? '—'}</td>
                        <td><span className={`badge ${c.active ? 'badge-green' : 'badge-gray'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                        <td className="text-muted">{c.created_at ? fmtDate(c.created_at) : '—'}</td>
                        <td className="right" style={{ whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <>
                              <button className="btn-sm btn-primary" onClick={saveEdit} disabled={busy || !editing.name.trim()}>Save</button>{' '}
                              <button className="btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn-sm btn-primary" onClick={() => onOpenCompany(c)} disabled={!c.active}>Open →</button>{' '}
                              <button className="btn-sm" onClick={() => setEditing({ code: c.code, name: c.name, newCode: c.code, isHome: !!c.isHome })}>Edit</button>
                              {!c.isHome && (
                                <>
                                  {' '}
                                  <button className="btn-sm" onClick={() => toggle(c)} disabled={busy} style={c.active ? { color: 'var(--danger)' } : {}}>
                                    {c.active ? 'Deactivate' : 'Activate'}
                                  </button>{' '}
                                  <button className="btn-sm" onClick={() => remove(c)} disabled={busy} style={{ color: 'var(--danger)' }} title="Delete company and all its data">
                                    Delete
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {msg && (
            <p className="text-sm" style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)', marginTop: 12, lineHeight: 1.5 }}>
              {msg.text}
            </p>
          )}
        </div>

        {/* Add a company */}
        {Array.isArray(companies) && (
          <form className="card mb-16" onSubmit={add}>
            <div className="card-header">
              <div className="card-title">Add a company</div>
            </div>
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="nc-name">Company name</label>
                <input id="nc-name" value={form.name} onChange={set('name')} placeholder="e.g. Acme Health" required />
              </div>
              <div className="field">
                <label htmlFor="nc-code">Short code (2–16 letters/numbers)</label>
                <input id="nc-code" value={form.code} onChange={set('code')} placeholder="e.g. ACME" required maxLength={16} />
              </div>
              <div className="field">
                <label htmlFor="nc-admin">First admin — Employee ID</label>
                <input id="nc-admin" value={form.adminId} onChange={set('adminId')} required />
              </div>
              <div className="field">
                <label htmlFor="nc-admin-name">First admin — Name</label>
                <input id="nc-admin-name" value={form.adminName} onChange={set('adminName')} />
              </div>
              <div className="field">
                <label htmlFor="nc-pw">First admin — Password (min 6 characters)</label>
                <input id="nc-pw" type="text" value={form.adminPassword} onChange={set('adminPassword')} required minLength={6} autoComplete="off" />
              </div>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Working…' : '+ Add Company'}
              </button>
              <span className="text-muted text-sm">The company starts with default task targets; its own admin can then set up its team and targets.</span>
            </div>
          </form>
        )}

        {/* Owner account */}
        <form className="card mb-16" onSubmit={changePassword}>
          <div className="card-header">
            <div className="card-title">My owner account</div>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <label htmlFor="ow-pw">New password (min 8 characters)</label>
              <input id="ow-pw" type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} required minLength={8} autoComplete="new-password" />
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <label htmlFor="ow-pw2">Confirm new password</label>
              <input id="ow-pw2" type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} required minLength={8} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn-primary">Change password</button>
          </div>
          {pwMsg && (
            <p className="text-sm" style={{ color: pwMsg.ok ? 'var(--success)' : 'var(--danger)', marginTop: 8 }}>{pwMsg.text}</p>
          )}
        </form>
      </div>
    </div>
  );
}
