import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { today, addDays, getMon, wDays, fmtD, fmtSh, avg, pCol } from '../../lib/helpers';
import LineChart from '../../components/shared/LineChart';
import Modal from '../../components/shared/Modal';
import { Button } from '../../components/ui';

const pp = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

export default function MyReports({ user }) {
  const [view, setView]         = useState('prod');  // 'prod' | 'quality'
  const [weekStart, setWeekStart] = useState(getMon(today()));
  const [logs, setLogs]         = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [dayDetail, setDayDetail] = useState(null);

  const weekDays = wDays(weekStart);
  const periodLabel = `${fmtD(weekStart)} – ${fmtD(addDays(weekStart, 4))}`;

  useEffect(() => { load(); }, [weekStart]);

  async function load() {
    setLoading(true);
    const [logBatches, h] = await Promise.all([
      Promise.all(weekDays.map(d => S.get('daily_logs', { emp_id: user.emp_id, date: d }))),
      S.get('holidays'),
    ]);
    setLogs(logBatches.flat().filter(Boolean));
    setHolidays(h ?? []);
    setLoading(false);
  }

  const holidayDates = new Set((holidays ?? []).map(h => h.date));

  function getLog(date) { return logs.find(l => l.date === date) ?? null; }

  // Chart data
  const chartData = weekDays.map(d => {
    const isHol = holidayDates.has(d);
    const l     = getLog(d);
    const v = view === 'prod'
      ? (isHol ? null : (l ? (pp(l.total, l.adj_target ?? l.target) ?? 0) : 0))
      : (isHol ? null : (l?.quality ?? null));
    return { name: fmtSh(d), v: v ?? 0, isHol, date: d };
  }).filter(d => d.v !== null || !d.isHol);

  const validLogs = weekDays
    .filter(d => !holidayDates.has(d))
    .map(d => getLog(d))
    .filter(Boolean);

  const avgVal = view === 'prod'
    ? avg(validLogs.map(l => pp(l.total, l.adj_target ?? l.target)).filter(v => v != null))
    : avg(validLogs.map(l => l.quality).filter(v => v != null));

  const chartColor = view === 'prod' ? 'var(--accent)' : 'var(--col-green)';

  return (
    <div className="fg-page">
      {/* Period + switches (the page title is in the top bar) */}
      <div className="fg-bar">
        <div className="fg-filters">
          <div className="fg-choices fg-choices-tight" role="group" aria-label="View">
            {[['prod', 'Productivity'], ['quality', 'Quality']].map(([id, label]) => (
              <Button key={id} size="sm" active={view === id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</Button>
            ))}
          </div>
          <span className="fg-date">{periodLabel}</span>
        </div>
        <div className="fg-actions">
          <Button size="sm" aria-label="Previous week" onClick={() => setWeekStart(d => addDays(d, -7))}>‹</Button>
          <Button size="sm" aria-label="Next week" onClick={() => setWeekStart(d => addDays(d, 7))}>›</Button>
        </div>
      </div>

      {/* Avg KPI */}
      <div className="an-kpis">
        <div className="stat-card">
          <div className="stat-label">Week Avg {view === 'prod' ? 'Prod%' : 'Quality%'}</div>
          <div className={`stat-value ${pCol(avgVal)}`}>{avgVal != null ? avgVal.toFixed(1) + '%' : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Days Logged</div>
          <div className="stat-value">{validLogs.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Holidays</div>
          <div className="stat-value col-blue">
            {weekDays.filter(d => holidayDates.has(d)).length}
          </div>
        </div>
      </div>

      {/* Line chart */}
      <div className="card fg-card">
        <div className="card-header">
          <div className="card-title">{view === 'prod' ? 'Productivity Trend' : 'Quality Trend'}</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        {loading
          ? <div className="loading-row"><div className="spinner" /></div>
          : <LineChart data={chartData} color={chartColor} label={view === 'prod' ? 'Prod%' : 'Quality%'}
              onPointClick={item => { const l = getLog(item.date); if (l) setDayDetail(l); }} />}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Click a point to see that day's full report</p>
      </div>

      {/* Daily detail table */}
      <div className="card fg-card fg-tracker">
        <div className="card-header"><div className="card-title">Daily Details</div></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="center">Day</th>
                <th className="right">Total</th>
                <th className="right">Target</th>
                <th className="right">Prod%</th>
                <th className="right">Quality</th>
                <th className="right">Downtime</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {weekDays.map(d => {
                const isHol = holidayDates.has(d);
                const l     = getLog(d);
                const prod  = l ? pp(l.total, l.adj_target ?? l.target) : null;
                const dayName = new Date(d + 'T00:00').toLocaleDateString('en-US', { weekday: 'short' });
                return (
                  <tr key={d} className={isHol ? 'em-hol' : undefined}>
                    <td className="bold">{fmtD(d)}</td>
                    <td className="center text-sm text-muted">{dayName}</td>
                    {isHol ? (
                      <td colSpan={6} className="em-hol-t">
                        🏖 Holiday
                      </td>
                    ) : (
                      <>
                        <td className="right">{l?.total ?? '—'}</td>
                        <td className="right text-muted">{l?.adj_target ?? l?.target ?? '—'}</td>
                        <td className={`right bold ${pCol(prod)}`}>{prod != null ? prod + '%' : '—'}</td>
                        <td className={`right ${pCol(l?.quality)}`}>{l?.quality != null ? l.quality + '%' : '—'}</td>
                        <td className="right text-muted">{l?.downtime != null ? l.downtime + 'h' : '—'}</td>
                        <td className="text-sm text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l?.remarks ?? (l ? '—' : <span style={{ color: 'var(--danger)' }}>Not submitted</span>)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Day detail modal */}
      {dayDetail && (() => {
        const prod = pp(dayDetail.total, dayDetail.adj_target ?? dayDetail.target);
        const tasks = dayDetail.tasks || {};
        return (
          <Modal title={`${fmtD(dayDetail.date)} — Day Detail`} onClose={() => setDayDetail(null)}>
            <div className="rp-kpi-grid em-day">
              {[
                { label: 'Total',   value: dayDetail.total ?? '—' },
                { label: 'Target',  value: dayDetail.adj_target ?? dayDetail.target ?? '—' },
                { label: 'Prod%',   value: prod != null ? prod + '%' : '—', cls: pCol(prod) },
                { label: 'Quality', value: dayDetail.quality != null ? dayDetail.quality + '%' : '—', cls: pCol(dayDetail.quality) },
              ].map(k => (
                <div key={k.label} className="stat-card">
                  <div className="stat-label">{k.label}</div>
                  <div className={`stat-value ${k.cls ?? ''}`} style={{ fontSize: 20 }}>{k.value}</div>
                </div>
              ))}
            </div>
            {Object.keys(tasks).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Task Breakdown</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(tasks).map(([name, val]) => (
                    <span key={name} className="badge badge-gray" style={{ fontSize: 13 }}>{name}: <strong>{val}</strong></span>
                  ))}
                </div>
              </div>
            )}
            {dayDetail.remarks && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
                "{dayDetail.remarks}"
              </p>
            )}
            {dayDetail.downtime != null && (
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Downtime: {dayDetail.downtime}h</p>
            )}
            <div className="form-actions">
              <button className="btn-primary" onClick={() => setDayDetail(null)}>Close</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
