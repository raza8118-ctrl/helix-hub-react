import NavIcon from '../../components/ui/NavIcon';
import { OWNER_SECTIONS } from '../../lib/ownerCenter';

/** Owner Command Center menu (PO 2026-11-09). Same Frost Glass sidebar as the app; line icons only, no emoji. */
const initials = name => (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'O';

export default function OwnerSidebar({ owner, active, onPick, counts = {}, onSignOut, mobileOpen, onCloseMobile }) {
  return (
    <aside className={`sidebar sb-glass oc-sidebar${mobileOpen ? ' open' : ''}`} aria-label="Owner menu">
      <div className="sidebar-brand">
        <span className="oc-brand-badge" aria-hidden="true"><NavIcon icon="crown" size={20} /></span>
        <div className="sb-brand-text">
          <div className="brand-name">Command Center</div>
          <div className="brand-company">Helix Hub owner</div>
        </div>
        {mobileOpen && <button className="nav-icon-btn" onClick={onCloseMobile} aria-label="Close menu">✕</button>}
      </div>

      <nav className="sidebar-nav" aria-label="Owner pages">
        {OWNER_SECTIONS.map(sec => (
          <div key={sec.name} className="sb-section">
            <div className="sidebar-section-label">{sec.name}</div>
            {sec.items.map(([id, label, icon]) => (
              <div key={id} className="sidebar-row">
                <button
                  type="button"
                  className={`sidebar-link ${active === id ? 'active' : ''}`}
                  aria-current={active === id ? 'page' : undefined}
                  onClick={() => { onPick(id); onCloseMobile?.(); }}
                >
                  <span className="icon"><NavIcon icon={icon} /></span>
                  <span className="sidebar-link-text">{label}</span>
                  {counts[id] > 0 && <span className="nav-count" title={`${counts[id]} need your attention`}>{counts[id]}</span>}
                </button>
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-me">
          <span className="sb-avatar oc-avatar" aria-hidden="true">{initials(owner.name)}</span>
          <span className="sb-me-text oc-me-text">
            <span className="sb-me-name">{owner.name}</span>
            <span className="sb-me-role">Owner · {owner.username}</span>
          </span>
          <button className="nav-icon-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out"><NavIcon icon="power" size={16} /></button>
        </div>
      </div>
    </aside>
  );
}
