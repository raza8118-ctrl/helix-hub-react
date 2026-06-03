import { useState, useEffect } from 'react';
import { S, kv } from '../../lib/supabase';
import { today, fmtD, fmtSh, addDays, getMon, wDays, mDays, avg, pCol, dlCSV, callAI } from '../../lib/helpers';
import { MONTHS, ACCESSES } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';
import LineChart from '../../components/shared/LineChart';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';

const MEDAL = { 1: '🏆', 2: '🥈', 3: '🥉' };
const pp = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

export default function Summary({ user, defaultMode = 'weekly' }) {
  const todayStr = today();
  const [mode, setMode]         = useState(defaultMode);
  const [refDate, setRefDate]   = useState(getMon(todayStr));
  const [refMonth, setRefMonth] = useState({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
  const [filterProc, setProc]   = useState('ALL');
  const [agentId, setAgentId]   = useState('ALL');
  const [logs, setLogs]         = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [showEmail, setShowEmail]     = useState(false);
  const [emailBody, setEmailBody]     = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [empDetail, setEmpDetail] = useState(null);

  const workDays = mode === 'weekly'
    ? wDays(refDate)
    : mDays(refMonth.y, refMonth.m);

  useEffect(() => { load(); }, [mode, refDate, refMonth]);

  async function load() {
    setLoading(true);
    const [u, h] = await Promise.all([
      S.get('users', { active: true }),
      S.get('holidays'),
    ]);
    setAllUsers(u ?? []);
    setHolidays(h ?? []);
    const batched = await Promise.all(workDays.map(d => S.get('daily_logs', { date: d })));
    setLogs(batched.flat().filter(Boolean));
    setLoading(false);
  }

  const holidayDates = new Set((holidays ?? []).map(h => h.date));
  const activeDays   = workDays.filter(d => !holidayDates.has(d));

  const filteredUsers = allUsers.filter(u => {
    if (u.role !== 'employee') return false;
    const procOk  = filterProc === 'ALL' || u.access === filterProc || u.access === 'ALL';
    const agentOk = agentId === 'ALL' || u.emp_id === agentId;
    return procOk && agentOk;
  });

  const filteredLogs = logs.filter(l => {
    const procOk  = filterProc === 'ALL' || l.process === filterProc;
    const agentOk = agentId === 'ALL' || l.emp_id === agentId;
    return procOk && agentOk && !holidayDates.has(l.date);
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
    return { name: fmtSh(d), prod: avg(dp) != null ? Math.round(avg(dp)) : 0 };
  });

  const lineData = barData.map(d => ({ name: d.name, v: d.prod }));

  const rankings = filteredUsers.map(u => {
    const ul = filteredLogs.filter(l => l.emp_id === u.emp_id);
    const up = ul.map(l => pp(l.total, l.adj_target ?? l.target)).filter(v => v != null);
    return {
      ...u,
      avgProd: avg(up),
      avgQuality: avg(ul.map(l => l.quality).filter(v => v != null)),
      total: ul.reduce((s, l) => s + (l.total ?? 0), 0),
      days: ul.length,
    };
  }).sort((a, b) => (b.avgProd ?? -1) - (a.avgProd ?? -1));

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
    const headers = ['Rank', 'Employee', 'Emp ID', 'Process', 'Working Days', 'Total Volume', 'Avg Prod%', 'Avg Quality%'];
    const rows = rankings.map((r, i) => ({
      'Rank': i + 1,
      'Employee': r.name ?? r.emp_id,
      'Emp ID': r.emp_id,
      'Process': r.access,
      'Working Days': r.days,
      'Total Volume': r.total,
      'Avg Prod%': r.avgProd?.toFixed(1) ?? '',
      'Avg Quality%': r.avgQuality?.toFixed(1) ?? '',
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
          <select value={agentId} onChange={e => setAgentId(e.target.value)} style={{ maxWidth: 165 }}>
            <option value="ALL">All Agents</option>
            {allUsers.filter(u => u.role === 'employee').map(u => <option key={u.emp_id} value={u.emp_id}>{u.name ?? u.emp_id}</option>)}
          </select>
          <button className="btn-sm" onClick={exportCSV}>Export CSV</button>
          <button className="btn-primary" onClick={genEmail}>✦ AI Summary Email</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-16" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Working Days</div>
          <div className="stat-value">{kpiDays}</div>
          <div className="stat-sub">{holidays.filter(h => workDays.includes(h.date)).length} holiday(s)</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Agents</div>
          <div className="stat-value">{kpiAgents}</div>
          <div className="stat-sub">{filterProc}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Productivity</div>
          <div className={`stat-value ${pCol(kpiAvgProd)}`}>{kpiAvgProd != null ? kpiAvgProd.toFixed(1) + '%' : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Quality</div>
          <div className={`stat-value ${pCol(kpiAvgQ)}`}>{kpiAvgQ != null ? kpiAvgQ.toFixed(1) + '%' : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Claims</div>
          <div className="stat-value">{kpiTotal.toLocaleString()}</div>
          <div className="stat-sub">volume processed</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><div className="card-title">Daily Avg Productivity</div></div>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <BarChart data={barData} height={160} />}
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Productivity Trend</div></div>
          {loading
            ? <div className="loading-row"><div className="spinner" /></div>
            : <LineChart data={lineData} height={160} />}
        </div>
      </div>

      {/* Rankings */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Performance Rankings</div>
          <span className="badge badge-blue">{rankings.length} agents</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="center" style={{ width: 60 }}>Rank</th>
                <th>Employee</th>
                <th>Process</th>
                <th className="right">Days</th>
                <th className="right">Total</th>
                <th className="right">Avg Prod%</th>
                <th className="right">Avg Quality</th>
              </tr>
            </thead>
            <tbody>
              {rankings.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No data for this period</td></tr>
              )}
              {rankings.map((r, i) => (
                <tr key={r.emp_id} style={i === 0 ? { background: 'rgba(16,185,129,0.04)' } : undefined}>
                  <td className="center" style={{ fontSize: i < 3 ? 18 : 14, fontWeight: 700 }}>
                    {MEDAL[i + 1] ?? `#${i + 1}`}
                  </td>
                  <td className="bold" style={{ cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => setEmpDetail(r)}>
                    {r.name ?? r.emp_id}
                  </td>
                  <td>{r.access}</td>
                  <td className="right">{r.days}</td>
                  <td className="right">{r.total.toLocaleString()}</td>
                  <td className={`right bold ${pCol(r.avgProd)}`}>
                    {r.avgProd != null ? r.avgProd.toFixed(1) + '%' : '—'}
                  </td>
                  <td className={`right ${pCol(r.avgQuality)}`}>
                    {r.avgQuality != null ? r.avgQuality.toFixed(1) + '%' : '—'}
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
    </div>
  );
}
