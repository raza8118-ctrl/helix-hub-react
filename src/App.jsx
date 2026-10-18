import { useState, useEffect, Suspense, lazy } from 'react';
import Login       from './components/Login';
import Sidebar     from './components/Sidebar';
import Profile     from './components/shared/Profile';
import Starfield   from './components/shared/Starfield';
import { THEMES }  from './lib/constants';
import { S, kv, setActiveCompany, refreshCompanyProcesses } from './lib/supabase';
import { getOwnerSession, setOwnerSession } from './lib/company';
import { WORKBENCH_TABS } from './pages/workbench/modules';
import './index.css';

// Owns its own 1s tick so the whole app doesn't re-render every second
// along with it — only this small corner of the page-topbar does.
function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  );
}

// Lazy-loaded per role — a given user only ever needs one of these three bundles.
const AdminApp      = lazy(() => import('./pages/admin/AdminApp'));
const SupervisorApp = lazy(() => import('./pages/supervisor/SupervisorApp'));
const EmployeeApp   = lazy(() => import('./pages/employee/EmployeeApp'));
const OwnerConsole  = lazy(() => import('./pages/owner/OwnerConsole'));

// ── Theme helper ──────────────────────────────────────────────────────────────
const THEME_CLASSES = ['dark', 'dusk', 'mist', 'stars'];

function applyTheme(themeId) {
  const found = THEMES.find(t => t.id === themeId);
  if (!found) return;
  document.body.style.background = found.bg;
  document.body.style.setProperty('--topbar-bg', found.topbar);
  THEME_CLASSES.forEach(c => document.body.classList.remove(c));
  if (found.dark) document.body.classList.add('dark');
  if (found.cls)  document.body.classList.add(found.cls);
  // Starfield backdrop for dark themes + Dusk; High Contrast stays plain for readability
  if ((found.dark || found.cls === 'dusk') && found.id !== 'highcontrast') document.body.classList.add('stars');
}

// ── Tab definitions ───────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'dashboard',   label: 'Dashboard',     icon: '🧭', section: 'Monitoring' },
  { id: 'today',       label: 'Today',         icon: '📅', section: 'Monitoring' },
  { id: 'prodmonitor', label: 'Prod Monitor',  icon: '📊', section: 'Monitoring' },
  { id: 'qualitymon',  label: 'Quality',       icon: '⭐', section: 'Monitoring' },
  { id: 'hourlymon',   label: 'Hourly',        icon: '⏱️', section: 'Monitoring' },
  { id: 'weekly',      label: 'Weekly',        icon: '🗓️', section: 'Monitoring' },
  { id: 'monthly',     label: 'Monthly',       icon: '📆', section: 'Monitoring' },
  { id: 'team',        label: 'Team',          icon: '👥', section: 'Team' },
  { id: 'allocation',  label: 'Work Alloc',    icon: '🗂️', section: 'Team' },
  { id: 'allocmon',    label: 'Alloc Monitor', icon: '📋', section: 'Team' },
  ...WORKBENCH_TABS,
  { id: 'feedback',    label: 'Announcements', icon: '📢', section: 'Engagement' },
  { id: 'feed',        label: 'Team Feed',     icon: '💬', section: 'Engagement' },
  { id: 'feedmonitor', label: 'Feed Monitor',  icon: '🖼️', section: 'Engagement' },
  { id: 'settings',    label: 'Settings',      icon: '⚙️', section: 'System' },
];

