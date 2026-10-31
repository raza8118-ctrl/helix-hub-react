import { useState, useEffect, Suspense, lazy } from 'react';
import Login       from './components/Login';
import Sidebar     from './components/Sidebar';
import Profile     from './components/shared/Profile';
import Starfield   from './components/shared/Starfield';
import FollowupNudge from './components/shared/FollowupNudge';
import PayerUpdatesBadge from './components/shared/PayerUpdatesBadge';
import GlobalSearch from './components/shared/GlobalSearch';
import BoardBadge from './components/shared/BoardBadge';
import PageErrorBoundary from './components/shared/PageErrorBoundary';
import HelixLauncher from './components/shared/HelixLauncher';
import { THEMES }  from './lib/constants';
import { S, kv, supabase, setActiveCompany, getActiveCompany, refreshCompanyProcesses, getSessionToken, setSessionToken } from './lib/supabase';
import { getOwnerSession, setOwnerSession, ownerLogout, loadCompanyRow, loadHomeFeatures, SIGNOUT_MSG_KEY } from './lib/company';
import { disabledTabs, isFeatureOn, setAiAllowed } from './lib/companyFeatures';
import { ownerLog, codeOf, openOwnerSession } from './lib/owner';
import PlatformBanners from './components/shared/PlatformBanners';
import { WORKBENCH_TABS } from './pages/workbench/modules';
import { logAudit } from './lib/audit';
import { canOpenTab, TAB_FEATURES } from './lib/access';
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
  { id: 'teamdash',    label: 'Team Dashboard', icon: '📈', section: 'Monitoring' },
  { id: 'dashboard',   label: 'Attendance (Keka)', icon: '🧭', section: 'Monitoring' },
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
  { id: 'teamdash',    label: 'Team Dashboard', icon: '📈', section: 'Monitoring' },
  { id: 'dashboard',   label: 'Attendance (Keka)', icon: '🧭', section: 'Monitoring' },
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

// Tabs beyond a role's own list, shown to anyone with the feature — by role default or
// granted by an admin on the Team page (lib/access.js decides who has which)
const EXTRA_TABS = [
  { id: 'masters',  label: 'Clients & Payers', icon: '🏢', section: 'System' },
  { id: 'auditlog', label: 'Audit Log',        icon: '📜', section: 'System' },
];
// Owner Console 2.0: the company's session_version when this person signed in (raised = signed out by the owner)
const SESSION_VERSION_KEY = 'hh_sv';

/** The signed-in added company's code, or null for the home company (which is stored with its code but no prefix). */
const addedCompanyCode = () => { const c = getActiveCompany(); return c?.prefix ? c.code : null; };

/** Paused / signed out by the owner: clear this tab's session and reload — the login screen shows the message once. */
function kickOut(message) {
  window.dispatchEvent(new Event('helix:signed-out'));   // e.g. wipes an in-memory appeal form (patient details)
  try {
    sessionStorage.setItem(SIGNOUT_MSG_KEY, message);
    ['hh_user', 'hh_tab', 'hh_missed_dismissed', SESSION_VERSION_KEY].forEach(k => sessionStorage.removeItem(k));
  } catch { /* storage unavailable */ }
  setSessionToken(null);
  setActiveCompany(null);
  window.location.reload();
}
const POST_ANNOUNCEMENTS_TAB ={ id: 'feedbackadmin', label: 'Post Announcements', icon: '📣', section: 'Engagement' };
const SECTION_ORDER = ['My Work', 'Monitoring', 'Team', 'Workbench', 'Engagement', 'System'];

