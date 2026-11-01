import { useState, useEffect } from 'react';
import Modal from '../../components/shared/Modal';
import BarChart from '../../components/shared/BarChart';
import { confirmDialog, promptDialog, alertDialog } from '../../components/shared/Dialog';
import { FEATURE_GROUPS, ALL_FEATURES, isFeatureOn } from '../../lib/companyFeatures';
import { actionLabel } from '../../lib/auditLabels';
import {
  saveCompanySettings, savePrivate, forceSignOut, companyUsers, companyUserForSignIn, setUserPassword, setUserActive,
  companyAudit, companyActivity, ownerLog, tempPassword, codeOf, demoStatus, demoLoad, demoRemove,
} from '../../lib/owner';
import { loadHomeFeatures, saveHomeFeatures } from '../../lib/company';

const SECTIONS = [['profile', 'Profile & plan'], ['access', 'Pages'], ['users', 'Users'], ['activity', 'Activity'], ['danger', 'Pause & danger zone']];
const fmtWhen = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');

/**
 * Owner Console 2.0 — everything about one company: plan, user limit, contact + private notes, banner, which pages it
 * gets, its users (reset password, switch off / on, 🔑 sign in as), activity, pause / sign everyone out / delete.
 * The home company has no plan / pause (it's the platform's own company); its pages on / off are kept in the home kv store.
 */
