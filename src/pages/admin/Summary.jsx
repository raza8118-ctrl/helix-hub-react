import { useState, useEffect, useMemo } from 'react';
import { S, kv } from '../../lib/supabase';
import { today, fmtD, fmtSh, addDays, getMon, wDays, mDays, avg, pCol, dlCSV, callAI, procIncludes, logMatchesProc, scopeToSupervisor } from '../../lib/helpers';
import { MONTHS, ACCESSES } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';
import LineChart from '../../components/shared/LineChart';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';

const pp = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '13px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text)', letterSpacing: '0.02em' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
      <div style={{ padding: '12px 8px 4px' }}>{children}</div>
    </div>
  );
}

export default function Summary({ user, defaultMode = 'weekly' }) {
  const todayStr = today();
  const [mode, setMode]         = useState(defaultMode);
  const [refDate, setRefDate]   = useState(getMon(todayStr));
  const [refMonth, setRefMonth] = useState({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
  const [filterProc, setProc]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [agentId, setAgentId]   = useState('ALL');
  const [logs, setLogs]         = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [showEmail, setShowEmail]     = useState(false);
  const [emailBody, setEmailBody]     = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [empDetail, setEmpDetail] = useState(null);
  const [dayDetail, setDayDetail] = useState(null);
  const [customProcs, setCustomProcs] = useState([]);

  const workDays = useMemo(() => (
    mode === 'weekly' ? wDays(refDate) : mDays(refMonth.y, refMonth.m)
  ), [mode, refDate, refMonth]);

  useEffect(() => { load(); }, [mode, refDate, refMonth]);

  async function load() {
    setLoading(true);
    const [u, h, cp] = await Promise.all([
      S.get('users'),
      S.get('holidays'),
      S.get('processes'),
    ]);
    setAllUsers(u ?? []);
    setHolidays(h ?? []);
    setCustomProcs(cp ?? []);
    const batched = await Promise.all(workDays.map(d => S.get('daily_logs', { date: d })));
    setLogs(batched.flat().filter(Boolean));
    setLoading(false);
  }

  const {
    kpiDays, kpiAgents, kpiAvgProd, kpiAvgQ, kpiTotal, barData, rankings,
    callsBarData, callHoursLineData, kpiTotalCalls, kpiTotalCallHours,
    qualityBarData,
  } = useMemo(() => {
    const holidayDates = new Set((holidays ?? []).map(h => h.date));
    const activeDays   = workDays.filter(d => !holidayDates.has(d));

    const filteredUsers = scopeToSupervisor(allUsers, user, customProcs).filter(u => {
      if (u.role !== 'employee') return false;
      // When a specific agent is selected, bypass proc/status filters so their data always shows
      if (agentId !== 'ALL') return u.emp_id === agentId;
      const procOk   = filterProc === 'ALL' || procIncludes(u, filterProc);
      const statusOk = statusFilter === 'all' ||
        (statusFilter === 'active' ? u.active !== false : u.active === false);
      return procOk && statusOk;
    });

    const teamEmpIds = new Set(filteredUsers.map(u => u.emp_id));
    const filteredLogs = logs.filter(l => {
      const agentOk = agentId === 'ALL' || l.emp_id === agentId;
      // When a specific agent is chosen, skip proc filter (their process is already correct)
      const procOk  = agentId !== 'ALL' ? true : logMatchesProc(l, filterProc);
      const teamOk  = teamEmpIds.has(l.emp_id);
      return agentOk && procOk && teamOk && !holidayDates.has(l.date);
    });

    const allProds   = filteredLogs.map(l => pp(l.total, l.adj_target ?? l.target)).filter(v => v != null);
    const kpiDays    = activeDays.length;
    const kpiAgents  = filteredUsers.length;
    const kpiAvgProd = avg(allProds);
    const kpiAvgQ    = avg(filteredLogs.map(l => l.quality).filter(v => v != null));
    const kpiTotal   = filteredLogs.reduce((s, l) => s + (l.total ?? 0), 0);

    const barData = activeDays.map(d => {
      const dl = filteredLogs.filter(l => l.date === d);
      const dp = dl.map(l => pp(l.total, l.adj_target ?? l.target)).filter(v => v != null);
      return { name: fmtSh(d), prod: avg(dp) != null ? Math.round(avg(dp)) : 0, date: d };
    });

    const qualityBarData = activeDays.map(d => {
      const dl = filteredLogs.filter(l => l.date === d);
      const dq = dl.map(l => l.quality).filter(v => v != null);
      return { name: fmtSh(d), prod: avg(dq) != null ? Math.round(avg(dq)) : 0, date: d };
    });

    const callsBarData = activeDays.map(d => {
      const dl = filteredLogs.filter(l => l.date === d);
      return { name: fmtSh(d), prod: dl.reduce((s, l) => s + (l.calls ?? 0), 0), date: d };
    });
    const callHoursLineData = activeDays.map(d => {
      const dl = filteredLogs.filter(l => l.date === d);
      const hrs = dl.reduce((s, l) => s + (l.call_hours ?? 0), 0);
      return { name: fmtSh(d), v: Math.round(hrs * 10) / 10, date: d };
    });
    const kpiTotalCalls     = filteredLogs.reduce((s, l) => s + (l.calls ?? 0), 0);
    const kpiTotalCallHours = filteredLogs.reduce((s, l) => s + (l.call_hours ?? 0), 0);

    const rankings = filteredUsers.map(u => {
      const ul = filteredLogs.filter(l => l.emp_id === u.emp_id);
      const up = ul.map(l => pp(l.total, l.adj_target ?? l.target)).filter(v => v != null);
      return {
        ...u,
        avgProd: avg(up),
        avgQuality: avg(ul.map(l => l.quality).filter(v => v != null)),
        total: ul.reduce((s, l) => s + (l.total ?? 0), 0),
        calls: ul.reduce((s, l) => s + (l.calls ?? 0), 0),
        callHours: ul.reduce((s, l) => s + (l.call_hours ?? 0), 0),
        days: ul.length,
      };
    }).sort((a, b) => (b.avgProd ?? -1) - (a.avgProd ?? -1));

    return {
      activeDays, filteredUsers, kpiDays, kpiAgents, kpiAvgProd, kpiAvgQ, kpiTotal, barData, rankings,
      callsBarData, callHoursLineData, kpiTotalCalls, kpiTotalCallHours,
      qualityBarData,
    };
  }, [holidays, workDays, allUsers, user, customProcs, filterProc, agentId, statusFilter, logs]);

  function openDayDetail(item) {
    if (!item?.date) return;
    const hols = new Set(holidays.map(h => h.date));
    const scopedIds = new Set(
      scopeToSupervisor(allUsers, user, customProcs)
        .filter(u => u.role === 'employee')
        .map(u => u.emp_id)
    );
    const dayLogs = logs
      .filter(l => l.date === item.date && scopedIds.has(l.emp_id) && !hols.has(l.date))
      .filter(l => agentId !== 'ALL' ? l.emp_id === agentId : logMatchesProc(l, filterProc));
    const rows = dayLogs.map(l => {
      const u = allUsers.find(u => u.emp_id === l.emp_id);
      return {
        name: u?.name ?? l.emp_id,
        emp_id: l.emp_id,
        process: l.process ?? u?.access ?? '—',
        total: l.total ?? 0,
        target: l.adj_target ?? l.target ?? 0,
        prod: pp(l.total, l.adj_target ?? l.target),
        quality: l.quality,
        calls: l.calls,
        callHours: l.call_hours,
        remarks: l.remarks,
      };
    }).sort((a, b) => (b.prod ?? -1) - (a.prod ?? -1));
    setDayDetail({ label: item.name, date: item.date, rows });
  }

  function navPrev() {
    if (mode === 'weekly') setRefDate(d => addDays(d, -7));
    else setRefMonth(({ y, m }) => m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });
  }
  function navNext() {
    if (mode === 'weekly') setRefDate(d => addDays(d, 7));
    else setRefMonth(({ y, m }) => m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });
  }

  const periodLabel = mode === 'weekly'
    ? `${fmtD(refDate)} – ${fmtD(addDays(refDate, 4))}`
    : `${MONTHS[refMonth.m - 1]} ${refMonth.y}`;

  async function genEmail() {
    setShowEmail(true);
    setEmailLoading(true);
    setEmailBody('');
    try {
      const apiKey = await kv.get('anthropic_key');
      const top = rankings[0];
      const text = await callAI(
        `Write a professional ${mode} performance summary email for an RCM team at 3Gen Consulting.
Period: ${periodLabel} | Working days: ${kpiDays} | Agents: ${kpiAgents} | Process: ${filterProc}
Avg Productivity: ${kpiAvgProd != null ? kpiAvgProd.toFixed(1) + '%' : 'N/A'}
Avg Quality: ${kpiAvgQ != null ? kpiAvgQ.toFixed(1) + '%' : 'N/A'}
Total Volume: ${kpiTotal.toLocaleString()}
Top Performer: ${top?.name ?? 'N/A'} — ${top?.avgProd?.toFixed(1) ?? 'N/A'}%
Write a professional ${mode} recap email (200-250 words). Include subject line, highlights, top performers, areas for improvement.`,
        1024,
        apiKey
      );
      setEmailBody(text);
    } catch (err) {
      setEmailBody(`Error: ${err.message}`);
    }
    setEmailLoading(false);
  }

  function exportCSV() {
    const headers = ['Rank', 'Employee', 'Emp ID', 'Process', 'Working Days', 'Total Volume', 'Avg Prod%', 'Avg Quality%', 'Total Calls', 'Call Hours'];
    const rows = rankings.map((r, i) => ({
      'Rank': i + 1,
      'Employee': r.name ?? r.emp_id,
      'Emp ID': r.emp_id,
      'Process': r.access,
      'Working Days': r.days,
      'Total Volume': r.total,
      'Avg Prod%': r.avgProd?.toFixed(1) ?? '',
      'Avg Quality%': r.avgQuality?.toFixed(1) ?? '',
      'Total Calls': r.calls || '',
      'Call Hours': r.callHours ? r.callHours.toFixed(1) : '',
    }));
    dlCSV(headers, rows, `summary-${periodLabel.replace(/[^a-z0-9]/gi, '-')}.csv`);
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Performance Summary</div>
          <div className="page-subtitle">{periodLabel} · {kpiDays} working day{kpiDays !== 1 ? 's' : ''}</div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {/* Mode toggle */}
          <div className="row" style={{ background: 'var(--surface-2)', borderRadius: 6, padding: 2, gap: 2 }}>
            {['weekly', 'monthly'].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4, border: 'none',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
              }}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn-sm" onClick={navPrev} style={{ fontWeight: 700, fontSize: 15 }}>‹</button>
            <button className="btn-sm" onClick={navNext} style={{ fontWeight: 700, fontSize: 15 }}>›</button>
          </div>
          <select value={filterProc} onChange={e => setProc(e.target.value)} style={{ maxWidth: 120 }}>
            {ACCESSES.map(a => <option key={a}>{a}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 120 }}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="all">All</option>
          </select>
          <select value={agentId} onChange={e => setAgentId(e.target.value)} style={{ maxWidth: 165 }}>
            <option value="ALL">All Agents</option>
            {allUsers.filter(u => u.role === 'employee').map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id}</option>)}
          </select>
          <button className="btn-sm" onClick={exportCSV}>Export CSV</button>
          <button className="btn-primary" onClick={genEmail}>✦ AI Summary Email</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-16" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        {[
          {
            label: 'Working Days', value: kpiDays,
            sub: `${holidays.filter(h => workDays.includes(h.date)).length} holiday(s)`,
          },
          {
            label: 'Agents', value: kpiAgents,
            sub: filterProc === 'ALL' ? 'All processes' : filterProc,
          },
          {
            label: 'Avg Productivity',
            value: kpiAvgProd != null ? kpiAvgProd.toFixed(1) + '%' : '—',
            valueCol: kpiAvgProd >= 100 ? '#10b981' : kpiAvgProd >= 75 ? '#f59e0b' : kpiAvgProd != null ? '#ef4444' : 'var(--text)',
            bar: kpiAvgProd, barCol: kpiAvgProd >= 100 ? '#10b981' : kpiAvgProd >= 75 ? '#f59e0b' : '#ef4444',
          },
          {
            label: 'Avg Quality',
            value: kpiAvgQ != null ? kpiAvgQ.toFixed(1) + '%' : '—',
            valueCol: kpiAvgQ >= 98 ? '#10b981' : kpiAvgQ >= 90 ? '#f59e0b' : kpiAvgQ != null ? '#ef4444' : 'var(--text)',
            bar: kpiAvgQ, barCol: kpiAvgQ >= 98 ? '#10b981' : kpiAvgQ >= 90 ? '#f59e0b' : '#ef4444',
          },
          {
            label: 'Total Claims', value: kpiTotal.toLocaleString(),
            sub: 'volume processed',
          },
          {
            label: 'Total Calls', value: kpiTotalCalls.toLocaleString(),
            sub: `${kpiTotalCallHours.toFixed(1)} hrs on calls`,
          },
        ].map(({ label, value, sub, valueCol, bar, barCol }) => (
          <div key={label} className="stat-card">
            <div className="stat-label" style={{
              margin: 0, textTransform: 'uppercase', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
            }}>{label}</div>
            <div className="stat-value" style={{ color: valueCol ?? 'var(--text)', fontSize: 26, lineHeight: 1, marginTop: 7 }}>{value}</div>
            {bar != null && (
              <div style={{ marginTop: 9, height: 3, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(bar, 100)}%`, background: barCol, borderRadius: 3, transition: 'width 0.6s ease' }} />
              </div>
            )}
            {sub && <div className="stat-sub" style={{ marginTop: 6 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 10px' }}>
        Team Trends · {periodLabel}
      </div>
      <div className="grid-2 mb-16">
        <ChartCard title="Productivity" subtitle={`Daily average, with trend line · ${barData.length} days`}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={barData} height={190} showLine onBarClick={openDayDetail} />}
        </ChartCard>
        <ChartCard title="Quality" subtitle={`Daily average, with trend line · ${qualityBarData.length} days`}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={qualityBarData} height={190} showLine onBarClick={openDayDetail} />}
        </ChartCard>
      </div>
      <div className="grid-2 mb-16">
        <ChartCard title="Call Volume" subtitle={`${kpiTotalCalls.toLocaleString()} total calls · ${callsBarData.length} days`}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={callsBarData} height={190} mode="value" color="#0284c7" onBarClick={openDayDetail} />}
        </ChartCard>
        <ChartCard title="Call Hours" subtitle={`${kpiTotalCallHours.toFixed(1)} total hrs · ${callHoursLineData.length} days`}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <LineChart data={callHoursLineData} height={190} mode="value" suffix="h" color="#7c3aed" onPointClick={openDayDetail} />}
        </ChartCard>
      </div>

      {/* Rankings */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Performance Rankings</div>
          <span className="badge badge-blue">{rankings.length} agent{rankings.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="center" style={{ width: 64 }}>Rank</th>
                <th>Employee</th>
                <th>Process</th>
                <th className="right">Days</th>
                <th className="right">Volume</th>
                <th style={{ minWidth: 160 }}>Avg Prod%</th>
                <th className="right">Quality</th>
                <th className="right">Calls</th>
                <th className="right">Call Hrs</th>
              </tr>
            </thead>
            <tbody>
              {rankings.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>No data for this period</td></tr>
              )}
              {rankings.map((r, i) => {
                const prodColor = r.avgProd >= 100 ? '#10b981' : r.avgProd >= 85 ? '#f59e0b' : r.avgProd >= 70 ? '#f97316' : '#ef4444';
                const qualColor = r.avgQuality >= 98 ? '#10b981' : r.avgQuality >= 90 ? '#f59e0b' : '#ef4444';
                return (
                  <tr key={r.emp_id}>
                    <td className="center">
                      <span style={{
                        display: 'inline-block', width: 26, height: 26, lineHeight: '26px',
                        borderRadius: '50%', background: i === 0 ? 'var(--accent-dim)' : 'var(--surface-2)',
                        fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--accent)' : 'var(--text-muted)',
                      }}>{i + 1}</span>
                    </td>
                    <td>
                      <span className="bold" style={{ cursor: 'pointer', color: 'var(--accent)' }}
                        onClick={() => setEmpDetail(r)}>
                        {r.name ?? r.emp_id}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.access}</td>
                    <td className="right" style={{ fontSize: 13 }}>{r.days}</td>
                    <td className="right bold" style={{ fontSize: 13 }}>{r.total.toLocaleString()}</td>
                    <td style={{ paddingRight: 16 }}>
                      {r.avgProd != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--surface-3)', borderRadius: 6, overflow: 'hidden', minWidth: 60 }}>
                            <div style={{
                              height: '100%', width: `${Math.min(r.avgProd, 100)}%`,
                              background: prodColor, borderRadius: 6,
                              transition: 'width 0.5s ease',
                            }} />
                          </div>
                          <span style={{ fontWeight: 700, fontSize: 13, color: prodColor, minWidth: 44, textAlign: 'right' }}>
                            {r.avgProd.toFixed(1)}%
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="right" style={{ fontWeight: 600, fontSize: 13, color: r.avgQuality != null ? qualColor : 'var(--text-muted)' }}>
                      {r.avgQuality != null ? r.avgQuality.toFixed(1) + '%' : '—'}
                    </td>
                    <td className="right" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {r.calls > 0 ? r.calls.toLocaleString() : '—'}
                    </td>
                    <td className="right" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {r.callHours > 0 ? r.callHours.toFixed(1) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Email modal */}
      {showEmail && (
        <Modal title={`AI ${mode.charAt(0).toUpperCase() + mode.slice(1)} Summary Email`} onClose={() => setShowEmail(false)} wide>
          {emailLoading
            ? <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Generating with Claude…</div>
            : (
              <>
                <textarea value={emailBody} readOnly style={{
                  width: '100%', minHeight: 300, resize: 'vertical',
                  fontFamily: 'inherit', fontSize: 13, lineHeight: 1.65, padding: 12,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none',
                }} />
                <div className="form-actions">
                  <button className="btn-sm" onClick={() => navigator.clipboard?.writeText(emailBody)}>Copy</button>
                  <button className="btn-primary" onClick={() => setShowEmail(false)}>Done</button>
                </div>
              </>
            )}
        </Modal>
      )}

      {empDetail && (
        <EmpDetail emp={empDetail} onClose={() => setEmpDetail(null)} currentUser={user} />
      )}

      {dayDetail && (
        <Modal title={`${dayDetail.label} — Daily Breakdown`} onClose={() => setDayDetail(null)} wide>
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            {dayDetail.rows.length} submission{dayDetail.rows.length !== 1 ? 's' : ''} · {dayDetail.date}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Process</th>
                  <th className="right">Total</th>
                  <th className="right">Target</th>
                  <th className="right">Prod%</th>
                  <th className="right">Quality</th>
                  <th className="right">Calls</th>
                  <th className="right">Call Hrs</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {dayDetail.rows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      No data submitted for this day
                    </td>
                  </tr>
                )}
                {dayDetail.rows.map((r, i) => (
                  <tr key={r.emp_id} style={i === 0 ? { background: 'rgba(16,185,129,0.04)' } : undefined}>
                    <td>
                      <span className="bold" style={{ cursor: 'pointer', color: 'var(--accent)' }}
                        onClick={() => { setDayDetail(null); setEmpDetail(allUsers.find(u => u.emp_id === r.emp_id) ?? r); }}>
                        {r.name}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.process}</td>
                    <td className="right bold">{r.total || '—'}</td>
                    <td className="right" style={{ color: 'var(--text-muted)' }}>{r.target || '—'}</td>
                    <td className={`right bold ${pCol(r.prod)}`}>{r.prod != null ? r.prod + '%' : '—'}</td>
                    <td className={`right ${pCol(r.quality)}`}>{r.quality != null ? r.quality + '%' : '—'}</td>
                    <td className="right" style={{ color: 'var(--text-muted)' }}>{r.calls ?? '—'}</td>
                    <td className="right" style={{ color: 'var(--text-muted)' }}>{r.callHours ?? '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.remarks ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={() => setDayDetail(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
