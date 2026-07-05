import * as XLSX from 'xlsx';
import { DEFAULT_TASKS, SHIFT_H, LEGACY_AUTH_CUTOFF, LEAVE_STATUSES, HALF_DAY_STATUSES, DEF_PROCS, DEFAULT_PROJECT, HOURLY_SLOTS_STD, HOURLY_SLOTS_DST } from './constants.js';
import { kv, S } from './supabase.js';

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

// Local Y/M/D components, not toISOString() — toISOString() converts to UTC first,
// which silently rolls the date back a day for anyone in a timezone ahead of UTC (e.g. IST).
function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

export function getMon(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return ymd(new Date(y, m - 1, d + diff));
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

/**
 * Hourly tracker slot labels, admin-toggled in Settings (kv key 'shift_dst')
 * for the US Daylight Saving Time switchover. Unset/true = DST (shift starts
 * 6:30 PM IST); false = standard time (shift starts 5:30 PM IST).
 */
export async function getHourlySlots() {
  const dst = await kv.get('shift_dst');
  return dst === false ? HOURLY_SLOTS_STD : HOURLY_SLOTS_DST;
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

/** Resize/compress an image file client-side before upload, returns a Blob. */
export function resizeImage(file, maxSize = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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
    // Accept any process name — including custom ones not in DEFAULT_TASKS
    const valid = user.processes.filter(p => p && p !== 'ALL');
    if (valid.length > 0) return valid;
    if (user.processes.includes('ALL')) return DEF_PROCS;
  }
  const proc = user?.process || user?.access;
  if (!proc || proc === 'ALL') return DEF_PROCS;
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

// ── Supervisor team scoping, permissions, and audit log ────────────────────────

export const DEFAULT_SUPERVISOR_PERMS = {
  resetPassword:  true,
  bypassDeadline: true,
  editCounts:     true,
  editQuality:    true,
  pinEmployee:    true,
};

/** Synchronous — permissions ride along on the already-loaded user object, per person. */
export function permsFor(user) {
  return { ...DEFAULT_SUPERVISOR_PERMS, ...(user?.permissions || {}) };
}

/** All sub-process names belonging to a project: built-ins for the default project, plus any custom rows tagged with it. */
export function subProcessesOf(project, customProcs = []) {
  const custom = (customProcs ?? []).filter(p => (p.project ?? DEFAULT_PROJECT) === project).map(p => p.name);
  return project === DEFAULT_PROJECT ? [...new Set([...DEF_PROCS, ...custom])] : custom;
}

/**
 * Restricts a user list to a scoped role's team.
 * - supervisor: union of individually picked employees (supervisor_ids) and whole
 *   sub-processes they've been assigned (supervised_processes).
 * - manager: whole projects they've been assigned (supervised_projects), each project
 *   resolving to every sub-process under it — empty or ['ALL'] means unrestricted.
 * - admin/employee: passthrough, sees everyone.
 */
export function scopeToSupervisor(users, currentUser, customProcs = []) {
  if (currentUser?.role === 'manager') {
    const projects = currentUser.supervised_projects ?? [];
    if (projects.length === 0 || projects.includes('ALL')) return users;
    const allowedProcs = new Set(projects.flatMap(p => subProcessesOf(p, customProcs)));
    return (users || []).filter(u => getProcs(u).some(p => allowedProcs.has(p)));
  }
  if (currentUser?.role !== 'supervisor') return users;
  const watchedProcs = currentUser.supervised_processes ?? [];
  return (users || []).filter(u =>
    u.supervisor_ids?.includes(currentUser.emp_id) ||
    getProcs(u).some(p => watchedProcs.includes(p))
  );
}

/** Fire-and-forget — records who did what to whom, for the admin audit log. */
export function logAudit({ actor, action, targetEmpId = null, targetName = null, details = null }) {
  S.set('audit_log', {
    actor_emp_id: actor?.emp_id,
    actor_name:   actor?.name ?? actor?.emp_id,
    actor_role:   actor?.role,
    action,
    target_emp_id: targetEmpId,
    target_name:   targetName,
    details,
    created_at: new Date().toISOString(),
  }).catch(() => {});
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

/**
 * Resolves a user's daily target for a given date, accounting for an
 * admin-defined ramp-up schedule (ramp_schedule[0] = week 1, etc.).
 * Falls back to the flat `target` field before the ramp starts, once it
 * runs out, or when ramp-up isn't enabled.
 */
export function effectiveTarget(user, dateStr) {
  const flat = parseInt(user?.target) || 50;
  if (!user?.ramp_enabled || !Array.isArray(user?.ramp_schedule) || !user.ramp_schedule.length || !user?.ramp_start_date) {
    return flat;
  }
  const weeksElapsed = Math.floor((new Date(dateStr) - new Date(user.ramp_start_date)) / (7 * 86400000));
  if (weeksElapsed < 0 || weeksElapsed >= user.ramp_schedule.length) return flat;
  return parseInt(user.ramp_schedule[weeksElapsed]) || flat;
}

/** True if a daily log represents an approved/self-marked absence */
export function isOnLeave(log) {
  return !!log && LEAVE_STATUSES.includes(log.attendance_status);
}

/** True if user works on the AUTH process */
export function userIsAuth(user) {
  return procIncludes(user, 'AUTH');
}

// ── Team Feed: friendship helpers ──────────────────────────────────────────────

/** True if a and b have an accepted friend_requests row in either direction */
export function isFriend(a, b, requestRows) {
  if (a === b) return false;
  return (requestRows ?? []).some(r =>
    r.status === 'accepted' &&
    ((r.from_emp_id === a && r.to_emp_id === b) || (r.from_emp_id === b && r.to_emp_id === a))
  );
}

/** True if owner has marked friendId as a close friend */
export function isCloseFriend(owner, friendId, closeRows) {
  return (closeRows ?? []).some(r => r.owner_emp_id === owner && r.friend_emp_id === friendId);
}

/** True if viewer is allowed to see a post by author, given its visibility */
export function canViewPost(post, viewerEmpId, requestRows, closeRows) {
  if (post.emp_id === viewerEmpId) return true;
  if (post.visibility === 'public') return true;
  if (post.visibility === 'friends') return isFriend(post.emp_id, viewerEmpId, requestRows);
  if (post.visibility === 'close_friends') return isCloseFriend(post.emp_id, viewerEmpId, closeRows);
  return false;
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

// ── Excel/CSV import ──────────────────────────────────────────────────────────

// Parses an uploaded .xlsx/.xls/.csv file, auto-detecting the header row by
// scanning the first 15 rows for the one with the most non-empty cells.
export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const scan = all.slice(0, 15);
        let headerIdx = 0, maxCells = 0;
        scan.forEach((row, i) => {
          const cnt = row.filter(v => v !== '' && v !== null && v !== undefined).length;
          if (cnt > maxCells) { maxCells = cnt; headerIdx = i; }
        });
        const headers = all[headerIdx].map(h => String(h ?? '').trim()).filter(Boolean);
        const rows = all.slice(headerIdx + 1)
          .filter(r => r.some(v => v !== '' && v !== null && v !== undefined))
          .map(r => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
            return obj;
          });
        resolve({ headers, rows });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
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