export default function CompanyManage({ owner, company: c, stats, priv, ready, onClose, onChanged, onOpen, onTogglePause, onDelete, onNotice }) {
  const isHome = !!c.isHome;
  const code = codeOf(c);
  const prefix = c.prefix ?? '';
  const [section, setSection] = useState('profile');
  const [busy, setBusy] = useState(false);

  // Profile & plan
  const [p, setP] = useState(() => ({
    plan: c.plan ?? '', seat_limit: c.seat_limit ?? '', bannerText: c.banner?.text ?? '', bannerKind: c.banner?.kind ?? 'info',
    contact_name: priv?.contact_name ?? '', contact_email: priv?.contact_email ?? '', contact_phone: priv?.contact_phone ?? '', notes: priv?.notes ?? '',
  }));
  const setF = k => e => setP(x => ({ ...x, [k]: e.target.value }));

  // Pages on / off ({ key: false } = off)
  const [features, setFeatures] = useState(() => ({ ...(c.features ?? {}) }));
  const offCount = ALL_FEATURES.filter(f => !isFeatureOn(features, f.key)).length;
  useEffect(() => {   // home company: its pages are in the home kv store, not on a registry row
    if (!isHome) return;
    let alive = true;
    loadHomeFeatures().then(f => { if (alive) setFeatures({ ...f }); });
    return () => { alive = false; };
  }, [isHome]);

  // Users + activity load when their section opens
  const [users, setUsers] = useState(undefined);
  const [q, setQ] = useState('');
  const [activity, setActivity] = useState(null);
  const [reloadUsers, setReloadUsers] = useState(0);
  const [demo, setDemo] = useState(undefined);   // demo data counts (added companies only)
  const [reloadDemo, setReloadDemo] = useState(0);

  useEffect(() => {
    if (section !== 'demo' || isHome) return;
    let alive = true;
    demoStatus(owner, code).then(r => { if (alive) setDemo(r.error ? null : r.data); });
    return () => { alive = false; };
  }, [section, isHome, owner, code, reloadDemo]);

  useEffect(() => {
    if (section !== 'users') return;
    let alive = true;
    companyUsers(prefix).then(u => { if (alive) setUsers(u); });
    return () => { alive = false; };
  }, [section, prefix, reloadUsers]);

  useEffect(() => {
    if (section !== 'activity') return;
    let alive = true;
    companyActivity(prefix).then(a => { if (alive) setActivity(a); });
    return () => { alive = false; };
  }, [section, prefix]);

  async function saveProfile() {
    setBusy(true);
    const errors = [];
    if (!isHome) {
      const seats = String(p.seat_limit).trim();
      if (seats && (!/^\d+$/.test(seats) || Number(seats) < 1)) { setBusy(false); onNotice(false, 'User limit must be a whole number (or empty for no limit).'); return; }
      const r = await saveCompanySettings(owner, c.code, {
        plan: p.plan, seat_limit: seats || null,
        banner: p.bannerText.trim() ? { text: p.bannerText.trim(), kind: p.bannerKind } : null,
      });
      if (r.error) errors.push(r.error);
    }
    const r2 = await savePrivate(owner, code, { contact_name: p.contact_name, contact_email: p.contact_email, contact_phone: p.contact_phone, notes: p.notes });
    if (r2.error) errors.push(r2.error);
    setBusy(false);
    if (errors.length) { onNotice(false, errors.includes('NOT_SET_UP') ? 'This needs the Owner Console database update (migration 34) first.' : errors.join(' · ')); return; }
    onNotice(true, `✓ ${c.name}: profile and plan saved.`);
    onChanged();
  }

  async function saveAccess() {
    const off = Object.fromEntries(ALL_FEATURES.filter(f => !isFeatureOn(features, f.key)).map(f => [f.key, false]));
    if (!await confirmDialog({
      title: `Save pages for ${c.name}?`,
      message: offCount ? `${offCount} page(s) / module(s) will be hidden for everyone in ${c.name}, its admins included. Signed-in users see the change within about 2 minutes.` : `Every page will be switched on for ${c.name}.`,
      confirmText: 'Save',
    })) return;
    setBusy(true);
    if (isHome) {   // the home company has no registry row: its pages live in the home kv store
      const ok = await saveHomeFeatures(off);
      setBusy(false);
      if (!ok) { onNotice(false, 'Could not save the pages. Please try again.'); return; }
      const offKeys = Object.keys(off);
      companyAudit(prefix, owner, 'owner_set_pages', {}, { off: offKeys });
      ownerLog(owner, 'company_settings', code, `Pages: ${offCount} switched off`, { off: offKeys });
      onNotice(true, `✓ ${c.name}: pages saved (${offCount} switched off).`);
      onChanged();
      return;
    }
    const r = await saveCompanySettings(owner, c.code, { features: off });
    setBusy(false);
    if (r.error) { onNotice(false, r.error === 'NOT_SET_UP' ? 'This needs the Owner Console database update (migration 34) first.' : r.error); return; }
    onNotice(true, `✓ ${c.name}: pages saved (${offCount} switched off).`);
    onChanged();
  }

  async function resetPassword(u) {
    if (!await confirmDialog({ title: `Reset ${u.name ?? u.emp_id}'s password?`, message: 'A new temporary password is created and shown to you once. Give it to them; they can change it in their Profile.', tone: 'warning', confirmText: 'Reset password' })) return;
    const temp = tempPassword();
    if (!await setUserPassword(prefix, u.emp_id, temp)) { onNotice(false, 'Could not reset the password. Please try again.'); return; }
    companyAudit(prefix, owner, 'owner_reset_password', { emp_id: u.emp_id, name: u.name });
    ownerLog(owner, 'owner_reset_password', code, `${u.name ?? ''} (${u.emp_id})`);
    await alertDialog({ title: 'New temporary password', message: `${u.name ?? u.emp_id} (${u.emp_id}) at ${c.name}:\n\n${temp}\n\nCopy it now — it won't be shown again.`, tone: 'success' });
  }

  async function toggleUser(u) {
    const on = u.active === false;
    if (!await confirmDialog(on
      ? { title: `Switch ${u.name ?? u.emp_id} back on?`, message: 'They will be able to sign in again.', confirmText: 'Switch on' }
      : { title: `Switch ${u.name ?? u.emp_id} off?`, message: "They won't be able to sign in. No data is deleted.", tone: 'danger', confirmText: 'Switch off' })) return;
    if (!await setUserActive(prefix, u.emp_id, on)) { onNotice(false, 'Could not change the user. Please try again.'); return; }
    companyAudit(prefix, owner, on ? 'activate_user' : 'deactivate_user', { emp_id: u.emp_id, name: u.name });
    ownerLog(owner, on ? 'owner_user_activate' : 'owner_user_deactivate', code, `${u.name ?? ''} (${u.emp_id})`);
    setReloadUsers(x => x + 1);
  }

  async function signInAs(u) {
    const reason = await promptDialog({
      title: `🔑 Sign in as ${u.name ?? u.emp_id}?`,
      message: `You'll see ${c.name} exactly as ${u.name ?? u.emp_id} does. A purple banner stays on screen, and everything you do is logged as "via Helix Hub owner ${owner.username}" in ${c.name}'s Audit Log and in your owner log.\n\nReason (optional):`,
      placeholder: 'e.g. Checking a reported problem',
      confirmText: 'Sign in as',
    });
    if (reason === null) return;
    const full = await companyUserForSignIn(prefix, u.emp_id);
    if (!full) { onNotice(false, 'Could not load that user. Please try again.'); return; }
    onOpen(c, { asUser: full, reason });
  }

  async function signOutAll() {
    if (!await confirmDialog({ title: `Sign everyone in ${c.name} out?`, message: 'Everyone signed in is sent back to the login screen within about 2 minutes. They can sign straight back in.', tone: 'warning', confirmText: 'Sign everyone out' })) return;
    setBusy(true);
    const r = await forceSignOut(owner, c.code);
    setBusy(false);
    if (r.error) { onNotice(false, r.error === 'NOT_SET_UP' ? 'This needs the Owner Console database update (migration 34) first.' : r.error); return; }
    onNotice(true, `✓ Everyone in ${c.name} is being signed out.`);
    onChanged();
  }

  const shownUsers = (users ?? []).filter(u => !q.trim() || `${u.name ?? ''} ${u.emp_id} ${u.role}`.toLowerCase().includes(q.trim().toLowerCase()));
  // The home company gets Pages too (PO 2026-10-30); its Pause tab only explains it can't be paused. Demo data: added companies only.
  const sections = isHome ? SECTIONS : [...SECTIONS.slice(0, 4), ['demo', 'Demo data'], SECTIONS[4]];
  const demoLoaded = (demo?.users ?? 0) > 0;

  async function loadDemo() {
    if (!await confirmDialog({ title: `Load demo data into ${c.name}?`, message: 'Adds fake clients, payers, 9 demo users (DEMO-01…09), 30 days of production numbers, a denials worklist and denial steps. All of it is tagged so “Remove demo data” takes it out again. No patient data.', confirmText: 'Load demo data' })) return;
    setBusy(true);
    const r = await demoLoad(owner, code);
    setBusy(false);
    if (r.error) { onNotice(false, r.error === 'NOT_SET_UP' ? 'Demo data needs the database update (migration 41).' : r.error); return; }
    setReloadDemo(x => x + 1);
    onChanged();
    await alertDialog({ title: 'Demo data loaded', message: `Demo users DEMO-01 to DEMO-09 (DEMO-09 is the supervisor) sign in with company “${c.name}” and this password:

${r.data.password}

It is shown only now — note it down. You can also use “Open as admin →”.`, tone: 'success' });
  }

  async function removeDemo() {
    if (!await confirmDialog({ title: `Remove demo data from ${c.name}?`, message: 'Deletes only the demo rows (DEMO users, their reports, demo clients / payers, the demo worklist and denial steps). Anything your team added by hand stays.', tone: 'danger', confirmText: 'Remove demo data' })) return;
    setBusy(true);
    const r = await demoRemove(owner, code);
    setBusy(false);
    if (r.error) { onNotice(false, r.error); return; }
    setReloadDemo(x => x + 1);
    onChanged();
    const kept = r.data?.kept ?? [];
    onNotice(true, kept.length ? `✓ Demo data removed. Kept: ${kept.join('; ')}.` : '✓ Demo data removed.');
  }

  return (
    <Modal title={`${c.name} — Manage`} onClose={onClose} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={`badge ${isHome ? 'badge-blue' : c.active ? 'badge-green' : 'badge-gray'}`}>{isHome ? 'Home company' : c.active ? 'Active' : 'Paused'}</span>
        <span className="text-sm text-muted">{stats?.activeUsers ?? '—'} active users{c.seat_limit ? ` of ${c.seat_limit}` : ''} · {stats?.signIns7 ?? '—'} sign-ins in 7 days</span>
        <button className="btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => onOpen(c)}>Open as admin →</button>
      </div>

      <div className="tabs mb-16" role="tablist">
        {sections.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={`tab-btn${section === id ? ' active' : ''}`} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      {!ready && section !== 'users' && section !== 'activity' && (
        <p className="text-sm" style={{ color: 'var(--warning)' }}>Saving here needs the Owner Console database update (migration 34).</p>
      )}

      {section === 'profile' && (
        <div>
          {!isHome && (
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="cm-plan">Plan name</label><input id="cm-plan" value={p.plan} onChange={setF('plan')} placeholder="e.g. Standard, Pro, Trial" /></div>
              <div className="field"><label htmlFor="cm-seats">User limit (active users)</label><input id="cm-seats" inputMode="numeric" value={p.seat_limit} onChange={setF('seat_limit')} placeholder="Empty = no limit" /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="cm-banner">Banner for this company's users</label>
                <div className="row" style={{ gap: 8 }}>
                  <select value={p.bannerKind} onChange={setF('bannerKind')} style={{ maxWidth: 150 }} aria-label="Banner type">
                    <option value="info">ℹ️ Info</option><option value="warning">⚠️ Warning</option><option value="maintenance">🛠️ Maintenance</option>
                  </select>
                  <input id="cm-banner" value={p.bannerText} onChange={setF('bannerText')} placeholder="Empty = no banner. e.g. Invoice overdue — please contact 3Gen" />
                </div>
              </div>
            </div>
          )}
          <div className="card-title" style={{ margin: '6px 0 8px' }}>Contact & private notes <span className="text-muted text-sm">(only owners see these)</span></div>
          <div className="grid-3" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="cm-cn">Contact person</label><input id="cm-cn" value={p.contact_name} onChange={setF('contact_name')} /></div>
            <div className="field"><label htmlFor="cm-ce">Email</label><input id="cm-ce" type="email" value={p.contact_email} onChange={setF('contact_email')} /></div>
            <div className="field"><label htmlFor="cm-cp">Phone</label><input id="cm-cp" value={p.contact_phone} onChange={setF('contact_phone')} /></div>
          </div>
          <div className="field"><label htmlFor="cm-notes">Notes (billing, contract, anything — never patient details)</label><textarea id="cm-notes" rows={3} value={p.notes} onChange={setF('notes')} /></div>
          <button className="btn-primary" onClick={saveProfile} disabled={busy || !ready}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      {section === 'access' && (
        <div>
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>
            Untick a page or module to hide it for everyone in {c.name}, its admins included. Daily Report, My Reports, Team,
            Settings, Clients & Payers, Audit Log and Profile are always on. When you open the company you see exactly what they see.
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <button className="btn-sm" onClick={() => setFeatures({})}>All on</button>
            <button className="btn-sm" onClick={() => setFeatures(Object.fromEntries(ALL_FEATURES.map(f => [f.key, false])))}>All off</button>
            <span className="text-sm text-muted">{offCount} switched off</span>
          </div>
          {FEATURE_GROUPS.map(g => (
            <fieldset key={g.group} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
              <legend className="bold text-sm" style={{ padding: '0 6px' }}>{g.group}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 12px' }}>
                {g.items.map(f => (
                  <label key={f.key} className="text-sm" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={isFeatureOn(features, f.key)}
                      onChange={e => setFeatures(x => { const next = { ...x }; if (e.target.checked) delete next[f.key]; else next[f.key] = false; return next; })} />
                    {f.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <button className="btn-primary" onClick={saveAccess} disabled={busy || !ready}>{busy ? 'Saving…' : 'Save pages'}</button>
        </div>
      )}

      {section === 'users' && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input type="search" placeholder="Search name, ID or role…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label="Search users" />
            <span className="text-sm text-muted">{users ? `${users.length} users` : ''}</span>
          </div>
          {users === undefined && <div className="loading-row"><div className="spinner" /> Loading…</div>}
          {users === null && <p className="text-sm">Couldn't load this company's users.</p>}
          {users && (
            <div className="table-wrap" style={{ maxHeight: '50vh', overflow: 'auto' }}>
              <table>
                <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="right"></th></tr></thead>
                <tbody>
                  {shownUsers.map(u => (
                    <tr key={u.emp_id}>
                      <td><div className="bold">{u.name ?? '—'}</div><div className="text-sm text-muted">{u.emp_id}{u.team ? ` · ${u.team}` : ''}</div></td>
                      <td className="text-sm">{u.role}</td>
                      <td><span className={`badge ${u.active === false ? 'badge-gray' : 'badge-green'}`}>{u.active === false ? 'Off' : 'Active'}</span></td>
                      <td className="text-sm text-muted">{fmtWhen(u.last_sign_in)}</td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-sm" onClick={() => signInAs(u)} disabled={u.active === false} title="Master key: see the app as this person">🔑 Sign in as</button>{' '}
                        <button className="btn-sm" onClick={() => resetPassword(u)}>Reset password</button>{' '}
                        <button className="btn-sm" onClick={() => toggleUser(u)} style={u.active === false ? {} : { color: 'var(--danger)' }}>{u.active === false ? 'Switch on' : 'Switch off'}</button>
                      </td>
                    </tr>
                  ))}
                  {!shownUsers.length && <tr><td colSpan={5} className="center text-muted">No users match</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === 'activity' && (
        <div>
          {!activity && <div className="loading-row"><div className="spinner" /> Loading…</div>}
          {activity && (
            <>
              <div className="card-title" style={{ marginBottom: 4 }}>Sign-ins per day · last 30 days</div>
              <BarChart data={activity.daily.map(d => ({ name: d.date.slice(5), value: d.n }))} mode="value" height={170} />
              <div className="card-title" style={{ margin: '12px 0 6px' }}>Latest activity</div>
              <div className="table-wrap" style={{ maxHeight: '38vh', overflow: 'auto' }}>
                <table>
                  <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th></tr></thead>
                  <tbody>
                    {activity.recent.map((r, i) => (
                      <tr key={i}>
                        <td className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtWhen(r.created_at)}</td>
                        <td className="text-sm">{r.actor_name ?? r.actor_emp_id ?? '—'}</td>
                        <td className="text-sm">{actionLabel(r.action)}</td>
                        <td className="text-sm text-muted">{r.target_name ?? ''}</td>
                      </tr>
                    ))}
                    {!activity.recent.length && <tr><td colSpan={4} className="center text-muted">No activity yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {section === 'demo' && !isHome && (
        <div className="card" style={{ margin: 0 }}>
          <div className="bold">Demo data</div>
          <p className="text-sm text-muted">Fake, clearly labelled data for showing Helix Hub: demo clients and payers, 9 demo users, 30 days of production numbers, a denials worklist and denial steps. No real names, no patient data. Never available for the home company.</p>
          {demo === undefined && <div className="loading-row"><div className="spinner" /> Checking…</div>}
          {demo === null && <p className="text-sm" style={{ color: 'var(--warning)' }}>Demo data needs the database update (migration 41).</p>}
          {demo && (
            <p className="text-sm" style={{ margin: '10px 0' }}>
              {demoLoaded
                ? <>Loaded: <strong>{demo.users}</strong> users · <strong>{demo.clients}</strong> clients · <strong>{demo.payers}</strong> payers · <strong>{demo.daily_reports}</strong> daily reports · <strong>{demo.denied_claims}</strong> denied claims · <strong>{demo.denial_entries}</strong> denial steps</>
                : 'No demo data loaded.'}
            </p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-sm btn-primary" onClick={loadDemo} disabled={busy || !demo || demoLoaded}>＋ Load demo data</button>
            <button className="btn-sm" onClick={removeDemo} disabled={busy || !demo || !demoLoaded} style={{ color: 'var(--danger)' }}>Remove demo data</button>
          </div>
        </div>
      )}

      {section === 'danger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isHome ? (
            <p className="text-sm text-muted">The home company can't be paused or deleted. You can still reset passwords, switch users off and sign in as anyone (Users).</p>
          ) : (
            <>
              <div className="card" style={{ margin: 0 }}>
                <div className="bold">{c.active ? 'Pause login' : 'Resume login'}</div>
                <p className="text-sm text-muted">{c.active
                  ? 'Blocks sign-in with your message and signs out anyone signed in (≈2 min). No data is touched; you can still open it.'
                  : `Paused${c.pause_message ? ` — “${c.pause_message}”` : ''}. Resuming lets its users sign in again.`}</p>
                <button className="btn-sm" onClick={() => onTogglePause(c)} style={c.active ? { color: 'var(--danger)' } : {}}>{c.active ? '⏸ Pause' : '▶ Resume'}</button>
              </div>
              <div className="card" style={{ margin: 0 }}>
                <div className="bold">Sign everyone out now</div>
                <p className="text-sm text-muted">Everyone signed in goes back to the login screen within about 2 minutes (they can sign straight back in). Use it after changing passwords or pages.</p>
                <button className="btn-sm" onClick={signOutAll} disabled={busy || !ready}>⎋ Sign everyone out</button>
              </div>
              <div className="card" style={{ margin: 0, borderLeft: '4px solid var(--danger)' }}>
                <div className="bold" style={{ color: 'var(--danger)' }}>Delete company</div>
                <p className="text-sm text-muted">Deletes ALL of {c.name}'s data — users, reports, targets, settings. This cannot be undone. Pausing is usually better.</p>
                <button className="btn-sm" onClick={() => onDelete(c)} style={{ color: 'var(--danger)' }}>Delete {c.name}…</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
