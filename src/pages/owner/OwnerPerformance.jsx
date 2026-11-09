import { useState, useEffect, useCallback } from 'react';
import { companyPerformance } from '../../lib/owner';
import { pCol } from '../../lib/helpers';

/**
 * Owner Command Center → Performance (PO 2026-11-09): Prod % and Quality % per company, side by side,
 * for this week (Monday → today) and this month (1st → today). Same formula as Prod Monitor.
 */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const short = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const keyOf = c => c.prefix || 'home';

function ranges() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mon = new Date(today); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    week:  { from: ymd(mon), to: ymd(today), label: `This week · ${short(mon)} – ${short(today)}` },
    month: { from: ymd(first), to: ymd(today), label: `This month · ${short(first)} – ${short(today)}` },
  };
}

function Pct({ value, n, what }) {
  if (value == null) return <span className="text-muted" title={`No ${what} yet`}>—</span>;
  const v = Math.round(value * 10) / 10;
  return (
    <div className="opf-cell" title={`Average of ${n} report${n === 1 ? '' : 's'}`}>
      <span className={pCol(v)}>{v.toFixed(1)}%</span>
      <span className="opf-bar" aria-hidden="true"><i className={pCol(v)} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /></span>
    </div>
  );
}

export default function OwnerPerformance({ rows }) {
  const [data, setData] = useState(undefined);   // key → { week, month }
  const r = ranges();

  const load = useCallback(async () => {
    const { week, month } = ranges();
    const out = await Promise.all(rows.map(async c => {
      const [w, m] = await Promise.all([companyPerformance(c.prefix ?? '', week.from, week.to), companyPerformance(c.prefix ?? '', month.from, month.to)]);
      return [keyOf(c), { week: w, month: m }];
    }));
    setData(Object.fromEntries(out));
  }, [rows]);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => alive && load());
    return () => { alive = false; };
  }, [load]);

  return (
    <div className="fg-page">
      <div className="fg-bar">
        <div className="fg-filters">
          <span className="fg-date">{r.week.label} &nbsp;·&nbsp; {r.month.label}</span>
        </div>
        <div className="fg-actions">
          <button type="button" className="btn-sm" onClick={() => { setData(undefined); load(); }}>Refresh</button>
        </div>
      </div>

      <div className="card fg-card fg-tracker">
        <div className="table-wrap">
          <table className="opf-table">
            <thead>
              <tr>
                <th rowSpan={2}>Company</th>
                <th colSpan={3} className="opf-group">This week</th>
                <th colSpan={3} className="opf-group">This month</th>
              </tr>
              <tr>
                <th>Prod %</th><th>Quality %</th><th className="right">Reports</th>
                <th>Prod %</th><th>Quality %</th><th className="right">Reports</th>
              </tr>
            </thead>
            <tbody>
              {data === undefined && <tr><td colSpan={7}><div className="loading-row"><div className="spinner" /> Loading…</div></td></tr>}
              {data && rows.map(c => {
                const d = data[keyOf(c)] ?? {};
                const cells = p => (p == null
                  ? <td colSpan={3} className="text-muted text-sm">Couldn't load</td>
                  : <>
                    <td><Pct value={p.prod} n={p.prodN} what="production" /></td>
                    <td><Pct value={p.quality} n={p.qualityN} what="quality scores" /></td>
                    <td className="right">{p.reports}<div className="text-muted" style={{ fontSize: 11 }}>{p.people} people</div></td>
                  </>);
                return (
                  <tr key={keyOf(c)}>
                    <td><div className="bold">{c.name}</div><div className="text-sm text-muted">{c.isHome ? 'Home' : c.code}{c.active === false ? ' · paused' : ''}</div></td>
                    {cells(d.week)}
                    {cells(d.month)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted" style={{ margin: '12px 0 0' }}>
          Prod % uses the Prod Monitor formula for each daily report (work done ÷ adjusted target), averaged; days with no target
          (leave, absent) are left out. Quality % is the average of the quality scores entered. Hover a number to see how many reports it is based on.
        </p>
      </div>
    </div>
  );
}
