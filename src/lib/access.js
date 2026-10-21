// Per-user feature access.
// Each feature lists the roles that have it by default. An admin can also grant it
// to anyone else on the Team page (stored as users.access_grants = { key: true }).
// Every new module adds its permission here — the Team page and the sidebar pick it up.
// Page role defaults match what each role saw before per-user access existed.
const MONITORS = ['admin', 'manager', 'supervisor'];
const MANAGERS = ['admin', 'manager'];

export const FEATURES = [
  { group: 'Pages', key: 'page_dashboard',     label: 'Dashboard (attendance)', defaultRoles: MONITORS },
  { group: 'Pages', key: 'page_today',         label: 'Today',                  defaultRoles: MONITORS },
  { group: 'Pages', key: 'page_prodmonitor',   label: 'Prod Monitor',           defaultRoles: MONITORS },
  { group: 'Pages', key: 'page_hourly',        label: 'Hourly',                 defaultRoles: MONITORS },
  { group: 'Pages', key: 'page_summary',       label: 'Weekly & Monthly',       defaultRoles: MONITORS },
  { group: 'Pages', key: 'page_announcements', label: 'Post Announcements',     defaultRoles: MONITORS },
  { group: 'Pages', key: 'page_quality',       label: 'Quality Monitor',        defaultRoles: MANAGERS },
  { group: 'Pages', key: 'page_allocation',    label: 'Work Allocation',        defaultRoles: MANAGERS },
  { group: 'Pages', key: 'page_feedmonitor',   label: 'Feed Monitor',           defaultRoles: MANAGERS },
  { group: 'Pages', key: 'page_team',          label: 'Team management',        defaultRoles: MANAGERS,
    warning: 'Can add users, change roles and reset passwords for the whole company' },
  { group: 'Pages', key: 'page_settings',      label: 'Settings',               defaultRoles: MANAGERS,
    warning: 'Can change productivity targets, shift timing and the AI key' },
  { group: 'Tools', key: 'masters_edit', label: 'Edit Clients & Payers', defaultRoles: MANAGERS },
  { group: 'Tools', key: 'audit_view',   label: 'View Audit Log',        defaultRoles: ['admin'] },
  // Viewing the Payer Directory is open to every signed-in user; editing is gated
  { group: 'Tools', key: 'payers_edit',  label: 'Edit Payer Directory',  defaultRoles: MANAGERS },
  // File Tools are open to everyone; this only controls the company's Appeal Packet file naming convention
  { group: 'Tools', key: 'packet_settings', label: 'Appeal Packet settings', defaultRoles: MANAGERS },
  // Published SOPs are open to everyone; editing (and seeing drafts) is gated
  { group: 'Tools', key: 'sops_edit',    label: 'Edit SOP Library',      defaultRoles: MANAGERS },
  // Who has opened / acknowledged each published SOP version
  { group: 'Tools', key: 'sops_tracking', label: 'See SOP read tracking', defaultRoles: MONITORS },
  // Training: everyone sees their own learning paths; building/assigning and team progress are gated
  { group: 'Tools', key: 'training_manage', label: 'Manage learning paths', defaultRoles: MANAGERS },
  { group: 'Tools', key: 'training_track',  label: 'See training progress + confirm items', defaultRoles: MONITORS },
  // Denial Navigator: looking codes up is open to everyone; editing / import is gated
  { group: 'Tools', key: 'denials_edit', label: 'Edit Denial library', defaultRoles: MANAGERS },
  // Appeal Builder: everyone writes appeals; the company's letter templates are managed by these people
  { group: 'Tools', key: 'appeal_templates', label: 'Manage appeal letter templates', defaultRoles: MANAGERS },
  // AR Tools: everyone writes claim notes; each client's note format is managed by these people
  { group: 'Tools', key: 'note_formats', label: 'Manage claim note formats', defaultRoles: MANAGERS },
  // Code lookup: searching is open to everyone; importing / editing the revenue, HIPPS and ICD-10 lists is gated
  { group: 'Tools', key: 'ref_codes_edit', label: 'Manage code lists', defaultRoles: MANAGERS },
  // Smart Worklist: everyone works their own claims; uploading / prioritising / assigning is gated
  // (supervisors manage worklists for their own team)
  { group: 'Tools', key: 'worklist_manage', label: 'Manage worklists', defaultRoles: MONITORS },
  // Portal launchpad: opening links is open to everyone; setting up each client's links is gated (never passwords)
  { group: 'Tools', key: 'portals_edit', label: 'Manage portal links', defaultRoles: MANAGERS },
  // QA Audits: everyone sees their own audits; auditing (supervisors: own team; the QA flag also allows it) and
  // managing scorecards / error categories are gated
  { group: 'Tools', key: 'qa_audit',  label: 'Do QA audits',          defaultRoles: MONITORS },
  { group: 'Tools', key: 'qa_manage', label: 'Manage QA scorecards',  defaultRoles: MANAGERS },
  // Error library (7.2): everyone reads and suggests; editing / publishing is gated (the QA flag also allows it)
  { group: 'Tools', key: 'mistakes_edit', label: 'Edit error library', defaultRoles: MANAGERS },
  // Client Queries (7.3): everyone logs and works their own queries; reassigning / acting on anyone's is gated
  { group: 'Tools', key: 'queries_manage', label: 'Manage client queries', defaultRoles: MONITORS },
  // Handover & Escalations (7.4): everyone writes handovers and raises escalations; seeing all escalations, acting on
  // anyone's and the overview are gated
  { group: 'Tools', key: 'escalations_manage', label: 'Manage escalations', defaultRoles: MONITORS },
  // Medicare Trackers (7.5): everyone adds and works their own ADRs / overpayments; RTP uploads, assigning and changing
  // anyone's items are gated
  { group: 'Tools', key: 'medicare_manage', label: 'Manage Medicare trackers', defaultRoles: MONITORS },
  // Payer Updates (8.1): everyone reads the feed; uploading bulletins (AI extraction) is gated
  { group: 'Tools', key: 'payer_updates_edit', label: 'Manage payer updates', defaultRoles: MANAGERS },
  // Credentialing (9.3): everyone views providers / enrollments / due dates; editing is gated (grant to the Credentialing team)
  { group: 'Tools', key: 'credentialing_edit', label: 'Manage credentialing', defaultRoles: MANAGERS },
];

