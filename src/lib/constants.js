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

export const HOURLY_SLOTS = [
  '6:30 PM','7:30 PM','8:30 PM','9:30 PM','10:30 PM',
  '11:30 PM','12:30 AM','1:30 AM','2:30 AM',
];

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

export const FEED_BUCKET = 'feed-media';
export const GIPHY_API_KEY = 'dc6zaTOxFJmzC'; // Giphy public beta key — swap for your own in Settings later

export const THEMES = [
  { id: 'light',       label: 'Light',         bg: '#f5f6fa',  topbar: '#ffffff',  dark: false },
  { id: 'dark',        label: 'Dark',          bg: '#0f1117',  topbar: '#1a1d27',  dark: true  },
  { id: 'ocean',       label: 'Ocean Blue',    bg: '#0d1b2a',  topbar: '#1b2d45',  dark: true  },
  { id: 'forest',      label: 'Forest Green',  bg: '#0d1f12',  topbar: '#1a3320',  dark: true  },
  { id: 'rose',        label: 'Rose',          bg: '#fff5f7',  topbar: '#fff0f2',  dark: false },
  { id: 'slate',       label: 'Slate',         bg: '#1e2533',  topbar: '#252d3d',  dark: true  },
  { id: 'amber',       label: 'Amber',         bg: '#fffbf0',  topbar: '#fff8e6',  dark: false },
  { id: 'violet',      label: 'Violet',        bg: '#0f0d1a',  topbar: '#1a1530',  dark: true  },
  { id: 'highcontrast',label: 'High Contrast', bg: '#000000',  topbar: '#111111',  dark: true  },
];

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
