// 📈 Team Dashboard (PO request 2026-10-29): productivity, quality, attendance and calls for the team or one person,
// for a day, a week or one or more months. Look taken from the PO's sample kit, rebuilt with our own CSS / SVG.
// Reads only data that already exists (daily_logs incl. the Keka attendance fields, holidays, users, processes,
// qa_audits). No patient data anywhere. No database change.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { addDays, getMon, isWknd, fmtSh, avg, getProcs, scopeToSupervisor, procIncludes, logMatchesProc } from './helpers';
import { HALF_DAY_STATUSES, SHIFT_H } from './constants';

// Colour thresholds (also used for the chips and heat grid)
export const PROD_GOOD = 100, PROD_WARN = 75;        // same bands as the rest of Helix Hub (pCol)
export const QUAL_GOOD = 98, QUAL_WARN = 95;
export const SHRINK_GOOD = 5, SHRINK_WARN = 10;      // %, lower is better
export const LATE_FLAG = 3;                          // late logins in the period that put someone on the watch list
export const NEON = ['#4f8bff', '#22d3ee', '#a78bfa', '#fbbf24', '#34d399', '#fb7185', '#f472b6', '#60a5fa'];
export const TONE_HEX = { good: '#34d399', warn: '#fbbf24', bad: '#f87171', none: '#94a3b8' };

/** 'good' | 'warn' | 'bad' | 'none' — for chips, tiles and heat cells. */
export function toneOf(v, good, warn, lowerIsBetter = false) {
  if (v == null || Number.isNaN(v)) return 'none';
  if (lowerIsBetter) return v <= good ? 'good' : v <= warn ? 'warn' : 'bad';
  return v >= good ? 'good' : v >= warn ? 'warn' : 'bad';
}
export const prodTone = v => toneOf(v, PROD_GOOD, PROD_WARN);
export const qualTone = v => toneOf(v, QUAL_GOOD, QUAL_WARN);
export const shrinkTone = v => toneOf(v, SHRINK_GOOD, SHRINK_WARN, true);

