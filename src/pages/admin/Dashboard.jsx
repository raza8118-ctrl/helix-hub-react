import { useState, useEffect, useRef, useMemo } from 'react';
import { S } from '../../lib/supabase';
import {
  today, fmtD, procIncludes, logMatchesProc, scopeToSupervisor, isOnLeave, parseExcelFile,
} from '../../lib/helpers';
import {
  ACCESSES, ATTENDANCE_STATUSES, LEAVE_TYPES, HALF_DAY_STATUSES,
  KEKA_TARGET_FIELDS, LATE_LOGIN_THRESHOLD, BREAK_LIMIT_MINUTES,
} from '../../lib/constants';
import Modal from '../../components/shared/Modal';

// ── Field-mapping heuristics ──────────────────────────────────────────────────
// Best-effort guesses from header text — the user confirms/adjusts these in
// the wizard, so a wrong guess just means one extra click, not a bad import.
function guessMapping(header) {
  const h = header.toLowerCase();
  if (h.includes('emp')) return 'emp_id';
  if (h.includes('date')) return 'date';
  if (h.includes('logout') || h.includes('log out') || h.includes('log-out')) return 'logout_time';
  if (h.includes('login') || h.includes('log in') || h.includes('log-in')) return 'login_time';
  if (h.includes('leave')) return 'leave_type';
  if (h.includes('status')) return 'attendance_status';
  if (h.includes('late')) return 'late_login';
  if (h.includes('break') && (h.includes('exceed') || h.includes('over'))) return 'break_exceed';
  if (h.includes('break')) return 'break_minutes';
  return 'ignore';
}

function guessValueMap(target, rawValues) {
  const map = {};
  rawValues.forEach(v => {
    const lv = v.toLowerCase();
    if (target === 'attendance_status') {
      if (lv.startsWith('p')) map[v] = 'present';
      else if (lv.includes('half')) map[v] = 'half_day_1';
      else if (lv.startsWith('a')) map[v] = 'absent';
      else map[v] = '';
    } else {
      if (lv.includes('csl')) map[v] = 'csl';
      else if (lv.includes('plan')) map[v] = 'planned';
      else map[v] = '';
    }
  });
  return map;
}

