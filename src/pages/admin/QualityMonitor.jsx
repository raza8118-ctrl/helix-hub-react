import { useState, useEffect, useMemo } from 'react';
import { S, kv } from '../../lib/supabase';
import { today, fmtSh, fmtD, avg, procIncludes, scopeToSupervisor, permsFor, logAudit, isOnLeave, isScopedUser } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';
import { alertDialog } from '../../components/shared/Dialog';
import { Pill, Notice, Button } from '../../components/ui';

const RANGE_OPTIONS = [7, 14, 21];

function datesBefore(endDate, count) {
  const result = [];
  const base = new Date(endDate + 'T00:00:00');
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    result.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return result;
}

function qColor(val) {
  if (val == null) return '';
  if (val >= 98) return 'col-green';
  if (val >= 90) return 'col-yellow';
  return 'col-red';
}

/** Frost Glass: same bands as qColor → pill tone. */
const Q_TONE = { 'col-green': 'good', 'col-yellow': 'warn', 'col-red': 'bad' };
const qTone = val => Q_TONE[qColor(val)] ?? 'neutral';

export default function QualityMonitor({ user }) {
  const [endDate, setEndDate]       = useState(today());
  const [range, setRange]           = useState(14);
  const [filterProc, setFilterProc] = useState('ALL');
  const [allUsers, setAllUsers]     = useState([]);
  const [logs, setLogs]             = useState([]);
  const [holidays, setHolidays]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [customProcs, setCustomProcs] = useState([]);
  const [qualitySkipProcs, setQualitySkipProcs] = useState(new Set());

  const [editTarget, setEditTarget] = useState(null);
  const [editDate, setEditDate]     = useState('');
  const [editVal, setEditVal]       = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const isScopedRole = isScopedUser(user);
  const perms        = permsFor(user);
  const canEdit      = !isScopedRole || perms?.editQuality;

  const dates = useMemo(() => datesBefore(endDate, range), [endDate, range]);

  useEffect(() => { load(); }, [endDate, range]);

  async function load() {
    setLoading(true);
    const startDate = dates[0];
    const [u, cp, skipList] = await Promise.all([
      S.get('users'),
      S.get('processes'),
      kv.get('quality_skip_procs'),
    ]);
    // Fetch logs for the full date range via gte/lte — S.get only does eq,
    // so fetch all logs for each employee within the range using a raw query.
    // (db() targets the active company's copy of the table)
    const { data: l } = await import('../../lib/supabase').then(m =>
      m.db('daily_logs').select('*').gte('date', startDate).lte('date', endDate)
    );
    // Fetch holidays in range
    const { data: h } = await import('../../lib/supabase').then(m =>
      m.db('holidays').select('*').gte('date', startDate).lte('date', endDate)
    );
    setAllUsers(u ?? []);
    setLogs(l ?? []);
    setHolidays(h ?? []);
    setCustomProcs(cp ?? []);
    setQualitySkipProcs(new Set(skipList ?? []));
    setLoading(false);
  }

  const holidayDates = useMemo(() => new Set((holidays ?? []).map(h => h.date)), [holidays]);

  const employees = useMemo(() => {
    return scopeToSupervisor(allUsers, user, customProcs).filter(u => {
      if (u.role !== 'employee' || u.active === false) return false;
      return filterProc === 'ALL' || procIncludes(u, filterProc);
    });
  }, [allUsers, user, customProcs, filterProc]);

  const logMap = useMemo(() => {
    const m = {};
    for (const l of logs) {
      m[`${l.emp_id}__${l.date}`] = l;
    }
    return m;
  }, [logs]);

  const allProcs = useMemo(() => {
    const procs = new Set();
    allUsers.filter(u => u.role === 'employee').forEach(u => {
      (u.processes ?? [u.access]).filter(Boolean).forEach(p => procs.add(p));
    });
    return ['ALL', ...Array.from(procs).sort()];
  }, [allUsers]);

  // Per-date average quality across employees who have a quality value
  const dateAvgs = useMemo(() => {
    return dates.map(d => {
      const vals = employees
        .map(e => logMap[`${e.emp_id}__${d}`]?.quality)
        .filter(v => v != null);
      return vals.length ? Math.round(avg(vals) * 10) / 10 : null;
    });
  }, [dates, employees, logMap]);

  // Per-employee average across the visible range
  function empAvg(emp) {
    const vals = dates.map(d => logMap[`${emp.emp_id}__${d}`]?.quality).filter(v => v != null);
    return vals.length ? Math.round(avg(vals) * 10) / 10 : null;
  }

  // Pending count: worked days with no quality, excluding skip-quality processes
  const totalPending = useMemo(() => {
    let count = 0;
    for (const e of employees) {
      const eProcs = (e.processes?.length ? e.processes : [e.access || e.process]).filter(Boolean);
      if (eProcs.length > 0 && eProcs.every(p => qualitySkipProcs.has(p))) continue;
      for (const d of dates) {
        const log = logMap[`${e.emp_id}__${d}`];
        if (log && !isOnLeave(log) && !log.quality_bypass_reason && log.quality == null) count++;
      }
    }
    return count;
  }, [employees, dates, logMap, qualitySkipProcs]);

  function openEdit(emp, date, existingVal) {
    setEditTarget(emp);
    setEditDate(date);
    setEditVal(existingVal != null ? String(existingVal) : '');
  }

  async function saveQuality() {
    const q = parseFloat(editVal);
    if (!editTarget || isNaN(q) || q < 0 || q > 100) return;
    setEditLoading(true);
    const log = logMap[`${editTarget.emp_id}__${editDate}`];
    if (!log) {
      await alertDialog({ title: 'No report found', message: `No log found for ${editTarget.name ?? editTarget.emp_id} on ${editDate}.`, tone: 'warning' });
      setEditLoading(false);
      return;
    }
    await S.update('daily_logs', { quality: q }, { id: log.id });
    logAudit({ actor: user, action: 'edit_quality', targetEmpId: editTarget.emp_id, targetName: editTarget.name, details: { value: q, date: editDate } });
    setEditTarget(null);
    setEditVal('');
    setEditLoading(false);
    await load();
  }

  return (
    <div className="fg-page">
      {/* Filters (the page title is in the top bar) */}
      <div className="fg-bar">
        <div className="fg-filters">
          <label className="fg-f"><span>End date</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
          <div className="fg-f" role="group" aria-label="Range"><span>Range</span>
            <div className="fg-choices fg-choices-tight">
              {RANGE_OPTIONS.map(r => (
                <Button key={r} size="sm" active={range === r} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {r} days
                </Button>
              ))}
            </div>
          </div>
          <div className="fg-f" role="group" aria-label="Process"><span>Process</span>
            <div className="fg-choices fg-choices-tight">
              {allProcs.map(p => (
                <Button key={p} size="sm" active={filterProc === p} aria-pressed={filterProc === p} onClick={() => setFilterProc(p)}>
                  {p}
                </Button>
              ))}
            </div>
          </div>
        </div>
        {loading && <span className="fg-date">Loading…</span>}
      </div>

      {/* Summary stat */}
      {totalPending > 0 && (
        <Notice icon="⏳">
          {totalPending} quality entr{totalPending === 1 ? 'y' : 'ies'} pending across this range
        </Notice>
      )}

      {/* Grid */}
      <div className="card qm-grid">
        <div className="qm-scroll">
          <table>
            <thead>
              <tr>
                <th className="qm-name">Employee</th>
                <th className="qm-proc">Proc</th>
                {dates.map((d, i) => (
                  <th key={d} className={`center qm-day${holidayDates.has(d) ? ' holiday' : ''}`}>
                    {fmtSh(d)}
                    {holidayDates.has(d) && <div className="qm-hol">Holiday</div>}
                    {dateAvgs[i] != null && (
                      <div className={`qm-davg ${qColor(dateAvgs[i])}`}>
                        avg {dateAvgs[i]}%
                      </div>
                    )}
                  </th>
                ))}
                <th className="right qm-avg">Avg</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 && (
                <tr><td colSpan={dates.length + 3} className="fg-empty">No employees found</td></tr>
              )}
              {employees.map(emp => {
                const avg_ = empAvg(emp);
                const empProcs = (emp.processes?.length ? emp.processes : [emp.access || emp.process]).filter(Boolean);
                const skipQuality = empProcs.length > 0 && empProcs.every(p => qualitySkipProcs.has(p));
                return (
                  <tr key={emp.emp_id}>
                    <td className="bold qm-name">
                      {emp.name ?? emp.emp_id}
                    </td>
                    <td className="text-muted qm-small">
                      {(emp.processes ?? [emp.access]).filter(Boolean).join(', ')}
                    </td>
                    {dates.map(d => {
                      const log = logMap[`${emp.emp_id}__${d}`];
                      const isHoliday = holidayDates.has(d);
                      const onLeave = isOnLeave(log);
                      const bypassed = !!log?.bypass_reason;
                      const hasLog = !!log;
                      const quality = log?.quality;

                      if (isHoliday) {
                        return (
                          <td key={d} className="center qm-holcell">
                            —
                          </td>
                        );
                      }
                      if (onLeave) {
                        return (
                          <td key={d} className="center">
                            <Pill tone="accent">Leave</Pill>
                          </td>
                        );
                      }
                      if (bypassed) {
                        return (
                          <td key={d} className="center">
                            <Pill>Bypassed</Pill>
                          </td>
                        );
                      }
                      if (skipQuality) {
                        return (
                          <td key={d} className="center">
                            {hasLog ? <Pill tone="good">100%</Pill> : <span className="text-muted">—</span>}
                          </td>
                        );
                      }
                      const qualityBypassed = !!log?.quality_bypass_reason;
                      if (!hasLog || qualityBypassed) {
                        return <td key={d} className="center text-muted">—</td>;
                      }
                      // Has log — show quality or pending
                      return (
                        <td key={d} className={`center${canEdit ? ' qm-edit' : ''}`}
                          onClick={() => canEdit && openEdit(emp, d, quality)}
                          title={canEdit ? `Click to ${quality != null ? 'edit' : 'enter'} quality for ${fmtD(d)}` : ''}>
                          {quality != null
                            ? <Pill tone={qTone(quality)}>{quality}%</Pill>
                            : <Pill>Pending</Pill>
                          }
                        </td>
                      );
                    })}
                    <td className={`right bold qm-avg ${qColor(avg_)}`}>
                      {avg_ != null ? avg_ + '%' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editTarget && (
        <Modal title={`Quality — ${editTarget.name ?? editTarget.emp_id}`} onClose={() => setEditTarget(null)}>
          <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
            Entering quality for <strong>{fmtD(editDate)}</strong>
          </p>
          <div className="field">
            <label>Quality % (0–100)</label>
            <input type="number" min="0" max="100" step="0.1" value={editVal}
              onChange={e => setEditVal(e.target.value)} placeholder="e.g. 96.5" autoFocus />
          </div>
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={saveQuality} disabled={editLoading || editVal === ''}>
              {editLoading ? 'Saving…' : 'Save Quality'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