// Which feature opens each sidebar tab ('feedbackadmin' = Post Announcements for employees,
// whose own 'feedback' tab is the read-only announcements list)
export const TAB_FEATURES = {
  dashboard: 'page_dashboard', today: 'page_today', prodmonitor: 'page_prodmonitor',
  hourlymon: 'page_hourly', weekly: 'page_summary', monthly: 'page_summary',
  feedbackadmin: 'page_announcements', qualitymon: 'page_quality',
  allocation: 'page_allocation', allocmon: 'page_allocation', feedmonitor: 'page_feedmonitor',
  team: 'page_team', settings: 'page_settings', masters: 'masters_edit', auditlog: 'audit_view',
};

/** Tabs with no feature (e.g. My Reports) are open to whoever the role's tab list includes them for. */
export function canOpenTab(user, tabId) {
  const key = TAB_FEATURES[tabId];
  return !key || hasAccess(user, key);
}

export function hasRoleDefault(role, key) {
  return !!FEATURES.find(f => f.key === key)?.defaultRoles.includes(role);
}

/** Granted individually by an admin (not counting role defaults). */
export function grantsOf(user) {
  const grants = { ...(user?.access_grants ?? {}) };
  if (user?.can_view_audit) grants.audit_view = true;   // step 0.4 column, kept in sync
  return grants;
}

export function hasAccess(user, key) {
  if (!user) return false;
  return hasRoleDefault(user.role, key) || !!grantsOf(user)[key];
}
