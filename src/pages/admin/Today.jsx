import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import { loadCompany } from '../../lib/company';
import { today, fmtD, pCol, avg, dlCSV, callAI, procIncludes, logMatchesProc, getPinned, togglePinned, scopeToSupervisor, isOnLeave, permsFor } from '../../lib/helpers';
import { ACCESSES } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';
import { promptDialog } from '../../components/shared/Dialog';
import { KpiCard } from '../../components/dash/DashParts';
import { Pill, Notice, Button } from '../../components/ui';

/** Frost Glass: productivity colour band (pCol) → status pill tone. */
const TONE_OF = { 'col-green': 'good', 'col-orange': 'warn', 'col-red': 'bad' };
const toneOf = pct => TONE_OF[pCol(pct)] ?? 'neutral';

const p = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

export default function Today({ user }) {
  const [date, setDate]         = useState(today());
  const [filterProc, setProc]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [pinned, setPinned]     = useState([]);
  const [logs, setLogs]         = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [holiday, setHoliday]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [showEmail, setShowEmail]     = useState(false);
  const [emailBody, setEmailBody]     = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [empDetail, setEmpDetail] = useState(null);
  const [customProcs, setCustomProcs] = useState([]);

  useEffect(() => { load(); }, [date]);
  useEffect(() => { getPinned().then(setPinned); }, []);

  // Auto-refresh every 30 seconds so admin sees new submissions quickly
  useEffect(() => {
    const interval = setInterval(() => {
      Promise.all([S.get('daily_logs', { date }), S.get('users')]).then(([l, u]) => {
        setLogs(l ?? []);
        setAllUsers(u ?? []);
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [date]);

  async function load() {
    setLoading(true);
    const [u, l, h, cp] = await Promise.all([
      S.get('users'),
      S.get('daily_logs', { date }),
      S.get('holidays', { date }),
      S.get('processes'),
    ]);
    setAllUsers(u ?? []);
    setLogs(l ?? []);
    setHoliday(h?.[0] ?? null);
    setCustomProcs(cp ?? []);
    setLoading(false);
  }

  // Employees granted this page are view-only unless an admin ticked "Pin employee" for them
  const isGrantedEmployee = user.role === 'employee';
  const canPin = !isGrantedEmployee || permsFor(user).pinEmployee;

  async function togglePin(empId) {
    if (!canPin) return;
    const next = await togglePinned(empId, pinned);
    setPinned(next);
  }

  const { filteredUsers, submitted, onLeave, pending, avgProd, avgQuality, chartData, tableRows } = useMemo(() => {
    const employees = scopeToSupervisor(allUsers, user, customProcs).filter(u => {
      if (u.role !== 'employee') return false;
      const procOk   = filterProc === 'ALL' || procIncludes(u, filterProc);
      const statusOk = statusFilter === 'all' ||
        (statusFilter === 'active' ? u.active !== false : u.active === false);
      const pinOk    = !pinnedOnly || pinned.includes(u.emp_id);
      return procOk && statusOk && pinOk;
    });

    const teamEmpIds = new Set(employees.map(u => u.emp_id));
    const filteredLogs = logs.filter(l => logMatchesProc(l, filterProc) && teamEmpIds.has(l.emp_id));

    const onLeave    = filteredLogs.filter(l => isOnLeave(l)).length;
    const submitted  = filteredLogs.filter(l => l.submitted && !isOnLeave(l)).length;
    const pending    = employees.length - submitted - onLeave;
    const avgProd    = avg(filteredLogs.map(l => p(l.total, l.adj_target ?? l.target)));
    const avgQuality = avg(filteredLogs.map(l => l.quality).filter(v => v != null));

    const chartData = [...filteredLogs]
      .map(l => ({ name: l.emp_name ?? l.emp_id, prod: p(l.total, l.adj_target ?? l.target) ?? 0 }))
      .sort((a, b) => b.prod - a.prod);

    const tableRows = employees.map(u => ({
      ...u,
      log: filteredLogs.find(l => l.emp_id === u.emp_id) ?? null,
    })).sort((a, b) => (pinned.includes(b.emp_id) ? 1 : 0) - (pinned.includes(a.emp_id) ? 1 : 0));

    return { filteredUsers: employees, submitted, onLeave, pending, avgProd, avgQuality, chartData, tableRows };
  }, [allUsers, logs, user, customProcs, filterProc, statusFilter, pinnedOnly, pinned]);

  async function toggleHoliday() {
    if (holiday) {
      await S.del('holidays', { date });
      setHoliday(null);
    } else {
      const note = await promptDialog({ title: 'Mark as holiday', message: 'Give this holiday a label.', placeholder: 'e.g. Eid Holiday', confirmText: 'Mark Holiday' });
      if (note === null) return;
      const r = await S.set('holidays', { date, note: note.trim() || 'Holiday' });
      setHoliday(r?.[0] ?? { date, note: note || 'Holiday' });
    }
  }

  async function genEmail() {
    setShowEmail(true);
    setEmailLoading(true);
    setEmailBody('');
    try {
      const company = await loadCompany();
      const text = await callAI(
        `Write a professional daily performance summary email for an RCM team at ${company.name}.
Date: ${fmtD(date)} | Process: ${filterProc}
Team: ${filteredUsers.length} | Submitted: ${submitted} | Pending: ${pending}
Avg Productivity: ${avgProd != null ? avgProd.toFixed(1) + '%' : 'N/A'}
Avg Quality: ${avgQuality != null ? avgQuality.toFixed(1) + '%' : 'N/A'}
${holiday ? `Holiday: ${holiday.note}` : ''}
Write a concise professional email (150-200 words) from the RCM Operations Manager. Include subject line, highlights, and encouraging closing.`,
        1024
      );
      setEmailBody(text);
    } catch (err) {
      setEmailBody(`Error: ${err.message}\n\nMake sure the Anthropic API key is saved in Settings.`);
    }
    setEmailLoading(false);
  }

  function exportCSV() {
    const headers = ['Employee', 'Emp ID', 'Process', 'Status', 'Total', 'Adj.Target', 'Prod%', 'Quality', 'Downtime', 'Remark', 'Submitted At'];
    const rows = tableRows.map(row => ({
      'Employee': row.name ?? row.emp_id,
      'Emp ID': row.emp_id,
      'Process': row.log?.process ?? row.access,
      'Status': isOnLeave(row.log) ? 'On Leave' : row.log?.submitted ? 'Submitted' : 'Pending',
      'Total': row.log?.total ?? '',
      'Adj.Target': row.log?.adj_target ?? row.log?.target ?? '',
      'Prod%': row.log ? (p(row.log.total, row.log.adj_target ?? row.log.target) ?? '') : '',
      'Quality': row.log?.quality ?? '',
      'Downtime': row.log?.downtime ?? '',
      'Remark': row.log?.remarks ?? '',
      'Submitted At': row.log?.submitted_at ? new Date(row.log.submitted_at).toLocaleTimeString() : '',
    }));
    dlCSV(headers, rows, `today-${date}.csv`);
  }

  return (
    <div className="td-page">
      {/* Holiday banner */}
      {holiday && (
        <Notice tone="warn" icon="🏖">
          <strong>{holiday.note}</strong> — This date is marked as a holiday
        </Notice>
      )}

      {/* Filters + actions (the page title is in the top bar) */}
      <div className="td-bar">
        <div className="td-filters">
          <label className="td-f"><span>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="td-f"><span>Process</span>
            <select value={filterProc} onChange={e => setProc(e.target.value)}>
              {ACCESSES.map(a => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="td-f"><span>Status</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="all">All</option>
            </select>
          </label>
          <span className="td-date">{fmtD(date)}</span>
        </div>
        <div className="td-actions">
          <Button size="sm" variant={pinnedOnly ? 'primary' : 'secondary'} aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(v => !v)}>
            📌 Pinned only
          </Button>
          {!isGrantedEmployee && (
            <Button size="sm" className={holiday ? 'td-holiday-on' : ''} aria-pressed={!!holiday} onClick={toggleHoliday}>
              {holiday ? 'Unmark Holiday' : '🏖 Mark Holiday'}
            </Button>
          )}
          <Button size="sm" onClick={load}>↺ Refresh</Button>
          <Button size="sm" onClick={exportCSV}>Export CSV</Button>
          <Button size="sm" variant="primary" onClick={genEmail}>✦ AI Email</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="td-kpis">
        <KpiCard label="Team size" value={filteredUsers.length} sub={`${statusFilter} employees`} />
        <KpiCard label="Submitted" value={submitted} sub={`${pending} pending`} valueClass="col-green" />
        <KpiCard label="On leave" value={onLeave} sub="absent today" valueClass="col-blue" />
        <KpiCard label="Avg productivity" value={avgProd != null ? avgProd.toFixed(1) + '%' : '—'} sub="target 100%" valueClass={pCol(avgProd)} />
        <KpiCard label="Avg quality" value={avgQuality != null ? avgQuality.toFixed(1) + '%' : '—'} sub="target ≥95%" valueClass={pCol(avgQuality)} />
      </div>

      {/* Bar chart */}
      <div className="card td-card">
        <div className="card-header">
          <div className="card-title">Team Productivity</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <BarChart data={chartData} />
      </div>

      {/* Submission tracker */}
      <div className="card td-card td-tracker">
        <div className="card-header">
          <div className="card-title">Submission Tracker</div>
          <Pill tone={submitted === filteredUsers.length && filteredUsers.length > 0 ? 'good' : 'warn'}>
            {submitted}/{filteredUsers.length}
          </Pill>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Process</th>
                <th className="center">Status</th>
                <th className="right">Total</th>
                <th className="right">Prod%</th>
                <th className="right">Quality</th>
                <th className="right">Downtime</th>
                <th>Reason</th>
                <th>Time Submitted</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr><td colSpan={9} className="td-empty">No data for this date</td></tr>
              )}
              {tableRows.map(row => {
                const prod = row.log ? p(row.log.total, row.log.adj_target ?? row.log.target) : null;
                const isPinned = pinned.includes(row.emp_id);
                return (
                  <tr key={row.emp_id} className={isPinned ? 'td-pinned' : undefined}>
                    <td className="bold">
                      <span
                        onClick={e => { e.stopPropagation(); togglePin(row.emp_id); }}
                        className={`td-pin${isPinned ? ' on' : ''}${canPin ? ' can' : ''}`}
                        title={canPin ? (isPinned ? 'Unpin' : 'Pin for close monitoring') : (isPinned ? 'Pinned' : '')}
                      >
                        📌
                      </span>
                      <span className="td-name" onClick={() => setEmpDetail(row)}>
                        {row.name ?? row.emp_id}
                      </span>
                    </td>
                    <td>{row.log?.process ?? row.access}</td>
                    <td className="center">
                      {isOnLeave(row.log)
                        ? <Pill tone="accent">On Leave</Pill>
                        : row.log?.submitted
                          ? <Pill tone="good">Submitted</Pill>
                          : <Pill tone="bad">Pending</Pill>}
                    </td>
                    <td className="right">{row.log?.total ?? '—'}</td>
                    <td className="right">{prod != null ? <Pill tone={toneOf(prod)}>{prod}%</Pill> : '—'}</td>
                    <td className={`right ${pCol(row.log?.quality)}`}>
                      {row.log?.quality != null
                        ? row.log.quality + '%'
                        : (row.log && !isOnLeave(row.log) && !row.log?.bypass_reason)
                          ? <Pill>Pending</Pill>
                          : '—'}
                    </td>
                    <td className="right text-muted">{row.log?.downtime != null ? row.log.downtime + 'h' : '—'}</td>
                    <td className="text-sm text-muted td-reason">
                      {row.log?.bypass_reason
                        ? <span className="td-bypass">📋 {row.log.bypass_reason}</span>
                        : row.log?.remarks ?? '—'}
                    </td>
                    <td className="text-sm text-muted">
                      {row.log?.submitted_at ? new Date(row.log.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}
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
        <Modal title="AI Generated Email" onClose={() => setShowEmail(false)} wide>
          {emailLoading
            ? <div className="td-empty">Generating with Claude…</div>
            : (
              <>
                <textarea className="td-email" value={emailBody} readOnly />
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
