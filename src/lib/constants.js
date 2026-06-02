export const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec',
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
    { name: 'Charges Posted',  target: 100 },
    { name: 'Claims Reviewed', target: 80  },
    { name: 'Denials Worked',  target: 40  },
    { name: 'Appeals Filed',   target: 20  },
  ],
  MCD: [
    { name: 'Charges Posted',   target: 100 },
    { name: 'Claims Reviewed',  target: 80  },
    { name: 'Denials Worked',   target: 40  },
    { name: 'Adjustments Made', target: 30  },
  ],
  MCR: [
    { name: 'Charges Posted',  target: 100 },
    { name: 'Claims Reviewed', target: 80  },
    { name: 'Denials Worked',  target: 40  },
    { name: 'Remits Posted',   target: 60  },
  ],
  AUTH: [
    { name: 'Initial Request',    target: 30 },
    { name: 'Additional Request', target: 20 },
    { name: 'Follow Up Accounts', target: 25 },
    { name: 'Approved Accounts',  target: 20 },
    { name: 'Initial Approved',   target: 15 },
    { name: 'Discharge-Transfer', target: 10 },
    { name: 'Denied Account',     target: 10 },
  ],
};
