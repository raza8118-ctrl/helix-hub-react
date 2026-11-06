import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtD, pCol, avg, procIncludes, logMatchesProc, getPinned, togglePinned, scopeToSupervisor, permsFor, logAudit, effectiveTarget, isOnLeave, calcProd, isScopedUser } from '../../lib/helpers';
import { ACCESSES, ATTENDANCE_STATUSES, LEAVE_STATUSES, HALF_DAY_STATUSES, LEAVE_TYPES, DEFAULT_TASKS, DEF_PROCS, LEGACY_AUTH_CUTOFF } from '../../lib/constants';
import Modal from '../../components/shared/Modal';
import EmpDetail from '../../components/shared/EmpDetail';
import { alertDialog, confirmDialog, promptDialog } from '../../components/shared/Dialog';
import { KpiCard } from '../../components/dash/DashParts';
import { Pill, Notice, Button } from '../../components/ui';

/** Frost Glass: productivity colour band (pCol) → status pill tone. */
const TONE_OF = { 'col-green': 'good', 'col-orange': 'warn', 'col-red': 'bad' };
const toneOf = pct => TONE_OF[pCol(pct)] ?? 'neutral';

const p = (total, adjT) => (!adjT || adjT === 0) ? null : Math.round((total / adjT) * 100);

const STATUS_LABELS = { present: 'Present', half_day_1: 'First Half', half_day_2: 'Second Half', absent: 'Absent' };

