import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtD, pCol, avg, procIncludes, logMatchesProc, getPinned, togglePinned } from '../../lib/helpers';
import { ACCESSES, SHIFT_H, ATTENDANCE_STATUSES, LEAVE_STATUSES, HALF_DAY_STATUSES, LEAVE_TYPES } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';

const p = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

const STATUS_LABELS = { present: 'Present', half_day_1: 'Half Day AM', half_day_2: 'Half Day PM', absent: 'Absent' };

function StatusBadge({ prod, bypassed }) {
  if (bypassed) return <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent)' }}>Bypassed</span>;
  if (prod == null) return <span className="badge badge-gray">No Data</span>;
  if (prod >= 100) return <span className="badge badge-green">On Track</span>;
  if (prod >= 75)  return <span className="badge badge-yellow">At Risk</span>;
  return <span className="badge badge-red">Below Target</span>;
}

export default function ProdMonitor({ user }) {
  const [date, setDate]         = useState(today());
  const [filterProc, setProc]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [pinned, setPinned]     = useState([]);
  const [logs, setLogs]         = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [holiday, setHoliday]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [empDetail, setEmpDetail] = useState(null);

  const [bypassTarget, setBypassTarget] = useState(null);
  const [bypassReason, setBypassReason] = useState('');
  const [bypassStatus, setBypassStatus] = useState('absent');
  const [bypassLeaveType, setBypassLeaveType] = useState('planned');
  const [bypassLoading, setBypassLoading] = useState(false);

  const [qualityTarget, setQualityTarget] = useState(null);
  const [qualityVal, setQualityVal]       = useState('');
  const [qualityLoading, setQualityLoading] = useState(false);

  useEffect(() => { load(); }, [date]);
  useEffect(() => { getPinned().then(setPinned); }, []);

  async function load() {
    setLoading(true);
    const [u, l, h] = await Promise.all([
      S.get('users'),
      S.get('daily_logs', { date }),
      S.get('holidays', { date }),
    ]);
    setAllUsers(u ?? []);
    setLogs(l ?? []);
    setHoliday(h?.[0] ?? null);
    setLoading(false);
  }

  async function togglePin(empId) {
    const next = await togglePinned(empId, pinned);
    setPinned(next);
  }

  async function toggleHoliday() {
    if (holiday) {
      await S.del('holidays', { date });
      setHoliday(null);
    } else {
      const note = window.prompt('Holiday label:');
      if (note === null) return;
      const r = await S.set('holidays', { date, note: note.trim() || 'Holiday' });
      setHoliday(r?.[0] ?? { date, note });
    }
  }

  async function doBypass() {
    if (!bypassTarget || !bypassReason.trim()) return;
    setBypassLoading(true);

    const isAbsentStatus  = LEAVE_STATUSES.includes(bypassStatus);
    const isHalfDayStatus = HALF_DAY_STATUSES.includes(bypassStatus);
    const baseTarget = bypassTarget.target ?? 50;
    const statusFields = {
      attendance_status: bypassStatus,
      leave_type: isAbsentStatus ? bypassLeaveType : null,
      total: isAbsentStatus ? 0 : (bypassTarget.log?.total ?? 0),
      adj_target: isAbsentStatus ? 0 : (isHalfDayStatus ? baseTarget * 0.5 : baseTarget),
      base_target: isAbsentStatus ? 0 : (isHalfDayStatus ? baseTarget * 0.5 : baseTarget),
    };

    if (bypassTarget.log?.id) {
      await S.update('daily_logs', { bypass_reason: bypassReason.trim(), ...statusFields }, { id: bypassTarget.log.id });
    } else {
      // No log exists — create a minimal entry with the bypass note
      await S.set('daily_logs', {
        emp_id: bypassTarget.emp_id,
        emp_name: bypassTarget.name ?? bypassTarget.emp_id,
        date,
        process: bypassTarget.process || bypassTarget.access || 'MCO',
        target: baseTarget,
        ...statusFields,
        bypass_reason: bypassReason.trim(),
        submitted: false,
        submitted_at: new Date().toISOString(),
      }, 'emp_id,date');
    }
    setBypassTarget(null);
    setBypassReason('');
    setBypassStatus('absent');
    setBypassLeaveType('planned');
    setBypassLoading(false);
    await load();
  }

  async function removeBypass(row) {
    if (!window.confirm('Remove bypass for this employee?')) return;
    await S.update('daily_logs', { bypass_reason: null }, { id: row.log.id });
    await load();
  }

  async function doQuality() {
    const q = parseFloat(qualityVal);
    if (!qualityTarget || isNaN(q) || q < 0 || q > 100) return;
    setQualityLoading(true);
    await S.update('daily_logs', { quality: q }, { id: qualityTarget.log.id });
    setQualityTarget(null);
    setQualityVal('');
    setQualityLoading(false);
    await load();
  }

  const employees = allUsers.filter(u => {
    if (u.role !== 'employee') return false;
    const procOk   = filterProc === 'ALL' || procIncludes(u, filterProc);
    const statusOk = statusFilter === 'all' ||
      (statusFilter === 'active' ? u.active !== false : u.active === false);
    const pinOk    = !pinnedOnly || pinned.includes(u.emp_id);
    return procOk && statusOk && pinOk;
  });
  const filteredUsers = employees;

  const filteredLogs = logs.filter(l => logMatchesProc(l, filterProc));

  const tableRows = filteredUsers.map(u => {
    const log  = filteredLogs.find(l => l.emp_id === u.emp_id) ?? null;
    const adjT = log?.adj_target ?? (log?.target != null && log?.downtime != null
      ? Math.round(log.target * ((SHIFT_H - log.downtime) / SHIFT_H))
      : log?.target ?? null);
    const prod    = p(log?.total, adjT);
    const deficit = adjT != null && log?.total != null ? adjT - log.total : null;
    return { ...u, log, adjT, prod, deficit };
  }).sort((a, b) => (pinned.includes(b.emp_id) ? 1 : 0) - (pinned.includes(a.emp_id) ? 1 : 0));

  const avgProd    = avg(tableRows.map(r => r.prod).filter(v => v != null));
  const avgQuality = avg(filteredLogs.map(l => l.quality).filter(v => v != null));

  return (
    <div>
      {/* Holiday banner */}
      {holiday && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(245,158,11,0.15), transparent)',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--warning)',
        }}>
          🏖 <strong>{holiday.note}</strong> — Holiday
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Productivity Monitor</div>
          <div className="page-subtitle">
            {fmtD(date)}
            {avgProd != null && (
              <> · Team avg: <span className={pCol(avgProd)}>{avgProd.toFixed(1)}%</span></>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <select value={filterProc} onChange={e => setProc(e.target.value)} style={{ maxWidth: 130 }}>
            {ACCESSES.map(a => <option key={a}>{a}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 120 }}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="all">All</option>
          </select>
          <button
            className="btn-sm"
            style={pinnedOnly ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
            onClick={() => setPinnedOnly(v => !v)}
          >
            📌 Pinned only
          </button>
          <button className="btn-sm" onClick={load}>↺ Refresh</button>
          <button
            className="btn-sm"
            style={holiday ? { background: 'var(--warning)', color: '#000', border: 'none' } : {}}
            onClick={toggleHoliday}
          >
            {holiday ? 'Unmark Holiday' : '🏖 Holiday'}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid-4 mb-16">
        <div className="stat-card">
          <div className="stat-label">Total Employees</div>
          <div className="stat-value">{filteredUsers.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">On Track (≥100%)</div>
          <div className="stat-value col-green">{tableRows.filter(r => (r.prod ?? 0) >= 100).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Productivity</div>
          <div className={`stat-value ${pCol(avgProd)}`}>{avgProd != null ? avgProd.toFixed(1) + '%' : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Quality</div>
          <div className={`stat-value ${pCol(avgQuality)}`}>{avgQuality != null ? avgQuality.toFixed(1) + '%' : '—'}</div>
        </div>
      </div>

      {/* Main table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Employee Productivity</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Process</th>
                <th className="center">Auth?</th>
                <th className="center">Status</th>
                <th className="right">Total</th>
                <th className="right">Adj.Target</th>
                <th className="right">Prod%</th>
                <th className="right">Deficit</th>
                <th className="right">Quality</th>
                <th className="right">Downtime</th>
                <th>Remark</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No employees found</td></tr>
              )}
              {tableRows.map(row => {
                const isPinned = pinned.includes(row.emp_id);
                return (
                <tr key={row.emp_id} style={isPinned ? { borderLeft: '3px solid var(--accent)' } : undefined}>
                  <td className="bold">
                    <span
                      onClick={e => { e.stopPropagation(); togglePin(row.emp_id); }}
                      style={{ cursor: 'pointer', marginRight: 6, opacity: isPinned ? 1 : 0.3 }}
                      title={isPinned ? 'Unpin' : 'Pin for close monitoring'}
                    >
                      📌
                    </span>
                    <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => setEmpDetail(row)}>
                      {row.name ?? row.emp_id}
                    </span>
                  </td>
                  <td>{row.log?.process ?? row.access}</td>
                  <td className="center">
                    {row.access === 'AUTH' || row.access === 'ALL'
                      ? <span className="badge badge-blue">Y</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="center">
                    <StatusBadge prod={row.prod} bypassed={!!row.log?.bypass_reason} />
                  </td>
                  <td className="right">{row.log?.total ?? '—'}</td>
                  <td className="right">{row.adjT ?? '—'}</td>
                  <td className={`right bold ${pCol(row.prod)}`}>{row.prod != null ? row.prod + '%' : '—'}</td>
                  <td className={`right ${row.deficit != null && row.deficit > 0 ? 'col-red' : 'col-green'}`}>
                    {row.deficit != null ? (row.deficit > 0 ? `▼${row.deficit}` : `▲${Math.abs(row.deficit)}`) : '—'}
                  </td>
                  <td className={`right ${pCol(row.log?.quality)}`}>
                    {row.log?.quality != null ? row.log.quality + '%' : '—'}
                  </td>
                  <td className="right text-muted">
                    {row.log?.downtime != null ? row.log.downtime + 'h' : '—'}
                  </td>
                  <td className="text-sm text-muted" style={{ maxWidth: 140 }}>
                    {row.log?.bypass_reason
                      ? <span style={{ color: 'var(--accent)' }}>📋 {row.log.bypass_reason}</span>
                      : row.log?.remarks ?? '—'}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {!row.log?.bypass_reason && (
                        <button className="btn-sm" onClick={() => { setBypassTarget(row); setBypassReason(''); setBypassStatus(row.log?.attendance_status || 'absent'); setBypassLeaveType(row.log?.leave_type || 'planned'); }}>
                          {row.log ? 'Bypass' : '+ Note'}
                        </button>
                      )}
                      {row.log?.bypass_reason && (
                        <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeBypass(row)}>Remove</button>
                      )}
                      {row.log && (
                        <button className="btn-sm" onClick={() => { setQualityTarget(row); setQualityVal(row.log.quality ?? ''); }}>Quality</button>
                      )}
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bypass modal */}
      {bypassTarget && (
        <Modal title={`Bypass — ${bypassTarget.name ?? bypassTarget.emp_id}`} onClose={() => setBypassTarget(null)}>
          <p className="text-muted text-sm" style={{ marginBottom: 12 }}>Set attendance and/or bypass reason for {fmtD(date)}.</p>
          <div className="field">
            <label>Attendance Status</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {ATTENDANCE_STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setBypassStatus(s)}
                  className="btn-sm"
                  style={bypassStatus === s ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
                >
                  {STATUS_LABELS[s] ?? s}
                </button>
              ))}
            </div>
          </div>
          {LEAVE_STATUSES.includes(bypassStatus) && (
            <div className="field">
              <label>Leave Type</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {LEAVE_TYPES.map(lt => (
                  <button
                    key={lt.id}
                    type="button"
                    onClick={() => setBypassLeaveType(lt.id)}
                    className="btn-sm"
                    style={bypassLeaveType === lt.id ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
                  >
                    {lt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Reason</label>
            <textarea rows={3} value={bypassReason} onChange={e => setBypassReason(e.target.value)}
              placeholder="e.g. System downtime, Training, Employee on leave…" style={{ resize: 'vertical' }} />
          </div>
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setBypassTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={doBypass} disabled={bypassLoading || !bypassReason.trim()}>
              {bypassLoading ? 'Saving…' : 'Confirm Bypass'}
            </button>
          </div>
        </Modal>
      )}

      {/* Quality modal */}
      {qualityTarget && (
        <Modal title={`Quality — ${qualityTarget.name ?? qualityTarget.emp_id}`} onClose={() => setQualityTarget(null)}>
          <div className="field">
            <label>Quality % (0–100)</label>
            <input type="number" min="0" max="100" step="0.1" value={qualityVal}
              onChange={e => setQualityVal(e.target.value)} placeholder="e.g. 96.5" autoFocus />
          </div>
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setQualityTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={doQuality} disabled={qualityLoading || qualityVal === ''}>
              {qualityLoading ? 'Saving…' : 'Save Quality'}
            </button>
          </div>
        </Modal>
      )}

      {empDetail && (
        <EmpDetail emp={empDetail} onClose={() => setEmpDetail(null)} currentUser={user} />
      )}
    </div>
  );
}
