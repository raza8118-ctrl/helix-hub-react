import { useState, useEffect } from 'react';
import { S, kv } from '../../lib/supabase';
import { today, fmtD, pCol, avg, dlCSV, callAI } from '../../lib/helpers';
import { ACCESSES } from '../../lib/constants';
import BarChart from '../../components/shared/BarChart';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';

const p = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

export default function Today({ user }) {
  const [date, setDate]         = useState(today());
  const [filterProc, setProc]   = useState('ALL');
  const [logs, setLogs]         = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [holiday, setHoliday]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [showEmail, setShowEmail]     = useState(false);
  const [emailBody, setEmailBody]     = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [empDetail, setEmpDetail] = useState(null);

  useEffect(() => { load(); }, [date]);

  async function load() {
    setLoading(true);
    const [u, l, h] = await Promise.all([
      S.get('users', { active: true }),
      S.get('daily_logs', { date }),
      S.get('holidays', { date }),
    ]);
    setAllUsers(u ?? []);
    setLogs(l ?? []);
    setHoliday(h?.[0] ?? null);
    setLoading(false);
  }

  const filteredUsers = filterProc === 'ALL'
    ? allUsers
    : allUsers.filter(u => u.access === filterProc || u.access === 'ALL');

  const filteredLogs = filterProc === 'ALL'
    ? logs
    : logs.filter(l => l.process === filterProc);

  const submitted  = filteredLogs.filter(l => l.submitted).length;
  const pending    = filteredUsers.length - submitted;
  const avgProd    = avg(filteredLogs.map(l => p(l.total, l.adj_target ?? l.target)));
  const avgQuality = avg(filteredLogs.map(l => l.quality).filter(v => v != null));

  const chartData = [...filteredLogs]
    .map(l => ({ name: l.emp_name ?? l.emp_id, prod: p(l.total, l.adj_target ?? l.target) ?? 0 }))
    .sort((a, b) => b.prod - a.prod);

  const tableRows = filteredUsers.map(u => ({
    ...u,
    log: filteredLogs.find(l => l.emp_id === u.emp_id) ?? null,
  }));

  async function toggleHoliday() {
    if (holiday) {
      await S.del('holidays', { date });
      setHoliday(null);
    } else {
      const note = window.prompt('Holiday label (e.g. "Eid Holiday"):');
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
      const apiKey = await kv.get('anthropic_key');
      const text = await callAI(
        `Write a professional daily performance summary email for an RCM team at 3Gen Consulting.
Date: ${fmtD(date)} | Process: ${filterProc}
Team: ${filteredUsers.length} | Submitted: ${submitted} | Pending: ${pending}
Avg Productivity: ${avgProd != null ? avgProd.toFixed(1) + '%' : 'N/A'}
Avg Quality: ${avgQuality != null ? avgQuality.toFixed(1) + '%' : 'N/A'}
${holiday ? `Holiday: ${holiday.note}` : ''}
Write a concise professional email (150-200 words) from the RCM Operations Manager. Include subject line, highlights, and encouraging closing.`,
        1024,
        apiKey
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
      'Status': row.log?.submitted ? 'Submitted' : 'Pending',
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
    <div>
      {/* Holiday banner */}
      {holiday && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center',
          gap: 10, fontSize: 13, color: 'var(--warning)',
        }}>
          🏖 <strong>{holiday.note}</strong> — This date is marked as a holiday
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Today's Overview</div>
          <div className="page-subtitle">{fmtD(date)}</div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <select value={filterProc} onChange={e => setProc(e.target.value)} style={{ maxWidth: 130 }}>
            {ACCESSES.map(a => <option key={a}>{a}</option>)}
          </select>
          <button
            className="btn-sm"
            style={holiday ? { background: 'var(--warning)', color: '#000', border: 'none' } : {}}
            onClick={toggleHoliday}
          >
            {holiday ? 'Unmark Holiday' : '🏖 Mark Holiday'}
          </button>
          <button className="btn-sm" onClick={exportCSV}>Export CSV</button>
          <button className="btn-primary" onClick={genEmail}>✦ AI Email</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid-4 mb-16">
        {[
          { label: 'Team Size',        value: filteredUsers.length, sub: 'active employees',    cls: '' },
          { label: 'Submitted',        value: submitted,             sub: `${pending} pending`,  cls: 'col-green' },
          { label: 'Avg Productivity', value: avgProd != null ? avgProd.toFixed(1) + '%' : '—', sub: 'target 100%', cls: pCol(avgProd) },
          { label: 'Avg Quality',      value: avgQuality != null ? avgQuality.toFixed(1) + '%' : '—', sub: 'target ≥95%', cls: pCol(avgQuality) },
        ].map(kpi => (
          <div key={kpi.label} className="stat-card">
            <div className="stat-label">{kpi.label}</div>
            <div className={`stat-value ${kpi.cls}`}>{kpi.value}</div>
            <div className="stat-sub">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Team Productivity</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <BarChart data={chartData} />
      </div>

      {/* Submission tracker */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Submission Tracker</div>
          <span className={`badge ${submitted === filteredUsers.length && filteredUsers.length > 0 ? 'badge-green' : 'badge-yellow'}`}>
            {submitted}/{filteredUsers.length}
          </span>
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
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No data for this date</td></tr>
              )}
              {tableRows.map(row => {
                const prod = row.log ? p(row.log.total, row.log.adj_target ?? row.log.target) : null;
                return (
                  <tr key={row.emp_id}>
                    <td className="bold" style={{ cursor: 'pointer', color: 'var(--accent)' }}
                      onClick={() => setEmpDetail(row)}>
                      {row.name ?? row.emp_id}
                    </td>
                    <td>{row.log?.process ?? row.access}</td>
                    <td className="center">
                      {row.log?.submitted
                        ? <span className="badge badge-green">Submitted</span>
                        : <span className="badge badge-red">Pending</span>}
                    </td>
                    <td className="right">{row.log?.total ?? '—'}</td>
                    <td className={`right bold ${pCol(prod)}`}>{prod != null ? prod + '%' : '—'}</td>
                    <td className={`right ${pCol(row.log?.quality)}`}>
                      {row.log?.quality != null ? row.log.quality + '%' : '—'}
                    </td>
                    <td className="right text-muted">{row.log?.downtime != null ? row.log.downtime + 'h' : '—'}</td>
                    <td className="text-sm text-muted" style={{ maxWidth: 140 }}>
                      {row.log?.bypass_reason
                        ? <span style={{ color: 'var(--accent)' }}>📋 {row.log.bypass_reason}</span>
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
            ? <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Generating with Claude…</div>
            : (
              <>
                <textarea value={emailBody} readOnly style={{
                  width: '100%', minHeight: 280, resize: 'vertical',
                  fontFamily: 'inherit', fontSize: 13, lineHeight: 1.65,
                  padding: 12, background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  color: 'var(--text)', outline: 'none',
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
