import { THEMES } from '../lib/constants';

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

export default function Sidebar({
  user,
  theme,
  onTheme,
  onLogout,
  onOpenProfile,
  activeTab,
  onTab,
  tabs = [],
}) {
  const isDark = THEMES.find(t => t.id === theme)?.dark ?? false;
  const ini    = initials(user?.name, user?.emp_id);

  function toggleTheme() {
    onTheme(isDark ? 'light' : 'dark');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <HexLogo />
        <div>
          <div className="brand-name">Helix Hub</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>3Gen Consulting</div>
        </div>
      </div>

      <nav className="sidebar-nav" role="tablist">
        {tabs.map((tab, i) => (
          <div key={tab.id}>
            {tab.section && tab.section !== tabs[i - 1]?.section && (
              <div className="sidebar-section-label">{tab.section}</div>
            )}
            <button
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => onTab(tab.id)}
              className={`sidebar-link ${activeTab === tab.id ? 'active' : ''}`}
            >
              <span className="icon">{tab.icon ?? '•'}</span>
              <span>{tab.label}</span>
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button
            onClick={onOpenProfile}
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
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light' : 'Switch to Dark'}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
              fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1, flexShrink: 0,
            }}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
        <button onClick={onLogout} className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
