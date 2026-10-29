import { useState, useEffect, useCallback } from 'react';
import {
  listCompanies, createCompany, updateCompany, deleteCompany, syncCompanies,
  loadCompany, saveCompany,
} from '../../lib/company';
import {
  ownerConsoleReady, companyStats, structureStatus, loadPrivate, pauseCompany, ownerLog, codeOf, HOME_CODE,
} from '../../lib/owner';
import { countOff } from '../../lib/companyFeatures';
import { confirmDialog, promptDialog, alertDialog } from '../../components/shared/Dialog';
import CompanyManage from './CompanyManage';
import { OwnerBroadcasts, OwnerSecurity, OwnerPlatform } from './OwnerTabs';

// Helix Hub owner only — reached from the "Helix Hub owner" link on the login screen, never from a company login.
// Owner Console 2.0 (PO request 2026-10-29): Overview (watch every company), Companies (add / rename / Manage: plan,
// seats, pages on-off, pause, sign everyone out, banner, users + sign in as, activity, delete), Broadcasts, Owners &
// security (owner accounts, owner activity log, password), Platform (structure check, sync, version history).
const EMPTY = { name: '', code: '', adminId: 'ADMIN', adminName: 'Administrator', adminPassword: '' };
const TABS = [['overview', '🛰️ Overview'], ['companies', '🏢 Companies'], ['broadcasts', '📣 Broadcasts'], ['owners', '👑 Owners & security'], ['platform', '⚙️ Platform']];
const START_PAGES = [['', 'Default page'], ['teamdash', 'Team Dashboard'], ['today', 'Today'], ['team', 'Team'], ['settings', 'Settings'], ['auditlog', 'Audit Log']];

const fmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const ago = iso => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
const n = v => (v == null ? '—' : v.toLocaleString());

