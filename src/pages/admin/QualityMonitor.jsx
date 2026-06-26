import { useState, useEffect, useMemo } from 'react';
import { S } from '../../lib/supabase';
import { today, fmtSh, fmtD, avg, procIncludes, scopeToSupervisor, permsFor, logAudit, isOnLeave } from '../../lib/helpers';
import Modal from '../../components/shared/Modal';

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

export default function QualityMonitor({ user }) {
  const [endDate, setEndDate]       = useState(today());
  const [range, setRange]           = useState(14);
  const [filterProc, setFilterProc] = useState('ALL');
  const [allUsers, setAllUsers]     = useState([]);
  const [logs, setLogs]             = useState([]);
  const [holidays, setHolidays]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [customProcs, setCustomProcs] = useState([]);

  const [editTarget, setEditTarget] = useState(null);
  const [editDate, setEditDate]     = useState('');
  const [editVal, setEditVal]       = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const isScopedRole = user.role === 'supervisor' || user.role === 'manager';
  const perms        = permsFor(user);
  const canEdit      = !isScopedRole || perms?.editQuality;

  const dates = useMemo(() => datesBefore(endDate, range), [endDate, range]);

  useEffect(() => { load(); }, [endDate, range]);

  async function load() {
    setLoading(true);
    const startDate = dates[0];
    const [u, cp] = await Promise.all([
      S.get('users'),
      S.get('processes'),
    ]);
    // Fetch logs for the full date range via gte/lte — S.get only does eq,
    // so fetch all logs for each employee within the range using a raw query.
    const { data: l } = await import('../../lib/supabase').then(m =>
      m.supabase.from('daily_logs').select('*').gte('date', startDate).lte('date', endDate)
    );
    // Fetch holidays in range
    const { data: h } = await import('../../lib/supabase').then(m =>
      m.supabase.from('holidays').select('*').gte('date', startDate).lte('date', endDate)
    );
    setAllUsers(u ?? []);
    setLogs(l ?? []);
    setHolidays(h ?? []);
    setCustomProcs(cp ?? []);
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

  // Pending count: worked days with no quality across all employees
  const totalPending = useMemo(() => {
    let count = 0;
    for (const e of employees) {
      for (const d of dates) {
        const log = logMap[`${e.emp_id}__${d}`];
        if (log && !isOnLeave(log) && !log.bypass_reason && log.quality == null) count++;
      }
    }
    return count;
  }, [employees, dates, logMap]);

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
      window.alert(`No log found for ${editTarget.name ?? editTarget.emp_id} on ${editDate}.`);
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
    <div>
      {/* Header controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Quality Monitor</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 13 }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Range</label>
            <div className="row" style={{ gap: 6, marginTop: 2 }}>
              {RANGE_OPTIONS.map(r => (
                <button key={r} className="btn-sm"
                  style={range === r ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
                  onClick={() => setRange(r)}>
                  {r} days
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Process</label>
            <div className="row" style={{ gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
              {allProcs.map(p => (
                <button key={p} className="btn-sm"
                  style={filterProc === p ? { background: 'var(--accent)', color: '#fff', border: 'none' } : {}}
                  onClick={() => setFilterProc(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary stat */}
      {totalPending > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="badge badge-gray" style={{ fontSize: 12 }}>
            ⏳ {totalPending} quality entr{totalPending === 1 ? 'y' : 'ies'} pending across this range
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 140, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 2 }}>Employee</th>
                <th style={{ minWidth: 60 }}>Proc</th>
                {dates.map((d, i) => (
                  <th key={d} className="center" style={{
                    minWidth: 72, fontSize: 11,
                    color: holidayDates.has(d) ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: holidayDates.has(d) ? 700 : 600,
                  }}>
                    {fmtSh(d)}
                    {holidayDates.has(d) && <div style={{ fontSize: 9, color: 'var(--accent)' }}>Holiday</div>}
                    {dateAvgs[i] != null && (
                      <div className={qColor(dateAvgs[i])} style={{ fontSize: 10, fontWeight: 700, marginTop: 1 }}>
                        avg {dateAvgs[i]}%
                      </div>
                    )}
                  </th>
                ))}
                <th className="right" style={{ minWidth: 72 }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 && (
                <tr><td colSpan={dates.length + 3} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No employees found</td></tr>
              )}
              {employees.map(emp => {
                const avg_ = empAvg(emp);
                return (
                  <tr key={emp.emp_id}>
                    <td className="bold" style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                      {emp.name ?? emp.emp_id}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>
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
                          <td key={d} className="center" style={{ background: 'var(--surface-2)', fontSize: 11, color: 'var(--accent)' }}>
                            —
                          </td>
                        );
                      }
                      if (onLeave) {
                        return (
                          <td key={d} className="center">
                            <span className="badge badge-blue" style={{ fontSize: 10 }}>Leave</span>
                          </td>
                        );
                      }
                      if (bypassed) {
                        return (
                          <td key={d} className="center">
                            <span className="badge" style={{ fontSize: 10, background: 'rgba(99,102,241,0.15)', color: 'var(--accent)' }}>Bypassed</span>
                          </td>
                        );
                      }
                      if (!hasLog) {
                        return <td key={d} className="center text-muted" style={{ fontSize: 12 }}>—</td>;
                      }
                      // Has log — show quality or pending
                      return (
                        <td key={d} className="center" style={{ cursor: canEdit ? 'pointer' : 'default' }}
                          onClick={() => canEdit && openEdit(emp, d, quality)}
                          title={canEdit ? `Click to ${quality != null ? 'edit' : 'enter'} quality for ${fmtD(d)}` : ''}>
                          {quality != null
                            ? <span className={`bold ${qColor(quality)}`} style={{ fontSize: 13 }}>{quality}%</span>
                            : <span className="badge badge-gray" style={{ fontSize: 10 }}>Pending</span>
                          }
                        </td>
                      );
                    })}
                    <td className={`right bold ${qColor(avg_)}`} style={{ fontSize: 13 }}>
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
              onChange={e => setEditVal(e.target.value)} placeholder="e.g. 96.5" autoFocus
              style={{ color: 'var(--text)', background: 'var(--surface)' }} />
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