function toBool(raw) {
  return ['y', 'yes', 'true', '1'].includes(String(raw ?? '').trim().toLowerCase());
}

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Assumes DD-MM-YYYY for slash/dash dates (Keka is used in India) — revisit
// once we see a real export, since this is ambiguous with MM-DD-YYYY.
function normalizeDate(raw, fallback) {
  if (raw === '' || raw == null) return fallback;
  if (typeof raw === 'number') {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return isNaN(d) ? fallback : ymdLocal(d);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? fallback : ymdLocal(d);
}

// ── Import wizard ─────────────────────────────────────────────────────────────
function ImportWizard({ user, date, allUsers, onClose, onImported }) {
  const [step, setStep]           = useState(1);
  const [file, setFile]           = useState(null);
  const [parsing, setParsing]     = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [parsed, setParsed]       = useState(null);
  const [colMap, setColMap]       = useState({});
  const [valueMap, setValueMap]   = useState({});
  const [importing, setImporting] = useState(false);
  const [error, setError]         = useState('');
  const fileInput = useRef(null);

  async function handleFile(f) {
    if (!f) return;
    setFile(f); setError(''); setParsed(null);
    setParsing(true);
    try {
      const result = await parseExcelFile(f);
      setParsed(result);
      const guesses = {};
      result.headers.forEach(h => { guesses[h] = guessMapping(h); });
      setColMap(guesses);
    } catch (err) {
      setError(`Parse error: ${err.message}`);
    }
    setParsing(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  const valueMapHeaders = useMemo(
    () => Object.entries(colMap).filter(([, t]) => t === 'attendance_status' || t === 'leave_type').map(([h]) => h),
    [colMap]
  );

  function goToStep3() {
    const vm = {};
    valueMapHeaders.forEach(h => {
      const target = colMap[h];
      const raw = [...new Set(parsed.rows.map(r => String(r[h] ?? '').trim()).filter(Boolean))];
      vm[h] = guessValueMap(target, raw);
    });
    setValueMap(vm);
    setStep(valueMapHeaders.length > 0 ? 3 : 4);
  }

  function buildRows() {
    const empHeader = Object.entries(colMap).find(([, t]) => t === 'emp_id')?.[0];
    const dateHeader = Object.entries(colMap).find(([, t]) => t === 'date')?.[0];
    if (!empHeader) return [];
    return parsed.rows.map(r => {
      const row = {
        emp_id: String(r[empHeader] ?? '').trim(),
        date: normalizeDate(dateHeader ? r[dateHeader] : null, date),
      };
      for (const [header, target] of Object.entries(colMap)) {
        if (target === 'ignore' || target === 'emp_id' || target === 'date') continue;
        const raw = r[header];
        if (target === 'attendance_status' || target === 'leave_type') {
          const mapped = valueMap[header]?.[String(raw ?? '').trim()];
          if (mapped) row[target] = mapped;
        } else if (target === 'late_login' || target === 'break_exceed') {
          row[target] = toBool(raw);
        } else if (target === 'break_minutes') {
          const n = parseFloat(raw);
          row[target] = Number.isFinite(n) ? n : null;
        } else {
          row[target] = String(raw ?? '').trim() || null;
        }
      }
      return row;
    }).filter(r => r.emp_id && r.date);
  }

  const rows = parsed ? buildRows() : [];
  const empIndex = useMemo(() => new Map(allUsers.map(u => [String(u.emp_id).trim().toLowerCase(), u])), [allUsers]);
  const matched   = rows.filter(r => empIndex.has(r.emp_id.toLowerCase()));
  const unmatched = rows.length - matched.length;

  async function doImport() {
    setImporting(true); setError('');
    try {
      const byDate = new Map();
      matched.forEach(r => {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date).push(r);
      });

      for (const [d, group] of byDate) {
        const existingLogs = await S.get('daily_logs', { date: d });
        const existingByEmp = new Map((existingLogs ?? []).map(l => [String(l.emp_id).trim().toLowerCase(), l]));
        for (const r of group) {
          const key = r.emp_id.toLowerCase();
          const emp = empIndex.get(key);
          const ex  = existingByEmp.get(key);
          const patch = { keka_imported_at: new Date().toISOString() };
          ['attendance_status', 'leave_type', 'login_time', 'logout_time', 'break_minutes', 'late_login', 'break_exceed']
            .forEach(f => { if (r[f] !== undefined) patch[f] = r[f]; });
          if (ex?.id) {
            await S.update('daily_logs', patch, { id: ex.id });
          } else {
            await S.set('daily_logs', {
              emp_id: emp.emp_id,
              emp_name: emp.name ?? emp.emp_id,
              date: d,
              process: emp.access ?? '',
              ...patch,
            });
          }
        }
      }

      await S.set('keka_imports', {
        imported_by: user.emp_id,
        imported_by_name: user.name ?? user.emp_id,
        imported_at: new Date().toISOString(),
        file_name: file?.name ?? 'unknown',
        date,
        records_count: rows.length,
        matched_count: matched.length,
        unmatched_count: unmatched,
      });

      onImported();
    } catch (err) {
      setError(`Import failed: ${err.message}. Please try again.`);
    }
    setImporting(false);
  }

  return (
    <Modal title="Import Keka File" onClose={onClose} wide>
      {error && <div className="text-sm" style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}

      {/* Step 1 — upload */}
      {step === 1 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-lg)',
            background: dragOver ? 'var(--accent-dim)' : 'var(--surface)',
            padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
            {parsing ? 'Parsing file…' : 'Drop Keka export here'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {parsing ? 'Please wait…' : 'or click to browse — .xlsx, .xls, .csv supported'}
          </div>
          {parsing && <div className="spinner" style={{ margin: '14px auto 0' }} />}
          <input
            ref={fileInput} type="file" accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => e.target.files[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}
      {step === 1 && parsed && (
        <div className="form-actions">
          <button className="btn-primary" onClick={() => setStep(2)}>Next — Map Columns →</button>
        </div>
      )}

      {/* Step 2 — map columns */}
      {step === 2 && parsed && (
        <>
          <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Match each Keka column to a Helix Hub field. Columns set to "Ignore" are skipped.
          </div>
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th>Keka Column</th><th>Maps to</th></tr></thead>
              <tbody>
                {parsed.headers.map(h => (
                  <tr key={h}>
                    <td className="bold">{h}</td>
                    <td>
                      <select
                        value={colMap[h] ?? 'ignore'}
                        onChange={e => setColMap(prev => ({ ...prev, [h]: e.target.value }))}
                      >
                        {KEKA_TARGET_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setStep(1)}>← Back</button>
            <button
              className="btn-primary"
              disabled={!Object.values(colMap).includes('emp_id')}
              onClick={goToStep3}
            >
              Next →
            </button>
          </div>
          {!Object.values(colMap).includes('emp_id') && (
            <div className="text-sm" style={{ color: 'var(--warning)', marginTop: 6 }}>Map an Employee ID column to continue.</div>
          )}
        </>
      )}

      {/* Step 3 — map values (attendance/leave columns only) */}
      {step === 3 && (
        <>
          <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Match the raw values found in each status column to Helix Hub's own values.
          </div>
          {valueMapHeaders.map(h => {
            const target = colMap[h];
            const options = target === 'attendance_status' ? ATTENDANCE_STATUSES : LEAVE_TYPES.map(l => l.id);
            return (
              <div key={h} className="card" style={{ marginBottom: 12, padding: 12 }}>
                <div className="bold" style={{ marginBottom: 8 }}>{h}</div>
                {Object.keys(valueMap[h] ?? {}).map(raw => (
                  <div key={raw} className="row" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <span className="badge badge-gray" style={{ minWidth: 80 }}>{raw}</span>
                    <span>→</span>
                    <select
                      value={valueMap[h][raw] ?? ''}
                      onChange={e => setValueMap(prev => ({ ...prev, [h]: { ...prev[h], [raw]: e.target.value } }))}
                      style={{ maxWidth: 160 }}
                    >
                      <option value="">— skip —</option>
                      {options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setStep(2)}>← Back</button>
            <button className="btn-primary" onClick={() => setStep(4)}>Next — Preview →</button>
          </div>
        </>
      )}

      {/* Step 4 — preview & confirm */}
      {step === 4 && (
        <>
          <div className="grid-3 mb-16">
            <div className="stat-card">
              <div className="stat-label">Rows Found</div>
              <div className="stat-value">{rows.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Matched Employees</div>
              <div className="stat-value col-green">{matched.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Unmatched</div>
              <div className={unmatched > 0 ? 'stat-value col-red' : 'stat-value'}>{unmatched}</div>
            </div>
          </div>
          <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Importing will overwrite attendance/login/break fields on Daily Logs for each matched employee + date. Unmatched rows are skipped.
          </div>
          <div className="form-actions">
            <button className="btn-sm" onClick={() => setStep(valueMapHeaders.length > 0 ? 3 : 2)}>← Back</button>
            <button className="btn-primary" disabled={importing || matched.length === 0} onClick={doImport}>
              {importing ? 'Importing…' : `Import ${matched.length} Records`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Dashboard({ user }) {
  const [date, setDate]         = useState(today());
  const [filterProc, setProc]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('active');
  const [logs, setLogs]         = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [customProcs, setCustomProcs] = useState([]);
  const [imports, setImports]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [showImport, setShowImport] = useState(false);

  const canImport = user.role === 'admin' || user.role === 'manager';

  useEffect(() => { load(); }, [date]);

  async function load() {
    setLoading(true);
    const [u, l, cp, imp] = await Promise.all([
      S.get('users'),
      S.get('daily_logs', { date }),
      S.get('processes'),
      S.get('keka_imports'),
    ]);
    setAllUsers(u ?? []);
    setLogs(l ?? []);
    setCustomProcs(cp ?? []);
    setImports((imp ?? []).sort((a, b) => new Date(b.imported_at) - new Date(a.imported_at)).slice(0, 5));
    setLoading(false);
  }

  const { teamSize, leaveCount, attendancePct, shrinkagePct, breakExceedCount, lateLoginCount, tableRows } = useMemo(() => {
    const employees = scopeToSupervisor(allUsers, user, customProcs).filter(u => {
      if (u.role !== 'employee') return false;
      const procOk   = filterProc === 'ALL' || procIncludes(u, filterProc);
      const statusOk = statusFilter === 'all' ||
        (statusFilter === 'active' ? u.active !== false : u.active === false);
      return procOk && statusOk;
    });

    const teamEmpIds = new Set(employees.map(u => u.emp_id));
    const filteredLogs = logs.filter(l => logMatchesProc(l, filterProc) && teamEmpIds.has(l.emp_id));

    const teamSize   = employees.length;
    const leaveCount = filteredLogs.filter(isOnLeave).length;
    const halfDayCount = filteredLogs.filter(l => HALF_DAY_STATUSES.includes(l.attendance_status)).length;
    const attendancePct = teamSize > 0 ? ((teamSize - leaveCount) / teamSize) * 100 : null;
    const shrinkagePct  = teamSize > 0 ? ((leaveCount + 0.5 * halfDayCount) / teamSize) * 100 : null;
    const breakExceedCount = filteredLogs.filter(l => l.break_exceed).length;
    const lateLoginCount   = filteredLogs.filter(l => l.late_login).length;

    const tableRows = employees.map(u => ({ ...u, log: filteredLogs.find(l => l.emp_id === u.emp_id) ?? null }));

    return { teamSize, leaveCount, attendancePct, shrinkagePct, breakExceedCount, lateLoginCount, tableRows };
  }, [allUsers, logs, user, customProcs, filterProc, statusFilter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Keka Attendance Overview · {fmtD(date)}</div>
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
          <button className="btn-sm" onClick={load}>↺ Refresh</button>
          {canImport && (
            <button className="btn-primary" onClick={() => setShowImport(true)}>⬆ Import Keka File</button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid-5 mb-16">
        {[
          { label: 'Team Leave Avg', value: teamSize > 0 ? `${((leaveCount / teamSize) * 100).toFixed(1)}%` : '—', sub: `${leaveCount} on leave`, cls: 'col-blue' },
          { label: 'Attendance',     value: attendancePct != null ? attendancePct.toFixed(1) + '%' : '—', sub: 'present today', cls: 'col-green' },
          { label: 'Shrinkage',      value: shrinkagePct != null ? shrinkagePct.toFixed(1) + '%' : '—', sub: 'leave + half-day', cls: '' },
          { label: 'Break Exceed Instances', value: breakExceedCount, sub: `over ${BREAK_LIMIT_MINUTES}m limit`, cls: breakExceedCount > 0 ? 'col-red' : '' },
          { label: 'Late Login',     value: lateLoginCount, sub: `after ${LATE_LOGIN_THRESHOLD}`, cls: lateLoginCount > 0 ? 'col-red' : '' },
        ].map(kpi => (
          <div key={kpi.label} className="stat-card">
            <div className="stat-label">{kpi.label}</div>
            <div className={`stat-value ${kpi.cls}`}>{kpi.value}</div>
            <div className="stat-sub">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Per-employee Keka data */}
      <div className="card mb-16">
        <div className="card-header">
          <div className="card-title">Attendance Detail</div>
          {loading && <span className="text-muted text-sm">Loading…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th className="center">Status</th>
                <th>Login</th>
                <th>Logout</th>
                <th className="right">Break (min)</th>
                <th className="center">Late Login</th>
                <th className="center">Break Exceeded</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>No data for this date</td></tr>
              )}
              {tableRows.map(row => (
                <tr key={row.emp_id}>
                  <td className="bold">{row.name ?? row.emp_id}</td>
                  <td className="center">
                    {isOnLeave(row.log)
                      ? <span className="badge badge-blue">On Leave</span>
                      : row.log?.attendance_status === 'present'
                        ? <span className="badge badge-green">Present</span>
                        : <span className="badge badge-gray">—</span>}
                  </td>
                  <td className="text-sm">{row.log?.login_time ?? '—'}</td>
                  <td className="text-sm">{row.log?.logout_time ?? '—'}</td>
                  <td className="right">{row.log?.break_minutes ?? '—'}</td>
                  <td className="center">{row.log?.late_login ? '⚠️' : '—'}</td>
                  <td className="center">{row.log?.break_exceed ? '⚠️' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent imports */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent Keka Imports</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>File</th><th>Date</th><th>By</th><th className="right">Records</th><th className="right">Matched</th><th className="right">Unmatched</th><th>When</th></tr>
            </thead>
            <tbody>
              {imports.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No imports yet</td></tr>
              )}
              {imports.map(imp => (
                <tr key={imp.id}>
                  <td className="text-sm">{imp.file_name}</td>
                  <td className="text-sm">{fmtD(imp.date)}</td>
                  <td className="text-sm">{imp.imported_by_name}</td>
                  <td className="right">{imp.records_count}</td>
                  <td className="right col-green">{imp.matched_count}</td>
                  <td className={`right ${imp.unmatched_count > 0 ? 'col-red' : ''}`}>{imp.unmatched_count}</td>
                  <td className="text-sm text-muted">{new Date(imp.imported_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <ImportWizard
          user={user}
          date={date}
          allUsers={allUsers}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}
    </div>
  );
}
