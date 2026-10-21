import { useState, useMemo, useEffect } from 'react';
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
  // First visit: only the first group is open. A closed group still shows the current page.
  const isOpen = (g, i) => prefs.open[g.key] ?? i === 0;
  const toggleGroup = (g, i) => update({ open: { ...prefs.open, [g.key]: !isOpen(g, i) } });
  const togglePin = id => update({ pins: pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id].slice(-MAX_PINS) });

  function toggleTheme() {
    onTheme(isDark ? 'light' : 'dark');
  }

  function open(id) {
    onTab(id);
    onCloseMobile?.();
  }

  const link = (tab, { pinnable = true } = {}) => {
    const { text, count } = splitCount(tab.label);
    const pinned = pins.includes(tab.id);
    return (
      <div key={tab.id} className="sidebar-row">
        <button
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => open(tab.id)}
          className={`sidebar-link ${activeTab === tab.id ? 'active' : ''}`}
          title={compact ? `${text}${count ? ` (${count})` : ''}` : undefined}
        >
          <span className="icon">{tab.icon ?? '•'}</span>
          {!compact && <span className="sidebar-link-text">{text}</span>}
          {count > 0 && <span className="nav-count">{count}</span>}
        </button>
        {!compact && pinnable && (
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

      <nav className="sidebar-nav" role="tablist">
        {pins.length > 0 && (
          <div className="nav-group">
            {!compact && <div className="sidebar-section-label">⭐ Pinned</div>}
            {pins.map(id => link(byId[id], { pinnable: false }))}
            {compact && <div className="nav-divider" />}
          </div>
        )}

        {groups.map((g, i) => {
          if (compact) {
            return (
              <div key={g.key} className="nav-group">
                {g.tabs.map(t => link(t))}
                {i < groups.length - 1 && <div className="nav-divider" />}
              </div>
            );
          }
          const opened = isOpen(g, i);
          const shown = opened ? g.tabs : g.tabs.filter(t => t.id === activeTab);
          const closedCount = opened ? 0 : g.tabs.reduce((n, t) => n + splitCount(t.label).count, 0);
          return (
            <div key={g.key} className="nav-group">
              <button className="sidebar-section-label nav-group-head" onClick={() => toggleGroup(g, i)} aria-expanded={opened}>
                <span className={`nav-chevron${opened ? ' open' : ''}`} aria-hidden="true">›</span>
                <span style={{ flex: 1 }}>{g.label}</span>
                {closedCount > 0 && <span className="nav-count">{closedCount}</span>}
              </button>
              {shown.map(t => link(t))}
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
