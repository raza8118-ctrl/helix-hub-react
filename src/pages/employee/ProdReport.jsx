import { useState, useEffect, useRef } from 'react';
import { S, kv } from '../../lib/supabase';
import { today, yesterday, fmtD, dlCSV, effectiveTarget, getHourlySlots } from '../../lib/helpers';
import {
  DEFAULT_TASKS, AUTH_HOURLY_TASKS, HOURLY_SLOTS, SHIFT_H,
  LEGACY_AUTH_CUTOFF, LEAVE_STATUSES, HALF_DAY_STATUSES, ATTENDANCE_STATUSES, LEAVE_TYPES,
} from '../../lib/constants';

// ── Four-path calcProd (matches spec §4) ────────────────────────────────────
// Weight is NEVER stored — always derived as 50/t.target (float, un-rounded).
function calcProd(taskDefs, counts, overallTarget, downtimeHours, attendanceStatus, isLegacyAuth) {
  // PATH A — Leave
  if (LEAVE_STATUSES.includes(attendanceStatus)) {
    return { total: 0, adjTarget: 0, prodPct: null, deficit: 0, deficitPct: null, isLeave: true, shiftHours: 0, baseTarget: 0 };
  }

  // Weighted total (same for B, C, D)
  let total = 0;
  for (const t of taskDefs) {
    total += (parseFloat(counts[t.name]) || 0) * (50 / t.target);
  }
  total = +total.toFixed(2);

  // PATH B — Legacy Auth (frozen; date < LEGACY_AUTH_CUTOFF)
  if (isLegacyAuth) {
    const prodPct = total > 0 ? +Math.min((total / 50) * 100, 999).toFixed(1) : 0;
    return { total, adjTarget: 50, prodPct, deficit: 0, deficitPct: 0, isLeave: false, shiftHours: SHIFT_H, baseTarget: 50 };
  }

  // PATH D — half-day feeds PATH C with adjusted inputs
  const isHalfDay = HALF_DAY_STATUSES.includes(attendanceStatus);
  const shiftHours = isHalfDay ? 4.5 : SHIFT_H;
  const baseTarget = isHalfDay ? overallTarget * 0.5 : overallTarget;

  // PATH C — Standard
  const eff       = Math.max(0, (shiftHours - (parseFloat(downtimeHours) || 0)) / shiftHours);
  const adjTarget = +(baseTarget * eff).toFixed(2);
  const prodPct   = adjTarget > 0 ? +((total / adjTarget) * 100).toFixed(1) : 0;

  // Half-day: prod% is measured against the halved target, but the deficit
  // shown is measured against the FULL day's target (flat, no downtime adjustment).
  const deficitBase = isHalfDay ? overallTarget : adjTarget;
  const deficit      = +(Math.max(0, deficitBase - total)).toFixed(2);
  const deficitPct   = deficitBase > 0 ? +(100 - (total / deficitBase) * 100).toFixed(1) : null;
  return { total, adjTarget, prodPct, deficit, deficitPct, isLeave: false, shiftHours, baseTarget };
}

function pColor(pct) {
  const n = parseFloat(pct);
  if (isNaN(n) || pct == null) return 'var(--col-neutral)';
  if (n >= 100) return 'var(--col-green)';
  if (n >= 75)  return 'var(--col-orange)';
  return 'var(--col-red)';
}

const ATTEND_LABELS = {
  present:    'Present',
  half_day_1: 'First Half',
  half_day_2: 'Second Half',
  absent:     'Absent',
};