function withGrantedTabs(roleTabs, user) {
  const have = new Set(roleTabs.map(t => t.id));
  const pool = user.role === 'employee'   // employees' own 'feedback' tab is the read-only list
    ? [...ADMIN_TABS.filter(t => t.id !== 'feedback'), POST_ANNOUNCEMENTS_TAB, ...EXTRA_TABS]
    : [...ADMIN_TABS, ...EXTRA_TABS];
  const extra = pool.filter(t => TAB_FEATURES[t.id] && !have.has(t.id) && canOpenTab(user, t.id));
  if (!extra.length) return roleTabs;
  // Keep each granted tab inside its usual section
  const rank = t => { const i = SECTION_ORDER.indexOf(t.section); return i < 0 ? SECTION_ORDER.length : i; };
  return [...roleTabs, ...extra]
    .map((t, i) => [t, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([t]) => t);
}

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
  const [followupDue, setFollowupDue] = useState(0);   // 6.5: follow-ups due → count on the Smart Worklist sidebar item
  const [updatesNew, setUpdatesNew] = useState(0);     // 8.2: unread payer changes for my team → count on Payer Updates
  const [pageVisit, setPageVisit] = useState(0);       // 10.1: bumped when search opens a record so the page remounts
  const [boardNew, setBoardNew] = useState(0);         // 10.3: unread must-read notices → count on Notice Board
  const [navOpen, setNavOpen] = useState(false);       // calm navigation: ☰ drawer on phones
  const [companyRow, setCompanyRow] = useState(null);  // Owner Console 2.0: this company's pages on / off, banner, pause
  const [homeFeatures, setHomeFeatures] = useState(null);  // home company's pages on / off (it has no registry row)

  // ── Owner Console 2.0: watch the company's registry row (every 2 min + when the tab regains focus) ──
  // Added companies only (the home company has no row). The owner viewing a company is never signed out.
  useEffect(() => {
    if (!currentUser) return;
    const code = addedCompanyCode();   // null = home company (no registry row)
    let alive = true;
    // Home company: only its pages on / off (kv `home_features`) — no pause / sign-out / banner
    const checkHome = () => loadHomeFeatures().then(features => {
      if (!alive) return;
      setHomeFeatures(features);
      setAiAllowed(isFeatureOn(features, 'ai'));
    }, () => {});
    const check = () => code == null ? checkHome() : loadCompanyRow(code).then(row => {
      if (!alive) return;
      setCompanyRow(row);
      setAiAllowed(isFeatureOn(row?.features, 'ai'));
      if (!row || currentUser.isOwner) return;
      if (row.active === false) {
        kickOut(`${row.name}'s access to Helix Hub has been paused. ${row.pause_message || 'Please contact your administrator.'}`);
        return;
      }
      const base = Number(sessionStorage.getItem(SESSION_VERSION_KEY));
      if (!base) sessionStorage.setItem(SESSION_VERSION_KEY, String(row.session_version ?? 1));
      else if ((row.session_version ?? 1) > base) kickOut('You were signed out by the Helix Hub administrator. Please sign in again.');
    }, () => {});
    // Security stage 2: a session that ended (signed out elsewhere, switched off, password changed, expired) → login
    const checkSession = () => supabase.rpc('session_check', { p_token: getSessionToken() }).then(({ data, error }) => {
      if (alive && !error && data === false) kickOut('Your sign-in has ended. Please sign in again.');
    }, () => {});
    const checkAll = () => { checkSession(); check(); };
    checkAll();
    const id = setInterval(checkAll, 2 * 60 * 1000);
    const onFocus = () => checkAll();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [currentUser]);

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
      const me = users?.find(u => u.emp_id === currentUser.emp_id);
      const mySupervisorIds = me?.supervisor_ids ?? [];
      // An employee granted Post Announcements only reaches people sharing a sub-process
      const procsOf = u => [u?.access, u?.process, ...(u?.processes ?? [])].filter(Boolean);
      const sharesProcess = sender => {
        const theirs = procsOf(sender);
        return theirs.includes('ALL') || procsOf(me).some(p => p === 'ALL' || theirs.includes(p));
      };
      const cnt = (all ?? []).filter(f => {
        let mine;
        if (f.to_emp_id) {
          mine = f.to_emp_id === currentUser.emp_id;
        } else {
          const sender = users?.find(u => u.emp_id === f.from_emp_id);
          mine = sender?.role === 'supervisor' ? mySupervisorIds.includes(sender.emp_id)
            : sender?.role === 'employee' ? sharesProcess(sender)
            : true;
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
  // 10.1: global search → remount the page (even when it is already open) so it reads the handed-over record
  function openFromSearch(tabId) {
    setPageVisit(v => v + 1);
    handleSetTab(tabId);
  }

  function handleSetTab(tabId) {
    setActiveTab(tabId);
    sessionStorage.setItem('hh_tab', tabId);
  }

  // A Workbench page can ask to open another Workbench tab (e.g. Denial Navigator → "Start an appeal").
  // Only 'wb_' tabs, which every role has.
  useEffect(() => {
    const onOpen = e => {
      const tabId = e.detail;
      if (typeof tabId !== 'string' || !tabId.startsWith('wb_')) return;
      setActiveTab(tabId);
      sessionStorage.setItem('hh_tab', tabId);
    };
    window.addEventListener('helix:open-tab', onOpen);
    return () => window.removeEventListener('helix:open-tab', onOpen);
  }, []);

  // Ask Helix 📍 buttons / sources: open a Workbench page and remount it so it reads the handed-over record
  useEffect(() => {
    const onOpenPage = e => {
      const tabId = e.detail;
      if (typeof tabId !== 'string' || !tabId.startsWith('wb_') || !currentUser || !canOpenTab(currentUser, tabId)) return;
      setPageVisit(v => v + 1);
      setActiveTab(tabId);
      sessionStorage.setItem('hh_tab', tabId);
    };
    window.addEventListener('helix:open-page', onOpenPage);
    return () => window.removeEventListener('helix:open-page', onOpenPage);
  }, [currentUser]);

  // ── Login ───────────────────────────────────────────────────────────────────
  async function handleLogin(signedIn, startOverride = null) {
    const u = { ...signedIn };
    delete u.password;   // never kept in the browser (security stage 1)
    await refreshCompanyProcesses().catch(() => {});
    const isAdmin = u.role === 'admin' || u.role === 'manager';
    const isSupervisor = u.role === 'supervisor';
    setCurrentUser(u);
    const startTab = startOverride || ((isAdmin || isSupervisor) ? 'today' : 'prodreport');
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
  // Opening a company from the Owner Console signs in to it as a full admin — or, with opts.asUser (Owner Console 2.0
  // master key), as that person. Either way the purple banner shows and the audit log says "via Helix Hub owner".
  async function openCompanyAsOwner(c, opts = {}) {
    setActiveCompany(c.prefix ? { name: c.name, code: c.code, prefix: c.prefix } : null);
    const { data: token } = await openOwnerSession(owner, c.prefix ?? '', opts.asUser?.emp_id ?? null);
    setSessionToken(token);
    const ownerUser = opts.asUser
      ? { ...opts.asUser, isOwner: true, viewing: c.name, viewingAs: true, ownerUsername: owner.username }
      : {
        emp_id: 'HELIX_OWNER', name: owner.name, role: 'admin', access: 'ALL', active: true,
        isOwner: true, viewing: c.name, ownerUsername: owner.username,
      };
    const action = opts.asUser ? 'owner_sign_in_as' : 'owner_open_company';
    const reason = opts.reason?.trim() || null;
    logAudit({ actor: ownerUser, action, details: { owner: owner.username, reason } });
    ownerLog(owner, action, codeOf(c), opts.asUser ? `${opts.asUser.name ?? ''} (${opts.asUser.emp_id})` : null, { reason, start_page: opts.startTab ?? null });
    handleLogin(ownerUser, opts.startTab);
  }

  function handleOwnerSignOut() {
    ownerLogout(owner);
    setOwnerSession(null);
    setOwner(null);
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  // An owner viewing a company returns to the Owner Console instead of signing out.
  function handleLogout() {
    window.dispatchEvent(new Event('helix:signed-out'));   // e.g. wipes an in-memory appeal form (patient details)
    if (!currentUser?.isOwner) handleOwnerSignOut();
    const token = getSessionToken();
    if (token) supabase.rpc('user_logout', { p_token: token }).then(() => {}, () => {});
    setSessionToken(null);
    sessionStorage.removeItem('hh_user');
    sessionStorage.removeItem('hh_tab');
    setActiveCompany(null);   // next login starts at the company step again
    sessionStorage.removeItem('hh_missed_dismissed');
    sessionStorage.removeItem(SESSION_VERSION_KEY);
    setCompanyRow(null);
    setHomeFeatures(null);
    setAiAllowed(true);
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

  const roleTabs = isAdmin ? ADMIN_TABS : isSupervisor ? SUPERVISOR_TABS : empTabs;
  // Owner Console 2.0: pages the owner switched off for this company are hidden for everyone (owner view included,
  // so the owner sees exactly what the company sees); an open page that was switched off falls back to the first one
  const offTabs = disabledTabs(addedCompanyCode() == null ? homeFeatures : companyRow?.features);
  const tabs = withGrantedTabs(roleTabs, currentUser).filter(t => !offTabs.has(t.id));
  const shownTab = offTabs.has(activeTab) ? (tabs[0]?.id ?? activeTab) : activeTab;
  const pageTitle = tabs.find(t => t.id === shownTab)?.label ?? '';
  // Counts on Workbench items: 6.5 follow-ups, 8.2 payer updates, 10.3 notice board
  const tabCounts = { wb_worklist: followupDue, wb_updates: updatesNew, wb_board: boardNew };
  const sidebarTabs = Object.values(tabCounts).some(n => n > 0)
    ? tabs.map(t => (tabCounts[t.id] > 0 ? { ...t, label: `${t.label} (${tabCounts[t.id]})` } : t))
    : tabs;

  return (
    <div className="app-shell">
      <Starfield />
      <FollowupNudge user={currentUser} onCount={setFollowupDue} />
      <PayerUpdatesBadge user={currentUser} onCount={setUpdatesNew} />
      <BoardBadge user={currentUser} onCount={setBoardNew} />
      <HelixLauncher user={currentUser} tabs={tabs} activeTab={shownTab} />
      <Sidebar
        user={currentUser}
        theme={theme}
        onTheme={handleThemeChange}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfile(true)}
        activeTab={shownTab}
        onTab={handleSetTab}
        tabs={sidebarTabs}
        mobileOpen={navOpen}
        onCloseMobile={() => setNavOpen(false)}
      />
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="content-col">
        <header className="page-topbar topbar-blur">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button className="nav-menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu" title="Menu">☰</button>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GlobalSearch user={currentUser} tabs={tabs} onOpen={openFromSearch} />
            <Clock />
          </div>
        </header>

        {currentUser.isOwner && (
          <div style={{
            background: '#4c1d95', color: '#fff',
            padding: '5px 16px', fontSize: 12.5, fontWeight: 600,   // calm navigation: thin banner
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span>
              {currentUser.viewingAs
                ? <>👑 Owner signed in as {currentUser.name ?? currentUser.emp_id} ({currentUser.emp_id}) at {currentUser.viewing} — actions are logged as the owner</>
                : <>👑 Helix Hub owner — viewing {currentUser.viewing} with full admin access</>}
              {offTabs.size > 0 && <span style={{ fontWeight: 400, opacity: 0.85 }}> · {offTabs.size} page{offTabs.size === 1 ? '' : 's'} switched off for this company</span>}
            </span>
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

        <PlatformBanners code={addedCompanyCode()} banner={companyRow?.banner} />

        {!isAdmin && !isSupervisor && missedDay && !missedDismissed && (
          <div style={{
            background: '#f59e0b', color: '#1c1917',
            padding: '5px 16px', fontSize: 12.5, fontWeight: 600,   // calm navigation: thin banner
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
            <div key={`${shownTab}|${pageVisit}`} className="page-transition">
              {/* A crash in one page shows an error card instead of blanking the whole app (resets on page change) */}
              <PageErrorBoundary>
                {isAdmin
                  ? <AdminApp      activeTab={shownTab} user={currentUser} />
                  : isSupervisor
                  ? <SupervisorApp activeTab={shownTab} user={currentUser} />
                  : <EmployeeApp   activeTab={shownTab} user={currentUser} />
                }
              </PageErrorBoundary>
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
