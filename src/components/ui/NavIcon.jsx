// Line icons for the sidebar (Frost Glass, 2026-11-06). Drawn with currentColor so every theme colours them.
// A page without a line icon here keeps its emoji (passed as `fallback`), so new pages never lose their icon.

const P = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  calendar2: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M8 17h6" /></>,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2 1.5M9.5 2.5h5" /></>,
  layers: <><path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z" /><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" /></>,
  list: <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.75" cy="6.5" r="1" /><circle cx="4.75" cy="12" r="1" /><circle cx="4.75" cy="17.5" r="1" /></>,
  file: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5M9 13h6M9 16.5h4" /></>,
  edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="m14 7 3 3" /></>,
  trend: <><path d="M3.5 17 9 11.5l3.5 3.5 7.5-8" /><path d="M15 7h5v5" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.5A6.5 6.5 0 0 1 21.5 20" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M16.5 9a4 4 0 0 1 0 6" /></>,
  chat: <path d="M20.5 12a8 8 0 0 1-11.8 7L3.5 20.5 5 15.6A8 8 0 1 1 20.5 12z" />,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.75" /><path d="m20.5 16-5-5-8.5 8.5" /></>,
  scroll: <><path d="M8 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8" /><path d="M8 3.5a2 2 0 0 0-2 2v13a2 2 0 0 1-2 2h4M11 8h6M11 12h6M11 16h4" /></>,
  building: <><rect x="4.5" y="3.5" width="15" height="17" rx="1.5" /><path d="M9 7.5h1.5M13.5 7.5H15M9 11.5h1.5M13.5 11.5H15M10 20.5V16h4v4.5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" /></>,
  book: <path d="M5 4.5h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18.5a2 2 0 0 1 2-2h11" />,
  bookmark: <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />,
  shield: <path d="M12 3.5 19.5 6v6c0 4.5-3.2 7.5-7.5 8.5-4.3-1-7.5-4-7.5-8.5V6z" />,
  // Owner Command Center (2026-11-09)
  crown: <><path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" /><path d="M4.5 20.5h15" /></>,
  database: <><ellipse cx="12" cy="6" rx="7.5" ry="2.75" /><path d="M4.5 6v12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75V6M4.5 12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75" /></>,
  server: <><rect x="3.5" y="4" width="17" height="7" rx="1.75" /><rect x="3.5" y="13" width="17" height="7" rx="1.75" /><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" /></>,
  power: <><path d="M12 3.5v8" /><path d="M7 6.5a7.5 7.5 0 1 0 10 0" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4v4.5H15" /></>,
  alert: <><path d="M12 3.8 21 19.5H3z" /><path d="M12 10v4.2M12 17h.01" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  calc: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 7.5h7M8.5 12h1M12 12h1M15 12h.5M8.5 16h1M12 16h1M15 16h.5" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M9 10h6M9 14h6M9 17.5h3" /></>,
  badge: <><circle cx="12" cy="9" r="5.5" /><path d="m9 13.8-1.5 6.7 4.5-2.5 4.5 2.5-1.5-6.7" /></>,
  swap: <path d="M7 4.5 3.5 8 7 11.5M3.5 8H16M17 12.5l3.5 3.5-3.5 3.5M20.5 16H8" />,
  bank: <path d="M3.5 9.5 12 4l8.5 5.5M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3.5 20.5h17" />,
  news: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7 8.5h10M7 12h4M7 15.5h4M13.5 12H17v3.5h-3.5z" /></>,
  card: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16a3 3 0 0 1 6 0M14.5 10h3M14.5 13.5h3" /></>,
  bars: <path d="M5 20.5v-6M10 20.5V9M15 20.5v-9M20 20.5V4.5M3.5 20.5h17" />,
  pin: <><path d="M9 3.5h6l-1 6 3 3H7l3-3z" /><path d="M12 12.5v8" /></>,
  paperclip: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
  grad: <><path d="m12 4.5 9.5 4.5L12 13.5 2.5 9z" /><path d="M6.5 11v4.5c1.5 1.5 3.5 2.5 5.5 2.5s4-1 5.5-2.5V11" /></>,
  puzzle: <path d="M9 4.5h3.5v1.5a1.75 1.75 0 0 0 3.5 0V4.5h3.5V8h-1.5a1.75 1.75 0 0 0 0 3.5h1.5v8.5H16v-1.5a1.75 1.75 0 0 0-3.5 0V20H9v-3.5H7.5a1.75 1.75 0 0 1 0-3.5H9z" />,
  bot: <><rect x="4.5" y="8" width="15" height="11" rx="3" /><path d="M12 4.5V8M9 13h.01M15 13h.01M2.5 13v2M21.5 13v2" /></>,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
};

/** Tab id → icon name. */
const BY_TAB = {
  teamdash: 'grid', today: 'clock', prodmonitor: 'pulse', qualitymon: 'check', weekly: 'calendar', monthly: 'calendar2',
  dashboard: 'compass', hourlymon: 'timer', allocmon: 'layers', allocation: 'layers', myallocation: 'layers',
  prodreport: 'edit', myreports: 'file', progress: 'trend', myteam: 'users', team: 'users',
  feedback: 'megaphone', feedbackadmin: 'megaphone', feed: 'chat', feedmonitor: 'image', auditlog: 'scroll',
  masters: 'building', settings: 'gear', admincentre: 'shield',
  wb_payers: 'bookmark', wb_files: 'paperclip', wb_sops: 'book', wb_training: 'grad', wb_denials: 'shield',
  wb_appeals: 'mail', wb_artools: 'calc', wb_worklist: 'clipboard', wb_qa: 'badge', wb_queries: 'chat',
  wb_handover: 'swap', wb_medicare: 'bank', wb_updates: 'news', wb_assistant: 'bot', wb_credentialing: 'card',
  wb_reports: 'bars', wb_board: 'pin',
};

/** Sidebar group rows (lib/navGroups.js keys). */
const BY_GROUP = {
  'My Work': 'user', Monitoring: 'bars', Team: 'users', Engagement: 'megaphone', System: 'gear',
  wb_daily: 'clipboard', wb_claims: 'shield', wb_reference: 'bookmark', wb_specialist: 'puzzle', wb_more: 'folder',
};

export default function NavIcon({ tab, group, icon, fallback, size = 18 }) {
  const name = icon ?? (tab ? BY_TAB[tab] : BY_GROUP[group]);
  if (!name) return <span className="ui-navicon-emoji" aria-hidden="true">{fallback ?? '•'}</span>;
  return (
    <svg className="ui-navicon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
