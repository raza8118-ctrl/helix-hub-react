import { useState, useEffect, useMemo, useRef } from 'react';
import { today, fmtD, fmtSh, addDays, getProcs, scopeToSupervisor } from '../../lib/helpers';
import { TEAMS } from '../../lib/constants';
import {
  periodOf, recentMonths, monthQuickPicks, loadDashboard, buildDashboard, logDashboardView, compareOf, exportRows, hoursOf,
  prodTone, qualTone, shrinkTone, fmtPct, fmtNum, fmtHm, PROD_GOOD, QUAL_GOOD, NEON, TONE_HEX,
} from '../../lib/teamDashboard';
import {
  Chip, Meter, Avatar, Segmented, MonthPicker, StatTile, Badge, Panel, Glass, PanelTabs, TrendChart, Donut, BarList,
  HeatGrid, HeatLegend, HBars, MiniStats, Legend, Empty,
} from '../../components/dash/DashParts';
import DrillModal from '../../components/dash/DrillModal';

const MODES = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'months', label: 'Month' }];
const TABS = [['prod', '⚡ Production'], ['qual', '⭐ Quality'], ['att', '🗓️ Attendance'], ['calls', '📞 Calls']];
const SORTS = {
  name: p => (p.name ?? '').toLowerCase(), prod: p => p.prod ?? -1, quality: p => p.quality ?? -1, achieved: p => p.achieved,
  missing: p => p.missing, present: p => p.present, late: p => p.late, hours: p => p.avgHours ?? -1, calls: p => p.calls,
};

/**
 * 📈 Team Dashboard (PO request 2026-10-29) — one page with productivity, quality, attendance and calls for the
 * whole team or one person, for a day, a week or one or more months. Admins / managers see everyone, supervisors
 * their own team. Click any number for the records behind it (Excel export is audit-logged).
 */
