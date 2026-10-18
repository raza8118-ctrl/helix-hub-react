// Workbench modules — productivity tools from docs/HELIX_ROADMAP.md.
// Each entry becomes a sidebar tab (id prefixed 'wb_') for every role.
// Until a module is built, its tab shows WorkbenchPlaceholder with this info.
export const WORKBENCH_MODULES = [
  {
    id: 'wb_payers', label: 'Payer Directory', icon: '📇', phase: 1,
    purpose: 'Every payer’s IDs, phone/fax, addresses, filing limits and forms on one page, with copy buttons.',
    planned: [
      'Type-ahead payer search with aliases (e.g. “BCBSTX”, “Blue Cross Texas”)',
      'Payer card: claims, auth and appeals contacts, payer IDs, portal links',
      'Timely filing and appeal limits, with client-specific overrides',
      'Appeal, recon, auth and corrected-claim forms to download',
      'Last-verified dates and a “Report wrong info” button',
    ],
  },
  {
    id: 'wb_files', label: 'File Tools', icon: '📎', phase: 2,
    purpose: 'Merge, split and convert files safely inside Helix Hub — nothing goes to outside converter sites.',
    planned: [
      'Merge PDFs, reorder and delete pages',
      'Split and compress PDFs',
      'Excel → PDF and image → PDF',
      'PDF → Excel table extraction',
      'Appeal Packet builder with page numbers and file naming',
    ],
  },
  {
    id: 'wb_sops', label: 'SOP Library', icon: '📚', phase: 3,
    purpose: 'Step-by-step guides for every software and task, by client and by team.',
    planned: [
      'SOPs organised by software → task (EMR, clearinghouse, payer portals, Medicare DDE)',
      'Standard SOP layout with screenshots and “If it goes wrong” steps',
      'Client-specific vs common SOPs with version history',
      'Acknowledge button and read tracking',
      'Learning paths and short quizzes for new joiners',
    ],
  },
  {
    id: 'wb_denials', label: 'Denial Navigator', icon: '🧩', phase: 4,
    purpose: 'Look up a denial code and see exactly what to do — client rules first, then payer, then common steps.',
    planned: [
      'CARC/RARC codes with plain-English reasons',
      'Layered steps: client SOP → payer rule → common 3Gen steps',
      'Admin screen to maintain denial steps',
      'Appeal / corrected-claim deadline helper',
    ],
  },
  {
    id: 'wb_appeals', label: 'Appeal Builder', icon: '✉️', phase: 5,
    purpose: 'Build appeal letters and packets in minutes from the claim facts.',
    planned: [
      'Simple form: client, payer, denial reason, claim #, DOS, key facts',
      'Letter templates per denial type (placeholders only — no patient data sent to AI)',
      'Cover letter PDF with payer address/fax from the Payer Directory',
      'Appeal deadline check and “Add to Appeal Packet”',
    ],
  },
  {
    id: 'wb_artools', label: 'AR Tools', icon: '🧮', phase: 6,
    purpose: 'Everyday AR helpers to work claims faster and more accurately.',
    planned: [
      'Claim note generator in each client’s note format',
      'Calculators: TFL/AFL, NOA/NOE due dates, PDGM periods, LUPA, hospice benefit periods',
      'Code lookup: CARC/RARC, revenue codes, HIPPS, ICD-10',
      'Smart worklist and follow-up reminders',
      'Portal launchpad per client',
    ],
  },
];

export const WORKBENCH_TABS = WORKBENCH_MODULES.map(m => ({
  id: m.id, label: m.label, icon: m.icon, section: 'Workbench',
}));

export const isWorkbenchTab = tabId => typeof tabId === 'string' && tabId.startsWith('wb_');
