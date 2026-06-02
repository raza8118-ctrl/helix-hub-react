import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { today, addDays, getMon, wDays, mDays, fmtSh, fmtD, avg, pCol } from '../../lib/helpers';
import { MONTHS } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';

const pp = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

export default function Progress({ user }) {
  const todayStr = today();
  const [weekStart, setWeekStart] = useState(getMon(todayStr));
  const [month, setMonth]         = useState({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
  const [logs, setLogs]           = useState([]);
  const [holidays, setHolidays]   = useState([]);
  const [loading, setLoading]     = useState(false);

  const weekDays  = wDays(weekStart);
  const monthDays = mDays(month.y, month.m);

  useEffect(() => { load(); }, [weekStart, month]);

  async function load() {
    setLoading(true);
    const allDates = [...new Set([...weekDays, ...monthDays])];
    const [batches, h] = await Promise.all([
      Promise.all(allDates.map(d => S.get('daily_logs', { emp_id: user.emp_id, date: d }))),
      S.get('holidays'),
    ]);
    setLogs(batches.flat().filter(Boolean));
    setHolidays(h ?? []);
    setLoading(false);
  }

  const holidayDates = new Set((holidays ?? []).map(h => h.date));
  const getLog = d => logs.find(l => l.date === d) ?? null;

  // ── Weekly ──────────────────────────────────────────────────────────────────
  const weekActive = weekDays.filter(d => !holidayDates.has(d));
  const weekBarData = weekDays.map(d => ({
    name: fmtSh(d),
    prod: holidayDates.has(d)
      ? 0
      : (getLog(d) ? (pp(getLog(d).total, getLog(d).adj_target ?? getLog(d).target) ?? 0) : 0),
  }));

  const weekLogs    = weekActive.map(d => getLog(d)).filter(Boolean);
  const weekAvg     = avg(weekLogs.map(l => pp(l.total, l.adj_target ?? l.target)));
  const weekTotal   = weekLogs.reduce((s, l) => s + (l.total ?? 0), 0);
  const weekTarget  = weekLogs.reduce((s, l) => s + (l.adj_target ?? l.target ?? 0), 0);
  const weekDeficit = Math.max(0, weekTarget - weekTotal);
  const weekCalls   = weekLogs.reduce((s, l) => s + (l.calls ?? 0), 0);
  const weekCallHrs = weekLogs.reduce((s, l) => s + (l.call_hours ?? 0), 0);

  // ── Monthly ─────────────────────────────────────────────────────────────────
  const monthActive  = monthDays.filter(d => !holidayDates.has(d));
  const monthBarData = monthDays.map(d => ({
    name: fmtSh(d),
    prod: holidayDates.has(d)
      ? 0
      : (getLog(d) ? (pp(getLog(d).total, getLog(d).adj_target ?? getLog(d).target) ?? 0) : 0),
  }));

  const periodLabel = `${fmtD(weekStart)} – ${fmtD(addDays(weekStart, 4))}`;
  const monthLabel  = `${MONTHS[month.m - 1]} ${month.y}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Progress</div>
          <div className="page-subtitle">{user.name ?? user.emp_id}</div>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Week Avg',   value: weekAvg != null ? weekAvg.toFixed(1) + '%' : '—', cls: pCol(weekAvg) },
          { label: 'Total Done', value: weekTotal.toLocaleString(), cls: '' },
          { label: 'Week Target',value: weekTarget.toLocaleString(), cls: '' },
          { label: 'Deficit',    value: weekDeficit > 0 ? weekDeficit.toLocaleString() : '0', cls: weekDeficit > 0 ? 'col-red' : 'col-green' },
          { label: 'Calls',      value: weekCalls || '—', cls: '' },
          { label: 'Call Hrs',   value: weekCallHrs > 0 ? weekCallHrs.toFixed(1) : '—', cls: '' },
        ].map(k => (
          <div key={k.label} className="stat-card">
            <div className="stat-label">{k.label}</div>
            <div className={`stat-value ${k.cls}`} style={{ fontSize: 20 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Weekly chart */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Weekly Productivity</div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn-sm" onClick={() => setWeekStart(d => addDays(d, -7))} style={{ fontWeight: 700, fontSize: 15 }}>‹</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 6px' }}>{periodLabel}</span>
            <button className="btn-sm" onClick={() => setWeekStart(d => addDays(d, 7))} style={{ fontWeight: 700, fontSize: 15 }}>›</button>
          </div>
        </div>
        {loading
          ? <div className="loading-row"><div className="spinner" /></div>
          : <BarChart data={weekBarData} height={160} />}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {weekActive.length} working days · {weekDays.length - weekActive.length} holiday(s) excluded
        </p>
      </div>

      {/* Monthly chart */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Monthly Productivity</div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn-sm" onClick={() => setMonth(({ y, m }) => m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 })} style={{ fontWeight: 700, fontSize: 15 }}>‹</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 6px' }}>{monthLabel}</span>
            <button className="btn-sm" onClick={() => setMonth(({ y, m }) => m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 })} style={{ fontWeight: 700, fontSize: 15 }}>›</button>
          </div>
        </div>
        {loading
          ? <div className="loading-row"><div className="spinner" /></div>
          : <BarChart data={monthBarData} height={160} />}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {monthActive.length} working days · grey bars are holidays (excluded from calculations)
        </p>
      </div>
    </div>
  );
}
