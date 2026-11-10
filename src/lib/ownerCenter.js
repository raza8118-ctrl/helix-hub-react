// Owner Command Center (PO 2026-11-09): menu and company health rules, shared by the owner pages.

export const OWNER_SECTIONS = [
  { name: 'Command Center', items: [['overview', 'Overview', 'grid'], ['companies', 'Companies', 'building'], ['people', 'People', 'users']] },
  { name: 'Insights', items: [['masters', 'Master Library', 'database'], ['performance', 'Performance', 'trend']] },
  { name: 'Platform', items: [['broadcasts', 'Broadcasts', 'megaphone'], ['security', 'Security', 'shield'], ['platform', 'Platform', 'server']] },
];
export const OWNER_PAGES = Object.fromEntries(OWNER_SECTIONS.flatMap(s => s.items.map(([id, label, icon]) => [id, { label, icon, section: s.name }])));

export const HEALTH_LEVELS = {
  problem: { label: 'Problem', badge: 'badge-red' },
  watch:   { label: 'Watch',   badge: 'badge-yellow' },
  good:    { label: 'Good',    badge: 'badge-green' },
};

/**
 * Company health — the existing alert rules turned into a status, no new targets.
 * Problem: paused · more active users than the plan allows · structure out of date.
 * Watch: nobody signed in for 7 days · no daily reports this week (not checked on Mondays, the week has just started).
 */
export function healthOf(c, s = {}, outOfDate = false) {
  const reasons = [];
  if (!c.active) reasons.push({ level: 'problem', text: 'Paused — its users can’t sign in' });
  if (c.seat_limit && s.activeUsers != null && s.activeUsers > c.seat_limit) reasons.push({ level: 'problem', text: `${s.activeUsers} active users, plan allows ${c.seat_limit}` });
  if (outOfDate) reasons.push({ level: 'problem', text: 'Structure out of date — run Sync on the Platform page', sync: true });
  if (c.active) {
    if (s.signIns7 === 0) reasons.push({ level: 'watch', text: 'Nobody signed in for 7 days' });
    if (s.reportsWeek === 0 && new Date().getDay() !== 1) reasons.push({ level: 'watch', text: 'No daily reports this week' });
  }
  const level = reasons.some(r => r.level === 'problem') ? 'problem' : reasons.length ? 'watch' : 'good';
  return { level, reasons };
}
