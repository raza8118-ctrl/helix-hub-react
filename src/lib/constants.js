export const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec',
];

export const LEGACY_AUTH_CUTOFF = '2026-06-16';

export const LEAVE_STATUSES    = ['absent'];
export const HALF_DAY_STATUSES = ['half_day_1', 'half_day_2'];
export const ATTENDANCE_STATUSES = ['present', 'half_day_1', 'half_day_2', 'absent'];

export const LEAVE_TYPES = [
  { id: 'planned', label: 'Planned Leave' },
  { id: 'csl',      label: 'CSL' },
];

export const SHIFT_H = 8;

// Hourly tracker slot labels (IST clock times for a US-shift team).
// US observes Daylight Saving Time (mid-March to early November) — since the
// shift is pinned to US business hours, its IST-equivalent start time shifts
// by 1 hour between the two. Toggled in Settings, read via getHourlySlots().
export const HOURLY_SLOTS_STD = [
  '5:30 PM','6:30 PM','7:30 PM','8:30 PM','9:30 PM',
  '10:30 PM','11:30 PM','12:30 AM','1:30 AM',
];
export const HOURLY_SLOTS_DST = [
  '6:30 PM','7:30 PM','8:30 PM','9:30 PM','10:30 PM',
  '11:30 PM','12:30 AM','1:30 AM','2:30 AM',
];
// Default/fallback — matches the previous hardcoded behavior (DST labels).
export const HOURLY_SLOTS = HOURLY_SLOTS_DST;

export const AUTH_HOURLY_TASKS = [
  'Initial Request',
  'Additional Request',
  'Follow Up Accounts',
  'Approved Accounts',
  'Initial Approved',
  'Discharge-Transfer',
  'Denied Account',
];

export const ACCESSES = ['MCO', 'MCD', 'MCR', 'AUTH', 'ALL'];

// Functional teams (users.team). Separate from users.role, which is the permission
// level (employee / supervisor / manager / admin). QA is a flag (users.is_qa).
export const TEAMS = ['AR', 'Auth', 'Billing/Posting', 'Coding', 'Credentialing'];

// ── Keka import ───────────────────────────────────────────────────────────────
// Placeholders until real Keka export columns/rules are confirmed — Keka itself
// may already flag these per-row, in which case these thresholds go unused.
export const LATE_LOGIN_THRESHOLD = '09:15'; // shift start + grace period, 24h "HH:MM"
export const BREAK_LIMIT_MINUTES = 30;

// Column-mapping targets offered in the Keka import wizard (Dashboard.jsx).
export const KEKA_TARGET_FIELDS = [
  { id: 'emp_id',            label: 'Employee ID' },
  { id: 'date',              label: 'Date' },
  { id: 'attendance_status', label: 'Attendance Status' },
  { id: 'leave_type',        label: 'Leave Type' },
  { id: 'login_time',        label: 'Login Time' },
  { id: 'logout_time',       label: 'Logout Time' },
  { id: 'break_minutes',     label: 'Break Minutes' },
  { id: 'late_login',        label: 'Late Login (Y/N)' },
  { id: 'break_exceed',      label: 'Break Exceeded (Y/N)' },
  { id: 'ignore',            label: 'Ignore' },
];

// The current (and so far only) project's sub-processes — implicitly under project 'PMB'.
export const DEF_PROCS = ['MCO', 'MCD', 'MCR', 'AUTH'];
export const DEFAULT_PROJECT = 'PMB';

export const REACTIONS = [
  { id: 'like',  emoji: '👍' },
  { id: 'love',  emoji: '❤️' },
  { id: 'haha',  emoji: '😂' },
  { id: 'wow',   emoji: '😮' },
  { id: 'sad',   emoji: '😢' },
  { id: 'angry', emoji: '😠' },
];

export const POST_VISIBILITY = [
  { id: 'public',       label: 'Public' },
  { id: 'friends',      label: 'Friends' },
  { id: 'close_friends', label: 'Close Friends' },
];

export const PRIORITIES = [
  { id: 'low',    label: 'Low',    color: '#94a3b8' },
  { id: 'normal', label: 'Normal', color: '#3b82f6' },
  { id: 'high',   label: 'High',   color: '#f59e0b' },
  { id: 'urgent', label: 'Urgent', color: '#ef4444' },
];

export const FEED_BUCKET = 'feed-media';
export const GIPHY_API_KEY = 'O7xoQ2OykXwLJWW9WkTbfT6mOCmUC7NJ';

