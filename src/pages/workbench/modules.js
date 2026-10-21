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
    id: 'wb_training', label: 'Training', icon: '🎓', phase: 3,
    purpose: 'Day-by-day learning paths for new joiners, with progress tracking for trainers.',
    planned: [
      'Learning paths by team (e.g. new AR joiner Day 1–5)',
      'SOPs, tasks and links per day, with due dates',
      'Team progress, overdue items and trainer sign-off',
      'Short quizzes per SOP',
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
  {
    id: 'wb_worklist', label: 'Smart Worklist', icon: '📋', phase: 6,
    purpose: 'Aging / RTP claims prioritised by deadline, dollars and payer, assigned and worked claim by claim.',
    planned: [
      'Upload an aging or RTP file (patient details are never stored)',
      'Priority bands with reasons, assign or auto-split to people',
      'My worklist with status, follow-up dates and counts for the Daily Report',
    ],
  },
  {
    id: 'wb_qa', label: 'QA Audits', icon: '✅', phase: 7,
    purpose: 'Audit claims against team scorecards; every error is linked to its SOP and acknowledged by the agent.',
    planned: [
      'Scorecards with weighted / critical checkpoints and error categories',
      'Random sampling of worked claims from the Smart Worklist',
      'Agent acknowledgement or dispute, and results by person and error type',
    ],
  },
  {
    id: 'wb_queries', label: 'Client Queries', icon: '💬', phase: 7,
    purpose: 'Every question sent to a client — logged, chased until answered, with aging per client.',
    planned: [
      'Log a query with a reference (Q-0042), owner and expected answer date',
      'Chase every 3 working days with a copy-ready message; escalate when stuck',
      'Aging per client and per owner, with Excel export',
    ],
  },
  {
    id: 'wb_handover', label: 'Handover & Escalations', icon: '🔁', phase: 7,
    purpose: 'End-of-shift handover for the next shift, and escalations tracked until they are resolved.',
    planned: [
      'My handover: done today, carry-over items, watch out, blockers',
      'Team inbox with read tracking; take, finish or escalate carry-over items',
      'Escalation tracker with severity, target dates, history and an overview',
    ],
  },
  {
    id: 'wb_medicare', label: 'Medicare Trackers', icon: '🏛️', phase: 7,
    purpose: 'ADRs, overpayments / credit balances and claims stuck in RTP or suspense — with due dates and aging.',
    planned: [
      'ADR tracker: due dates, records from the client, submission and decision',
      'Overpayments and credit balances with the 60-day refund date and quarter view',
      'RTP / suspense monitor from FISS list uploads (patient columns dropped)',
    ],
  },
  {
    id: 'wb_updates', label: 'Payer Updates', icon: '📰', phase: 8,
    purpose: 'Payer bulletins turned into a feed of changes: payer, effective date, teams affected and action needed.',
    planned: [
      'Upload a bulletin PDF — AI suggests one row per change, you review and save',
      'Searchable list, Excel download and notices to affected teams',
      'Suggested Payer Directory updates from bulletins (admin approves)',
    ],
  },
  {
    id: 'wb_assistant', label: 'Ask Helix', icon: '🤖', phase: 9,
    purpose: 'Ask a question — answered from the Payer Directory, SOPs, Denial Navigator and Payer Updates, with sources.',
    planned: [
      'PHI-free: questions are de-identified in the browser before anything is sent',
      'Answers only from Helix Hub data, with links to the source records',
    ],
  },
  {
    id: 'wb_credentialing', label: 'Credentialing', icon: '🪪', phase: 9,
    purpose: 'Payer enrollments, CAQH, revalidations and expiring licenses — with what is due next.',
    planned: [
      'Due soon: CAQH every 120 days, revalidations, expiring licenses, stuck enrollments',
      'Provider status checklist and client × payer enrollment grid',
      'AI enrollment checklist from Helix Hub data',
    ],
  },
  {
    id: 'wb_reports', label: 'Reports', icon: '📈', phase: 10,
    purpose: 'Denial trends by payer and client, and a weekly report for each client.',
    planned: [
      'Denial trends: by payer, client, week and denial code, with outcomes',
      'Weekly client report: claims, denials, queries, escalations, Medicare, payer changes',
    ],
  },
  {
    id: 'wb_board', label: 'Notice Board', icon: '📌', phase: 10,
    purpose: 'Lasting notices — process changes, client and payer news, system notices and wins — with must-read tracking.',
    planned: [
      'Notices by category and team, pinned first, with show-from / until dates',
      'Must read: “✓ I\'ve read this” with read tracking per team',
    ],
  },
];

export const WORKBENCH_TABS = WORKBENCH_MODULES.map(m => ({
  id: m.id, label: m.label, icon: m.icon, section: 'Workbench',
}));

export const isWorkbenchTab = tabId => typeof tabId === 'string' && tabId.startsWith('wb_');
