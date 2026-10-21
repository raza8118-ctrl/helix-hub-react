// Calm navigation (PO request 2026-10-21): the sidebar shows the same tabs as before, but in short foldable groups,
// with ⭐ pinned pages on top and an icons-only mode. Nothing is removed — tabs, permissions and search are unchanged.
// Open groups, pins and the icons-only choice are per person in this browser (localStorage) — never PHI.

/** The Workbench section split into smaller groups (tab ids in sidebar order). */
export const WB_GROUPS = [
  { key: 'wb_daily', label: 'Daily work', tabs: ['wb_worklist', 'wb_queries', 'wb_handover', 'wb_board'] },
  { key: 'wb_claims', label: 'Claims & denials', tabs: ['wb_denials', 'wb_appeals', 'wb_artools', 'wb_medicare'] },
  { key: 'wb_reference', label: 'Payers & reference', tabs: ['wb_payers', 'wb_updates', 'wb_sops', 'wb_training'] },
  { key: 'wb_specialist', label: 'Specialist', tabs: ['wb_credentialing', 'wb_qa', 'wb_reports', 'wb_files'] },
];

/** In the tab list (search, permissions, hand-offs) but not shown in the sidebar — the floating 🤖 Ask button opens it. */
export const HIDDEN_IN_SIDEBAR = ['wb_assistant'];
export const MAX_PINS = 6;

/**
 * The flat tab list → [{ key, label, tabs }] in the same order. Workbench tabs go into WB_GROUPS; a Workbench tab not
 * listed there (a future page) lands in "More tools" so nothing disappears.
 */
export function groupTabs(tabs) {
  const shown = tabs.filter(t => !HIDDEN_IN_SIDEBAR.includes(t.id));
  const groups = [];
  const bySection = {};
  for (const t of shown) {
    const section = t.section ?? 'Other';
    if (section === 'Workbench') {
      if (!bySection.Workbench) {
        bySection.Workbench = true;
        WB_GROUPS.forEach(g => groups.push({ key: g.key, label: g.label, tabs: [] }));
        groups.push({ key: 'wb_more', label: 'More tools', tabs: [] });
      }
      const g = WB_GROUPS.find(x => x.tabs.includes(t.id));
      groups.find(x => x.key === (g ? g.key : 'wb_more')).tabs.push(t);
    } else {
      if (!bySection[section]) {
        bySection[section] = { key: section, label: section, tabs: [] };
        groups.push(bySection[section]);
      }
      bySection[section].tabs.push(t);
    }
  }
  // Workbench groups keep the WB_GROUPS order inside; drop empty ones (pages the person can't open)
  groups.forEach(g => {
    const order = WB_GROUPS.find(x => x.key === g.key)?.tabs;
    if (order) g.tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  });
  return groups.filter(g => g.tabs.length);
}

/** "Payer Updates (3)" → { text: 'Payer Updates', count: 3 } so counts show as a small pill. */
export function splitCount(label) {
  const m = /^(.*?)\s*\((\d+)\)$/.exec(String(label ?? ''));
  return m ? { text: m[1], count: Number(m[2]) } : { text: label, count: 0 };
}

// ── Per-person preferences (this browser only) ─────────────────────────────

const prefsKey = empId => `hh_nav_${empId ?? 'anon'}`;

/** { open: { groupKey: bool }, pins: [tabId], compact: bool } */
export function loadNavPrefs(empId) {
  try {
    const p = JSON.parse(localStorage.getItem(prefsKey(empId)) ?? 'null');
    return { open: p?.open ?? {}, pins: Array.isArray(p?.pins) ? p.pins : [], compact: !!p?.compact };
  } catch {
    return { open: {}, pins: [], compact: false };
  }
}

export function saveNavPrefs(empId, prefs) {
  try { localStorage.setItem(prefsKey(empId), JSON.stringify(prefs)); } catch { /* private window: not remembered */ }
}
