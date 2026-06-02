import { THEMES } from '../lib/constants';

function initials(name, empId) {
  return (name || empId || '?')
    .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}

export default function TopBar({
  user,
  theme,
  onTheme,
  onLogout,
  onOpenProfile,
  activeTab,
  onTab,
  tabs = [],
  clock = '',
  deficitCount = 0,
}) {
  const isDark = THEMES.find(t => t.id === theme)?.dark ?? false;
  const ini    = initials(user?.name, user?.emp_id);

  function toggleTheme() {
    onTheme(isDark ? 'light' : 'dark');
  }

  return (
    <header style={{
      background: 'var(--topbar-bg)',
      borderBottom: '1px solid var(--topbar-border)',
      position: 'sticky', top: 0, zIndex: 100,
      boxShadow: 'var(--shadow)',
    }}>
      {/* ── Main row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', height: 'var(--topbar-h)',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="tbHexG" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="100%" stopColor="#4338ca" />
              </linearGradient>
            </defs>
            <polygon points="50,5 93,27.5 93,72.5 50,95 7,72.5 7,27.5" fill="url(#tbHexG)" />
            <text x="50" y="68" textAnchor="middle" fill="white" fontSize="44" fontWeight="800"
              fontFamily="'Inter','Segoe UI',sans-serif">H</text>
          </svg>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--topbar-text)', lineHeight: 1.2, letterSpacing: '-0.3px' }}>
              Helix Hub
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>3Gen Consulting</div>
          </div>
        </div>

        {/* Live clock */}
        <div style={{ flex: 1, textAlign: 'center', lineHeight: 1.35 }}>
          {clock && (
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--topbar-text)', fontVariantNumeric: 'tabular-nums' }}>
              {clock}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Dark / Light toggle */}
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light' : 'Switch to Dark'}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, padding: '5px 9px', cursor: 'pointer',
              fontSize: 15, color: 'var(--text-muted)', lineHeight: 1,
            }}
          >
            {isDark ? '☀️' : '🌙'}
          </button>

          {/* Deficit alert badge */}
          {deficitCount > 0 && (
            <span style={{
              background: '#ef4444', color: '#fff',
              borderRadius: 12, padding: '3px 9px',
              fontSize: 11, fontWeight: 700,
            }}
              title={`${deficitCount} employee${deficitCount !== 1 ? 's' : ''} below target`}
            >
              ⚠ {deficitCount}
            </span>
          )}

          {/* Avatar → opens Profile */}
          <button
            onClick={onOpenProfile}
            title="My Profile"
            style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: user?.avatar_url ? 'transparent' : 'linear-gradient(135deg, #7c3aed, #4338ca)',
              border: '2px solid var(--border)', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 0,
            }}
          >
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : ini
            }
          </button>

          {/* User info */}
          <div style={{ lineHeight: 1.3 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--topbar-text)',
              maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user?.name || user?.emp_id}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {user?.role}
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={onLogout}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-muted)', fontWeight: 500,
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <nav style={{
        display: 'flex', gap: 0, padding: '0 16px',
        borderTop: '1px solid var(--topbar-border)', overflowX: 'auto',
      }} role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTab(tab.id)}
            style={{
              padding: '9px 16px', fontSize: 13, background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.id ? 700 : 400,
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
