// Owner Console 2.0: which pages / modules the Helix Hub owner can switch off per company (rcm.companies.features,
// { featureKey: false } = off, missing = on, so new companies start with everything on). A page that's off is hidden
// for everyone in that company, its admins included. App-enforced (see the security note in docs/PROGRESS.md).
// The home company has no registry row: its map is kept in the home kv store (`home_features`, lib/company.js).
import { WORKBENCH_MODULES } from '../pages/workbench/modules';

/** key → tab ids it controls. Essentials (Daily Report, My Reports, Team, My Team, Settings, Clients & Payers,
 *  Audit Log, Profile) are not listed, so they can't be switched off. */
export const FEATURE_GROUPS = [
  {
    group: 'Monitoring', items: [
      { key: 'teamdash', label: 'Team Dashboard', tabs: ['teamdash'] },
      { key: 'dashboard', label: 'Attendance (Keka)', tabs: ['dashboard'] },
      { key: 'today', label: 'Today', tabs: ['today'] },
      { key: 'prodmonitor', label: 'Prod Monitor', tabs: ['prodmonitor'] },
      { key: 'qualitymon', label: 'Quality Monitor', tabs: ['qualitymon'] },
      { key: 'hourlymon', label: 'Hourly', tabs: ['hourlymon'] },
      { key: 'summary', label: 'Weekly & Monthly', tabs: ['weekly', 'monthly'] },
    ],
  },
  {
    group: 'Team & work', items: [
      { key: 'allocation', label: 'Work Allocation (+ My Allocation)', tabs: ['allocation', 'allocmon', 'myallocation'] },
      { key: 'progress', label: 'Employee Progress page', tabs: ['progress'] },
    ],
  },
  {
    group: 'Workbench', items: WORKBENCH_MODULES.map(m => ({ key: m.id, label: m.label, tabs: [m.id] })),
  },
  {
    group: 'Engagement', items: [
      { key: 'announcements', label: 'Announcements', tabs: ['feedback', 'feedbackadmin'] },
      { key: 'feed', label: 'Team Feed (+ Feed Monitor)', tabs: ['feed', 'feedmonitor'] },
    ],
  },
  {
    group: 'AI', items: [
      { key: 'ai', label: 'AI features (summaries, AI letter help, bulletin reading, checklists)', tabs: [] },
    ],
  },
];

export const ALL_FEATURES = FEATURE_GROUPS.flatMap(g => g.items);
const TAB_TO_FEATURE = Object.fromEntries(ALL_FEATURES.flatMap(f => f.tabs.map(t => [t, f.key])));

export const isFeatureOn = (features, key) => (features ?? {})[key] !== false;

/** Tab ids switched off for a company (empty for the home company / no settings). */
export function disabledTabs(features) {
  return new Set(Object.entries(TAB_TO_FEATURE).filter(([, key]) => !isFeatureOn(features, key)).map(([tab]) => tab));
}

export const countOff = features => ALL_FEATURES.filter(f => !isFeatureOn(features, f.key)).length;

// ── AI switch (checked by every AI call: helpers.callAI, appealAI, assistant) ──
let aiAllowed = true;
export function setAiAllowed(on) { aiAllowed = on !== false; }
export const AI_OFF_MESSAGE = 'AI features are switched off for this company. Please contact your Helix Hub administrator.';
/** Throws when the owner switched AI off for this company. */
export function assertAiAllowed() {
  if (!aiAllowed) throw new Error(AI_OFF_MESSAGE);
}