const SUPERVISOR_TABS = [
  { id: 'dashboard',   label: 'Dashboard',     icon: '🧭', section: 'Monitoring' },
  { id: 'today',       label: 'Today',         icon: '📅', section: 'Monitoring' },
  { id: 'prodmonitor', label: 'Prod Monitor',  icon: '📊', section: 'Monitoring' },
  { id: 'hourlymon',   label: 'Hourly',        icon: '⏱️', section: 'Monitoring' },
  { id: 'weekly',      label: 'Weekly',        icon: '🗓️', section: 'Monitoring' },
  { id: 'monthly',     label: 'Monthly',       icon: '📆', section: 'Monitoring' },
  { id: 'myteam',      label: 'My Team',       icon: '🧑‍🤝‍🧑', section: 'Team' },
  ...WORKBENCH_TABS,
  { id: 'feedback',    label: 'Announcements', icon: '📢', section: 'Engagement' },
  { id: 'feed',        label: 'Team Feed',     icon: '💬', section: 'Engagement' },
];

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [owner, setOwner]             = useState(getOwnerSession);   // Helix Hub owner, if signed in
  const [theme, setTheme]             = useState(THEMES[0].id);
  const [activeTab, setActiveTab]     = useState('today');
  const [showProfile, setShowProfile] = useState(false);
  const [hasDeficit, setHasDeficit]   = useState(false);
  const [unreadFeedback, setUnreadFeedback] = useState(0);
  const [missedDay, setMissedDay]     = useState(null);
  const [missedDismissed, setMissedDismissed] = useState(false);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = sessionStorage.getItem('hh_user');
        if (!raw) return;
        const u = JSON.parse(raw);
        await refreshCompanyProcesses().catch(() => {});
        setCurrentUser(u);
        const isAdmin = u.role === 'admin' || u.role === 'manager';
        const isSupervisor = u.role === 'supervisor';
        const savedTab = sessionStorage.getItem('hh_tab');
        setActiveTab(savedTab || ((isAdmin || isSupervisor) ? 'today' : 'prodreport'));

        let t = u.theme || THEMES[0].id;
        try {
          const prefs = await kv.get(`prefs_${u.emp_id}`);
          if (prefs?.theme && THEMES.find(th => th.id === prefs.theme)) t = prefs.theme;
        } catch { /* use default */ }
        setTheme(t);
        applyTheme(t);
      } catch { /* ignore corrupt session */ }
    })();
  }, []);

  // ── Unread feedback count (employees only) ──────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
    if (isAdmin) return;

    async function checkUnread() {
      const [all, acks, users] = await Promise.all([
        S.get('feedback'),
        S.get('feedback_acks', { emp_id: currentUser.emp_id }),
        S.get('users'),
      ]);
      const ackedBroadcastIds = new Set((acks ?? []).map(a => a.feedback_id));
      const mySupervisorIds = users?.find(u => u.emp_id === currentUser.emp_id)?.supervisor_ids ?? [];
      const cnt = (all ?? []).filter(f => {
        let mine;
        if (f.to_emp_id) {
          mine = f.to_emp_id === currentUser.emp_id;
        } else {
          const sender = users?.find(u => u.emp_id === f.from_emp_id);
          mine = sender?.role === 'supervisor' ? mySupervisorIds.includes(sender.emp_id) : true;
        }
        if (!mine) return false;
        return f.to_emp_id ? !f.acknowledged : !ackedBroadcastIds.has(f.id);
      }).length;
      setUnreadFeedback(cnt);
    }
    checkUnread().catch(() => {});
    const id = setInterval(() => checkUnread().catch(() => {}), 25000);
    return () => clearInterval(id);
  }, [currentUser]);

  // ── Deficit check (admins only, today's data) ───────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
    if (!isAdmin) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    S.get('daily_logs', { date: todayStr }).then(logs => {
      const anyDeficit = (logs ?? []).some(l => {
        const adjT = l.adj_target ?? l.target;
        if (!adjT || l.total == null) return false;
        return Math.round((l.total / adjT) * 100) < 100;
      });
      setHasDeficit(anyDeficit);
    }).catch(() => {});
  }, [currentUser]);

  // ── Missed log check (employees only) ──────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const isAdm = currentUser.role === 'admin' || currentUser.role === 'manager';
    const isSup = currentUser.role === 'supervisor';
    if (isAdm || isSup) return;
    if (sessionStorage.getItem('hh_missed_dismissed')) { setMissedDismissed(true); return; }
    (async () => {
      try {
        for (let daysBack = 1; daysBack <= 7; daysBack++) {
          const d = new Date();
          d.setDate(d.getDate() - daysBack);
          if (d.getDay() === 0 || d.getDay() === 6) continue;
          const dateStr = [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0'),
          ].join('-');
          const holidays = await S.get('holidays', { date: dateStr }).catch(() => []);
          if (holidays?.length) break;
          const logs = await S.get('daily_logs', { emp_id: currentUser.emp_id, date: dateStr });
          if (!logs?.length) setMissedDay(dateStr);
          break;
        }
      } catch { /* non-critical */ }
    })();
  }, [currentUser]);

  // ── Tab switch (persisted so a browser refresh stays on the same tab) ───────
  function handleSetTab(tabId) {
    setActiveTab(tabId);
    sessionStorage.setItem('hh_tab', tabId);
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  async function handleLogin(u) {
    await refreshCompanyProcesses().catch(() => {});
    const isAdmin = u.role === 'admin' || u.role === 'manager';
    const isSupervisor = u.role === 'supervisor';
    setCurrentUser(u);
    const startTab = (isAdmin || isSupervisor) ? 'today' : 'prodreport';
    setActiveTab(startTab);
    sessionStorage.setItem('hh_user', JSON.stringify(u));
    sessionStorage.setItem('hh_tab', startTab);

    // Load saved theme from rcm:prefs:{empId}
    let t = u.theme || THEMES[0].id;
    try {
      const prefs = await kv.get(`prefs_${u.emp_id}`);
      if (prefs?.theme && THEMES.find(th => th.id === prefs.theme)) {
        t = prefs.theme;
      }
    } catch { /* use default */ }
    setTheme(t);
    applyTheme(t);
  }

  // ── Missed banner dismiss ────────────────────────────────────────────────────
  function dismissMissedBanner() {
    setMissedDismissed(true);
    sessionStorage.setItem('hh_missed_dismissed', '1');
  }

  // ── Helix Hub owner ─────────────────────────────────────────────────────────
  // Opening a company from the Owner Console signs in to it as a full admin.
  function openCompanyAsOwner(c) {
    setActiveCompany(c.prefix ? { name: c.name, code: c.code, prefix: c.prefix } : null);
    handleLogin({
      emp_id: 'HELIX_OWNER', name: owner.name, role: 'admin', access: 'ALL', active: true,
      isOwner: true, viewing: c.name,
    });
  }

  function handleOwnerSignOut() {
    setOwnerSession(null);
    setOwner(null);
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  // An owner viewing a company returns to the Owner Console instead of signing out.
  function handleLogout() {
    if (!currentUser?.isOwner) handleOwnerSignOut();
    sessionStorage.removeItem('hh_user');
    sessionStorage.removeItem('hh_tab');
    setActiveCompany(null);   // next login starts at the company step again
    sessionStorage.removeItem('hh_missed_dismissed');
    setCurrentUser(null);
    setActiveTab('today');
    setShowProfile(false);
    setHasDeficit(false);
    setUnreadFeedback(0);
    setMissedDay(null);
    setMissedDismissed(false);
    setTheme(THEMES[0].id);
    applyTheme(THEMES[0].id);
  }

  // ── Theme change ────────────────────────────────────────────────────────────
  async function handleThemeChange(newTheme) {
    setTheme(newTheme);
    applyTheme(newTheme);
    if (currentUser?.emp_id) {
      try {
        const existing = await kv.get(`prefs_${currentUser.emp_id}`) ?? {};
        await kv.set(`prefs_${currentUser.emp_id}`, { ...existing, theme: newTheme });
        const updated = { ...currentUser, theme: newTheme };
        sessionStorage.setItem('hh_user', JSON.stringify(updated));
        setCurrentUser(updated);
      } catch { /* non-critical */ }
    }
  }

  // ── User update (from Profile modal) ────────────────────────────────────────
  function handleUserUpdate(updated) {
    setCurrentUser(updated);
    sessionStorage.setItem('hh_user', JSON.stringify(updated));
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!currentUser && owner) {
    return (
      <Suspense fallback={<div className="loading-row"><div className="spinner" /> Loading…</div>}>
        <OwnerConsole owner={owner} onOpenCompany={openCompanyAsOwner} onSignOut={handleOwnerSignOut} onOwnerUpdate={o => { setOwnerSession(o); setOwner(o); }} />
      </Suspense>
    );
  }
  if (!currentUser) return <Login onLogin={handleLogin} onOwnerLogin={setOwner} />;

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
  const isSupervisor = currentUser.role === 'supervisor';

  const empTabs = [
    { id: 'prodreport',   label: 'Daily Report',  icon: '📝', section: 'My Work' },
    { id: 'myreports',    label: 'My Reports',    icon: '📄', section: 'My Work' },
    { id: 'progress',     label: 'Progress',      icon: '📈', section: 'My Work' },
    { id: 'myallocation', label: 'My Allocation', icon: '🗂️', section: 'My Work' },
    ...WORKBENCH_TABS,
    { id: 'feedback',     label: unreadFeedback > 0 ? `Announcements (${unreadFeedback})` : 'Announcements', icon: '📢', section: 'Engagement' },
    { id: 'feed',         label: 'Team Feed',     icon: '💬', section: 'Engagement' },
  ];

  const tabs = isAdmin ? ADMIN_TABS : isSupervisor ? SUPERVISOR_TABS : empTabs;
  const pageTitle = tabs.find(t => t.id === activeTab)?.label ?? '';

  return (
    <div className="app-shell">
      <Starfield />
      <Sidebar
        user={currentUser}
        theme={theme}
        onTheme={handleThemeChange}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfile(true)}
        activeTab={activeTab}
        onTab={handleSetTab}
        tabs={tabs}
      />

      <div className="content-col">
        <header className="page-topbar topbar-blur">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15.5, color: 'var(--text)' }}>{pageTitle}</span>
            {hasDeficit && (
              <span
                style={{ background: '#ef4444', color: '#fff', borderRadius: 12, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}
                title="Some employees are below target today"
              >
                ⚠ Below target
              </span>
            )}
          </div>
          <Clock />
        </header>

        {currentUser.isOwner && (
          <div style={{
            background: '#4c1d95', color: '#fff',
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span>👑 Helix Hub owner — viewing {currentUser.viewing} with full admin access</span>
            <button
              onClick={handleLogout}
              style={{
                background: '#fff', color: '#4c1d95', border: 'none', borderRadius: 6,
                padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
              }}
            >
              ← Back to Owner Console
            </button>
          </div>
        )}

        {!isAdmin && !isSupervisor && missedDay && !missedDismissed && (
          <div style={{
            background: '#f59e0b', color: '#1c1917',
            padding: '9px 18px', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            borderBottom: '1px solid #d97706',
          }}>
            <span>
              ⚠ You haven't submitted your daily report for{' '}
              {new Date(missedDay + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long', month: 'short', day: 'numeric',
              })}.
            </span>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => { handleSetTab('prodreport'); dismissMissedBanner(); }}
                style={{
                  background: '#1c1917', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Submit Now
              </button>
              <button
                onClick={dismissMissedBanner}
                style={{
                  background: 'transparent', color: '#1c1917',
                  border: '1px solid #92400e', borderRadius: 6,
                  padding: '4px 10px', fontSize: 12, cursor: 'pointer', opacity: 0.75,
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <main className="main-content">
          <Suspense fallback={<div className="loading-row"><div className="spinner" /> Loading…</div>}>
            <div key={activeTab} className="page-transition">
              {isAdmin
                ? <AdminApp      activeTab={activeTab} user={currentUser} />
                : isSupervisor
                ? <SupervisorApp activeTab={activeTab} user={currentUser} />
                : <EmployeeApp   activeTab={activeTab} user={currentUser} />
              }
            </div>
          </Suspense>
        </main>
      </div>

      {/* Profile modal — managed at App level */}
      {showProfile && (
        <Profile
          user={currentUser}
          theme={theme}
          onTheme={handleThemeChange}
          onClose={() => setShowProfile(false)}
          onSave={updated => { handleUserUpdate(updated); setShowProfile(false); }}
        />
      )}
    </div>
  );
}