export default function TeamDashboard({ user }) {
  const todayStr = today();
  const top = useRef(null);
  const viewLogged = useRef(false);
  const [mode, setMode] = useState('months');
  const [date, setDate] = useState(todayStr);
  const [months, setMonths] = useState([todayStr.slice(0, 7)]);
  const [proc, setProc] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [status, setStatus] = useState('active');
  const [person, setPerson] = useState('');
  const [tab, setTab] = useState('prod');
  const [sort, setSort] = useState({ key: 'prod', dir: -1 });
  const [result, setResult] = useState(null);   // { key, data } or { key, failed } — the last load that finished
  const [drill, setDrill] = useState(null);
  const [reload, setReload] = useState(0);

  const period = useMemo(() => periodOf(mode, { date, months }, todayStr), [mode, date, months, todayStr]);
  const allMonths = useMemo(() => recentMonths(todayStr, 12), [todayStr]);
  const loadKey = `${period.prev.from}|${period.from}|${period.to}|${reload}`;

  useEffect(() => {
    let live = true;
    loadDashboard(period)
      .then(d => { if (live) setResult({ key: loadKey, data: d }); })
      .catch(() => { if (live) setResult(r => ({ ...r, key: loadKey, failed: true })); });
    return () => { live = false; };
  }, [period, loadKey]);

  // The previous numbers stay on screen while a new period loads (and if a reload fails)
  const loading = result?.key !== loadKey;
  const failed = !loading && !!result?.failed;
  const data = result?.data ?? null;

  useEffect(() => {
    if (data && !viewLogged.current) { viewLogged.current = true; logDashboardView(user, period); }
  }, [data, user, period]);

  const dash = useMemo(() => (data ? buildDashboard(data, period, { proc, team, status, person }, user) : null),
    [data, period, proc, team, status, person, user]);

  // Filter choices come from everyone this viewer may see, not just the current filter
  const scoped = useMemo(() => (data ? scopeToSupervisor(data.users, user, data.processes).filter(u => u.role === 'employee') : []), [data, user]);
  const procOptions = useMemo(() => [...new Set(scoped.flatMap(u => getProcs(u)))].sort(), [scoped]);
  const teamOptions = useMemo(() => [...new Set([...TEAMS.filter(t => scoped.some(u => u.team === t)), ...scoped.map(u => u.team).filter(Boolean)])], [scoped]);

  const isFiltered = proc !== 'ALL' || team !== 'ALL' || status !== 'active' || !!person;
  const clearFilters = () => { setProc('ALL'); setTeam('ALL'); setStatus('active'); setPerson(''); };
  const pickPerson = id => { setPerson(id); top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const shiftDate = n => {
    let d = addDays(date, mode === 'week' ? n * 7 : n);
    if (d > todayStr) d = todayStr;
    setDate(d);
  };

  if (loading && !data) return <div className="hx-dash"><div className="loading-row"><div className="spinner" /></div></div>;
  if (failed && !data) {
    return (
      <div className="hx-dash">
        <div className="card"><p>The dashboard couldn’t load. Check your connection and try again.</p>
          <button className="btn-sm" onClick={() => setReload(r => r + 1)}>↻ Try again</button></div>
      </div>
    );
  }

  const { now, prev, buckets, people, nameOf } = dash;
  const p = dash.person;
  const trend = key => (buckets.length > 1 ? buckets.map(b => b[key]) : null);
  const exportNow = (title, rows) => exportRows(user, title, rows, period);
  const nm = id => nameOf.get(id) ?? id;
  const scopeLabel = user.role === 'admin' || user.role === 'manager' ? 'All teams' : 'Your team';

  // ── Details pop-ups ─────────────────────────────────────────────────────────
  const logCols = extra => [
    { label: 'Date', get: r => r.date, render: r => <b>{fmtSh(r.date)}</b> },
    { label: 'Employee', get: r => nm(r.emp_id), render: r => <span className="hx-who"><Avatar name={nm(r.emp_id)} size={22} />{nm(r.emp_id)}</span> },
    { label: 'Process', get: r => r.process ?? '' },
    ...extra,
  ];
  const openLogs = (title, rows, extra, opts = {}) => setDrill({
    title, subtitle: `${period.label} · ${p ? p.name : scopeLabel}`, rows: [...rows].sort((a, b) => b.date.localeCompare(a.date)),
    columns: logCols(extra), groupBy: r => nm(r.emp_id), ...opts,
  });
  const prodCols = [
    { label: 'Achieved', get: r => r.total ?? 0, right: true },
    { label: 'Target', get: r => r.adj_target ?? r.target ?? '', right: true },
    { label: 'Prod %', get: r => { const t = r.adj_target ?? r.target; return t ? Math.round(((r.total ?? 0) / t) * 1000) / 10 : ''; }, right: true,
      render: r => { const t = r.adj_target ?? r.target; const v = t ? ((r.total ?? 0) / t) * 100 : null; return <Chip tone={prodTone(v)}>{fmtPct(v)}</Chip>; } },
  ];
  const attCols = [
    { label: 'Status', get: r => (r.attendance_status ?? '').replace('_', ' ') + (r.leave_type ? ` (${r.leave_type})` : '') },
    { label: 'Login', get: r => r.login_time ?? '' },
    { label: 'Logout', get: r => r.logout_time ?? '' },
    { label: 'Break (min)', get: r => r.break_minutes ?? '', right: true },
    { label: 'Hours', get: r => { const h = hoursOf(r); return h == null ? '' : fmtHm(h); }, right: true },
  ];
  const L = dash.logs;
  const drills = {
    achieved: () => openLogs('Achieved', L.filter(l => (l.total ?? 0) > 0 || l.target), prodCols,
      { value: now.achieved.toLocaleString(), unit: `of ${now.target.toLocaleString()} target`, groupValue: rs => rs.reduce((s, r) => s + (r.total ?? 0), 0).toLocaleString() }),
    quality: () => openLogs('Quality', L.filter(l => l.quality != null), [{ label: 'Quality %', get: r => r.quality, right: true, render: r => <Chip tone={qualTone(r.quality)}>{fmtPct(r.quality)}</Chip> }],
      { value: fmtPct(now.quality), unit: 'average' }),
    missing: () => {
      const focus = p ? [p] : people;
      const rows = focus.flatMap(u => dash.workDays.filter(d => !u.logs.some(l => l.date === d && l.submitted)).map(d => ({ date: d, emp_id: u.emp_id, process: u.procs })));
      openLogs('Daily reports not submitted', rows, [], { value: rows.length, unit: 'missing report(s)', note: 'Working days (holidays and weekends left out) with no submitted daily report.' });
    },
    present: () => openLogs('Present days', L.filter(l => ['present', 'half_day_1', 'half_day_2'].includes(l.attendance_status)), attCols, { value: fmtNum(now.present), unit: 'day(s)', note: 'Half-days count as ½.' }),
    leave: () => openLogs('Leave days', L.filter(l => (l.attendance_status === 'absent' && l.leave_type) || ['half_day_1', 'half_day_2'].includes(l.attendance_status)), attCols, { value: fmtNum(now.leave), unit: 'day(s)', note: 'Planned leave / CSL, plus the missed half of half-days.' }),
    absent: () => openLogs('Absent days (no leave type)', L.filter(l => l.attendance_status === 'absent' && !l.leave_type), attCols, { value: fmtNum(now.absent), unit: 'day(s)' }),
    late: () => openLogs('Late logins', L.filter(l => l.late_login), attCols, { value: now.late, unit: 'late login(s)' }),
    breaks: () => openLogs('Break over the limit', L.filter(l => l.break_exceed), attCols, { value: now.breakOver, unit: 'day(s)' }),
    short: () => openLogs('Short days (under 8 hours)', L.filter(l => l.attendance_status === 'present' && hoursOf(l) != null && hoursOf(l) < 8), attCols, { value: now.short, unit: 'day(s)', note: 'Login to logout minus breaks, full present days only.' }),
    hours: () => openLogs('Hours per day', L.filter(l => hoursOf(l) != null), attCols, { value: fmtHm(now.avgHours), unit: 'average per present day' }),
    calls: () => openLogs('Calls', L.filter(l => (l.calls ?? 0) > 0 || (l.call_hours ?? 0) > 0), [
      { label: 'Calls', get: r => r.calls ?? 0, right: true }, { label: 'Call hours', get: r => r.call_hours ?? 0, right: true },
    ], { value: now.calls.toLocaleString(), unit: `calls · ${fmtNum(now.callHours)} h`, groupValue: rs => rs.reduce((s, r) => s + (r.calls ?? 0), 0).toLocaleString() }),
    audits: () => setDrill({
      title: 'QA audits', subtitle: `${period.label} · ${p ? p.name : scopeLabel}`, value: now.audited, unit: `audit(s) · ${now.fatal} fatal`,
      rows: [...(dash.audits ?? [])].sort((a, b) => (b.work_date ?? '').localeCompare(a.work_date ?? '')),
      groupBy: a => nm(a.agent_emp_id),
      columns: [
        { label: 'Work date', get: a => a.work_date ?? '' },
        { label: 'Employee', get: a => nm(a.agent_emp_id) },
        { label: 'Auditor', get: a => nm(a.auditor_emp_id) },
        { label: 'Score', get: a => a.score ?? '', right: true, render: a => <Chip tone={qualTone(a.score)}>{fmtPct(a.score)}</Chip> },
        { label: 'Fatal', get: a => (a.fatal ? 'Yes' : 'No') },
        { label: 'Status', get: a => a.status },
      ],
    }),
    bucket: b => openLogs(`${b.label}${b.days.length > 1 ? ` (week)` : ''}`, L.filter(l => b.days.includes(l.date)), tab === 'att' ? attCols : tab === 'calls'
      ? [{ label: 'Calls', get: r => r.calls ?? 0, right: true }, { label: 'Call hours', get: r => r.call_hours ?? 0, right: true }]
      : [...prodCols, { label: 'Quality %', get: r => r.quality ?? '', right: true }]),
  };

  // ── Team table ──────────────────────────────────────────────────────────────
  const sorted = [...people].sort((a, b) => {
    const f = SORTS[sort.key];
    const x = f(a), y = f(b);
    return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
  });
  const sortBy = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : (key === 'name' ? 1 : -1) }));
  const th = (k, label, right) => (
    <th key={k} className={`hx-sort${right ? ' right' : ''}`} onClick={() => sortBy(k)} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const exportTeam = () => exportNow('team members', sorted.map(u => ({
    'Employee ID': u.emp_id, Employee: u.name, Team: u.team ?? '', Process: u.procs, 'Prod %': u.prod == null ? '' : Math.round(u.prod * 10) / 10,
    'Quality %': u.quality == null ? '' : Math.round(u.quality * 10) / 10, Achieved: u.achieved, Target: u.target, 'Reports missing': u.missing,
    Present: u.present, Leave: u.leave, Absent: u.absent, 'Late logins': u.late, 'Break over': u.breakOver, 'Short days': u.short,
    'Avg hours': u.avgHours == null ? '' : Math.round(u.avgHours * 100) / 100, Calls: u.calls, 'Call hours': u.callHours,
    'QA audits': u.audited ?? '', 'Fatal errors': u.fatal ?? '', 'Prod rank': u.rank ?? '',
  })));

  const qaReady = now.audited != null;
  const mixData = dash.mix.map((m, k) => ({ ...m, fill: NEON[k % NEON.length] }));
  const bucketWord = buckets.length && buckets[0].days.length > 1 ? 'week' : 'day';

  return (
    <div className="hx-dash" ref={top}>
      {/* Header */}
      <header className="hx-hero">
        <div className="hx-hero-l">
          <div className="hx-kicker">Helix Hub · Monitoring</div>
          <h1 className="hx-title"><span>Team Dashboard</span></h1>
          <div className="hx-tagline">Productivity <i>•</i> Quality <i>•</i> Attendance <i>•</i> Calls</div>
          <div className="hx-pills">
            <span className="hx-pill strong">🗓️ {period.label}</span>
            <span className="hx-pill">👥 {scopeLabel}</span>
            <span className="hx-pill">{dash.workDays.length} working day{dash.workDays.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="hx-hero-r">
          <span className="hx-live"><i />{loading ? 'Refreshing…' : 'Live data'}</span>
          <div className="hx-hero-stats">
            <div className="hx-hstat"><span>📝 Reports up to</span><b>{dash.lastReport ? fmtSh(dash.lastReport) : '—'}</b><small>Daily reports</small></div>
            <div className="hx-hstat"><span>🕘 Attendance up to</span><b>{dash.lastKeka ? fmtSh(dash.lastKeka) : '—'}</b><small>{dash.lastKeka ? 'Keka import' : 'No Keka import yet'}</small></div>
            <button type="button" className="hx-hstat btn" onClick={() => setReload(r => r + 1)} title="Load the latest numbers"><span>↻ Refresh</span><b>{dash.people.length}</b><small>people shown</small></button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="hx-filters">
        <Segmented label="Period" options={MODES} value={mode} onChange={setMode} />
        {mode === 'months'
          ? <MonthPicker months={allMonths} value={months} onChange={setMonths} quick={monthQuickPicks(allMonths)} label={period.label} />
          : (
            <div className="hx-datestep">
              <button type="button" className="btn-sm" onClick={() => shiftDate(-1)} aria-label={`Previous ${mode}`}>◀</button>
              <input type="date" value={date} max={todayStr} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" />
              <button type="button" className="btn-sm" onClick={() => shiftDate(1)} disabled={date >= todayStr} aria-label={`Next ${mode}`}>▶</button>
            </div>
          )}
        <label className="hx-f"><span>Process</span>
          <select value={proc} onChange={e => setProc(e.target.value)}><option value="ALL">All</option>{procOptions.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        {teamOptions.length > 0 && (
          <label className="hx-f"><span>Team</span>
            <select value={team} onChange={e => setTeam(e.target.value)}><option value="ALL">All</option>{teamOptions.map(o => <option key={o}>{o}</option>)}</select>
          </label>
        )}
        <label className="hx-f"><span>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
        </label>
        <label className="hx-f"><span>Person</span>
          <select value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Whole team</option>
            {[...people].sort((a, b) => a.name.localeCompare(b.name)).map(u => <option key={u.emp_id} value={u.emp_id}>{u.name}</option>)}
          </select>
        </label>
        {isFiltered && <button type="button" className="hx-clear" onClick={clearFilters}>↺ Clear</button>}
        <span className="hx-f-right">{fmtD(period.from)}{period.to !== period.from ? ` – ${fmtD(period.to)}` : ''}</span>
      </div>

      {!dash.workDays.length && <div className="card hx-note">No working days in this period (weekend or holiday). Pick another date.</div>}

      {/* Summary card */}
      <section className="hx-entity">
        <div className="hx-entity-l">
          <div className="hx-entity-who">
            {p ? <Avatar name={p.name} size={60} /> : <span className="hx-team-ico" aria-hidden="true">👥</span>}
            <div>
              <div className="hx-kicker2">{p ? `Employee ${p.emp_id}` : scopeLabel}</div>
              <h2>{p ? p.name : `${people.length} employee${people.length === 1 ? '' : 's'}`}</h2>
              <div className="hx-sub">{p ? `${p.team ? `${p.team} · ` : ''}${p.procs}` : (proc === 'ALL' ? 'All processes' : proc)} · {period.label}</div>
            </div>
          </div>
          <div className="hx-badges">
            <Badge label="Prod %" value={fmtPct(now.prod)} tone={prodTone(now.prod)} onClick={drills.achieved} />
            <Badge label="Quality %" value={fmtPct(now.quality)} tone={qualTone(now.quality)} onClick={drills.quality} />
            <Badge label="Shrinkage" value={fmtPct(now.shrinkage)} tone={shrinkTone(now.shrinkage)} onClick={drills.leave} />
            {p && p.rank && <Badge rank label="Prod rank" value={`${p.rank}/${people.filter(x => x.rank).length}`} />}
          </div>
          {p && <button type="button" className="hx-back" onClick={() => setPerson('')}>← Back to the whole team</button>}
        </div>
        <div className="hx-tiles">
          <StatTile label="Achieved" value={now.achieved.toLocaleString()} sub={`of ${now.target.toLocaleString()} target`} trend={trend('achieved')} compare={compareOf(now.prod, prev.prod)} onClick={drills.achieved} />
          <StatTile label="Reports missing" value={people.length ? (p ? p.missing : people.reduce((s, u) => s + u.missing, 0)) : 0} sub={`${now.reports} submitted`} tone={(p ? p.missing : people.some(u => u.missing)) ? 'warn' : 'good'} onClick={drills.missing} />
          <StatTile label="QA audits" value={qaReady ? now.audited : '—'} sub={qaReady ? `Avg score ${fmtPct(now.auditScore)}` : 'QA Audits not set up'} onClick={qaReady && now.audited ? drills.audits : undefined} />
          <StatTile label="Fatal errors" value={qaReady ? now.fatal : '—'} sub={qaReady ? 'In QA audits' : '—'} tone={qaReady && now.fatal ? 'bad' : undefined} compare={qaReady ? compareOf(now.fatal, prev.fatal, true) : null} onClick={qaReady && now.fatal ? drills.audits : undefined} />
          <StatTile label="Present days" value={fmtNum(now.present)} sub={dash.focusSize > 1 ? `Avg ${fmtNum(now.present / dash.focusSize)} / person` : 'Half-day = ½'} trend={trend('present')} onClick={drills.present} />
          <StatTile label="Leave days" value={fmtNum(now.leave)} sub="Planned / CSL / half-days" trend={trend('leave')} compare={compareOf(now.leave, prev.leave, true)} onClick={drills.leave} />
          <StatTile label="Absent days" value={fmtNum(now.absent)} sub="No leave type" tone={now.absent ? 'bad' : undefined} compare={compareOf(now.absent, prev.absent, true)} onClick={drills.absent} />
          <StatTile label="Late logins" value={now.late} sub="Click for dates" trend={trend('late')} tone={now.late ? 'warn' : undefined} compare={compareOf(now.late, prev.late, true)} onClick={drills.late} />
          <StatTile label="Break over limit" value={now.breakOver} sub="Days" trend={trend('breakOver')} compare={compareOf(now.breakOver, prev.breakOver, true)} onClick={drills.breaks} />
          <StatTile label="Short days" value={now.short} sub="Under 8:00" compare={compareOf(now.short, prev.short, true)} onClick={drills.short} />
          <StatTile label="Avg hrs / day" value={fmtHm(now.avgHours)} sub="Target 8:00" tone={now.avgHours == null ? undefined : now.avgHours >= 8 ? 'good' : 'warn'} trend={trend('avgHours')} compare={compareOf(now.avgHours, prev.avgHours)} onClick={drills.hours} />
          <StatTile label="Calls" value={now.calls.toLocaleString()} sub={`${fmtNum(now.callHours)} call hours`} trend={trend('calls')} compare={compareOf(now.calls, prev.calls)} onClick={drills.calls} />
        </div>
        <div className="hx-cmp-note">▲▼ = better / worse than the previous {mode === 'day' ? 'working day' : mode === 'week' ? 'week' : `${months.length > 1 ? `${months.length} months` : 'month'}`}</div>
      </section>

      {/* Dark chart panel */}
      <Panel>
        <Glass wide>
          <PanelTabs tabs={TABS} value={tab} onChange={setTab} badge={`By ${bucketWord} · click a ${bucketWord} for its records`} />
          {tab === 'prod' && <>
            <TrendChart data={buckets} pillKey="prodPct" onPick={drills.bucket}
              series={[{ key: 'target', label: 'Target', type: 'bar', color: '#94a3b8', ghost: true }, { key: 'achieved', label: 'Achieved', type: 'bar', color: NEON[0] }]} />
            <Legend items={[['Achieved', NEON[0]], ['Target', '#94a3b8', true], ['% = achieved ÷ target', 'transparent']]} />
          </>}
          {tab === 'qual' && <>
            <TrendChart data={buckets} refY={QUAL_GOOD} yMax={100} onPick={drills.bucket}
              series={[{ key: 'quality', label: 'Quality %', color: NEON[3], unit: '%' }, ...(qaReady ? [{ key: 'auditScore', label: 'QA audit score', color: NEON[1], dashed: true, unit: '%' }] : [])]} />
            <Legend items={[['Quality %', NEON[3]], ...(qaReady ? [['QA audit score', NEON[1], true]] : []), [`Goal ${QUAL_GOOD}%`, 'rgba(255,255,255,.5)', true]]} />
          </>}
          {tab === 'att' && <>
            <TrendChart data={buckets} onPick={drills.bucket}
              series={[{ key: 'present', label: 'Present', type: 'bar', color: NEON[4] }, { key: 'leave', label: 'Leave', type: 'bar', color: NEON[2] },
                { key: 'absent', label: 'Absent', type: 'bar', color: NEON[5] }, { key: 'late', label: 'Late logins', color: NEON[3], axis: 'right', dashed: true }]} />
            <Legend items={[['Present', NEON[4]], ['Leave', NEON[2]], ['Absent', NEON[5]], ['Late logins (right scale)', NEON[3], true]]} />
            {!dash.lastKeka && <Empty>No Keka attendance imported for this period — import it on the Attendance (Keka) page.</Empty>}
          </>}
          {tab === 'calls' && <>
            <TrendChart data={buckets} onPick={drills.bucket}
              series={[{ key: 'calls', label: 'Calls', type: 'bar', color: NEON[0] }, { key: 'callHours', label: 'Call hours', color: NEON[2], axis: 'right', unit: 'h' }]} />
            <Legend items={[['Calls', NEON[0]], ['Call hours (right scale)', NEON[2]]]} />
          </>}
        </Glass>

        <Glass title="Work mix" sub={`Achieved by process · ${period.label}`}>
          <Donut data={mixData} center={now.achieved.toLocaleString()} caption="achieved" />
        </Glass>

        <Glass wide title="Process heat" sub={`Prod % by process, ${bucketWord} by ${bucketWord}`} right={<HeatLegend />}>
          <HeatGrid columns={buckets.map(b => b.label)} rows={dash.heat} tone={prodTone} />
        </Glass>

        <Glass title="⚠️ Needs attention" sub="This period · click a name">
          {dash.watch.length ? (
            <ul className="hx-watch">
              {dash.watch.slice(0, 8).map(w => (
                <li key={w.emp_id}><button type="button" onClick={() => pickPerson(w.emp_id)}>
                  <Avatar name={w.name} size={26} /><span><b>{w.name}</b><small>{w.why.join(' · ')}</small></span>
                </button></li>
              ))}
              {dash.watch.length > 8 && <li className="hx-more">+{dash.watch.length - 8} more — sort the table below</li>}
            </ul>
          ) : <Empty>Everyone is on track 🎉</Empty>}
        </Glass>

        <Glass title="🏆 Productivity ranking" sub="Prod % · click a name">
          <BarList rows={people.filter(u => u.prod != null).sort((a, b) => b.prod - a.prod).map(u => ({ key: u.emp_id, name: u.name, value: u.prod }))}
            fmt={fmtPct} max={Math.max(PROD_GOOD * 1.2, ...people.map(u => u.prod ?? 0))} color={v => TONE_HEX[prodTone(v)]} onRowClick={r => pickPerson(r.key)} />
        </Glass>

        <Glass title="⭐ Quality ranking" sub="Quality % · click a name">
          <BarList rows={people.filter(u => u.quality != null).sort((a, b) => b.quality - a.quality).map(u => ({ key: u.emp_id, name: u.name, value: u.quality }))}
            fmt={fmtPct} max={100} color={v => TONE_HEX[qualTone(v)]} onRowClick={r => pickPerson(r.key)} />
        </Glass>

        <Glass title="🚩 Flags by employee" sub="Late, long breaks, short days">
          <HBars rows={[...people].sort((a, b) => (b.late + b.breakOver + b.short) - (a.late + a.breakOver + a.short)).map(u => ({ key: u.emp_id, ...u }))}
            series={[['late', 'Late', NEON[5]], ['breakOver', 'Break over', NEON[2]], ['short', 'Under 8:00', NEON[3]]]} onRowClick={r => pickPerson(r.key)} />
          <MiniStats items={[{ label: 'Late', value: now.late, onClick: drills.late }, { label: 'Break over', value: now.breakOver, onClick: drills.breaks }, { label: 'Avg hrs', value: fmtHm(now.avgHours), onClick: drills.hours }]} />
        </Glass>
      </Panel>

      {/* Team members */}
      <div className="card hx-team">
        <div className="card-header">
          <div><div className="card-title">Team members</div><div className="text-muted text-sm">Click a column to sort · click a person to see their dashboard</div></div>
          <button type="button" className="btn-sm" onClick={exportTeam} disabled={!people.length}>⬇ Excel</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {th('name', 'Employee')}<th>Process</th>
                {th('prod', 'Prod %')}<th className="hx-hide-sm" />
                {th('quality', 'Quality %')}{th('achieved', 'Achieved', true)}{th('missing', 'Missing', true)}
                {th('present', 'Present', true)}<th className="right">Leave / Absent</th>{th('late', 'Late', true)}
                {th('hours', 'Avg hrs', true)}{th('calls', 'Calls', true)}
              </tr>
            </thead>
            <tbody>
              {sorted.map(u => (
                <tr key={u.emp_id} className={`hx-row${person === u.emp_id ? ' on' : ''}`} onClick={() => pickPerson(u.emp_id)}>
                  <td><span className="hx-who"><Avatar name={u.name} size={26} /><span>{u.name}<small>{u.emp_id}{u.team ? ` · ${u.team}` : ''}</small></span></span></td>
                  <td className="text-muted text-sm">{u.procs}</td>
                  <td><Chip tone={prodTone(u.prod)}>{fmtPct(u.prod)}</Chip></td>
                  <td className="hx-hide-sm" style={{ width: 120 }}><Meter value={u.prod} tone={prodTone(u.prod)} /></td>
                  <td><Chip tone={qualTone(u.quality)}>{fmtPct(u.quality)}</Chip></td>
                  <td className="right">{u.achieved.toLocaleString()}</td>
                  <td className="right">{u.missing ? <Chip tone="warn">{u.missing}</Chip> : '0'}</td>
                  <td className="right">{fmtNum(u.present)}</td>
                  <td className="right">{fmtNum(u.leave)} / {fmtNum(u.absent)}</td>
                  <td className="right">{u.late ? <Chip tone={u.late >= 3 ? 'bad' : 'warn'}>{u.late}</Chip> : '0'}</td>
                  <td className="right">{fmtHm(u.avgHours)}</td>
                  <td className="right">{u.calls.toLocaleString()}</td>
                </tr>
              ))}
              {!sorted.length && <tr><td colSpan={12} className="center text-muted" style={{ padding: 28 }}>No employees match these filters</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {drill && <DrillModal spec={drill} onClose={() => setDrill(null)} onExport={exportNow} />}
    </div>
  );
}
