import { useState, useMemo, useEffect, useRef } from 'react';
import { THEMES } from '../lib/constants';
import Starfield from './shared/Starfield';
import { useCompany } from '../lib/company';
import { groupTabs, splitCount, loadNavPrefs, saveNavPrefs, HIDDEN_IN_SIDEBAR, MAX_PINS } from '../lib/navGroups';

const PHONE = '(max-width: 768px)';

/** True on phone-width screens (the sidebar becomes a ☰ drawer). */
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const onChange = e => setPhone(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

function initials(name, empId) {
  return (name || empId || '?')
    .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}

function HexLogo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="sbMarkG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id="sbStrandG" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="24" fill="url(#sbMarkG)" />
      <path d="M36,21 C36,38 64,38 64,50 C64,62 36,62 36,79"
        stroke="url(#sbStrandG)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M64,21 C64,38 36,38 36,50 C36,62 64,62 64,79"
        stroke="url(#sbStrandG)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <line x1="42" y1="29" x2="58" y2="29" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />
      <line x1="48" y1="50" x2="52" y2="50" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />
      <line x1="42" y1="71" x2="58" y2="71" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Calm navigation (PO request 2026-10-21): foldable groups (Workbench split into four), ⭐ pinned pages on top,
 * « icons-only mode, and a ☰ slide-in drawer on phones. The tab list itself is unchanged (see lib/navGroups.js).
 */
export default function Sidebar({
  user,
  theme,
  onTheme,
  onLogout,
  onOpenProfile,
  activeTab,
  onTab,
  tabs = [],
  mobileOpen = false,     // phones: the ☰ drawer is open
  onCloseMobile,
}) {
  const company = useCompany();
  const isDark = THEMES.find(t => t.id === theme)?.dark ?? false;
  const ini    = initials(user?.name, user?.emp_id);
  const empId  = user?.emp_id;
  const [prefs, setPrefs] = useState(() => loadNavPrefs(empId));
  const isPhone = usePhone();
  const compact = prefs.compact && !isPhone;   // icons-only mode is for wide screens

  const groups = useMemo(() => groupTabs(tabs), [tabs]);
  const byId = useMemo(() => Object.fromEntries(tabs.map(t => [t.id, t])), [tabs]);
  const pins = prefs.pins.filter(id => byId[id] && !HIDDEN_IN_SIDEBAR.includes(id));

  function update(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveNavPrefs(empId, next);
  }
  // Phones: tapping a group opens it in place (remembered). A closed group still shows the current page.
  const isOpen = (g, i) => prefs.open[g.key] ?? (i === 0 && !compact);

  // Wide screens: pointing at a group shows its pages in a fly-out to the right (fixed, so the nav's scroll can't clip it)
  const [fly, setFly] = useState(null);   // { key, top, left }
  const flyTimer = useRef(null);
  function showFly(g, el) {
    clearTimeout(flyTimer.current);
    const row = el.getBoundingClientRect();
    const side = el.closest('.sidebar').getBoundingClientRect();
    const height = 56 + g.tabs.length * 46;
    setFly({ key: g.key, top: Math.max(8, Math.min(row.top - 8, window.innerHeight - height - 8)), left: side.right - 4 });
  }
  const keepFly = () => clearTimeout(flyTimer.current);
  function hideFlySoon() {
    clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => setFly(null), 220);   // time to move the cursor across to the fly-out
  }
  useEffect(() => () => clearTimeout(flyTimer.current), []);
  useEffect(() => {
    if (!fly) return undefined;
    const onKey = e => { if (e.key === 'Escape') setFly(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fly]);
  const toggleGroup = (g, i) => update({ open: { ...prefs.open, [g.key]: !isOpen(g, i) } });
  const togglePin = id => update({ pins: pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id].slice(-MAX_PINS) });

  function toggleTheme() {
    onTheme(isDark ? 'light' : 'dark');
  }

  function open(id) {
    setFly(null);
    onTab(id);
    onCloseMobile?.();
  }

  const link = (tab, { pinnable = true, inFlyout = false } = {}) => {
    const { text, count } = splitCount(tab.label);
    const pinned = pins.includes(tab.id);
    const iconOnly = compact && !inFlyout;
    return (
      <div key={tab.id} className="sidebar-row">
        <button
          role={inFlyout ? 'menuitem' : 'tab'}
          aria-selected={inFlyout ? undefined : activeTab === tab.id}
          onClick={() => open(tab.id)}
          className={`sidebar-link ${activeTab === tab.id ? 'active' : ''}`}
          title={iconOnly ? `${text}${count ? ` (${count})` : ''}` : undefined}
        >
          <span className="icon">{tab.icon ?? '•'}</span>
          {!iconOnly && <span className="sidebar-link-text">{text}</span>}
          {count > 0 && <span className="nav-count">{count}</span>}
        </button>
        {!iconOnly && pinnable && (
          <button
            className={`nav-pin${pinned ? ' pinned' : ''}`}
            onClick={() => togglePin(tab.id)}
            title={pinned ? 'Unpin' : pins.length >= MAX_PINS ? `Pin (replaces the oldest of ${MAX_PINS})` : 'Pin to top'}
            aria-label={pinned ? `Unpin ${text}` : `Pin ${text}`}
          >
            {pinned ? '★' : '☆'}
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className={`sidebar${compact ? ' compact' : ''}${mobileOpen ? ' open' : ''}`} aria-label="Main menu">
      <Starfield local />
      <div className="sidebar-brand">
        <HexLogo size={compact ? 28 : 30} />
        {!compact && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="brand-name">Helix Hub</div>
            <div className="brand-company">{company.name}</div>
          </div>
        )}
        {isPhone ? (
          <button className="nav-icon-btn" onClick={onCloseMobile} aria-label="Close menu">✕</button>
        ) : (
          <button
            className="nav-icon-btn"
            onClick={() => update({ compact: !prefs.compact })}
            title={compact ? 'Show names' : 'Icons only'}
            aria-label={compact ? 'Expand menu' : 'Collapse menu'}
          >
            {compact ? '»' : '«'}
          </button>
        )}
      </div>

      <nav className="sidebar-nav" role="tablist" onScroll={() => setFly(null)}>
        {pins.length > 0 && (
          <div className="nav-group">
            {!compact && <div className="sidebar-section-label">⭐ Pinned</div>}
            {pins.map(id => link(byId[id], { pinnable: false }))}
            {compact && <div className="nav-divider" />}
          </div>
        )}

        {!compact && pins.length > 0 && <div className="sidebar-section-label">Menu</div>}
        {groups.map((g, i) => {
          const hasActive = g.tabs.some(t => t.id === activeTab);
          const total = g.tabs.reduce((n, t) => n + splitCount(t.label).count, 0);
          const inPlace = isPhone && isOpen(g, i);     // phones: tap opens the group in place
          const flying = !isPhone && fly?.key === g.key;
          const below = compact ? [] : inPlace ? g.tabs : g.tabs.filter(t => t.id === activeTab);
          return (
            <div key={g.key} className="nav-group">
              <button
                className={`nav-group-row${hasActive ? ' has-active' : ''}${flying || inPlace ? ' open' : ''}`}
                aria-haspopup={isPhone ? undefined : 'menu'}
                aria-expanded={isPhone ? inPlace : flying}
                title={compact ? g.label : undefined}
                onMouseEnter={isPhone ? undefined : e => showFly(g, e.currentTarget)}
                onMouseLeave={isPhone ? undefined : hideFlySoon}
                onClick={e => (isPhone ? toggleGroup(g, i) : flying ? setFly(null) : showFly(g, e.currentTarget))}
              >
                <span className="icon">{g.icon}</span>
                {!compact && <span className="sidebar-link-text">{g.label}</span>}
                {total > 0 && <span className="nav-count">{total}</span>}
                {!compact && <span className={`nav-chevron${inPlace ? ' open' : ''}`} aria-hidden="true">›</span>}
              </button>
              {flying && (
                <div className="nav-flyout" role="menu" aria-label={g.label} style={{ top: fly.top, left: fly.left }}
                  onMouseEnter={keepFly} onMouseLeave={hideFlySoon}>
                  <div className="nav-flyout-title">{g.icon} {g.label}</div>
                  {g.tabs.map(t => link(t, { inFlyout: true }))}
                </div>
              )}
              {below.length > 0 && <div className="nav-sub">{below.map(t => link(t))}</div>}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-me">
          <button
            onClick={() => { onOpenProfile(); onCloseMobile?.(); }}
            title="My Profile"
            style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: user?.avatar_url ? 'transparent' : 'linear-gradient(135deg, #7c3aed, #4338ca)',
              border: '2px solid rgba(255,255,255,0.18)', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 0,
            }}
          >
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : ini
            }
          </button>
          {!compact && (
            <div style={{ lineHeight: 1.3, flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.92)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user?.name || user?.emp_id}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', textTransform: 'capitalize' }}>
                {user?.role}
              </div>
            </div>
          )}
          <button className="nav-icon-btn" onClick={toggleTheme} title={isDark ? 'Switch to Light' : 'Switch to Dark'}>
            {isDark ? '☀️' : '🌙'}
          </button>
          <button className="nav-icon-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">⏻</button>
        </div>
      </div>
    </aside>
  );
}
