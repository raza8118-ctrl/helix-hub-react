import { useState, useEffect } from 'react';
import { listCompanies, createCompany, updateCompany, syncCompanies } from '../../lib/company';

// Main-admin only: add companies (each gets its own copy of every table) and
// activate/deactivate them. Rendered inside Settings for the home company.
const EMPTY = { name: '', code: '', adminId: 'ADMIN', adminName: 'Administrator', adminPassword: '' };

export default function Companies({ user }) {
  const [companies, setCompanies] = useState(undefined);   // undefined = loading, null = not installed
  const [form, setForm]           = useState(EMPTY);
  const [busy, setBusy]           = useState(false);
  const [msg, setMsg]             = useState(null);        // { ok, text }

  useEffect(() => { reload(); }, []);

  async function reload() {
    setCompanies(await listCompanies());
  }

  const set = key => e => setForm(f => ({
    ...f,
    [key]: e.target.value,
    // Suggest a code from the name until the admin types one
    ...(key === 'name' && !f.codeTouched
      ? { code: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() }
      : {}),
    ...(key === 'code' ? { codeTouched: true } : {}),
  }));

  async function add(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { data, error } = await createCompany(user, form);
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error }); return; }
    setMsg({
      ok: true,
      text: `✓ ${data.name} is ready (${data.tables} tables created). Sign in with company “${data.name}” or “${data.code}”, then ${form.adminId.trim().toUpperCase()} and the password you set.`,
    });
    setForm(EMPTY);
    reload();
  }

  async function sync() {
    setMsg(null);
    setBusy(true);
    const { data, error } = await syncCompanies(user);
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error }); return; }
    const changes = data.tables_created + data.columns_added;
    setMsg({
      ok: true,
      text: changes
        ? `✓ Synced: ${data.tables_created} table(s) and ${data.columns_added} column(s) added across companies.`
        : '✓ All companies are already up to date.',
    });
  }

  async function toggle(c) {
    const verb = c.active ? 'Deactivate' : 'Activate';
    if (c.active && !window.confirm(`${verb} ${c.name}? Its users won't be able to sign in until it's activated again. No data is deleted.`)) return;
    const { error } = await updateCompany(user, c.code, { active: !c.active });
    if (error) setMsg({ ok: false, text: error });
    reload();
  }

  return (
    <div className="card mb-16">
      <div className="card-header">
        <div className="card-title">Companies</div>
        <div className="row" style={{ gap: 8 }}>
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
          <span className="badge badge-blue">Main Admin</span>
        </div>
      </div>
      <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
        Each company gets the same Helix Hub interface with its own completely separate users, task targets,
        processes, reports, and settings, so productivity calculations never mix between companies.
      </p>

      {companies === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}

      {companies === null && (
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.6 }}>
          <strong>One-time setup needed.</strong> Open Supabase → <strong>SQL Editor</strong>, paste the contents of{' '}
          <code>supabase/multi_company_setup.sql</code> from the Helix Hub code, and click <strong>Run</strong>.
          Then refresh this page.
        </div>
      )}

      {Array.isArray(companies) && (
        <>
          <div className="table-wrap mb-16">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th className="right"></th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No companies added yet</td></tr>
                )}
                {companies.map(c => (
                  <tr key={c.code}>
                    <td className="bold">{c.name}</td>
                    <td><code>{c.code}</code></td>
                    <td><span className={`badge ${c.active ? 'badge-green' : 'badge-gray'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                    <td className="text-muted">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="right">
                      <button className="btn-sm" onClick={() => toggle(c)} style={c.active ? { color: 'var(--danger)' } : {}}>
                        {c.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={add}>
            <div className="section-title">Add a company</div>
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
                {busy ? 'Creating…' : '+ Add Company'}
              </button>
              <span className="text-muted text-sm">The company starts with default task targets; its own admin can then set up its team and targets.</span>
            </div>
          </form>
        </>
      )}

      {msg && (
        <p className="text-sm" style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)', marginTop: 12, lineHeight: 1.5 }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
