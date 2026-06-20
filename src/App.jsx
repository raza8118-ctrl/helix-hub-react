import { useState, useEffect } from 'react';
import Login       from './components/Login';
import TopBar      from './components/TopBar';
import Profile     from './components/shared/Profile';
import AdminApp    from './pages/admin/AdminApp';
import EmployeeApp from './pages/employee/EmployeeApp';
import { THEMES }  from './lib/constants';
import { S, kv }   from './lib/supabase';
import './index.css';

// ── Theme helper ──────────────────────────────────────────────────────────────
function applyTheme(themeId) {
  const found = THEMES.find(t => t.id === themeId);
  if (!found) return;
  document.body.style.background = found.bg;
  document.body.style.setProperty('--topbar-bg', found.topbar);
  if (found.dark) document.body.classList.add('dark');
  else            document.body.classList.remove('dark');
}

// ── Tab definitions ───────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'today',       label: 'Today'         },
  { id: 'prodmonitor', label: 'Prod Monitor'  },
  { id: 'hourlymon',   label: 'Hourly'        },
  { id: 'weekly',      label: 'Weekly'        },
  { id: 'monthly',     label: 'Monthly'       },
  { id: 'feedback',    label: 'Announcements' },
  { id: 'team',        label: 'Team'          },
  { id: 'allocation',  label: 'Work Alloc'    },
  { id: 'allocmon',    label: 'Alloc Monitor' },
  { id: 'feedmonitor', label: 'Feed Monitor'  },
  { id: 'changelog',   label: 'Changelog'     },
  { id: 'settings',    label: 'Settings'      },
];

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [theme, setTheme]             = useState(THEMES[0].id);
  const [activeTab, setActiveTab]     = useState('today');
  const [showProfile, setShowProfile] = useState(false);
  const [hasDeficit, setHasDeficit]   = useState(false);
  const [clock, setClock]             = useState('');
  const [unreadFeedback, setUnreadFeedback] = useState(0);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = sessionStorage.getItem('hh_user');
        if (!raw) return;
        const u = JSON.parse(raw);
        setCurrentUser(u);
        const isAdmin = u.role === 'admin' || u.role === 'manager';
        const savedTab = sessionStorage.getItem('hh_tab');
        setActiveTab(savedTab || (isAdmin ? 'today' : 'prodreport'));

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

  // ── Live clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Unread feedback count (employees only) ──────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
    if (isAdmin) return;

    async function checkUnread() {
      const [all, acks] = await Promise.all([
        S.get('feedback'),
        S.get('feedback_acks', { emp_id: currentUser.emp_id }),
      ]);
      const ackedBroadcastIds = new Set((acks ?? []).map(a => a.feedback_id));
      const cnt = (all ?? []).filter(f => {
        const mine = f.to_emp_id === currentUser.emp_id || f.to_emp_id === null;
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

  // ── Tab switch (persisted so a browser refresh stays on the same tab) ───────
  function handleSetTab(tabId) {
    setActiveTab(tabId);
    sessionStorage.setItem('hh_tab', tabId);
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  async function handleLogin(u) {
    const isAdmin = u.role === 'admin' || u.role === 'manager';
    setCurrentUser(u);
    const startTab = isAdmin ? 'today' : 'prodreport';
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

  // ── Logout ──────────────────────────────────────────────────────────────────
  function handleLogout() {
    sessionStorage.removeItem('hh_user');
    sessionStorage.removeItem('hh_tab');
    setCurrentUser(null);
    setActiveTab('today');
    setShowProfile(false);
    setHasDeficit(false);
    setUnreadFeedback(0);
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
  if (!currentUser) return <Login onLogin={handleLogin} />;

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';

  const empTabs = [
    { id: 'prodreport',   label: 'Daily Report'   },
    { id: 'myreports',    label: 'My Reports'     },
    { id: 'progress',     label: 'Progress'       },
    { id: 'myallocation', label: 'My Allocation'  },
    { id: 'feedback',     label: unreadFeedback > 0 ? `Announcements (${unreadFeedback})` : 'Announcements' },
    { id: 'feed',         label: 'Team Feed'      },
  ];

  const tabs = isAdmin ? ADMIN_TABS : empTabs;

  return (
    <div className="app-shell">
      <TopBar
        user={currentUser}
        theme={theme}
        onTheme={handleThemeChange}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfile(true)}
        activeTab={activeTab}
        onTab={handleSetTab}
        tabs={tabs}
        clock={clock}
        deficitCount={hasDeficit ? 1 : 0}
      />

      <main className="main-content fade-in">
        {isAdmin
          ? <AdminApp    activeTab={activeTab} user={currentUser} />
          : <EmployeeApp activeTab={activeTab} user={currentUser} />
        }
      </main>

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
