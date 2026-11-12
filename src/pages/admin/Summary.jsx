import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import { loadCompany } from '../../lib/company';
import { today, fmtD, fmtSh, addDays, getMon, wDays, mDays, avg, pCol, dlCSV, callAI, procIncludes, logMatchesProc, scopeToSupervisor } from '../../lib/helpers';
import { MONTHS, ACCESSES } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';
import LineChart from '../../components/shared/LineChart';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';
import { KpiCard } from '../../components/dash/DashParts';
import { Pill, Button } from '../../components/ui';
import AiTestingBanner from '../../components/shared/AiTestingBanner';

const MEDAL = { 1: '🏆', 2: '🥈', 3: '🥉' };

// Frost Glass: the same colour bands as before, as theme classes (col-* follow the theme; orange band keeps its orange)
const prodBand = v => (v == null ? '' : v >= 100 ? 'col-green' : v >= 75 ? 'col-yellow' : 'col-red');        // KPI card
const qualBand = v => (v == null ? '' : v >= 98 ? 'col-green' : v >= 90 ? 'col-yellow' : 'col-red');
const rankProdTone = v => (v >= 100 ? 'good' : v >= 85 ? 'warn' : v >= 70 ? 'orange' : 'bad');            // rankings bar
const pp = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

// Best/worst day for a chart's dataset — used to fill the space below the chart with real numbers
function bestWorstDay(data, key, unit = '') {
  const valid = data.filter(d => d[key] > 0);
  if (valid.length < 2) return null;
  const best = valid.reduce((a, b) => (b[key] > a[key] ? b : a));
  const worst = valid.reduce((a, b) => (b[key] < a[key] ? b : a));
  if (best === worst) return null;
  return { best: `${best.name} · ${best[key]}${unit}`, worst: `${worst.name} · ${worst[key]}${unit}` };
}

