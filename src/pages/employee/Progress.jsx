import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { today, addDays, getMon, wDays, mDays, fmtSh, fmtD, avg, pCol } from '../../lib/helpers';
import { MONTHS } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';
import Modal from '../../components/shared/Modal';

const pp = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

export default function Progress({ user }) {
  const todayStr = today();
  const [weekStart, setWeekStart] = useState(getMon(todayStr));
  const [month, setMonth]         = useState({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
  const [logs, setLogs]           = useState([]);
  const [holidays, setHolidays]   = useState([]);
  const [loading, setLoading]     = useState(false);

  const [dayDetail, setDayDetail] = useState(null);

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
    date: d,
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
    date: d,
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
          : <BarChart data={weekBarData} height={160} onBarClick={item => { const l = getLog(item.date); if (l) setDayDetail(l); }} />}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {weekActive.length} working days · {weekDays.length - weekActive.length} holiday(s) excluded · Click a bar for details
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
          : <BarChart data={monthBarData} height={160} onBarClick={item => { const l = getLog(item.date); if (l) setDayDetail(l); }} />}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {monthActive.length} working days · grey bars are holidays · Click a bar for details
        </p>
      </div>

      {/* Day detail modal */}
      {dayDetail && (() => {
        const prod = pp(dayDetail.total, dayDetail.adj_target ?? dayDetail.target);
        const tasks = dayDetail.tasks || {};
        return (
          <Modal title={`${fmtD(dayDetail.date)} — Day Detail`} onClose={() => setDayDetail(null)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
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
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Task Breakdown</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(tasks).map(([name, val]) => (
                    <span key={name} className="badge" style={{ fontSize: 13 }}>{name}: <strong>{val}</strong></span>
                  ))}
                </div>
              </div>
            )}
            {dayDetail.remarks && (
              <p style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
                "{dayDetail.remarks}"
              </p>
            )}
            {dayDetail.downtime != null && (
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                Downtime: {dayDetail.downtime}h
              </p>
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
