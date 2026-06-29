import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtD, pCol, avg, procIncludes, logMatchesProc, getPinned, togglePinned, scopeToSupervisor, permsFor, logAudit, effectiveTarget, isOnLeave, calcProd } from '../../lib/helpers';
import { ACCESSES, SHIFT_H, ATTENDANCE_STATUSES, LEAVE_STATUSES, HALF_DAY_STATUSES, LEAVE_TYPES, DEFAULT_TASKS, LEGACY_AUTH_CUTOFF } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';

const p = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

const STATUS_LABELS = { present: 'Present', half_day_1: 'First Half', half_day_2: 'Second Half', absent: 'Absent' };

function StatusBadge({ prod, bypassed, onLeave }) {
  if (onLeave) return <span className="badge badge-blue">On Leave</span>;
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
  const [qualityDate, setQualityDate]     = useState('');
  const [qualityLoading, setQualityLoading] = useState(false);

  const [qualityBypassTarget, setQualityBypassTarget] = useState(null);
  const [qualityBypassReason, setQualityBypassReason] = useState('');
  const [qualityBypassLoading, setQualityBypassLoading] = useState(false);

  const [countsTarget, setCountsTarget]   = useState(null);
  const [countsVals, setCountsVals]       = useState({});
  const [countsDowntime, setCountsDowntime] = useState('');
  const [countsAttendance, setCountsAttendance] = useState('present');
  const [countsLoading, setCountsLoading] = useState(false);
  const [taskCfgRows, setTaskCfgRows]     = useState([]);

  const isScopedRole = user.role === 'supervisor' || user.role === 'manager';
  const perms = isScopedRole ? permsFor(user) : null;
  const [customProcs, setCustomProcs] = useState([]);

  useEffect(() => { load(); }, [date]);
  useEffect(() => { getPinned().then(setPinned); }, []);
  useEffect(() => { S.get('task_configs').then(rows => setTaskCfgRows(rows ?? [])).catch(() => setTaskCfgRows([])); }, []);

  const canBypass    = !isScopedRole || perms?.bypassDeadline;
  const canQuality   = !isScopedRole || perms?.editQuality;
  const canPin       = !isScopedRole || perms?.pinEmployee;
  const canEditCounts = !isScopedRole || perms?.editCounts;

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

  // ── Edit Counts (admin override — writes directly to daily_logs, bypassing
  // the employee-side 24h TAT lock since that check lives only in ProdReport) ──
  function userProcsOf(row) {
    const procs = Array.isArray(row.processes) && row.processes.length > 0
      ? row.processes.filter(p => DEFAULT_TASKS[p])
      : [(row.process || row.access || 'MCO')].filter(p => DEFAULT_TASKS[p]);
    return procs.length > 0 ? procs : ['MCO'];
  }

  function taskDefsFor(procs) {
    const seen = new Set();
    return procs.flatMap(p =>
      (DEFAULT_TASKS[p] ?? []).map(t => {
        const custom = taskCfgRows?.find(r => r.process === p && r.name === t.name);
        return { name: t.name, target: custom?.target || t.target };
      })
    ).filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  }

  function openCounts(row) {
    const procs = userProcsOf(row);
    const taskDefs = taskDefsFor(procs);
    const existingTasks = row.log?.tasks || {};
    const vals = {};
    taskDefs.forEach(t => { vals[t.name] = existingTasks[t.name] != null ? String(existingTasks[t.name]) : ''; });
    setCountsVals(vals);
    setCountsDowntime(row.log?.downtime != null ? String(row.log.downtime) : '');
    setCountsAttendance(row.log?.attendance_status || 'present');
    setCountsTarget({ ...row, userProcs: procs });
  }

  async function doSaveCounts() {
    if (!countsTarget) return;
    setCountsLoading(true);

    const procs        = countsTarget.userProcs;
    const taskDefs      = taskDefsFor(procs);
    const counts        = Object.fromEntries(taskDefs.map(t => [t.name, parseFloat(countsVals[t.name]) || 0]));
    const overallTarget = effectiveTarget(countsTarget, date);
    const isOnlyAuth    = procs.length === 1 && procs[0] === 'AUTH';
    const isLegacyAuth  = isOnlyAuth && date < LEGACY_AUTH_CUTOFF;
    const downtimeHours = parseFloat(countsDowntime) || 0;

    const { total, adjTarget, baseTarget, shiftHours } =
      calcProd(taskDefs, counts, overallTarget, downtimeHours, { attendanceStatus: countsAttendance, isLegacyAuth });

    const payload = {
      emp_id:            countsTarget.emp_id,
      emp_name:          countsTarget.name ?? countsTarget.emp_id,
      date,
      process:           procs.join(','),
      total,
      target:            overallTarget,
      adj_target:        adjTarget,
      base_target:       baseTarget,
      shift_hours:       shiftHours,
      downtime:          downtimeHours || null,
      attendance_status: countsAttendance,
      legacy_auth_calc:  isLegacyAuth,
      tasks:             Object.fromEntries(taskDefs.map(t => [t.name, counts[t.name]])),
      submitted:         true,
      submitted_at:      countsTarget.log?.submitted_at ?? new Date().toISOString(),
    };

    if (countsTarget.log?.id) await S.update('daily_logs', payload, { id: countsTarget.log.id });
    else                      await S.set('daily_logs', payload, 'emp_id,date');

    logAudit({ actor: user, action: 'edit_counts', targetEmpId: countsTarget.emp_id, targetName: countsTarget.name, details: { date } });
    setCountsTarget(null);
    setCountsLoading(false);
    await load();
  }

  async function togglePin(empId) {
    const wasPinned = pinned.includes(empId);
    const next = await togglePinned(empId, pinned);
    setPinned(next);
    logAudit({ actor: user, action: wasPinned ? 'unpin' : 'pin', targetEmpId: empId });
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
    const baseTarget = effectiveTarget(bypassTarget, date);
    const statusFields = {
      attendance_status: bypassStatus,
      leave_type: isAbsentStatus ? bypassLeaveType : null,
      total: isAbsentStatus ? 0 : (bypassTarget.log?.total ?? 0),
      adj_target: isAbsentStatus ? 0 : (isHalfDayStatus ? baseTarget * 0.5 : baseTarget),
      base_target: isAbsentStatus ? 0 : (isHalfDayStatus ? baseTarget * 0.5 : baseTarget),
      // An admin bypass finalizes the day's record just like a real submission —
      // otherwise it sits forever as "Pending" on every monitoring sheet.
      submitted: true,
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
        submitted_at: new Date().toISOString(),
      }, 'emp_id,date');
    }
    logAudit({
      actor: user, action: 'bypass', targetEmpId: bypassTarget.emp_id, targetName: bypassTarget.name,
      details: { reason: bypassReason.trim(), status: bypassStatus },
    });
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
    logAudit({ actor: user, action: 'remove_bypass', targetEmpId: row.emp_id, targetName: row.name });
    await load();
  }

  async function doQualityBypass() {
    if (!qualityBypassTarget || !qualityBypassReason.trim()) return;
    setQualityBypassLoading(true);
    const log = qualityBypassTarget.log;
    if (!log?.id) { setQualityBypassLoading(false); return; }
    await S.update('daily_logs', { quality_bypass_reason: qualityBypassReason.trim(), quality: null }, { id: log.id });
    logAudit({ actor: user, action: 'quality_bypass', targetEmpId: qualityBypassTarget.emp_id, targetName: qualityBypassTarget.name, details: { reason: qualityBypassReason.trim(), date } });
    setQualityBypassTarget(null);
    setQualityBypassReason('');
    setQualityBypassLoading(false);
    await load();
  }

  async function removeQualityBypass(row) {
    if (!window.confirm('Remove quality bypass for this employee?')) return;
    await S.update('daily_logs', { quality_bypass_reason: null }, { id: row.log.id });
    logAudit({ actor: user, action: 'remove_quality_bypass', targetEmpId: row.emp_id, targetName: row.name, details: { date } });
    await load();
  }

  async function doQuality() {
    const q = parseFloat(qualityVal);
    if (!qualityTarget || isNaN(q) || q < 0 || q > 100) return;
    setQualityLoading(true);
    let logId = qualityTarget.log?.id;
    if (qualityDate && qualityDate !== date) {
      const pastLogs = await S.get('daily_logs', { emp_id: qualityTarget.emp_id, date: qualityDate });
      if (!pastLogs?.length) {
        window.alert(`No log found for ${qualityTarget.name ?? qualityTarget.emp_id} on ${qualityDate}.`);
        setQualityLoading(false);
        return;
      }
      logId = pastLogs[0].id;
    }
    if (!logId) { setQualityLoading(false); return; }
    await S.update('daily_logs', { quality: q }, { id: logId });
    logAudit({ actor: user, action: 'edit_quality', targetEmpId: qualityTarget.emp_id, targetName: qualityTarget.name, details: { value: q, date: qualityDate || date } });
    setQualityTarget(null);
    setQualityVal('');
    setQualityDate('');
    setQualityLoading(false);
    await load();
  }

  const tableRows = useMemo(() => {
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

    return employees.map(u => {
      const log        = filteredLogs.find(l => l.emp_id === u.emp_id) ?? null;
      const baseTarget = effectiveTarget(u, date);
      const adjT       = log?.downtime != null
        ? Math.round(baseTarget * ((SHIFT_H - log.downtime) / SHIFT_H))
        : baseTarget;
      const prod    = p(log?.total, adjT);
      const deficit = (!isOnLeave(log) && !log?.bypass_reason && adjT != null && log?.total != null)
        ? adjT - log.total
        : null;
      return { ...u, log, adjT, prod, deficit };
    }).sort((a, b) => (pinned.includes(b.emp_id) ? 1 : 0) - (pinned.includes(a.emp_id) ? 1 : 0));
  }, [allUsers, logs, user, customProcs, filterProc, statusFilter, pinnedOnly, pinned, date]);

  const avgProd    = avg(tableRows.map(r => r.prod).filter(v => v != null));
  const avgQuality = avg(tableRows.map(r => r.log?.quality).filter(v => v != null));

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
          <div className="stat-value">{tableRows.length}</div>
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
                    {canPin && (
                      <span
                        onClick={e => { e.stopPropagation(); togglePin(row.emp_id); }}
                        style={{ cursor: 'pointer', marginRight: 6, opacity: isPinned ? 1 : 0.3 }}
                        title={isPinned ? 'Unpin' : 'Pin for close monitoring'}
                      >
                        📌
                      </span>
                    )}
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
                    <StatusBadge prod={row.prod} bypassed={!!row.log?.bypass_reason} onLeave={isOnLeave(row.log)} />
                  </td>
                  <td className="right">{row.log?.total ?? '—'}</td>
                  <td className="right">{row.adjT ?? '—'}</td>
                  <td className={`right bold ${row.log?.bypass_reason || isOnLeave(row.log) ? '' : pCol(row.prod)}`}>{row.prod != null ? row.prod + '%' : '—'}</td>
                  <td className={`right ${row.deficit != null && row.deficit > 0 ? 'col-red' : 'col-green'}`}>
                    {row.deficit != null ? (row.deficit > 0 ? `▼${row.deficit}` : `▲${Math.abs(row.deficit)}`) : '—'}
                  </td>
                  <td className={`right ${pCol(row.log?.quality)}`}>
                    {row.log?.quality != null
                      ? row.log.quality + '%'
                      : (row.log && !isOnLeave(row.log) && !row.log?.quality_bypass_reason)
                        ? <span className="badge badge-gray" style={{ fontSize: 11 }}>Pending</span>
                        : '—'}
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
                      {canBypass && !row.log?.bypass_reason && (
                        <button className="btn-sm" onClick={() => { setBypassTarget(row); setBypassReason(''); setBypassStatus(row.log?.attendance_status || 'absent'); setBypassLeaveType(row.log?.leave_type || 'planned'); }}>
                          {row.log ? 'Bypass' : '+ Note'}
                        </button>
                      )}
                      {canBypass && row.log?.bypass_reason && (
                        <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeBypass(row)}>Remove</button>
                      )}
                      {canQuality && row.log && !isOnLeave(row.log) && (
                        row.log?.quality_bypass_reason
                          ? <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeQualityBypass(row)}>Remove Q Bypass</button>
                          : <>
                              <button className="btn-sm" onClick={() => { setQualityTarget(row); setQualityVal(row.log?.quality ?? ''); setQualityDate(date); }}>Quality</button>
                              <button className="btn-sm" style={{ opacity: 0.75 }} onClick={() => { setQualityBypassTarget(row); setQualityBypassReason(''); }}>Q Bypass</button>
                            </>
                      )}
                      {canEditCounts && (
                        <button className="btn-sm" onClick={() => openCounts(row)}>✏️ Counts</button>
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
              placeholder="e.g. System downtime, Training, Employee on leave…"
              style={{ resize: 'vertical', color: 'var(--text)', background: 'var(--surface)' }} />
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
          <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
            Quality data often arrives late — change the date below to post it against the correct working day.
          </p>
          <div className="field">
            <label>Working Day</label>
            <input type="date" value={qualityDate} onChange={e => setQualityDate(e.target.value)} />
          </div>
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

      {/* Quality Bypass modal */}
      {qualityBypassTarget && (
        <Modal title={`Quality Bypass — ${qualityBypassTarget.name ?? qualityBypassTarget.emp_id}`} onClose={() => setQualityBypassTarget(null)}>
          <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
            Mark this employee's quality as not applicable for {fmtD(date)}. They will show "—" instead of "Pending" in quality reports.
          </p>
          <div className="field">
            <label>Reason</label>
            <textarea rows={3} value={qualityBypassReason} onChange={e => setQualityBypassReason(e.target.value)}
              placeholder="e.g. New hire, training day, not subject to quality review…"
              style={{ resize: 'vertical', color: 'var(--text)', background: 'var(--surface)' }} />
          </div>
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setQualityBypassTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={doQualityBypass} disabled={qualityBypassLoading || !qualityBypassReason.trim()}>
              {qualityBypassLoading ? 'Saving…' : 'Confirm Quality Bypass'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Counts modal — admin override, ignores the 24h employee edit window */}
      {countsTarget && (
        <Modal title={`Edit Counts — ${countsTarget.name ?? countsTarget.emp_id}`} onClose={() => setCountsTarget(null)} wide>
          <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
            Directly sets {fmtD(date)}'s task counts for this employee, bypassing their 24-hour edit window. Use when a count was missed or entered wrong and the employee can no longer fix it themselves.
          </p>
          <div className="field">
            <label>Attendance Status</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {ATTENDANCE_STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setCountsAttendance(s)}
                  className="btn-sm"
                  style={countsAttendance === s ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
                >
                  {STATUS_LABELS[s] ?? s}
                </button>
              ))}
            </div>
          </div>
          {!LEAVE_STATUSES.includes(countsAttendance) && (
            <>
              <div className="grid-2" style={{ gap: 10 }}>
                {taskDefsFor(countsTarget.userProcs).map(t => (
                  <div className="field" key={t.name}>
                    <label>{t.name} <span className="text-muted">(target {t.target})</span></label>
                    <input
                      type="number" min="0" step="1"
                      value={countsVals[t.name] ?? ''}
                      onChange={e => setCountsVals(prev => ({ ...prev, [t.name]: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <div className="field">
                <label>Downtime (hours)</label>
                <input type="number" min="0" step="0.5" value={countsDowntime} onChange={e => setCountsDowntime(e.target.value)} placeholder="0" />
              </div>
            </>
          )}
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setCountsTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={doSaveCounts} disabled={countsLoading}>
              {countsLoading ? 'Saving…' : 'Save Counts'}
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