function ChartCard({ icon, title, subtitle, highlight, children }) {
  return (
    <div className="card sm-chart">
      <div className="sm-chart-h">
        <div>
          <div className="sm-chart-t">{icon} {title}</div>
          <div className="sm-chart-s">{subtitle}</div>
        </div>
        <div className="sm-chart-hint">Click to view day</div>
      </div>
      <div className="sm-chart-b">{children}</div>
      {highlight && (
        <div className="sm-hl">
          <span>Best day: <strong className="sm-good">{highlight.best}</strong></span>
          <span>Lowest day: <strong className="sm-bad">{highlight.worst}</strong></span>
        </div>
      )}
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
      const company = await loadCompany();
      const top = rankings[0];
      const text = await callAI(
        `Write a professional ${mode} performance summary email for an RCM team at ${company.name}.
Period: ${periodLabel} | Working days: ${kpiDays} | Agents: ${kpiAgents} | Process: ${filterProc}
Avg Productivity: ${kpiAvgProd != null ? kpiAvgProd.toFixed(1) + '%' : 'N/A'}
Avg Quality: ${kpiAvgQ != null ? kpiAvgQ.toFixed(1) + '%' : 'N/A'}
Total Volume: ${kpiTotal.toLocaleString()}
Top Performer: ${top?.name ?? 'N/A'} — ${top?.avgProd?.toFixed(1) ?? 'N/A'}%
Write a professional ${mode} recap email (200-250 words). Include subject line, highlights, top performers, areas for improvement.`,
        1024
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
    <div className="fg-page">
      {/* Filters + actions (the page title is in the top bar) */}
      <div className="fg-bar">
        <div className="fg-filters">
          <div className="fg-choices fg-choices-tight" role="group" aria-label="Period">
            {['weekly', 'monthly'].map(m => (
              <Button key={m} size="sm" active={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </Button>
            ))}
          </div>
          <div className="fg-choices fg-choices-tight">
            <Button size="sm" onClick={navPrev} aria-label="Previous period">‹</Button>
            <Button size="sm" onClick={navNext} aria-label="Next period">›</Button>
          </div>
          <label className="fg-f"><span>Process</span>
            <select value={filterProc} onChange={e => setProc(e.target.value)}>
              {ACCESSES.map(a => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="fg-f"><span>Status</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="fg-f"><span>Agent</span>
            <select value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="ALL">All Agents</option>
              {allUsers.filter(u => u.role === 'employee').map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id}</option>)}
            </select>
          </label>
          <span className="fg-date">{periodLabel} · {kpiDays} working day{kpiDays !== 1 ? 's' : ''}</span>
        </div>
        <div className="fg-actions">
          <Button size="sm" onClick={exportCSV}>Export CSV</Button>
          <Button size="sm" variant="primary" onClick={genEmail}>✦ AI Summary Email</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="fg-kpis fg-kpis-6">
        <KpiCard label="Working days" value={kpiDays} sub={`${holidays.filter(h => workDays.includes(h.date)).length} holiday(s)`} />
        <KpiCard label="Agents" value={kpiAgents} sub={filterProc === 'ALL' ? 'All processes' : filterProc} />
        <KpiCard label="Avg productivity" value={kpiAvgProd != null ? kpiAvgProd.toFixed(1) + '%' : '—'}
          valueClass={prodBand(kpiAvgProd)} fill={kpiAvgProd} />
        <KpiCard label="Avg quality" value={kpiAvgQ != null ? kpiAvgQ.toFixed(1) + '%' : '—'}
          valueClass={qualBand(kpiAvgQ)} fill={kpiAvgQ} />
        <KpiCard label="Total claims" value={kpiTotal.toLocaleString()} sub="volume processed" />
        <KpiCard label="Total calls" value={kpiTotalCalls.toLocaleString()} sub={`${kpiTotalCallHours.toFixed(1)} hrs on calls`} />
      </div>

      {/* Charts */}
      <div className="fg-section">Team Trends · {periodLabel}</div>
      <div className="sm-charts">
        <ChartCard icon="⚡" title="Productivity" subtitle={`Daily average, with trend line · ${barData.length} days`}
          highlight={bestWorstDay(barData, 'prod', '%')}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={barData} height={190} showLine onBarClick={openDayDetail} />}
        </ChartCard>
        <ChartCard icon="⭐" title="Quality" subtitle={`Daily average, with trend line · ${qualityBarData.length} days`}
          highlight={bestWorstDay(qualityBarData, 'prod', '%')}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={qualityBarData} height={190} showLine onBarClick={openDayDetail} />}
        </ChartCard>
      </div>
      <div className="sm-charts">
        <ChartCard icon="📞" title="Call Volume" subtitle={`${kpiTotalCalls.toLocaleString()} total calls · ${callsBarData.length} days`}
          highlight={bestWorstDay(callsBarData, 'prod')}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={callsBarData} height={190} mode="value" color="var(--accent)" onBarClick={openDayDetail} />}
        </ChartCard>
        <ChartCard icon="⏱️" title="Call Hours" subtitle={`${kpiTotalCallHours.toFixed(1)} total hrs · ${callHoursLineData.length} days`}
          highlight={bestWorstDay(callHoursLineData, 'v', 'h')}>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <LineChart data={callHoursLineData} height={190} mode="value" suffix="h" color="var(--accent)" onPointClick={openDayDetail} />}
        </ChartCard>
      </div>

      {/* Rankings */}
      <div className="card fg-card fg-tracker">
        <div className="card-header">
          <div className="card-title">🏆 Performance Rankings</div>
          <Pill tone="accent">{rankings.length} agent{rankings.length !== 1 ? 's' : ''}</Pill>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="center sm-rank-col">Rank</th>
                <th>Employee</th>
                <th>Process</th>
                <th className="right">Days</th>
                <th className="right">Volume</th>
                <th className="sm-prod-col">Avg Prod%</th>
                <th className="right">Quality</th>
                <th className="right">Calls</th>
                <th className="right">Call Hrs</th>
              </tr>
            </thead>
            <tbody>
              {rankings.length === 0 && (
                <tr><td colSpan={9} className="fg-empty">No data for this period</td></tr>
              )}
              {rankings.map((r, i) => (
                <tr key={r.emp_id} className={i < 3 ? `sm-top${i + 1}` : undefined}>
                  <td className="center">
                    {i < 3
                      ? <span className="sm-medal">{MEDAL[i + 1]}</span>
                      : <span className="sm-rank">#{i + 1}</span>
                    }
                  </td>
                  <td>
                    <span className="bold fg-name" onClick={() => setEmpDetail(r)}>
                      {r.name ?? r.emp_id}
                    </span>
                  </td>
                  <td className="text-muted sm-small">{r.access}</td>
                  <td className="right">{r.days}</td>
                  <td className="right bold">{r.total.toLocaleString()}</td>
                  <td className="sm-prod-cell">
                    {r.avgProd != null ? (
                      <div className={`sm-bar sm-tone-${rankProdTone(r.avgProd)}`}>
                        <div className="sm-bar-track"><i style={{ width: `${Math.min(r.avgProd, 100)}%` }} /></div>
                        <span>{r.avgProd.toFixed(1)}%</span>
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className={`right sm-q ${r.avgQuality != null ? qualBand(r.avgQuality) : 'text-muted'}`}>
                    {r.avgQuality != null ? r.avgQuality.toFixed(1) + '%' : '—'}
                  </td>
                  <td className="right text-muted">
                    {r.calls > 0 ? r.calls.toLocaleString() : '—'}
                  </td>
                  <td className="right text-muted">
                    {r.callHours > 0 ? r.callHours.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Email modal */}
      {showEmail && (
        <Modal title={`AI ${mode.charAt(0).toUpperCase() + mode.slice(1)} Summary Email`} onClose={() => setShowEmail(false)} wide>
          <AiTestingBanner />
          {emailLoading
            ? <div className="fg-empty">Generating with Claude…</div>
            : (
              <>
                <textarea className="fg-email sm-email" value={emailBody} readOnly />
                <div className="form-actions">
                  <Button size="sm" onClick={() => navigator.clipboard?.writeText(emailBody)}>Copy</Button>
                  <Button size="sm" variant="primary" onClick={() => setShowEmail(false)}>Done</Button>
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
          <div className="sm-day-sub">
            {dayDetail.rows.length} submission{dayDetail.rows.length !== 1 ? 's' : ''} · {dayDetail.date}
          </div>
          <div className="table-wrap sm-day">
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
                    <td colSpan={9} className="fg-empty">
                      No data submitted for this day
                    </td>
                  </tr>
                )}
                {dayDetail.rows.map((r, i) => (
                  <tr key={r.emp_id} className={i === 0 ? 'sm-top1' : undefined}>
                    <td>
                      <span className="bold fg-name"
                        onClick={() => { setDayDetail(null); setEmpDetail(allUsers.find(u => u.emp_id === r.emp_id) ?? r); }}>
                        {r.name}
                      </span>
                    </td>
                    <td className="text-muted">{r.process}</td>
                    <td className="right bold">{r.total || '—'}</td>
                    <td className="right text-muted">{r.target || '—'}</td>
                    <td className={`right bold ${pCol(r.prod)}`}>{r.prod != null ? r.prod + '%' : '—'}</td>
                    <td className={`right ${pCol(r.quality)}`}>{r.quality != null ? r.quality + '%' : '—'}</td>
                    <td className="right text-muted">{r.calls ?? '—'}</td>
                    <td className="right text-muted">{r.callHours ?? '—'}</td>
                    <td className="text-muted sm-remarks">
                      {r.remarks ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <Button size="sm" variant="primary" onClick={() => setDayDetail(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