export default function ProdReport({ user }) {
  // ── Resolve processes (multi-process support) ────────────────────────────
  const userProcs = (() => {
    const procs = Array.isArray(user.processes) && user.processes.length > 0
      ? user.processes.filter(p => p && p !== 'ALL')
      : [(user.process || user.access || 'MCO')].filter(p => p && p !== 'ALL');
    return procs.length > 0 ? procs : ['MCO'];
  })();
  const proc       = userProcs[0];
  const isOnlyAuth = userProcs.length === 1 && proc === 'AUTH';

  // ── State ────────────────────────────────────────────────────────────────
  const [taskCfgRows, setTaskCfgRows]       = useState(null);
  const [hourlySlots, setHourlySlots]       = useState(HOURLY_SLOTS);
  const [attendanceStatus, setAttendanceStatus] = useState('present');
  const [leaveType, setLeaveType]           = useState('planned');
  const [date, setDate]                     = useState(today());
  const [holiday, setHoliday]               = useState(null);
  const [loading, setLoading]               = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [savingHourly, setSavingHourly]     = useState(false);
  const [saved, setSaved]                   = useState(false);
  const [saveError, setSaveError]           = useState('');
  const [submittedAt, setSubmittedAt]       = useState(null);
  const [hourlyMsg, setHourlyMsg]           = useState('');
  const [autoSave, setAutoSave]             = useState(false);
  const autoSaveTimer = useRef(null);
  const [downtime, setDowntime]             = useState('');
  const [remarks, setRemarks]               = useState('');
  const [quality, setQuality]               = useState(isOnlyAuth ? '100' : '');
  const [qualityNA, setQualityNA]           = useState(false);
  const [qualityDate, setQualityDate]       = useState(yesterday());
  const [actionPlan, setActionPlan]         = useState('');
  const [calls, setCalls]                   = useState('');
  const [callHours, setCallHours]           = useState('');
  const [callType, setCallType]             = useState('Insurance Call');
  const [callNotes, setCallNotes]           = useState('');

  // ── Derived flags ────────────────────────────────────────────────────────
  const overallTarget = effectiveTarget(user, date);
  const isLegacyAuth = isOnlyAuth && date < LEGACY_AUTH_CUTOFF;
  const isLeave      = LEAVE_STATUSES.includes(attendanceStatus);
  const isHalfDay    = HALF_DAY_STATUSES.includes(attendanceStatus);
  const maxDowntime  = isHalfDay ? 4.5 : SHIFT_H;

  // ── Load task configs from DB once ───────────────────────────────────────
  useEffect(() => {
    S.get('task_configs').then(rows => setTaskCfgRows(rows ?? [])).catch(() => setTaskCfgRows([]));
  }, []);

  // ── Load hourly slot labels (admin-toggled for US Daylight Saving Time) ──
  useEffect(() => {
    getHourlySlots().then(setHourlySlots).catch(() => {});
  }, []);

  // ── Load auto-save preference once, and clear any pending debounce on unmount ──
  useEffect(() => {
    kv.get(`prefs_${user.emp_id}`).then(p => setAutoSave(!!p?.autoSaveHourly)).catch(() => {});
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  async function toggleAutoSave(checked) {
    setAutoSave(checked);
    const existing = await kv.get(`prefs_${user.emp_id}`).catch(() => null);
    await kv.set(`prefs_${user.emp_id}`, { ...(existing ?? {}), autoSaveHourly: checked });
  }

  // ── Build deduped task list from all user processes ──────────────────────
  const taskDefs = (() => {
    const seen = new Set();
    return userProcs.flatMap(p => {
      if (DEFAULT_TASKS[p]) {
        // Built-in process — use DEFAULT_TASKS, allow task_configs to override target
        return DEFAULT_TASKS[p].map(t => {
          const saved = taskCfgRows?.find(r => r.process === p && r.name === t.name);
          return { name: t.name, target: saved?.target || t.target, process: p };
        });
      }
      // Custom process — load tasks entirely from task_configs DB rows
      return (taskCfgRows ?? [])
        .filter(r => r.process === p)
        .map(t => ({ name: t.name, target: t.target, process: p }));
    }).filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  })();

  const slotTaskOptions = isOnlyAuth ? AUTH_HOURLY_TASKS : taskDefs.map(t => t.name);

  // ── Slot + task-count state ──────────────────────────────────────────────
  const [slots, setSlots] = useState(
    hourlySlots.map(slot => ({ slot, task: slotTaskOptions[0] || '', count: '' }))
  );
  const [taskCounts, setTaskCounts] = useState(
    Object.fromEntries(taskDefs.map(t => [t.name, '']))
  );

  // 24-hour edit window
  const isEditable = date === today() ||
    !submittedAt ||
    (Date.now() - new Date(submittedAt).getTime()) < 24 * 60 * 60 * 1000;

  useEffect(() => { load(); }, [date, hourlySlots]);

  async function load() {
    setLoading(true); setSaved(false); setSaveError('');
    const [logs, hols, hRows] = await Promise.all([
      S.get('daily_logs', { emp_id: user.emp_id, date }),
      S.get('holidays', { date }),
      S.get('hourly_logs', { emp_id: user.emp_id, date }),
    ]);
    const ex = logs?.[0] ?? null;
    const hr = hRows?.[0] ?? null;
    setHoliday(hols?.[0] ?? null);
    setSubmittedAt(ex?.submitted_at ?? null);

    if (ex) {
      setAttendanceStatus(ex.attendance_status ?? 'present');
      setLeaveType(ex.leave_type ?? 'planned');
      setDowntime(ex.downtime != null ? String(ex.downtime) : '');
      setRemarks(ex.remarks ?? '');
      setCalls(ex.calls != null ? String(ex.calls) : '');
      setCallHours(ex.call_hours != null ? String(ex.call_hours) : '');
      setCallType(ex.insurance_call || 'Insurance Call');
      setCallNotes(ex.call_notes ?? '');
      setQualityNA(ex.quality == null);
      setQuality(ex.quality != null ? String(ex.quality) : isOnlyAuth ? '100' : '');
      setQualityDate(ex.tasks?._quality_date || yesterday());
      setActionPlan(ex.bypass_reason ?? '');

      const savedTasks = ex.tasks ?? {};
      const counts = {};
      taskDefs.forEach(t => { counts[t.name] = savedTasks[t.name] != null ? String(savedTasks[t.name]) : ''; });
      setTaskCounts(counts);

      const slotTasksMap = savedTasks._slot_tasks ?? {};
      setSlots(hourlySlots.map((slot, i) => ({
        slot,
        task: slotTasksMap[i] || slotTaskOptions[0] || '',
        count: hr ? (hr[`h${i}`] != null ? String(hr[`h${i}`]) : '') : '',
      })));
    } else {
      setAttendanceStatus('present');
      setLeaveType('planned');
      const newSlots = hourlySlots.map((slot, i) => ({
        slot,
        task: slotTaskOptions[0] || '',
        count: hr ? (hr[`h${i}`] != null ? String(hr[`h${i}`]) : '') : '',
      }));
      setSlots(newSlots);

      if (hr) {
        const sums = {};
        newSlots.forEach(sl => {
          const c = parseInt(sl.count) || 0;
          if (sl.task && c > 0) sums[sl.task] = (sums[sl.task] || 0) + c;
        });
        setTaskCounts(Object.fromEntries(taskDefs.map(t => [t.name, sums[t.name] ? String(sums[t.name]) : ''])));
      } else {
        setTaskCounts(Object.fromEntries(taskDefs.map(t => [t.name, ''])));
      }

      setDowntime(''); setRemarks('');
      setQuality(isOnlyAuth ? '100' : ''); setQualityNA(false);
      setQualityDate(yesterday()); setActionPlan('');
      setCalls(''); setCallHours(''); setCallType('Insurance Call'); setCallNotes('');
    }
    setLoading(false);
  }

  function syncHourlyToTasks(updatedSlots) {
    const sums = {};
    updatedSlots.forEach(sl => {
      const c = parseInt(sl.count) || 0;
      if (sl.task && c > 0) sums[sl.task] = (sums[sl.task] || 0) + c;
    });
    setTaskCounts(prev => {
      const next = { ...prev };
      taskDefs.forEach(t => { if (sums[t.name] !== undefined) next[t.name] = String(sums[t.name]); });
      return next;
    });
  }

  function updateSlot(i, field, value) {
    setSlots(prev => {
      const next = prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s);
      syncHourlyToTasks(next);
      return next;
    });
    if (autoSave && isEditable) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => saveHourly(true), 1500);
    }
  }

  // ── Live calculations ────────────────────────────────────────────────────
  const counts = Object.fromEntries(taskDefs.map(t => [t.name, parseFloat(taskCounts[t.name]) || 0]));
  const dt     = parseFloat(downtime) || 0;
  const { total, adjTarget, prodPct, deficit, deficitPct, isLeave: calcLeave, shiftHours, baseTarget } =
    calcProd(taskDefs, counts, overallTarget, dt, attendanceStatus, isLegacyAuth);

  const slotGrandTotal = slots.reduce((s, sl) => s + (parseInt(sl.count) || 0), 0);
  // For legacy auth path, display the raw hourly total; otherwise use the weighted total
  const displayTotal = isLegacyAuth ? slotGrandTotal : total;

  const slotDeltas = slots.map((sl, i) => {
    if (i === 0) return null;
    const curr = parseInt(sl.count) || 0;
    const prev = parseInt(slots[i - 1].count) || 0;
    if (!curr && !prev) return null;
    return curr - prev;
  });

  const slotSummary = slotTaskOptions.map(task => ({
    task,
    count: slots.filter(s => s.task === task).reduce((s, sl) => s + (parseInt(sl.count) || 0), 0),
  })).filter(t => t.count > 0);

  const authSummary = AUTH_HOURLY_TASKS.map(task => ({
    task,
    count: slots.filter(s => s.task === task).reduce((s, sl) => s + (parseInt(sl.count) || 0), 0),
  }));

  // ── Save hourly only ─────────────────────────────────────────────────────
  async function saveHourly(isAutoSave = false) {
    if (!isAutoSave) setSavingHourly(true);
    setHourlyMsg(isAutoSave ? 'Auto-saving…' : '');
    const hPayload = { emp_id: user.emp_id, date };
    slots.forEach((sl, i) => { hPayload[`h${i}`] = parseInt(sl.count) || 0; });
    const exHr = (await S.get('hourly_logs', { emp_id: user.emp_id, date }))?.[0];
    if (exHr?.id) await S.update('hourly_logs', hPayload, { id: exHr.id });
    else await S.set('hourly_logs', hPayload);
    setHourlyMsg(isAutoSave ? `✓ Auto-saved · Total: ${slotGrandTotal} counts` : `✓ Saved! Total: ${slotGrandTotal} counts`);
    if (!isAutoSave) setSavingHourly(false);
    setTimeout(() => setHourlyMsg(''), 3000);
  }

  // ── Save full report ─────────────────────────────────────────────────────
  async function save() {
    setSaving(true); setSaveError(''); setSaved(false);

    let payload;
    if (isLeave) {
      // PATH A — Absent: minimal record, just marks the day + leave type. No hourly/task data.
      payload = {
        emp_id:            user.emp_id,
        emp_name:          user.name ?? user.emp_id,
        date,
        process:           userProcs.join(','),
        total:             0,
        target:            overallTarget,
        adj_target:        0,
        base_target:       0,
        shift_hours:       0,
        downtime:          null,
        attendance_status: attendanceStatus,
        leave_type:        leaveType,
        legacy_auth_calc:  false,
        quality:           null,
        tasks:             {},
        remarks:           remarks.trim() || null,
        bypass_reason:     actionPlan.trim() || null,
        calls:             null,
        call_hours:        null,
        insurance_call:    null,
        call_notes:        null,
        submitted:         true,
        submitted_at:      new Date().toISOString(),
      };
    } else {
      await saveHourly();

      const slotTasksMap = {};
      slots.forEach((sl, i) => { slotTasksMap[i] = sl.task; });

      const taskPayload = isOnlyAuth
        ? { ...Object.fromEntries(authSummary.map(t => [t.task, t.count])), _slot_tasks: slotTasksMap, _quality_date: qualityDate }
        : { ...Object.fromEntries(taskDefs.map(t => [t.name, parseFloat(taskCounts[t.name]) || 0])), _slot_tasks: slotTasksMap, _quality_date: qualityDate };

      payload = {
        emp_id:           user.emp_id,
        emp_name:         user.name ?? user.emp_id,
        date,
        process:          userProcs.join(','),
        total:            isLegacyAuth ? slotGrandTotal : total,
        target:           overallTarget,
        adj_target:       adjTarget,
        base_target:      baseTarget,
        shift_hours:      shiftHours,
        downtime:         isLegacyAuth ? null : (dt || null),
        attendance_status: attendanceStatus,
        leave_type:       null,
        legacy_auth_calc: isLegacyAuth,
        quality:          qualityNA ? null : (parseFloat(quality) || null),
        tasks:            taskPayload,
        remarks:          remarks.trim() || null,
        bypass_reason:    actionPlan.trim() || null,
        calls:            parseInt(calls) || null,
        call_hours:       parseFloat(callHours) || null,
        insurance_call:   callType || null,
        call_notes:       callNotes.trim() || null,
        submitted:        true,
        submitted_at:     new Date().toISOString(),
      };
    }

    const existing = (await S.get('daily_logs', { emp_id: user.emp_id, date }))?.[0];
    let ok;
    if (existing?.id) ok = await S.update('daily_logs', payload, { id: existing.id });
    else              ok = await S.set('daily_logs', payload);

    if (ok) {
      setSaved(true); setSaveError('');
      setSubmittedAt(new Date().toISOString());
    } else {
      setSaveError('❌ Save failed — open browser console (F12) and check for errors, then try again.');
    }
    setSaving(false);
  }

  function exportReport() {
    const headers = ['Date', 'Process', 'Attendance', 'Total', 'Adj Target', 'Prod%', 'Deficit', 'Downtime', 'Quality', 'Remarks'];
    const rows = [{ Date: date, Process: userProcs.join(','), Attendance: attendanceStatus, Total: displayTotal, 'Adj Target': adjTarget, 'Prod%': prodPct != null ? prodPct + '%' : 'N/A', Deficit: deficit, Downtime: dt || 0, Quality: qualityNA ? 'N/A' : (quality || '—'), Remarks: remarks }];
    dlCSV(headers, rows, `report-${user.emp_id}-${date}.csv`);
  }

  const headerBg = { background: 'linear-gradient(135deg, #0a1628 0%, #1e3a5f 100%)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: 20, border: '1px solid rgba(255,255,255,0.1)' };

  return (
    <div>
      {/* Header controls */}
      <div className="page-header">
        <div>
          <div className="page-title">Daily Productivity Report</div>
          <div className="page-subtitle">
            {user.name ?? user.emp_id} · {userProcs.join(' + ')}
            {!isLegacyAuth && !isLeave ? ` · Target: ${overallTarget}${isHalfDay ? ` (half-day: ${overallTarget * 0.5})` : ''} · Shift: ${maxDowntime}h` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <button className="btn-sm" onClick={exportReport}>Export CSV</button>
          <button className="btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : saved ? '✓ Report Saved' : isLeave ? 'Mark Absent' : 'Save Report'}
          </button>
        </div>
      </div>

      {/* Attendance Status selector */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>
          Attendance Status — {fmtD(date)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ATTENDANCE_STATUSES.map(s => {
            const isLeaveOpt = LEAVE_STATUSES.includes(s);
            const isSelected = attendanceStatus === s;
            return (
              <button
                key={s}
                onClick={() => isEditable && setAttendanceStatus(s)}
                disabled={!isEditable}
                style={{
                  padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${isSelected ? (isLeaveOpt ? '#ef4444' : s === 'present' ? '#10b981' : '#f59e0b') : 'var(--border)'}`,
                  background: isSelected ? (isLeaveOpt ? 'rgba(239,68,68,0.12)' : s === 'present' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)') : 'var(--surface)',
                  color: isSelected ? (isLeaveOpt ? '#ef4444' : s === 'present' ? '#10b981' : '#d97706') : 'var(--text-muted)',
                  cursor: isEditable ? 'pointer' : 'not-allowed',
                  opacity: !isEditable ? 0.6 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {ATTEND_LABELS[s] ?? s}
              </button>
            );
          })}
        </div>
        {isLeave && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, marginBottom: 10 }}>
              🚫 Absent — no productivity entry required. Pick a leave type, then Save to record this day.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {LEAVE_TYPES.map(lt => (
                <button
                  key={lt.id}
                  onClick={() => isEditable && setLeaveType(lt.id)}
                  disabled={!isEditable}
                  style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: `1.5px solid ${leaveType === lt.id ? '#ef4444' : 'var(--border)'}`,
                    background: leaveType === lt.id ? 'rgba(239,68,68,0.12)' : 'var(--surface)',
                    color: leaveType === lt.id ? '#ef4444' : 'var(--text-muted)',
                    cursor: isEditable ? 'pointer' : 'not-allowed',
                  }}
                >
                  {lt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {isHalfDay && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, fontSize: 13, color: '#d97706' }}>
            ⏱ Half-day: target halved to <strong>{overallTarget * 0.5}</strong>, shift capped at <strong>4.5 hours</strong>, downtime max 4.5h.
          </div>
        )}
      </div>

      {/* Holiday banner */}
      {holiday && (
        <div style={{ background: 'linear-gradient(135deg,#faf5ff,#f5f3ff)', border: '1.5px solid #c4b5fd', borderRadius: 8, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>
          🏖️ <strong>{fmtD(date)} is a Holiday</strong> — No productivity counted for this day.
        </div>
      )}

      {/* Auth banner (legacy path only) */}
      {isLegacyAuth && (
        <div style={{ background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', border: '1.5px solid #a78bfa', borderRadius: 8, padding: '12px 18px', marginBottom: 16, fontSize: 13, color: '#5b21b6' }}>
          <strong>🔐 PMB Auth — Legacy Formula</strong> (dates before 16 Jun 2026): Quality 100% by default. Prod% = total ÷ 50 × 100. No downtime adjustment.
        </div>
      )}
      {isOnlyAuth && !isLegacyAuth && (
        <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', border: '1.5px solid #86efac', borderRadius: 8, padding: '12px 18px', marginBottom: 16, fontSize: 13, color: '#15803d' }}>
          <strong>🔐 PMB Auth Process</strong> — Standard formula applies from 16 Jun 2026. Quality 100% by default. Downtime field active.
        </div>
      )}

      {/* Submission / edit-window banner */}
      {submittedAt && isEditable && (
        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ fontSize: 16 }}>✅</span>
          <span style={{ color: '#10b981', fontWeight: 600 }}>Submitted at {new Date(submittedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          <span style={{ color: 'var(--text-muted)' }}>— You can edit and re-save within 24 hours of submission.</span>
        </div>
      )}
      {submittedAt && !isEditable && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ color: '#ef4444', fontWeight: 600 }}>Editing period expired</span>
          <span style={{ color: 'var(--text-muted)' }}>— Report submitted {new Date(submittedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}. Contact admin to make changes.</span>
        </div>
      )}

      {/* Deficit alert — not shown for leave or legacy auth */}
      {!isLeave && !isLegacyAuth && prodPct != null && prodPct < 100 && total > 0 && (
        <div style={{ background: 'linear-gradient(135deg,#fff1f2,#fef2f2)', border: '1.5px solid #fca5a5', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: '#991b1b', fontSize: 15 }}>Productivity Deficit Alert</div>
              <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 4 }}>
                You are <strong>{deficit.toFixed(1)} units short</strong> — {deficitPct.toFixed(1)}% below target.
              </div>
            </div>
            <div style={{ textAlign: 'center', background: 'white', borderRadius: 8, padding: '12px 18px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: pColor(prodPct) }}>{prodPct.toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Current</div>
            </div>
          </div>
        </div>
      )}

      {/* Dark KPI header */}
      {!isLeave && (
        <div style={headerBg}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '2.5px', textTransform: 'uppercase', marginBottom: 6 }}>Daily Productivity Report</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'white' }}>{user.name ?? user.emp_id}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                {user.emp_id} · {userProcs.join(' + ')}
                {!isLegacyAuth && ` · Target: ${overallTarget}${isHalfDay ? ` → ${overallTarget * 0.5}` : ''} · ${maxDowntime}h shift`}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { l: 'TOTAL',       v: String(displayTotal),                                        c: pColor(prodPct) },
              { l: 'ADJ. TARGET', v: isLegacyAuth ? '50 (fixed)' : adjTarget.toFixed(1),         c: 'rgba(255,255,255,0.9)' },
              { l: 'PROD %',      v: prodPct != null ? prodPct.toFixed(1) + '%' : '—',            c: pColor(prodPct) },
              { l: isLegacyAuth ? 'STATUS' : 'DEFICIT',
                v: isLegacyAuth ? 'Legacy Auth' : deficit > 0 ? '-' + deficit.toFixed(1) : '✅ Met',
                c: isLegacyAuth ? '#6ee7b7' : deficit > 0 ? '#fca5a5' : '#6ee7b7' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 5 }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v}</div>
              </div>
            ))}
          </div>
          {!isLegacyAuth && dt > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              Formula: {isHalfDay ? overallTarget * 0.5 : overallTarget} × ({maxDowntime} − {dt}) ÷ {maxDowntime} = <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{adjTarget.toFixed(1)}</strong>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-row"><div className="spinner" /> Loading…</div>
      ) : isLeave ? null : (
        <>
          {/* ── Hourly Tracker ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">⏰ Hourly Tracker — {fmtD(date)}</div>
              <span className="text-sm text-muted">Shift: <strong>6:30 PM → 2:30 AM</strong> · Select {isOnlyAuth ? 'request type' : 'task'} and enter count at each hour end</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
              {slots.map((sl, i) => {
                const night = true;
                const delta = slotDeltas[i];
                return (
                  <div key={i} style={{
                    background: night ? 'rgba(124,58,237,0.07)' : 'var(--surface)',
                    border: `1.5px solid ${night ? '#c4b5fd' : 'var(--border)'}`,
                    borderRadius: 8, padding: 10, textAlign: 'center', transition: 'border-color 0.2s',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: night ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 }}>
                      {sl.slot}
                    </div>
                    <select value={sl.task} onChange={e => updateSlot(i, 'task', e.target.value)}
                      style={{ border: `1px solid ${night ? '#c4b5fd' : 'var(--border)'}`, borderRadius: 4, padding: '4px 5px', width: '100%', fontSize: 10, marginBottom: 5, background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}>
                      <option value="">Select…</option>
                      {slotTaskOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input type="number" min="0" value={sl.count} onChange={e => updateSlot(i, 'count', e.target.value)}
                      style={{ border: `1px solid ${night ? '#c4b5fd' : 'var(--border)'}`, borderRadius: 4, padding: 6, width: '100%', fontSize: 15, fontWeight: 800, textAlign: 'center', color: night ? '#7c3aed' : 'var(--text)', background: 'var(--surface)', outline: 'none' }} />
                    <div style={{ fontSize: 10, marginTop: 4, color: delta === null ? 'var(--text-muted)' : delta >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                      {delta === null ? '—' : (delta >= 0 ? '+' : '') + delta}
                    </div>
                  </div>
                );
              })}
            </div>

            {slots.some(s => s.count) && (
              <div style={{ background: 'var(--accent-dim)', borderRadius: 6, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: 'var(--accent)' }}>{slotGrandTotal}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total hourly count · {slots.filter(s => s.count).length} hours filled</span>
              </div>
            )}

            {slotSummary.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Breakdown — {userProcs.join(' + ')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 8 }}>
                  {slotSummary.map(t => (
                    <div key={t.task} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{t.task}</span>
                      <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 15 }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={() => saveHourly()} disabled={savingHourly || !isEditable}
                style={{ padding: '9px 22px', fontSize: 13, opacity: !isEditable ? 0.5 : 1 }}>
                {savingHourly ? 'Saving…' : !isEditable ? '🔒 Locked' : '💾 Save Hourly Data'}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: isEditable ? 'pointer' : 'not-allowed' }}>
                <input type="checkbox" checked={autoSave} disabled={!isEditable}
                  onChange={e => toggleAutoSave(e.target.checked)} />
                Auto-save while entering counts
              </label>
              {hourlyMsg && <span style={{ fontSize: 13, fontWeight: 600, color: '#10b981' }}>{hourlyMsg}</span>}
            </div>
          </div>

          {/* ── Downtime + Task Entry ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            {!isLegacyAuth ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', marginBottom: 20, padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.2px', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    ⏱ Downtime (hours, max {maxDowntime})
                  </label>
                  <input type="number" min="0" max={maxDowntime} step="0.5" value={downtime}
                    onChange={e => setDowntime(e.target.value)}
                    style={{ border: '2px solid var(--accent)', borderRadius: 6, padding: '8px 12px', width: 110, fontSize: 17, fontWeight: 800, color: 'var(--accent)', background: 'var(--surface)', outline: 'none' }} />
                </div>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  <strong>Formula:</strong> Adj. Target = {isHalfDay ? overallTarget * 0.5 : overallTarget} × ({maxDowntime} − downtime) ÷ {maxDowntime}<br />
                  <strong>Current:</strong> {isHalfDay ? overallTarget * 0.5 : overallTarget} × ({maxDowntime} − {dt}) ÷ {maxDowntime} = <strong style={{ color: 'var(--text)' }}>{adjTarget.toFixed(1)}</strong>
                </div>
                <div style={{ textAlign: 'center', background: 'var(--surface)', borderRadius: 8, padding: '12px 18px', boxShadow: 'var(--shadow)' }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: pColor(prodPct) }}>{prodPct != null ? prodPct.toFixed(1) + '%' : '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Live Prod %</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '12px 16px', background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: '#5b21b6' }}>
                <strong>Legacy Auth:</strong> Prod% = (total requests ÷ 50) × 100. No downtime formula.
              </div>
            )}

            <div className="card-header">
              <div className="card-title">📋 Task Entry — {userProcs.join(' + ')}</div>
              <span className="text-sm text-muted">Weighted total: <strong>{isLegacyAuth ? slotGrandTotal : total.toFixed(2)}</strong></span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task / Request Type</th>
                    <th className="right">Target</th>
                    <th className="right">Weight ×</th>
                    <th className="right" style={{ minWidth: 110 }}>Count</th>
                    <th className="right">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {taskDefs.map((t, i) => {
                    const cnt    = parseFloat(taskCounts[t.name]) || 0;
                    const weight = (50 / t.target).toFixed(3);
                    const contrib = (cnt * (50 / t.target)).toFixed(2);
                    return (
                      <tr key={t.name} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)' }}>
                        <td className="bold">
                          {t.name}
                          {userProcs.length > 1 && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>[{t.process}]</span>}
                        </td>
                        <td className="right" style={{ color: 'var(--accent)', fontWeight: 700 }}>{t.target}</td>
                        <td className="right" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{weight}</td>
                        <td className="right">
                          <input type="number" min="0"
                            value={taskCounts[t.name] ?? ''}
                            onChange={e => setTaskCounts(prev => ({ ...prev, [t.name]: e.target.value }))}
                            style={{ width: 90, padding: '7px 10px', fontSize: 14, fontWeight: 700, border: '1.5px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', textAlign: 'right', outline: 'none' }} />
                        </td>
                        <td className="right bold" style={{ color: 'var(--accent)', fontSize: 13 }}>{contrib}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-2)', borderTop: '2px solid var(--accent)' }}>
                    <td colSpan={3} style={{ padding: '11px 14px', fontWeight: 800 }}>TOTAL</td>
                    <td colSpan={2} className="right" style={{ padding: '11px 14px', fontWeight: 900, fontSize: 18, color: pColor(prodPct) }}>
                      {isLegacyAuth ? slotGrandTotal : total.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Remark + Quality ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>
                📝 {!isLegacyAuth && deficit > 0 ? '⚠️ Reason for Deficit' : 'Remark / Highlights'}
              </div>
              <textarea rows={5} value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder={!isLegacyAuth && deficit > 0 ? 'Explain: VDI issues, DDE downtime, complex claims, TAT pressure…' : 'Highlights or context for today'}
                style={{
                  width: '100%', padding: '8px 12px', marginTop: 6,
                  border: `1px solid ${!isLegacyAuth && deficit > 0 ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                  background: !isLegacyAuth && deficit > 0 ? '#fffbeb' : 'var(--surface)',
                  borderRadius: 6, color: 'var(--text)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                }} />
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>⭐ Quality Entry</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Date (which day's quality)</label>
                  <input type="date" value={qualityDate} onChange={e => setQualityDate(e.target.value)}
                    style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 12, width: '100%', outline: 'none' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    {isOnlyAuth ? 'Quality % (default 100)' : 'Quality %'}
                  </label>
                  <input type="number" min="0" max="100" step="0.1" value={quality} onChange={e => setQuality(e.target.value)}
                    placeholder={isOnlyAuth ? '100' : 'e.g. 96.5'}
                    style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 700, width: '100%', outline: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <input type="checkbox" id="qa-na" checked={qualityNA} onChange={e => setQualityNA(e.target.checked)} style={{ width: 'auto' }} />
                <label htmlFor="qa-na" style={{ fontSize: 13, color: 'var(--text)', cursor: 'pointer', marginBottom: 0 }}>Mark as NA / Not completed today</label>
              </div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>💬 Action Plan</label>
              <textarea rows={3} value={actionPlan} onChange={e => setActionPlan(e.target.value)}
                placeholder="e.g. Will cover deficit by EOW…"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
            </div>
          </div>

          {/* ── Call Tracker ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">📞 Call Tracker — {fmtD(date)}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Track daily calls to monitor calling vs non-calling productivity
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Total Calls Made</label>
                <input type="number" value={calls} onChange={e => setCalls(e.target.value)} placeholder="e.g. 45"
                  style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 16, fontWeight: 700, width: '100%', outline: 'none' }} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Time on Calls (hrs)</label>
                <input type="number" value={callHours} onChange={e => setCallHours(e.target.value)} placeholder="e.g. 3.5" step="0.5"
                  style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 16, fontWeight: 700, width: '100%', outline: 'none' }} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Call Type</label>
                <select value={callType} onChange={e => setCallType(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none' }}>
                  <option value="Insurance Call">Insurance Call</option>
                </select>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Notes / Observations</label>
              <input type="text" value={callNotes} onChange={e => setCallNotes(e.target.value)}
                placeholder="e.g. Mostly denials on aging AR…"
                style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none' }} />
            </div>
            {(calls || callHours) && (
              <div style={{ background: 'linear-gradient(135deg,#f0f9ff,#e0f2fe)', borderRadius: 8, padding: '12px 16px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {calls && <div><span style={{ fontSize: 22, fontWeight: 900, color: '#0284c7' }}>{calls}</span><span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>calls</span></div>}
                {callHours && <div><span style={{ fontSize: 22, fontWeight: 900, color: '#7c3aed' }}>{callHours}h</span><span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>on calls</span></div>}
                {calls && callHours && (
                  <div><span style={{ fontSize: 22, fontWeight: 900, color: '#10b981' }}>{(parseInt(calls) / (parseFloat(callHours) || 1)).toFixed(1)}</span><span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>calls/hr</span></div>
                )}
              </div>
            )}
          </div>

          {/* Save / Export */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {saveError && <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 700 }}>{saveError}</span>}
            <button className="btn-sm" onClick={exportReport}>Export CSV</button>
            <button className="btn-primary" onClick={save} disabled={saving || loading || !isEditable}
              style={{ padding: '9px 24px', fontSize: 14, opacity: !isEditable ? 0.5 : 1 }}>
              {saving ? 'Saving…' : !isEditable ? '🔒 Editing Locked' : saved ? '↺ Update Report' : 'Save Report'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
