import { useState, useEffect, useCallback } from 'react';
import Changelog from '../admin/Changelog';
import { confirmDialog } from '../../components/shared/Dialog';
import { ownerChangePassword } from '../../lib/company';
import {
  loadBroadcasts, saveBroadcast, listOwners, addOwner, setOwnerActive, loadOwnerLog, ownerLog, codeOf, HOME_CODE,
} from '../../lib/owner';

// Owner Console 2.0 tabs: 📣 Broadcasts · 👑 Owners & security · ⚙️ Platform
const fmtWhen = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocalInput = v => (v ? new Date(v).toISOString() : '');
const NOT_SET_UP = 'This needs the Owner Console database update (migration 34) first.';
const errText = e => (e === 'NOT_SET_UP' ? NOT_SET_UP : e);

const OWNER_ACTIONS = {
  company_create: 'Added a company', company_rename: 'Renamed a company', company_delete: 'Deleted a company',
  company_settings: 'Changed company settings', company_pause: 'Paused a company', company_resume: 'Resumed a company',
  company_signout_all: 'Signed everyone out', company_private_save: 'Saved contact / notes',
  owner_open_company: 'Opened a company as admin', owner_sign_in_as: '🔑 Signed in as a user',
  owner_reset_password: 'Reset a user’s password', owner_user_activate: 'Switched a user on', owner_user_deactivate: 'Switched a user off',
  owner_add: 'Added an owner', owner_activate: 'Switched an owner on', owner_deactivate: 'Switched an owner off',
  broadcast_add: 'Sent a broadcast', broadcast_edit: 'Changed a broadcast', structure_sync: 'Synced structure',
  owner_password_change: 'Changed own owner password',
};
const KINDS = { info: 'ℹ️ Info', warning: '⚠️ Warning', maintenance: '🛠️ Maintenance' };
const EMPTY_B = { id: null, title: '', body: '', kind: 'info', companies: [], starts_at: '', ends_at: '', active: true };

function Notice({ msg }) {
  if (!msg) return null;
  return <p className="text-sm" role="status" style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)', margin: '8px 0 0' }}>{msg.text}</p>;
}

// ── 📣 Broadcasts ─────────────────────────────────────────────────────────────

