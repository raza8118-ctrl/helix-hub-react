const VERSIONS = [
  {
    version: 'v10.0', date: 'Jun 2026', status: 'current',
    features: [
      'Complete UI redesign — 9 professional themes (light, dark, ocean, forest, rose, slate, amber, violet, high-contrast)',
      'AI-powered email generation using Claude (daily summaries, weekly/monthly recaps)',
      'Work Allocation module with smart Excel parser (auto header detection, per-column filters)',
      'Allocation Monitor with download tracking and time-to-open colour coding (green <30m, orange <60m, red >60m)',
      'Hourly Monitor with 9 time slots (6:30 PM – 2:30 AM) and Filed/Pending status badges',
      'Productivity Monitor with Bypass, Remove Bypass, and Quality editing',
      'Weekly & Monthly Performance Summary with trophy rankings and CSV export',
      'Admin Team Management — create/edit users, process management, password reset approvals',
      'Employee Detail modal — 14-day bar chart, task breakdown, admin controls',
      'Profile modal — avatar, theme selector, name/password update, persisted to Supabase',
      'Anthropic API key saved to Supabase kv store (not localStorage)',
      'Task config with target and weight columns per process',
      'Persistent theme preference per user via Supabase rcm_store',
    ],
  },
  {
    version: 'v9.0', date: 'Jan 2026', status: 'stable',
    features: [
      'Supabase integration replacing local data store',
      'Role-based access control (admin, manager, employee, supervisor)',
      'Daily productivity log submission with quality scores',
      'Hourly count tracker (8 slots)',
      'Weekly summary reports with basic charts',
      'Team feedback messaging system with acknowledgement',
      'Dark mode toggle',
      'Session persistence via localStorage',
    ],
  },
  {
    version: 'v8.0', date: 'Sep 2025', status: 'legacy',
    features: [
      'AUTH process support with prior-auth task types',
      'Holiday marking and exclusion from calculations',
      'Deficit detection with colour-coded alerts',
      'Productivity bypass with reason logging',
      'CSV export for daily logs',
      'Monthly date navigation',
      'Employee history view',
    ],
  },
  {
    version: 'v7.0', date: 'Jun 2025', status: 'legacy',
    features: [
      'Multi-process support: MCO, MCD, MCR, AUTH',
      'Daily productivity form for employees',
      'Admin overview dashboard with team KPIs',
      'Basic bar chart for team productivity',
      'Process-based target configuration',
      'Quality score entry per employee',
      'Supervisor access control',
    ],
  },
  {
    version: 'v6.0', date: 'Mar 2025', status: 'legacy',
    features: [
      'Initial release of Helix Hub portal',
      'Employee login with role detection',
      'Simple productivity entry form',
      'MCO process only',
      'Basic admin dashboard',
      'Manual Excel reporting',
    ],
  },
];

const PLANNED = [
  'Automated deficit alerts via email/SMS notifications',
  'Real-time team dashboard with live updates (Supabase subscriptions)',
  'Employee self-service password reset via OTP email',
  'Advanced reporting with multi-month trend analysis and PDF export',
  'Mobile-responsive layout for field and supervisor access',
  'Integration with HR systems for automated employee onboarding',
  'Audit log for all admin actions (bypass, password reset, user changes)',
];

const STATUS = {
  current: { dot: '#10b981', bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'Current' },
  stable:  { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', label: 'Stable'  },
  legacy:  { dot: '#94a3b8', bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', label: 'Legacy'  },
};

export default function Changelog() {
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Changelog</div>
          <div className="page-subtitle">Helix Hub — RCM Team Performance Portal · 3Gen Consulting</div>
        </div>
        <span className="badge badge-green" style={{ fontSize: 13, padding: '4px 14px' }}>v10.0 Current</span>
      </div>

      {/* Timeline */}
      <div className="card mb-16">
        <div className="card-header"><div className="card-title">Release History</div></div>
        <div style={{ padding: '8px 4px' }}>
          {VERSIONS.map((v, idx) => {
            const s      = STATUS[v.status];
            const isLast = idx === VERSIONS.length - 1;
            return (
              <div key={v.version} style={{ display: 'flex', gap: 20 }}>
                {/* Spine */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 44 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: s.bg, border: `2px solid ${s.dot}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800, color: s.dot, textAlign: 'center', lineHeight: 1.2,
                  }}>
                    {v.version}
                  </div>
                  {!isLast && (
                    <div style={{ width: 2, flex: 1, minHeight: 20, background: 'var(--border)', margin: '4px 0' }} />
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, paddingBottom: isLast ? 0 : 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{v.version}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                      background: s.bg, color: s.color, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {s.label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.date}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {v.features.map((f, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Planned */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Planned Features</div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '2px 9px',
            borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
          }}>Roadmap</span>
        </div>
        <ul style={{ margin: 0, padding: '4px 0 4px 20px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {PLANNED.map((f, i) => (
            <li key={i} style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{f}</li>
          ))}
        </ul>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          Roadmap subject to change based on team requirements. Created by <strong>Faizan Shah</strong>.
        </p>
      </div>
    </div>
  );
}
