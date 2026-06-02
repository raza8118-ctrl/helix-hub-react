import { DEFAULT_TASKS, SHIFT_H } from './constants.js';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Date helpers ──────────────────────────────────────────────────────────────

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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
  if (pct >= 85)  return 'col-yellow';
  if (pct >= 70)  return 'col-orange';
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

/** Merges taskConfig with user's processes, returns flat array with process key */
export function getTasksForUser(user, taskConfig = DEFAULT_TASKS) {
  return getProcs(user).flatMap(p =>
    (taskConfig[p] || []).map(t => ({ ...t, process: p }))
  );
}

// ── Productivity calculation ──────────────────────────────────────────────────

/**
 * @param {Array}  tasks     - task definitions [{name, target}]
 * @param {Object} counts    - {taskName: count}
 * @param {number} target    - daily total target
 * @param {number} downtime  - downtime in minutes
 * @param {boolean} isAuth   - whether AUTH process
 * @returns {{ total, adjTarget, prodPct, deficit }}
 */
export function calcProd(tasks, counts, target, downtime, isAuth) {
  const shiftMins = SHIFT_H * 60;
  const effectiveMins = Math.max(0, shiftMins - (downtime || 0));
  const timeRatio = effectiveMins / shiftMins;
  const adjTarget = Math.round(target * timeRatio);

  const total = (tasks || []).reduce((sum, t) => sum + (Number(counts?.[t.name]) || 0), 0);

  const prodPct = adjTarget > 0 ? Math.round((total / adjTarget) * 100) : null;
  const deficit = Math.max(0, adjTarget - total);

  return { total, adjTarget, prodPct, deficit };
}

/** True if user works on the AUTH process */
export function userIsAuth(user) {
  return procIncludes(user, 'AUTH');
}

// ── AI helper ─────────────────────────────────────────────────────────────────

export async function callAI(prompt, maxTokens = 1024) {
  const key = import.meta.env.VITE_ANTHROPIC_KEY;
  if (!key) throw new Error('VITE_ANTHROPIC_KEY not configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
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