function StatusBadge({ prod, bypassed, onLeave }) {
  if (onLeave) return <Pill tone="accent">On Leave</Pill>;
  if (bypassed) return <Pill>Bypassed</Pill>;
  if (prod == null) return <Pill>No Data</Pill>;
  if (prod >= 100) return <Pill tone="good">On Track</Pill>;
  if (prod >= 75)  return <Pill tone="warn">At Risk</Pill>;
  return <Pill tone="bad">Below Target</Pill>;
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

  const isScopedRole = isScopedUser(user);
  const perms = isScopedRole ? permsFor(user) : null;
  const canMarkHoliday = user.role !== 'employee';   // granted employees are view-only here
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
    const procs = (Array.isArray(row.processes) && row.processes.length > 0
      ? row.processes
      : [row.process || row.access]
    ).filter(p => p && p !== 'ALL');
    return procs.length > 0 ? procs : DEF_PROCS.slice(0, 1);
  }

  // Built-in processes use DEFAULT_TASKS (task_configs may override targets);
  // custom processes take their tasks entirely from task_configs — same as ProdReport
  function taskDefsFor(procs) {
    const seen = new Set();
    return procs.flatMap(p =>
      DEFAULT_TASKS[p]
        ? DEFAULT_TASKS[p].map(t => {
            const custom = taskCfgRows?.find(r => r.process === p && r.name === t.name);
            return { name: t.name, target: custom?.target || t.target };
          })
        : (taskCfgRows ?? []).filter(r => r.process === p).map(t => ({ name: t.name, target: t.target }))
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
      const note = await promptDialog({ title: 'Mark as holiday', message: 'Give this holiday a label.', placeholder: 'e.g. Eid Holiday', confirmText: 'Mark Holiday' });
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
    if (!await confirmDialog({ title: 'Remove bypass?', message: `The bypass for ${row.name ?? row.emp_id} will be removed.`, tone: 'danger', confirmText: 'Remove' })) return;
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
    if (!await confirmDialog({ title: 'Remove quality bypass?', message: `The quality bypass for ${row.name ?? row.emp_id} will be removed.`, tone: 'danger', confirmText: 'Remove' })) return;
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
        await alertDialog({ title: 'No report found', message: `No log found for ${qualityTarget.name ?? qualityTarget.emp_id} on ${qualityDate}.`, tone: 'warning' });
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
      const adjT       = log?.adj_target ?? log?.target ?? baseTarget;
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
    <div className="fg-page">
      {/* Holiday banner */}
      {holiday && (
        <Notice tone="warn" icon="🏖">
          <strong>{holiday.note}</strong> — Holiday
        </Notice>
      )}

      {/* Filters + actions (the page title is in the top bar) */}
      <div className="fg-bar">
        <div className="fg-filters">
          <label className="fg-f"><span>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
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
          <span className="fg-date">
            {fmtD(date)}
            {avgProd != null && (
              <> · Team avg: <span className={pCol(avgProd)}>{avgProd.toFixed(1)}%</span></>
            )}
          </span>
        </div>
        <div className="fg-actions">
          <Button size="sm" variant={pinnedOnly ? 'primary' : 'secondary'} aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(v => !v)}>
            📌 Pinned only
          </Button>
          <Button size="sm" onClick={load}>↺ Refresh</Button>
          {canMarkHoliday && (
            <Button size="sm" className={holiday ? 'fg-holiday-on' : ''} aria-pressed={!!holiday} onClick={toggleHoliday}>
              {holiday ? 'Unmark Holiday' : '🏖 Holiday'}
            </Button>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="fg-kpis fg-kpis-4">
        <KpiCard label="Total employees" value={tableRows.length} />
        <KpiCard label="On track (≥100%)" value={tableRows.filter(r => (r.prod ?? 0) >= 100).length} valueClass="col-green" />
        <KpiCard label="Avg productivity" value={avgProd != null ? avgProd.toFixed(1) + '%' : '—'} valueClass={pCol(avgProd)} />
        <KpiCard label="Avg quality" value={avgQuality != null ? avgQuality.toFixed(1) + '%' : '—'} valueClass={pCol(avgQuality)} />
      </div>

      {/* Main table */}
      <div className="card fg-card fg-tracker">
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
                <tr><td colSpan={12} className="fg-empty">No employees found</td></tr>
              )}
              {tableRows.map(row => {
                const isPinned = pinned.includes(row.emp_id);
                return (
                <tr key={row.emp_id} className={isPinned ? 'fg-pinned' : undefined}>
                  <td className="bold">
                    {canPin && (
                      <span
                        onClick={e => { e.stopPropagation(); togglePin(row.emp_id); }}
                        className={`fg-pin can${isPinned ? ' on' : ''}`}
                        title={isPinned ? 'Unpin' : 'Pin for close monitoring'}
                      >
                        📌
                      </span>
                    )}
                    <span className="fg-name" onClick={() => setEmpDetail(row)}>
                      {row.name ?? row.emp_id}
                    </span>
                  </td>
                  <td>{row.log?.process ?? row.access}</td>
                  <td className="center">
                    {row.access === 'AUTH' || row.access === 'ALL'
                      ? <Pill tone="accent">Y</Pill>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="center">
                    <StatusBadge prod={row.prod} bypassed={!!row.log?.bypass_reason} onLeave={isOnLeave(row.log)} />
                  </td>
                  <td className="right">{row.log?.total ?? '—'}</td>
                  <td className="right">{row.adjT ?? '—'}</td>
                  <td className="right">{row.prod != null ? <Pill tone={row.log?.bypass_reason || isOnLeave(row.log) ? 'neutral' : toneOf(row.prod)}>{row.prod}%</Pill> : '—'}</td>
                  <td className={`right ${row.deficit != null && row.deficit > 0 ? 'col-red' : 'col-green'}`}>
                    {row.deficit != null ? (row.deficit > 0 ? `▼${row.deficit}` : `▲${Math.abs(row.deficit)}`) : '—'}
                  </td>
                  <td className={`right ${pCol(row.log?.quality)}`}>
                    {row.log?.quality != null
                      ? row.log.quality + '%'
                      : (row.log && !isOnLeave(row.log) && !row.log?.quality_bypass_reason)
                        ? <Pill>Pending</Pill>
                        : '—'}
                  </td>
                  <td className="right text-muted">
                    {row.log?.downtime != null ? row.log.downtime + 'h' : '—'}
                  </td>
                  <td className="text-sm text-muted fg-reason">
                    {row.log?.bypass_reason
                      ? <span className="fg-bypass">📋 {row.log.bypass_reason}</span>
                      : row.log?.remarks ?? '—'}
                  </td>
                  <td>
                    <div className="fg-row-actions">
                      {canBypass && !row.log?.bypass_reason && (
                        <Button size="xs" onClick={() => { setBypassTarget(row); setBypassReason(''); setBypassStatus(row.log?.attendance_status || 'absent'); setBypassLeaveType(row.log?.leave_type || 'planned'); }}>
                          {row.log ? 'Bypass' : '+ Note'}
                        </Button>
                      )}
                      {canBypass && row.log?.bypass_reason && (
                        <Button size="xs" variant="danger" onClick={() => removeBypass(row)}>Remove</Button>
                      )}
                      {canQuality && row.log && !isOnLeave(row.log) && (
                        row.log?.quality_bypass_reason
                          ? <Button size="xs" variant="danger" onClick={() => removeQualityBypass(row)}>Remove Q Bypass</Button>
                          : <>
                              <Button size="xs" onClick={() => { setQualityTarget(row); setQualityVal(row.log?.quality ?? ''); setQualityDate(date); }}>Quality</Button>
                              <Button size="xs" variant="ghost" onClick={() => { setQualityBypassTarget(row); setQualityBypassReason(''); }}>Q Bypass</Button>
                            </>
                      )}
                      {canEditCounts && (
                        <Button size="xs" onClick={() => openCounts(row)}>✏️ Counts</Button>
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
            <div className="fg-choices">
              {ATTENDANCE_STATUSES.map(s => (
                <Button key={s} size="sm" active={bypassStatus === s} aria-pressed={bypassStatus === s} onClick={() => setBypassStatus(s)}>
                  {STATUS_LABELS[s] ?? s}
                </Button>
              ))}
            </div>
          </div>
          {LEAVE_STATUSES.includes(bypassStatus) && (
            <div className="field">
              <label>Leave Type</label>
              <div className="fg-choices">
                {LEAVE_TYPES.map(lt => (
                  <Button key={lt.id} size="sm" active={bypassLeaveType === lt.id} aria-pressed={bypassLeaveType === lt.id} onClick={() => setBypassLeaveType(lt.id)}>
                    {lt.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Reason</label>
            <textarea rows={3} value={bypassReason} onChange={e => setBypassReason(e.target.value)}
              placeholder="e.g. System downtime, Training, Employee on leave…"
              className="fg-textarea" />
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
              className="fg-textarea" />
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
            <div className="fg-choices">
              {ATTENDANCE_STATUSES.map(s => (
                <Button key={s} size="sm" active={countsAttendance === s} aria-pressed={countsAttendance === s} onClick={() => setCountsAttendance(s)}>
                  {STATUS_LABELS[s] ?? s}
                </Button>
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
