import { DEFAULT_TASKS, SHIFT_H, LEGACY_AUTH_CUTOFF, LEAVE_STATUSES, HALF_DAY_STATUSES } from './constants.js';
import { kv } from './supabase.js';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Date helpers ──────────────────────────────────────────────────────────────

export function today() {
  const d = new Date();
  // Use local date components — critical for night shift (crosses UTC midnight)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** "01 Jan 2026" */
export function fmtD(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${String(d).padStart(2,'0')} ${MONTH_NAMES[m-1]} ${y}`;
}

/** "01 Jan" */
export function fmtSh(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-').map(Number);
  return `${String(d).padStart(2,'0')} ${MONTH_NAMES[m-1]}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.toISOString().slice(0, 10);
}

export function getMon(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(y, m - 1, d + diff).toISOString().slice(0, 10);
}

export function isWknd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/** Returns 5 working day strings starting from mondayStr */
export function wDays(mondayStr) {
  return Array.from({ length: 5 }, (_, i) => addDays(mondayStr, i));
}

/** Returns working days (Mon–Fri) in the given month */
export function mDays(year, month) {
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const d = String(i + 1).padStart(2, '0');
    return `${year}-${String(month).padStart(2, '0')}-${d}`;
  }).filter(s => !isWknd(s));
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** CSS color class string based on productivity % */
export function pCol(pct) {
  if (pct === null || pct === undefined) return 'col-neutral';
  if (pct >= 100) return 'col-green';
  if (pct >= 75)  return 'col-orange';
  return 'col-red';
}

/** Average of a numeric array, ignoring nulls */
export function avg(arr) {
  const valid = (arr || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Escape HTML special characters */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Process helpers ───────────────────────────────────────────────────────────

/** Returns MCO/MCD/MCR/AUTH from process string, or null */
export function getProcKey(process) {
  const valid = ['MCO', 'MCD', 'MCR', 'AUTH'];
  return valid.includes(process) ? process : null;
}

/** Returns array of process keys for a user object */
export function getProcs(user) {
  // user.processes array (TeamMgmt multi-select) takes priority
  if (Array.isArray(user?.processes) && user.processes.length > 0) {
    const valid = user.processes.filter(p => DEFAULT_TASKS[p]);
    if (valid.length > 0) return valid;
    if (user.processes.includes('ALL')) return ['MCO', 'MCD', 'MCR', 'AUTH'];
  }
  const proc = user?.process || user?.access;
  if (!proc || proc === 'ALL') return ['MCO', 'MCD', 'MCR', 'AUTH'];
  return [proc];
}

/** Joined process string for display */
export function procDisplay(user) {
  return getProcs(user).join(', ');
}

/** True if user's processes include the given filter */
export function procIncludes(user, filter) {
  return getProcs(user).includes(filter);
}

/** True if a saved log's (possibly comma-joined) process field includes the given process */
export function logMatchesProc(log, filterProc) {
  if (filterProc === 'ALL') return true;
  return (log?.process ?? '').split(',').map(s => s.trim()).includes(filterProc);
}

// ── Pinned employees (admin "watch closely" list, shared across admins) ───────

export async function getPinned() {
  const ids = await kv.get('pinned_emp_ids');
  return Array.isArray(ids) ? ids : [];
}

export async function togglePinned(empId, current) {
  const next = current.includes(empId) ? current.filter(id => id !== empId) : [...current, empId];
  await kv.set('pinned_emp_ids', next);
  return next;
}

/** Merges taskConfig with user's processes, returns deduped flat array (first-seen name wins) */
export function getTasksForUser(user, taskConfig = DEFAULT_TASKS) {
  const seen = new Set();
  return getProcs(user).flatMap(p =>
    (taskConfig[p] || []).map(t => ({ ...t, process: p }))
  ).filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

// ── Productivity calculation ──────────────────────────────────────────────────

/**
 * Weighted productivity formula.
 * Each task contributes count × (50 / task.target) to the weighted total.
 * AUTH process: raw claim count only, prod% = (total / 50) × 100.
 *
 * @param {Array}   tasks          - task definitions [{name, target}]
 * @param {Object}  counts         - {taskName: count}
 * @param {number}  overallTarget  - daily target (used for non-AUTH adj. target)
 * @param {number}  downtimeHours  - downtime in HOURS (not minutes)
 * @param {boolean} isAuth         - AUTH process flag
 * @returns {{ total, adjTarget, prodPct, deficit, deficitPct }}
 */
/**
 * Four-path productivity calculation (spec §4).
 * opts.attendanceStatus: 'present'|'half_day_1'|'half_day_2'|'full_leave'|'planned_leave'|'csl'|'absent'
 * opts.isLegacyAuth: true only for AUTH-only users with date < LEGACY_AUTH_CUTOFF
 * Weight is NEVER stored — always derived as 50/t.target (un-rounded float).
 */
export function calcProd(tasks, counts, overallTarget, downtimeHours, opts = {}) {
  const { attendanceStatus = 'present', isLegacyAuth = false } = opts;

  // PATH A — Leave: no calculation
  if (LEAVE_STATUSES.includes(attendanceStatus)) {
    return { total: 0, adjTarget: 0, prodPct: null, deficit: 0, deficitPct: null, isLeave: true, shiftHours: 0, baseTarget: 0 };
  }

  // Weighted total (same formula for all non-leave paths)
  let total = 0;
  for (const t of (tasks || [])) {
    total += (parseFloat(counts?.[t.name]) || 0) * (50 / t.target);
  }
  total = +total.toFixed(2);

  // PATH B — Legacy Auth (frozen historical behaviour)
  if (isLegacyAuth) {
    const prodPct = total > 0 ? +Math.min((total / 50) * 100, 999).toFixed(1) : 0;
    return { total, adjTarget: 50, prodPct, deficit: 0, deficitPct: 0, isLeave: false, shiftHours: SHIFT_H, baseTarget: 50 };
  }

  // PATH D — Half-day feeds PATH C with adjusted inputs
  const isHalfDay = HALF_DAY_STATUSES.includes(attendanceStatus);
  const shiftHours = isHalfDay ? 4.5 : SHIFT_H;
  const baseTarget = isHalfDay ? overallTarget * 0.5 : overallTarget;

  // PATH C — Standard
  const eff = Math.max(0, (shiftHours - (parseFloat(downtimeHours) || 0)) / shiftHours);
  const adjTarget = +(baseTarget * eff).toFixed(2);
  const prodPct   = adjTarget > 0 ? +((total / adjTarget) * 100).toFixed(1) : 0;

  // Half-day: prod% is measured against the halved target, but the deficit
  // shown is measured against the FULL day's target (flat, no downtime adjustment).
  const deficitBase = isHalfDay ? overallTarget : adjTarget;
  const deficit      = +(Math.max(0, deficitBase - total)).toFixed(2);
  const deficitPct   = deficitBase > 0 ? +(100 - (total / deficitBase) * 100).toFixed(1) : null;
  return { total, adjTarget, prodPct, deficit, deficitPct, isLeave: false, shiftHours, baseTarget };
}

/** True if user works on the AUTH process */
export function userIsAuth(user) {
  return procIncludes(user, 'AUTH');
}

// ── AI helper ─────────────────────────────────────────────────────────────────

export async function callAI(prompt, maxTokens = 1024, apiKey = null) {
  const key = apiKey || import.meta.env.VITE_ANTHROPIC_KEY;
  if (!key) throw new Error('NO_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Anthropic API error ${res.status}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text ?? '';
}

// ── CSV export ────────────────────────────────────────────────────────────────

export function dlCSV(headers, rows, filename = 'export.csv') {
  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