export const fmtPct = v => (v == null ? '—' : `${Math.round(v * 10) / 10}%`);
export const fmtNum = v => (v == null ? '—' : Math.round(v * 10) / 10).toLocaleString();
/** 7.5 → "7:30" */
export const fmtHm = h => {
  if (h == null) return '—';
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// ── Periods ───────────────────────────────────────────────────────────────────

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = ym => `${MONTH_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const qOf = ym => `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;

/** The last `n` months up to the given date, oldest first ('YYYY-MM'). */
export function recentMonths(todayStr, n = 12) {
  const [y, m] = todayStr.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** Quick picks for the month picker: each quarter (full or so far), last 3 months, last 12 months. */
export function monthQuickPicks(months) {
  const byQ = new Map();
  months.forEach(ym => byQ.set(qOf(ym), [...(byQ.get(qOf(ym)) ?? []), ym]));
  const qs = [...byQ].slice(-4).map(([q, ms]) => ({ label: `Q${q.slice(-1)} ${q.slice(0, 4)}${ms.length < 3 ? ' (so far)' : ''}`, months: ms }));
  return [...qs, { label: 'Last 3 months', months: months.slice(-3) }, { label: 'Last 12 months', months: [...months] }];
}

export function monthsLabel(months) {
  if (!months.length) return '';
  if (months.length === 1) return monthLabel(months[0]);
  const s = ym => MONTH_SHORT[Number(ym.slice(5, 7)) - 1];
  const q = qOf(months[0]);
  if (months.length === 3 && months.every(m => qOf(m) === q)) return `Q${q.slice(-1)} ${q.slice(0, 4)} (${s(months[0])} – ${s(months[2])})`;
  const a = months[0], b = months.at(-1);
  return `${s(a)}${a.slice(0, 4) === b.slice(0, 4) ? '' : ` ${a.slice(0, 4)}`} – ${s(b)} ${b.slice(0, 4)} (${months.length} months)`;
}

const lastDayOf = ym => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const ymShift = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const datesBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/**
 * Period → { from, to, label, prev: { from, to } }. mode: 'day' (date), 'week' (date → its Mon–Sun) or
 * 'months' (['YYYY-MM', …], may skip months — the range covers first to last). Never runs past today.
 */
export function periodOf(mode, { date, months }, todayStr) {
  if (mode === 'day') {
    let prev = addDays(date, -1);
    while (isWknd(prev)) prev = addDays(prev, -1);
    return { from: date, to: date, label: fmtSh(date), prev: { from: prev, to: prev } };
  }
  if (mode === 'week') {
    const mon = getMon(date);
    const sun = addDays(mon, 6);
    return { from: mon, to: sun < todayStr ? sun : todayStr, label: `Week of ${fmtSh(mon)}`, prev: { from: addDays(mon, -7), to: addDays(mon, -1) } };
  }
  const sorted = [...months].sort();
  const end = lastDayOf(sorted.at(-1));
  const span = sorted.length;
  return {
    from: `${sorted[0]}-01`, to: end < todayStr ? end : todayStr, label: monthsLabel(sorted), months: sorted,
    prev: { from: `${ymShift(sorted[0], -span)}-01`, to: lastDayOf(ymShift(sorted[0], -1)) },
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────

/** Supabase returns at most 1,000 rows per request — page through a ranged query. */
async function fetchRange(table, dateCol, from, to, extra = q => q) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await extra(db(table).select('*').gte(dateCol, from).lte(dateCol, to)).range(start, start + 999);
    if (error) return start === 0 ? null : out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Everything the page needs for the period and the one before it (for the better / worse arrows). */
export async function loadDashboard(period) {
  const from = period.prev.from < period.from ? period.prev.from : period.from;
  const [users, holidays, processes, logs, audits] = await Promise.all([
    S.get('users'), S.get('holidays'), S.get('processes'),
    fetchRange('daily_logs', 'date', from, period.to),
    // QA audits arrive with the 7.1 migration; null = not set up (tiles say so)
    fetchRange('qa_audits', 'work_date', from, period.to, q => q.in('status', ['sent', 'acknowledged', 'disputed', 'resolved']).eq('active', true)),
  ]);
  return { users: users ?? [], holidays: holidays ?? [], processes: processes ?? [], logs: logs ?? [], audits };
}

export function logDashboardView(user, period) {
  logAudit({ actor: user, action: 'team_dashboard_view', entityType: 'report', details: { report: 'team_dashboard', from: period.from, to: period.to } });
}

// ── Calculations ──────────────────────────────────────────────────────────────

const pctOf = (total, target) => (target ? (total / target) * 100 : null);
const targetOf = l => l.adj_target ?? l.target;
const isHalf = l => HALF_DAY_STATUSES.includes(l.attendance_status);
const hasKeka = l => !!l.keka_imported_at || !!l.attendance_status;

/** "18:05" / "6:05 PM" / "2026-10-28T18:05" → minutes after midnight, or null. */
function minutesOf(t) {
  const m = /(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i.exec(String(t ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.[0]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

/** Login → logout in hours (night shifts that cross midnight handled), minus breaks when known. */
export function hoursOf(l) {
  const a = minutesOf(l.login_time), b = minutesOf(l.logout_time);
  if (a == null || b == null) return null;
  const span = (b - a + 1440) % 1440;
  if (!span) return null;
  return Math.max(0, span - (Number(l.break_minutes) || 0)) / 60;
}

/** One day's attendance for one log: present / leave / absent weights (half-day = half present, half leave). */
function attendanceOf(l) {
  const s = l.attendance_status;
  if (s === 'present') return { present: 1, leave: 0, absent: 0 };
  if (isHalf(l)) return { present: 0.5, leave: 0.5, absent: 0 };
  if (s === 'absent') return l.leave_type ? { present: 0, leave: 1, absent: 0 } : { present: 0, leave: 0, absent: 1 };
  return null;
}

/** Sums for a set of logs + audits. scheduled = person-days the team was expected to work (for shrinkage). */
function totals(logs, audits, scheduled) {
  const prodVals = logs.map(l => pctOf(l.total ?? 0, targetOf(l))).filter(v => v != null);
  const qualVals = logs.map(l => l.quality).filter(v => v != null);
  let present = 0, leave = 0, absent = 0, kekaDays = 0;
  const hours = [];
  let short = 0;
  for (const l of logs) {
    const a = hasKeka(l) ? attendanceOf(l) : null;
    if (!a) continue;
    kekaDays++;
    present += a.present; leave += a.leave; absent += a.absent;
    const h = hoursOf(l);
    if (h != null && a.present === 1) { hours.push(h); if (h < SHIFT_H) short++; }
  }
  const sched = scheduled ?? kekaDays;
  return {
    achieved: logs.reduce((s, l) => s + (l.total ?? 0), 0),
    target: logs.reduce((s, l) => s + (targetOf(l) ?? 0), 0),
    prod: avg(prodVals),                  // average of the daily Prod %, same as Weekly / Monthly
    quality: avg(qualVals),
    reports: logs.filter(l => l.submitted).length,
    present, leave, absent, kekaDays,
    shrinkage: sched ? ((leave + absent) / sched) * 100 : null,
    late: logs.filter(l => l.late_login).length,
    breakOver: logs.filter(l => l.break_exceed).length,
    short,
    avgHours: avg(hours),
    calls: logs.reduce((s, l) => s + (l.calls ?? 0), 0),
    callHours: logs.reduce((s, l) => s + (l.call_hours ?? 0), 0),
    audited: audits ? audits.length : null,
    auditScore: audits ? avg(audits.map(a => a.score).filter(v => v != null)) : null,
    fatal: audits ? audits.filter(a => a.fatal).length : null,
  };
}

/** Day buckets for up to 31 days, otherwise weeks (Mon) — for the trend charts and heat grid. */
function bucketsFor(workDays) {
  if (workDays.length <= 31) return workDays.map(d => ({ key: d, label: fmtSh(d), days: [d] }));
  const byWeek = new Map();
  workDays.forEach(d => { const w = getMon(d); byWeek.set(w, [...(byWeek.get(w) ?? []), d]); });
  return [...byWeek].map(([w, days]) => ({ key: w, label: fmtSh(w), days }));
}

/**
 * Everything the page shows. filters: { proc, team, status, person }.
 * Returns null-safe numbers; `people` is the visible team (before the person filter) with each person's totals.
 */
export function buildDashboard(data, period, filters, viewer) {
  const holidaySet = new Set(data.holidays.map(h => h.date));
  const workIn = (from, to) => datesBetween(from, to).filter(d => !isWknd(d) && !holidaySet.has(d));
  const workDays = workIn(period.from, period.to);
  const prevDays = workIn(period.prev.from, period.prev.to);
  const daySet = new Set(workDays), prevSet = new Set(prevDays);

  const team = scopeToSupervisor(data.users, viewer, data.processes).filter(u => {
    if (u.role !== 'employee') return false;
    if (filters.status === 'active' && u.active === false) return false;
    if (filters.status === 'inactive' && u.active !== false) return false;
    if (filters.proc !== 'ALL' && !procIncludes(u, filters.proc)) return false;
    if (filters.team !== 'ALL' && (u.team ?? '') !== filters.team) return false;
    return true;
  });
  const ids = new Set(team.map(u => u.emp_id));
  const nameOf = new Map(data.users.map(u => [u.emp_id, u.name ?? u.emp_id]));
  const inTeam = l => ids.has(l.emp_id) && logMatchesProc(l, filters.proc);
  const teamLogs = data.logs.filter(l => inTeam(l) && daySet.has(l.date));
  const teamPrevLogs = data.logs.filter(l => inTeam(l) && prevSet.has(l.date));
  const auditsIn = (set, who) => (data.audits ? data.audits.filter(a => set.has(a.work_date) && who(a.agent_emp_id)) : null);

  // Attendance is only counted on days a Keka file covered, so missing imports don't look like 0% shrinkage
  const kekaDaySet = new Set(teamLogs.filter(hasKeka).map(l => l.date));
  const lastKeka = [...kekaDaySet].sort().at(-1) ?? null;
  const lastReport = teamLogs.filter(l => l.submitted).map(l => l.date).sort().at(-1) ?? null;

  const people = team.map(u => {
    const mine = teamLogs.filter(l => l.emp_id === u.emp_id);
    const sched = [...kekaDaySet].length;
    const t = totals(mine, auditsIn(daySet, id => id === u.emp_id), sched);
    const missing = workDays.filter(d => d <= period.to && !mine.some(l => l.date === d && l.submitted)).length;
    return { ...u, name: u.name ?? u.emp_id, procs: getProcs(u).join(', '), ...t, missing, logs: mine };
  });
  // Rank by Prod % (people with no data last)
  [...people].sort((a, b) => (b.prod ?? -1) - (a.prod ?? -1)).forEach((p, i) => { p.rank = p.prod == null ? null : i + 1; });

  const person = filters.person ? people.find(p => p.emp_id === filters.person) ?? null : null;
  const focusIds = person ? new Set([person.emp_id]) : ids;
  const logs = person ? person.logs : teamLogs;
  const prevLogs = person ? teamPrevLogs.filter(l => l.emp_id === person.emp_id) : teamPrevLogs;
  const scheduledNow = [...kekaDaySet].length * focusIds.size;
  const prevKekaDays = new Set(prevLogs.filter(hasKeka).map(l => l.date)).size;
  const now = totals(logs, auditsIn(daySet, id => focusIds.has(id)), scheduledNow);
  const prev = totals(prevLogs, auditsIn(prevSet, id => focusIds.has(id)), prevKekaDays * focusIds.size);

  // Trend buckets
  const buckets = bucketsFor(workDays).map(b => {
    const set = new Set(b.days);
    const bl = logs.filter(l => set.has(l.date));
    const kd = new Set(bl.filter(hasKeka).map(l => l.date)).size;
    const t = totals(bl, auditsIn(set, id => focusIds.has(id)), kd * focusIds.size);
    return { ...b, ...t, prodPct: t.target ? Math.round(pctOf(t.achieved, t.target) * 10) / 10 : null };
  });

  // Heat grid: process × bucket, Prod %
  const procs = [...new Set(team.flatMap(u => getProcs(u)))].filter(p => filters.proc === 'ALL' || p === filters.proc);
  const heat = procs.map(p => ({
    key: p, label: p,
    cells: buckets.map(b => {
      const set = new Set(b.days);
      return avg(logs.filter(l => set.has(l.date) && logMatchesProc(l, p)).map(l => pctOf(l.total ?? 0, targetOf(l))).filter(v => v != null));
    }),
  })).filter(r => r.cells.some(v => v != null));

  // Work mix: achieved by process
  const mix = procs.map(p => ({ name: p, value: logs.filter(l => logMatchesProc(l, p)).reduce((s, l) => s + (l.total ?? 0), 0) }))
    .filter(m => m.value > 0);

  // Watch list: people who need a look this period
  const watch = people.flatMap(p => {
    const why = [];
    if (p.prod != null && p.prod < PROD_WARN) why.push(`Prod ${fmtPct(p.prod)}`);
    if (p.quality != null && p.quality < QUAL_WARN) why.push(`Quality ${fmtPct(p.quality)}`);
    if (p.late >= LATE_FLAG) why.push(`${p.late} late logins`);
    if (p.fatal) why.push(`${p.fatal} fatal error${p.fatal > 1 ? 's' : ''}`);
    if (p.missing >= 2) why.push(`${p.missing} reports missing`);
    return why.length ? [{ emp_id: p.emp_id, name: p.name, why }] : [];
  });

  return {
    workDays, team, people, person, now, prev, buckets, heat, mix, watch, lastKeka, lastReport,
    nameOf, logs, audits: auditsIn(daySet, id => focusIds.has(id)),
    focusSize: focusIds.size,
  };
}

/** Better / worse than the previous period: { better: true|false|null, up } (null = no previous data). */
export function compareOf(nowV, prevV, lowerIsBetter = false) {
  if (nowV == null || prevV == null || nowV === prevV) return nowV != null && prevV != null ? { better: null } : null;
  const up = nowV > prevV;
  return { better: lowerIsBetter ? !up : up, up };
}

// ── Excel ─────────────────────────────────────────────────────────────────────

/** rows = [{ col: value }] already flattened. Names and numbers only — never patient data. */
export async function exportRows(user, title, rows, period) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No rows' }]), 'Details');
  const safe = title.replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'details';
  XLSX.writeFile(wb, `team-dashboard-${safe}-${period.from}-to-${period.to}.xlsx`);
  logAudit({ actor: user, action: 'team_dashboard_export', entityType: 'report', details: { report: 'team_dashboard', title, rows: rows.length, from: period.from, to: period.to } });
}
