import { KpiCard } from '../../components/dash/DashParts';
import NavIcon from '../../components/ui/NavIcon';
import { countOff } from '../../lib/companyFeatures';
import { healthOf, HEALTH_LEVELS as LEVELS } from '../../lib/ownerCenter';

const n = v => (v == null ? '—' : v.toLocaleString());
const ago = iso => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export default function OwnerOverview({ rows, statOf, needsSync, startPage, startPages, onStartPage, onOpen, onManage, onTogglePause, onPick, busy }) {
  const sum = k => rows.reduce((t, c) => t + (statOf(c)[k] ?? 0), 0);
  const health = rows.map(c => ({ c, ...healthOf(c, statOf(c), needsSync(c)) }));
  const alerts = health.flatMap(h => h.reasons.map(r => ({ c: h.c, ...r })))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1));
  const problems = health.filter(h => h.level === 'problem').length;
  const watching = health.filter(h => h.level === 'watch').length;

  return (
    <>
      <div className="fg-kpis oc-kpis mb-16">
        <KpiCard label="Companies" value={rows.length} sub={`${rows.filter(c => !c.active).length} paused`} />
        <KpiCard label="Active users" value={n(sum('activeUsers'))} sub={`${n(sum('users'))} accounts in total`} />
        <KpiCard label="Sign-ins today" value={n(sum('signInsToday'))} sub={`${n(sum('signIns7'))} in the last 7 days`} />
        <KpiCard label="Daily reports this week" value={n(sum('reportsWeek'))} sub="Submitted, all companies" />
        <KpiCard label="Need attention" value={problems + watching} sub={`${problems} problem · ${watching} watch`}
          valueClass={problems ? 'col-red' : watching ? 'col-yellow' : 'col-green'} />
      </div>

      <div className="card fg-card mb-16">
        <div className="card-header">
          <div className="card-title">Alerts</div>
          {alerts.length > 0 && <span className="text-sm text-muted">{alerts.length} item{alerts.length === 1 ? '' : 's'}</span>}
        </div>
        {alerts.length === 0 ? (
          <div className="oc-allclear"><NavIcon icon="check" size={18} /> All clear — nothing needs your attention.</div>
        ) : (
          <ul className="oc-alerts">
            {alerts.map((a, i) => (
              <li key={i} className={`oc-alert oc-${a.level}`}>
                <span className="oc-alert-icon" aria-hidden="true"><NavIcon icon="alert" size={16} /></span>
                <span className="oc-alert-text"><strong>{a.c.name}</strong> · {a.text}</span>
                <span className={`badge ${LEVELS[a.level].badge}`}>{LEVELS[a.level].label}</span>
                {a.sync
                  ? <button type="button" className="btn-sm" onClick={() => onPick('platform')}>Platform</button>
                  : <button type="button" className="btn-sm" onClick={() => onManage(a.c)}>Manage</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row mb-16" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="text-sm text-muted" htmlFor="ow-start">Open companies at</label>
        <select id="ow-start" value={startPage} onChange={e => onStartPage(e.target.value)} style={{ maxWidth: 200 }}>
          {startPages.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="grid-3 mb-16">
        {health.map(({ c, level, reasons }) => {
          const s = statOf(c);
          return (
            <div key={c.prefix || 'home'} className={`card fg-card oc-co oc-co-${level}`}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="bold" style={{ fontSize: 15 }}>{c.name}</div>
                  <div className="text-sm text-muted"><code>{c.code || '—'}</code>{c.isHome ? ' · Home' : ''}{c.plan ? ` · ${c.plan}` : ''}</div>
                </div>
                <span className={`badge ${LEVELS[level].badge}`} title="Health">{LEVELS[level].label}</span>
              </div>
              {reasons.length > 0 && (
                <ul className="oc-co-reasons">{reasons.map(r => <li key={r.text} className={`oc-${r.level}`}>{r.text}</li>)}</ul>
              )}
              <div className="oc-co-stats">
                {[
                  ['Users', `${n(s.activeUsers)}${c.seat_limit ? ` / ${c.seat_limit}` : ''}`],
                  ['Sign-ins today', n(s.signInsToday)],
                  ['Last 7 days', n(s.signIns7)],
                  ['Reports (week)', n(s.reportsWeek)],
                  ['Prod % (week)', s.prodWeek == null ? '—' : `${Math.round(s.prodWeek)}%`],
                  ['Pages off', c.isHome ? '—' : countOff(c.features)],
                ].map(([l, v]) => (
                  <div key={l} className="oc-co-stat"><div className="oc-co-stat-l">{l}</div><div className="bold">{v}</div></div>
                ))}
              </div>
              <div className="text-sm text-muted">
                Last activity: {s.lastActivity ? `${ago(s.lastActivity.created_at)} · ${s.lastActivity.actor_name ?? ''}` : 'none yet'}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                <button className="btn-sm btn-primary" onClick={() => onOpen(c)}>Open</button>
                <button className="btn-sm" onClick={() => onManage(c)}>Manage</button>
                {!c.isHome && (
                  <button className="btn-sm" onClick={() => onTogglePause(c)} disabled={busy} style={c.active ? { color: 'var(--danger)' } : {}}>
                    {c.active ? 'Pause' : 'Resume'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