export default function OwnerConsole({ owner, onOpenCompany, onSignOut, onOwnerUpdate }) {
  const [tab, setTab]             = useState(() => sessionStorage.getItem('hh_owner_tab') || 'overview');
  const [home, setHome]           = useState(null);
  const [companies, setCompanies] = useState(undefined);   // undefined = loading, null = not installed
  const [ready, setReady]         = useState(true);        // migration 34 run?
  const [stats, setStats]         = useState({});          // key → companyStats
  const [structure, setStructure] = useState({});          // code → { missing_tables, missing_columns }
  const [privates, setPrivates]   = useState({});          // code → contact / notes
  const [form, setForm]           = useState(EMPTY);
  const [editing, setEditing]     = useState(null);        // { code, name, newCode?, isHome }
  const [busy, setBusy]           = useState(false);
  const [msg, setMsg]             = useState(null);        // { ok, text }
  const [manage, setManage]       = useState(null);        // company row being managed
  const [startPage, setStartPage] = useState('');

  const reload = useCallback(async () => {
    const [h, list, isReady] = await Promise.all([loadCompany(), listCompanies(), ownerConsoleReady()]);
    setHome(h);
    setCompanies(list);
    setReady(isReady);
    const all = [{ ...h, isHome: true }, ...(list ?? [])];
    const s = await Promise.all(all.map(c => companyStats(c.prefix ?? '')));
    setStats(Object.fromEntries(all.map((c, i) => [c.prefix || 'home', s[i]])));
    if (isReady) {
      const [st, pv] = await Promise.all([structureStatus(owner), loadPrivate(owner)]);
      setStructure(Object.fromEntries((st.data ?? []).map(r => [r.code, r])));
      setPrivates(Object.fromEntries((pv.data ?? []).map(r => [r.code, r])));
    }
  }, [owner]);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && reload());
    return () => { alive = false; };
  }, [reload]);

  const pickTab = t => { setTab(t); try { sessionStorage.setItem('hh_owner_tab', t); } catch { /* storage unavailable */ } };

  async function run(action, okText) {
    setMsg(null);
    setBusy(true);
    const { data, error } = await action();
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error === 'NOT_SET_UP' ? 'This needs the Owner Console database update (migration 34) — see the note at the top.' : error }); return false; }
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
    if (!await confirmDialog({
      title: 'Create this company?',
      message: `${form.name.trim()} (${form.code.trim().toUpperCase()})\nFirst admin: ${adminId}\n\nA separate copy of every table will be created for it. It starts with every page switched on.`,
      confirmText: 'Create Company',
    })) return;
    const ok = await run(
      () => createCompany(owner, form),
      d => `✓ ${d.name} is ready (${d.tables} tables created). Its users sign in with company “${d.name}” or “${d.code}”; the first admin is ${adminId} with the password you set.`,
    );
    if (ok) { ownerLog(owner, 'company_create', form.code.trim().toUpperCase(), form.name.trim()); setForm(EMPTY); }
  }

  async function saveEdit() {
    const name = editing.name.trim();
    if (!name) return;
    if (!await confirmDialog({
      title: 'Save company name?',
      message: `Users will type “${name}”${editing.isHome && editing.newCode?.trim() ? ` or “${editing.newCode.trim().toUpperCase()}”` : ''} on the login screen from now on.`,
      confirmText: 'Save',
    })) return;
    if (editing.isHome) {
      const ok = await saveCompany({ name, code: editing.newCode });
      setMsg(ok ? { ok: true, text: `✓ Home company saved as ${name}.` } : { ok: false, text: 'Could not save — please try again.' });
      if (ok) { ownerLog(owner, 'company_rename', HOME_CODE, name); setEditing(null); reload(); }
      return;
    }
    if (await run(() => updateCompany(owner, editing.code, { name }), `✓ Renamed to ${name}.`)) {
      ownerLog(owner, 'company_rename', editing.code, name);
      setEditing(null);
    }
  }

  // Pause asks for the message the company's users see; pausing also signs everyone out (≈2 min)
  async function togglePause(c) {
    if (c.active) {
      const message = await promptDialog({
        title: `Pause ${c.name}?`,
        message: 'Its users can’t sign in, and anyone signed in now is signed out within about 2 minutes. No data is touched. You can still open it yourself.\n\nMessage they’ll see (optional):',
        placeholder: 'e.g. Access paused — please contact 3Gen Consulting',
        defaultValue: c.pause_message ?? '',
        confirmText: 'Pause',
      });
      if (message === null) return;
      if (!ready) { run(() => updateCompany(owner, c.code, { active: false }), `✓ ${c.name} paused.`); return; }
      run(() => pauseCompany(owner, c.code, true, message), `✓ ${c.name} paused — its users are being signed out.`);
    } else {
      if (!await confirmDialog({ title: `Resume ${c.name}?`, message: 'Its users will be able to sign in again.', confirmText: 'Resume' })) return;
      if (!ready) { run(() => updateCompany(owner, c.code, { active: true }), `✓ ${c.name} resumed.`); return; }
      run(() => pauseCompany(owner, c.code, false, null), `✓ ${c.name} resumed.`);
    }
  }

  async function remove(c) {
    if (!await confirmDialog({
      title: `Delete ${c.name} permanently?`,
      message: 'ALL of its data (users, reports, targets, settings) will be deleted. This cannot be undone.',
      tone: 'danger', requireText: c.code, confirmText: 'Delete Company',
    })) return;
    if (await run(() => deleteCompany(owner, c.code), d => `✓ ${c.name} deleted (${d.tables_dropped} tables removed).`)) {
      ownerLog(owner, 'company_delete', c.code, c.name);
      setManage(null);
    }
  }

  async function sync() {
    if (!await confirmDialog({ title: 'Sync company structure?', message: 'Any tables or columns added in recent Helix Hub updates will be added to every company. Nothing is deleted.', confirmText: 'Sync' })) return;
    if (await run(() => syncCompanies(owner), d => (d.tables_created + d.columns_added)
      ? `✓ Synced: ${d.tables_created} table(s) and ${d.columns_added} column(s) added across companies.`
      : '✓ All companies are already up to date.')) ownerLog(owner, 'structure_sync', null);
  }

  const open = (c, opts = {}) => onOpenCompany(c, { startTab: startPage || undefined, ...opts });

  const rows = home ? [{ ...home, isHome: true, active: true }, ...(companies ?? [])] : [];
  const statOf = c => stats[c.prefix || 'home'] ?? {};
  const structOf = c => (c.isHome ? null : structure[c.code]);
  const needsSync = c => { const s = structOf(c); return !!s && (s.missing_tables + s.missing_columns) > 0; };

  // Platform totals + alerts
  const sum = k => rows.reduce((t, c) => t + (statOf(c)[k] ?? 0), 0);
  const alerts = rows.flatMap(c => {
    const s = statOf(c);
    const out = [];
    if (!c.active) out.push({ c, tone: 'gray', text: `${c.name} is paused` });
    if (s.signIns7 === 0) out.push({ c, tone: 'yellow', text: `${c.name}: nobody signed in for 7 days` });
    if (c.seat_limit && s.activeUsers != null && s.activeUsers > c.seat_limit) out.push({ c, tone: 'red', text: `${c.name}: ${s.activeUsers} active users, plan allows ${c.seat_limit}` });
    if (needsSync(c)) out.push({ c, tone: 'blue', text: `${c.name}: structure out of date — run Sync (Platform tab)` });
    return out;
  });

  return (
    <div className="main-content" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <div className="page-title">👑 Helix Hub · Owner Console</div>
            <div className="page-subtitle">
              Signed in as {owner.name} ({owner.username}). Company admins can't see this page.
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-sm" onClick={reload} disabled={busy}>↻ Refresh</button>
            <button className="btn btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>
          </div>
        </div>

        {!ready && companies !== null && (
          <div className="card mb-16" style={{ borderLeft: '4px solid var(--warning)' }}>
            <strong>One database update needed for the new owner controls.</strong>{' '}
            <span className="text-sm">Run <code>supabase/migrations/20261029_owner_console.sql</code> in Supabase → SQL Editor,
            then click ↻ Sync structure (Platform tab). Until then: overview numbers, users, sign in as, rename, pause / resume
            and delete work; plan, seats, page on-off, banners, broadcasts, owner accounts and the owner log are not set up yet.</span>
          </div>
        )}

        {companies === null && (
          <div className="card mb-16" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>One-time setup needed.</strong> Open Supabase → <strong>SQL Editor</strong>, paste the contents of{' '}
            <code>supabase/multi_company_setup.sql</code> from the Helix Hub code, and click <strong>Run</strong>. Then refresh this page.
          </div>
        )}

        <div className="tabs mb-16" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab-btn${tab === id ? ' active' : ''}`} onClick={() => pickTab(id)}>{label}</button>
          ))}
        </div>

        {msg && (
          <div className="card mb-16" role="status" style={{ padding: '10px 14px', color: msg.ok ? 'var(--success)' : 'var(--danger)', fontSize: 13, lineHeight: 1.5 }}>
            {msg.text} <button className="btn-link" style={{ width: 'auto', marginLeft: 8 }} onClick={() => setMsg(null)}>Dismiss</button>
          </div>
        )}

        {companies === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}

        {/* ── Overview ── */}
        {tab === 'overview' && companies !== undefined && (
          <>
            <div className="grid-4 mb-16">
              {[
                ['Companies', rows.length, `${rows.filter(c => !c.active).length} paused`],
                ['Active users', n(sum('activeUsers')), `${n(sum('users'))} accounts in total`],
                ['Sign-ins today', n(sum('signInsToday')), `${n(sum('signIns7'))} in the last 7 days`],
                ['Daily reports this week', n(sum('reportsWeek')), 'Submitted, all companies'],
              ].map(([label, value, sub]) => (
                <div key={label} className="stat-card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>
              ))}
            </div>

            {alerts.length > 0 && (
              <div className="card mb-16">
                <div className="card-title" style={{ marginBottom: 8 }}>⚠️ Needs your attention</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {alerts.map((a, i) => (
                    <button key={i} className={`badge badge-${a.tone}`} style={{ border: 0, cursor: 'pointer', padding: '5px 10px' }} onClick={() => setManage(a.c)}>{a.text}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="row mb-16" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="text-sm text-muted" htmlFor="ow-start">Open companies at</label>
              <select id="ow-start" value={startPage} onChange={e => setStartPage(e.target.value)} style={{ maxWidth: 200 }}>
                {START_PAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="grid-3 mb-16">
              {rows.map(c => {
                const s = statOf(c);
                const st = structOf(c);
                return (
                  <div key={c.prefix || 'home'} className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, borderTop: `3px solid ${c.active ? 'var(--success)' : 'var(--text-subtle)'}` }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="bold" style={{ fontSize: 15 }}>{c.name}</div>
                        <div className="text-sm text-muted"><code>{c.code || '—'}</code>{c.plan ? ` · ${c.plan}` : ''}</div>
                      </div>
                      <span className={`badge ${c.isHome ? 'badge-blue' : c.active ? 'badge-green' : 'badge-gray'}`}>{c.isHome ? 'Home' : c.active ? 'Active' : 'Paused'}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                      {[
                        ['Users', `${n(s.activeUsers)}${c.seat_limit ? ` / ${c.seat_limit}` : ''}`],
                        ['Sign-ins today', n(s.signInsToday)],
                        ['Last 7 days', n(s.signIns7)],
                        ['Reports (week)', n(s.reportsWeek)],
                        ['Prod % (week)', s.prodWeek == null ? '—' : `${Math.round(s.prodWeek)}%`],
                        ['Pages off', c.isHome ? '—' : countOff(c.features)],
                      ].map(([l, v]) => (
                        <div key={l} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '6px 8px' }}>
                          <div className="text-muted" style={{ fontSize: 10.5 }}>{l}</div><div className="bold">{v}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-sm text-muted">
                      Last activity: {s.lastActivity ? `${ago(s.lastActivity.created_at)} · ${s.lastActivity.actor_name ?? ''}` : 'none yet'}
                      {st && (st.missing_tables + st.missing_columns > 0) && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Needs sync</span>}
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                      <button className="btn-sm btn-primary" onClick={() => open(c)}>Open →</button>
                      <button className="btn-sm" onClick={() => setManage(c)}>Manage</button>
                      {!c.isHome && <button className="btn-sm" onClick={() => togglePause(c)} disabled={busy} style={c.active ? { color: 'var(--danger)' } : {}}>{c.active ? 'Pause' : 'Resume'}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Companies ── */}
        {tab === 'companies' && companies !== undefined && (
          <>
            <div className="card mb-16">
              <div className="card-header"><div className="card-title">Companies</div></div>
              <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
                Every company has its own completely separate users, task targets, processes, reports and settings.
                <strong> Open</strong> signs you in to that company with full admin access; <strong>Manage</strong> sets its plan, user
                limit, which pages it gets, banners, its users (reset password, sign in as) and shows its activity.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Company</th><th>Code</th><th>Plan</th><th>Users</th><th>Status</th><th>Added</th><th className="right"></th></tr>
                  </thead>
                  <tbody>
                    {rows.map(c => {
                      const key = c.prefix || 'home';
                      const isEditing = editing && (editing.isHome ? c.isHome : editing.code === c.code && !c.isHome);
                      const s = statOf(c);
                      return (
                        <tr key={key}>
                          <td className="bold">
                            {isEditing ? (
                              <input value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                                autoFocus style={{ maxWidth: 220 }} aria-label="Company name" />
                            ) : c.name}
                            {c.isHome && <span className="badge badge-blue" style={{ marginLeft: 8 }}>Home</span>}
                          </td>
                          <td>
                            {isEditing && c.isHome ? (
                              <input value={editing.newCode} onChange={e => setEditing(ed => ({ ...ed, newCode: e.target.value }))} maxLength={16} style={{ maxWidth: 110 }} aria-label="Company code" />
                            ) : <code>{c.code || '—'}</code>}
                          </td>
                          <td className="text-sm">{c.plan ?? '—'}</td>
                          <td>{n(s.activeUsers)}{c.seat_limit ? ` / ${c.seat_limit}` : ''}</td>
                          <td><span className={`badge ${c.active ? 'badge-green' : 'badge-gray'}`}>{c.active ? 'Active' : 'Paused'}</span></td>
                          <td className="text-muted">{c.created_at ? fmtDate(c.created_at) : '—'}</td>
                          <td className="right" style={{ whiteSpace: 'nowrap' }}>
                            {isEditing ? (
                              <>
                                <button className="btn-sm btn-primary" onClick={saveEdit} disabled={busy || !editing.name.trim()}>Save</button>{' '}
                                <button className="btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button className="btn-sm btn-primary" onClick={() => open(c)}>Open →</button>{' '}
                                <button className="btn-sm" onClick={() => setManage(c)}>Manage</button>{' '}
                                <button className="btn-sm" onClick={() => setEditing({ code: c.code, name: c.name, newCode: c.code, isHome: !!c.isHome })}>Rename</button>
                                {!c.isHome && (
                                  <>
                                    {' '}
                                    <button className="btn-sm" onClick={() => togglePause(c)} disabled={busy} style={c.active ? { color: 'var(--danger)' } : {}}>
                                      {c.active ? 'Pause' : 'Resume'}
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
            </div>

            {Array.isArray(companies) && (
              <form className="card mb-16" onSubmit={add}>
                <div className="card-header"><div className="card-title">Add a company</div></div>
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
                <div className="row" style={{ gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                  <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Working…' : '+ Add Company'}</button>
                  <span className="text-muted text-sm">It starts with every page switched on and default task targets; set its plan, user limit and pages in Manage.</span>
                </div>
              </form>
            )}
          </>
        )}

        {tab === 'broadcasts' && <OwnerBroadcasts owner={owner} rows={rows} ready={ready} />}
        {tab === 'owners' && <OwnerSecurity owner={owner} rows={rows} ready={ready} onOwnerUpdate={onOwnerUpdate} />}
        {tab === 'platform' && <OwnerPlatform rows={rows} structure={structure} ready={ready} busy={busy} onSync={sync} />}

        {manage && (
          <CompanyManage
            key={manage.prefix || 'home'}
            owner={owner}
            company={rows.find(c => (c.prefix || 'home') === (manage.prefix || 'home')) ?? manage}
            stats={statOf(manage)}
            priv={privates[codeOf(manage)]}
            ready={ready}
            onClose={() => setManage(null)}
            onChanged={reload}
            onOpen={(c, opts) => open(c, opts)}
            onTogglePause={togglePause}
            onDelete={remove}
            onNotice={(ok, text) => (ok ? setMsg({ ok, text }) : alertDialog({ title: 'Could not do that', message: text, tone: 'warning' }))}
          />
        )}
      </div>
    </div>
  );
}