export function OwnerBroadcasts({ owner, rows, ready }) {
  const [list, setList] = useState(undefined);
  const [b, setB] = useState(EMPTY_B);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    loadBroadcasts().then(r => { if (alive) setList(r); });
    return () => { alive = false; };
  }, [reload]);

  const nameOf = code => (code === HOME_CODE ? rows.find(r => r.isHome)?.name ?? 'Home company' : rows.find(r => r.code === code)?.name ?? code);
  const now = new Date().toISOString();
  const statusOf = x => (!x.active ? ['Stopped', 'badge-gray'] : x.starts_at > now ? ['Scheduled', 'badge-blue'] : x.ends_at && x.ends_at <= now ? ['Ended', 'badge-gray'] : ['Live', 'badge-green']);
  const toggleCo = code => setB(x => ({ ...x, companies: x.companies.includes(code) ? x.companies.filter(c => c !== code) : [...x.companies, code] }));

  async function save(e) {
    e.preventDefault();
    const who = b.companies.length ? b.companies.map(nameOf).join(', ') : 'every company';
    if (!await confirmDialog({ title: b.id ? 'Save this broadcast?' : 'Send this broadcast?', message: `“${b.title.trim()}” → ${who}. It shows as a banner at the top of their app.`, confirmText: b.id ? 'Save' : 'Send' })) return;
    setBusy(true);
    const r = await saveBroadcast(owner, b.id, { ...b, starts_at: fromLocalInput(b.starts_at), ends_at: fromLocalInput(b.ends_at) });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: errText(r.error) }); return; }
    setMsg({ ok: true, text: b.id ? '✓ Broadcast saved.' : '✓ Broadcast sent — users see it within about 10 minutes (or when they next open Helix Hub).' });
    setB(EMPTY_B);
    setReload(x => x + 1);
  }

  async function stop(x) {
    if (!await confirmDialog({ title: 'Stop this broadcast?', message: `“${x.title}” will no longer show.`, tone: 'warning', confirmText: 'Stop' })) return;
    const r = await saveBroadcast(owner, x.id, { ...x, active: false });
    if (r.error) { setMsg({ ok: false, text: errText(r.error) }); return; }
    setReload(y => y + 1);
  }

  return (
    <>
      <form className="card mb-16" onSubmit={save}>
        <div className="card-header"><div className="card-title">{b.id ? 'Edit broadcast' : 'Send a broadcast'}</div></div>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="bc-title">Title</label><input id="bc-title" value={b.title} onChange={e => setB({ ...b, title: e.target.value })} required placeholder="e.g. Helix Hub maintenance on Sunday 10 PM" /></div>
          <div className="field"><label htmlFor="bc-kind">Type</label>
            <select id="bc-kind" value={b.kind} onChange={e => setB({ ...b, kind: e.target.value })}>{Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="bc-body">Details (optional)</label><input id="bc-body" value={b.body} onChange={e => setB({ ...b, body: e.target.value })} /></div>
          <div className="field"><label htmlFor="bc-start">Show from (empty = now)</label><input id="bc-start" type="datetime-local" value={b.starts_at} onChange={e => setB({ ...b, starts_at: e.target.value })} /></div>
          <div className="field"><label htmlFor="bc-end">Show until (empty = until stopped)</label><input id="bc-end" type="datetime-local" value={b.ends_at} onChange={e => setB({ ...b, ends_at: e.target.value })} /></div>
        </div>
        <div className="field">
          <label>Companies <span className="text-muted">(none ticked = every company)</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {rows.map(c => (
              <label key={codeOf(c)} className="text-sm" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={b.companies.includes(codeOf(c))} onChange={() => toggleCo(codeOf(c))} />{c.name}
              </label>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="btn-primary" disabled={busy || !ready || !b.title.trim()}>{b.id ? 'Save' : '📣 Send'}</button>
          {b.id && <button type="button" className="btn-sm" onClick={() => setB(EMPTY_B)}>Cancel</button>}
        </div>
        {!ready && <p className="text-sm" style={{ color: 'var(--warning)' }}>{NOT_SET_UP}</p>}
        <Notice msg={msg} />
      </form>

      <div className="card mb-16">
        <div className="card-title" style={{ marginBottom: 8 }}>Broadcasts</div>
        {list === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}
        {list === null && <p className="text-sm text-muted">Not set up yet.</p>}
        {list && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Title</th><th>Type</th><th>Companies</th><th>From → until</th><th>Status</th><th className="right"></th></tr></thead>
              <tbody>
                {list.map(x => {
                  const [label, cls] = statusOf(x);
                  return (
                    <tr key={x.id}>
                      <td><div className="bold">{x.title}</div>{x.body && <div className="text-sm text-muted">{x.body}</div>}</td>
                      <td className="text-sm">{KINDS[x.kind] ?? x.kind}</td>
                      <td className="text-sm">{x.companies?.length ? x.companies.map(nameOf).join(', ') : 'Every company'}</td>
                      <td className="text-sm text-muted">{fmtWhen(x.starts_at)} → {x.ends_at ? fmtWhen(x.ends_at) : 'until stopped'}</td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-sm" onClick={() => setB({ ...x, body: x.body ?? '', starts_at: toLocalInput(x.starts_at), ends_at: toLocalInput(x.ends_at) })}>Edit</button>{' '}
                        {x.active && <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => stop(x)}>Stop</button>}
                      </td>
                    </tr>
                  );
                })}
                {!list.length && <tr><td colSpan={6} className="center text-muted">No broadcasts yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── 👑 Owners & security ──────────────────────────────────────────────────────

export function OwnerSecurity({ owner, rows, ready, onOwnerUpdate }) {
  const [owners, setOwners] = useState(undefined);
  const [log, setLog] = useState(undefined);
  const [nw, setNw] = useState({ username: '', name: '', password: '' });
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [pwMsg, setPwMsg] = useState(null);
  const [q, setQ] = useState('');
  const [reload, setReload] = useState(0);

  const load = useCallback(() => Promise.all([listOwners(owner), loadOwnerLog(owner, 300)]), [owner]);
  useEffect(() => {
    let alive = true;
    load().then(([o, l]) => { if (!alive) return; setOwners(o.data ?? null); setLog(l.data ?? null); });
    return () => { alive = false; };
  }, [load, reload]);

  const coName = code => (!code ? '' : code === HOME_CODE ? rows.find(r => r.isHome)?.name ?? 'Home company' : rows.find(r => r.code === code)?.name ?? code);

  async function add(e) {
    e.preventDefault();
    if (!await confirmDialog({ title: 'Add this owner?', message: `${nw.name || 'New owner'} (${nw.username.trim().toUpperCase()}) gets FULL owner access: every company, pause, delete, sign in as anyone.`, tone: 'warning', confirmText: 'Add owner' })) return;
    const r = await addOwner(owner, nw);
    if (r.error) { setMsg({ ok: false, text: errText(r.error) }); return; }
    setMsg({ ok: true, text: `✓ Owner ${nw.username.trim().toUpperCase()} added. They sign in with “Helix Hub owner sign in” on the login screen.` });
    setNw({ username: '', name: '', password: '' });
    setReload(x => x + 1);
  }

  async function toggle(o) {
    if (!await confirmDialog(o.active
      ? { title: `Switch owner ${o.username} off?`, message: 'They can no longer sign in to the Owner Console.', tone: 'danger', confirmText: 'Switch off' }
      : { title: `Switch owner ${o.username} on?`, message: 'They get full owner access again.', confirmText: 'Switch on' })) return;
    const r = await setOwnerActive(owner, o.username, !o.active);
    if (r.error) { setMsg({ ok: false, text: errText(r.error) }); return; }
    setReload(x => x + 1);
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    if (!await confirmDialog({ title: 'Change your owner password?', message: 'Use the new password the next time you sign in.', tone: 'warning', confirmText: 'Change Password' })) return;
    const { error } = await ownerChangePassword(owner, pw.next);
    if (error) { setPwMsg({ ok: false, text: error }); return; }
    onOwnerUpdate({ ...owner, password: pw.next });
    ownerLog({ ...owner, password: pw.next }, 'owner_password_change', null);
    setPw({ next: '', confirm: '' });
    setPwMsg({ ok: true, text: '✓ Password changed.' });
  }

  const shownLog = (log ?? []).filter(l => !q.trim() || `${l.owner} ${OWNER_ACTIONS[l.action] ?? l.action} ${coName(l.company_code)} ${l.target ?? ''} ${l.details?.reason ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="grid-2 mb-16" style={{ alignItems: 'start' }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Owner accounts</div>
          {owners === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}
          {owners === null && <p className="text-sm text-muted">{NOT_SET_UP}</p>}
          {owners && (
            <table>
              <tbody>
                {owners.map(o => (
                  <tr key={o.username}>
                    <td><div className="bold">{o.name}</div><div className="text-sm text-muted">{o.username}{o.username === owner.username ? ' · you' : ''}</div></td>
                    <td><span className={`badge ${o.active ? 'badge-green' : 'badge-gray'}`}>{o.active ? 'Active' : 'Off'}</span></td>
                    <td className="right">{o.username !== owner.username && <button className="btn-sm" onClick={() => toggle(o)}>{o.active ? 'Switch off' : 'Switch on'}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form onSubmit={add} style={{ marginTop: 12 }}>
            <div className="text-sm bold" style={{ marginBottom: 6 }}>Add an owner</div>
            <div className="grid-3" style={{ gap: 8 }}>
              <input aria-label="Username" placeholder="Username" value={nw.username} onChange={e => setNw({ ...nw, username: e.target.value })} required minLength={3} />
              <input aria-label="Name" placeholder="Name" value={nw.name} onChange={e => setNw({ ...nw, name: e.target.value })} />
              <input aria-label="Password" type="password" placeholder="Password (8+)" value={nw.password} onChange={e => setNw({ ...nw, password: e.target.value })} required minLength={8} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn-sm btn-primary" style={{ marginTop: 8 }} disabled={!ready}>+ Add owner</button>
            <Notice msg={msg} />
          </form>
        </div>

        <form className="card" style={{ margin: 0 }} onSubmit={changePassword}>
          <div className="card-title" style={{ marginBottom: 8 }}>My owner password</div>
          <div className="field"><label htmlFor="ow-pw">New password (min 8 characters)</label>
            <input id="ow-pw" type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} required minLength={8} autoComplete="new-password" /></div>
          <div className="field"><label htmlFor="ow-pw2">Confirm new password</label>
            <input id="ow-pw2" type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} required minLength={8} autoComplete="new-password" /></div>
          <button type="submit" className="btn-primary">Change password</button>
          <Notice msg={pwMsg} />
        </form>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Owner activity log</div>
          <input type="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 220 }} aria-label="Search the owner log" />
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>Every owner action — opening companies, 🔑 sign in as, pauses, page changes, password resets, broadcasts. Only owners can see it.</p>
        {log === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}
        {log === null && <p className="text-sm text-muted">{NOT_SET_UP}</p>}
        {log && (
          <div className="table-wrap" style={{ maxHeight: '55vh', overflow: 'auto' }}>
            <table>
              <thead><tr><th>When</th><th>Owner</th><th>What</th><th>Company</th><th>Who / which</th><th>Reason / details</th></tr></thead>
              <tbody>
                {shownLog.map(l => (
                  <tr key={l.id}>
                    <td className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtWhen(l.created_at)}</td>
                    <td className="text-sm">{l.owner}</td>
                    <td className="text-sm">{OWNER_ACTIONS[l.action] ?? l.action.replace(/_/g, ' ')}</td>
                    <td className="text-sm">{coName(l.company_code)}</td>
                    <td className="text-sm">{l.target ?? ''}</td>
                    <td className="text-sm text-muted">{l.details?.reason ?? l.details?.message ?? (l.details?.changed ? `Changed: ${l.details.changed.join(', ')}` : '')}</td>
                  </tr>
                ))}
                {!shownLog.length && <tr><td colSpan={6} className="center text-muted">Nothing logged yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── ⚙️ Platform ───────────────────────────────────────────────────────────────

export function OwnerPlatform({ rows, structure, ready, busy, onSync }) {
  const added = rows.filter(c => !c.isHome);
  return (
    <>
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Structure check</div>
          {added.length > 0 && (
            <button className="btn-sm" onClick={onSync} disabled={busy} title="Run after a Helix Hub update that adds new tables or columns, so every company gets them">↻ Sync structure</button>
          )}
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          Each added company has its own copy of every table. After a Helix Hub update (or a new database migration), Sync adds
          the missing tables and columns to every company. Nothing is ever deleted.
        </p>
        {!added.length && <p className="text-sm text-muted">No added companies yet.</p>}
        {added.length > 0 && (
          <table>
            <thead><tr><th>Company</th><th>Missing tables</th><th>Missing columns</th><th>Status</th></tr></thead>
            <tbody>
              {added.map(c => {
                const s = structure[c.code];
                const behind = s && (s.missing_tables + s.missing_columns) > 0;
                return (
                  <tr key={c.code}>
                    <td className="bold">{c.name}</td>
                    <td>{s ? s.missing_tables : '—'}</td>
                    <td>{s ? s.missing_columns : '—'}</td>
                    <td>{!ready ? <span className="badge badge-gray">Check needs migration 34</span> : !s ? '—' : behind ? <span className="badge badge-blue">Needs sync</span> : <span className="badge badge-green">Up to date</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Changelog />
    </>
  );
}
