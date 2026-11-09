import { useState, useMemo, useEffect, useRef } from 'react';
import NavIcon from './ui/NavIcon';
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

/** Helix mark on a rounded square in the theme's logo colour (Frost Glass, 2026-11-06). */
function HexLogo({ size = 36 }) {
  return (
    <svg className="sb-logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="2" y="2" width="96" height="96" rx="26" fill="var(--sb-logo-bg)" />
      <g stroke="var(--sb-logo-text)" fill="none" strokeLinecap="round">
        <path d="M36,21 C36,38 64,38 64,50 C64,62 36,62 36,79" strokeWidth="6" />
        <path d="M64,21 C64,38 36,38 36,50 C36,62 64,62 64,79" strokeWidth="6" />
        <path d="M42,29 H58 M47,50 H53 M42,71 H58" strokeWidth="4.5" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * Calm navigation (PO request 2026-10-21): foldable groups (Workbench split into four), ⭐ pinned pages on top,
 * « icons-only mode, and a ☰ slide-in drawer on phones. The tab list itself is unchanged (see lib/navGroups.js).
 */
export default function Sidebar({
  user,
  onLogout,
  onOpenProfile,
  activeTab,
  onTab,
  tabs = [],
  mobileOpen = false,     // phones: the ☰ drawer is open
  onCloseMobile,
}) {
  const company = useCompany();
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
          <span className="icon"><NavIcon tab={tab.id} fallback={tab.icon} /></span>
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

  // Frost Glass: section headings (Monitoring / Workbench / Team …). Workbench keeps its sub-groups with fly-outs;
  // the other sections list their pages straight under the heading. Icons-only mode keeps one row per group.
  const sections = [];
  groups.forEach((g, i) => {
    const name = g.key.startsWith('wb_') ? 'Workbench' : g.label;
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.groups.push({ g, i });
    else sections.push({ name, groups: [{ g, i }] });
  });

  const groupRow = (g, i) => {
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
          <span className="icon"><NavIcon group={g.key} fallback={g.icon} /></span>
          {!compact && <span className="sidebar-link-text">{g.label}</span>}
          {total > 0 && <span className="nav-count">{total}</span>}
          {!compact && <span className={`nav-chevron${inPlace ? ' open' : ''}`} aria-hidden="true">›</span>}
        </button>
        {flying && (
          <div className="nav-flyout" role="menu" aria-label={g.label} style={{ top: fly.top, left: fly.left }}
            onMouseEnter={keepFly} onMouseLeave={hideFlySoon}>
            <div className="nav-flyout-title">{g.label}</div>
            {g.tabs.map(t => link(t, { inFlyout: true }))}
          </div>
        )}
        {below.length > 0 && <div className="nav-sub">{below.map(t => link(t))}</div>}
      </div>
    );
  };

  // Role badge (PO 2026-11-09): Owner / Admin / Manager / Supervisor / Employee; the team stays underneath
  const roleKey = user?.isOwner && !user?.viewingAs ? 'owner' : (user?.role || 'employee');
  const roleLabel = { owner: 'Owner', admin: 'Admin', manager: 'Manager', supervisor: 'Supervisor', employee: 'Employee' }[roleKey] ?? roleKey;

  return (
    <aside className={`sidebar sb-glass${compact ? ' compact' : ''}${mobileOpen ? ' open' : ''}`} aria-label="Main menu">
      <div className="sidebar-brand">
        <HexLogo size={compact ? 34 : 38} />
        {!compact && (
          <div className="sb-brand-text">
            <div className="brand-name">Helix Hub</div>
            <div className="brand-company">{company.name}</div>
          </div>
        )}
        {isPhone ? (
          <button className="nav-icon-btn" onClick={onCloseMobile} aria-label="Close menu">✕</button>
        ) : (
          <button
            className="nav-icon-btn sb-collapse"
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
            {!compact && <div className="sidebar-section-label">Pinned</div>}
            {pins.map(id => link(byId[id], { pinnable: false }))}
            {compact && <div className="nav-divider" />}
          </div>
        )}

        {sections.map(sec => (
          <div key={sec.name} className="sb-section">
            {compact ? <div className="nav-divider" /> : <div className="sidebar-section-label">{sec.name}</div>}
            {sec.name !== 'Workbench' && !compact
              ? sec.groups.flatMap(({ g }) => g.tabs).map(t => link(t))
              : sec.groups.map(({ g, i }) => groupRow(g, i))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-me">
          <button
            className="sb-avatar"
            onClick={() => { onOpenProfile(); onCloseMobile?.(); }}
            title="My Profile"
            aria-label="My Profile"
          >
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" />
              : ini
            }
          </button>
          {!compact && (
            <button type="button" className="sb-me-text" onClick={() => { onOpenProfile(); onCloseMobile?.(); }} title="My Profile">
              <span className="sb-me-name">{user?.name || user?.emp_id}</span>
              <span className="sb-me-role">
                <span className={`sb-role sb-role-${roleKey}`}>{roleLabel}</span>
                {user?.team && <span className="sb-role-team">{user.team}</span>}
              </span>
            </button>
          )}
          <button className="nav-icon-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">⏻</button>
        </div>
      </div>
    </aside>
  );
}