// Frost Glass themes (PO request 2026-11-06) — colours live in src/components/ui/themes.css (body class theme-<id>).
// bg / topbar / accent are only for the little swatches in the theme pickers.
export const THEMES = [
  { id: 'frost',    label: 'Frost',    bg: '#0a1120', topbar: '#14203a', accent: '#5EB8FF', dark: true,  blur: true },
  { id: 'daylight', label: 'Daylight', bg: '#eef1f9', topbar: '#ffffff', accent: '#4F46E5', dark: false, blur: true },
  { id: 'slate',    label: 'Slate',    bg: '#f4f5f7', topbar: '#0f1b2d', accent: '#0F766E', dark: false, blur: false },
  { id: 'violet',   label: 'Violet',   bg: '#110d20', topbar: '#221a3c', accent: '#A78BFA', dark: true,  blur: true },
];

/** Theme ids saved before 2026-11-06 → the nearest new theme (the saved value is only changed when the person picks again). */
const OLD_THEMES = {
  light: 'daylight', mist: 'daylight', rose: 'daylight', amber: 'daylight',
  dark: 'frost', dusk: 'frost', ocean: 'frost', forest: 'frost',
  highcontrast: 'slate',
};

/** Any saved theme id (new or old) → one of THEMES' ids; unknown → Frost. */
export function resolveTheme(id) {
  if (THEMES.some(t => t.id === id)) return id;
  return OLD_THEMES[id] ?? THEMES[0].id;
}

export const DEFAULT_TASKS = {
  MCO: [
    { name: 'Email',          target: 40 },
    { name: 'AR MCO Calling', target: 40 },
    { name: 'Review',         target: 80 },
    { name: 'Appeal',         target: 35 },
    { name: 'Denial',         target: 40 },
    { name: 'Rej(P)',         target: 80 },
    { name: 'Rej(W)',         target: 80 },
  ],
  MCD: [
    { name: 'Email',                      target: 45 },
    { name: 'AR MCO Calling',             target: 45 },
    { name: 'AR Medicaid Calling/Portal', target: 80 },
    { name: 'Review',                     target: 80 },
    { name: 'Appeal',                     target: 35 },
    { name: 'Denial',                     target: 80 },
    { name: 'Rej(P)',                     target: 80 },
    { name: 'Rej(W)',                     target: 80 },
  ],
  MCR: [
    { name: '5th Days NOA',             target: 480 },
    { name: 'NOA Status',               target: 50  },
    { name: 'Medicare RTP',             target: 50  },
    { name: 'NOE/NOA Handkey',          target: 40  },
    { name: 'Claim Handkey',            target: 20  },
    { name: 'Hospice Sequential Report',target: 90  },
    { name: 'Email',                    target: 50  },
    { name: 'AR Calling',               target: 50  },
    { name: 'AR Non Calling/Portal',    target: 90  },
    { name: 'Review',                   target: 220 },
    { name: 'Voice Mail',               target: 60  },
    { name: 'Appeal',                   target: 28  },
    { name: 'Denial',                   target: 35  },
    { name: 'Rej(P)',                   target: 60  },
    { name: 'Rej(W)',                   target: 120 },
  ],
  AUTH: [
    { name: 'Initial Request',    target: 50 },
    { name: 'Additional Request', target: 50 },
    { name: 'Follow Up Accounts', target: 50 },
    { name: 'Approved Accounts',  target: 50 },
    { name: 'Initial Approved',   target: 50 },
    { name: 'Discharge-Transfer', target: 50 },
    { name: 'Denied Account',     target: 50 },
  ],
};

// ── Company-specific built-ins ────────────────────────────────────────────────
// MCO/MCD/MCR/AUTH and their task lists belong to the home company (3Gen) only.
// Added companies start empty and define their own processes and tasks in
// Team → Process / Project Management and Settings. DEF_PROCS, DEFAULT_TASKS and
// ACCESSES are updated in place so every importer sees the active company's set.
const HOME_DEF_PROCS = [...DEF_PROCS];
const HOME_TASKS     = { ...DEFAULT_TASKS };
const HOME_ACCESSES  = [...ACCESSES];

export function applyCompanyBuiltins(isHome) {
  DEF_PROCS.splice(0, DEF_PROCS.length, ...(isHome ? HOME_DEF_PROCS : []));
  for (const k of Object.keys(DEFAULT_TASKS)) delete DEFAULT_TASKS[k];
  if (isHome) Object.assign(DEFAULT_TASKS, HOME_TASKS);
  ACCESSES.splice(0, ACCESSES.length, ...(isHome ? HOME_ACCESSES : ['ALL']));
}

// Added companies: their own process names fill the process filters (ALL stays last)
export function setCompanyProcessNames(names) {
  ACCESSES.splice(0, ACCESSES.length, ...new Set(names), 'ALL');
}
