import * as XLSX from 'xlsx';
import {
  BLUECARD, TRANSACTIONS, DEPARTMENTS, LIMIT_TYPES, MEASURED_FROM, NOTE_CATEGORIES, LINES_OF_BUSINESS, matchOption,
} from './payerOptions';

// Payer Directory Excel import (roadmap 1.7). Everything here runs in the browser.
// No patient data belongs in these sheets.

const n   = s => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
const yes = v => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());
const txt = v => { const s = (v ?? '').toString().trim(); return s === '' ? undefined : s; };
// Known list value, or the typed text as-is (free-text columns that usually use the list)
const loose = (list, v) => { const s = txt(v); if (s === undefined) return undefined; return matchOption(list, s) || s; };

const PAYER = { key: 'payer', header: 'Payer Name', required: true, example: 'Blue Cross Blue Shield of Texas' };
const PLAN  = { key: 'plan', header: 'Plan Name (optional)', example: '' };
const NOTES = { key: 'notes', header: 'Notes', example: '' };

/**
 * One entry per sheet. build(values) → { data } or { error }; undefined fields mean
 * "blank in the file". dupKey(row) identifies the same entry for a payer (plus plan/client).
 */
export const SHEETS = [
  {
    key: 'payers', sheet: 'Payers', table: 'payers', label: 'Payers',
    columns: [
      { key: 'name', header: 'Payer Name', required: true, example: 'Blue Cross Blue Shield of Texas' },
      { key: 'payer_type', header: 'Payer Type', example: 'Commercial' },
      { key: 'aliases', header: 'Aliases (comma-separated)', example: 'BCBSTX, Blue Cross Texas' },
      NOTES,
    ],
    build: v => ({ data: {
      name: txt(v.name), payer_type: txt(v.payer_type), notes: txt(v.notes),
      aliases: txt(v.aliases) && [...new Set(v.aliases.split(',').map(a => a.trim()).filter(Boolean))],
    } }),
  },
  {
    key: 'plans', sheet: 'Plans', table: 'payer_plans', label: 'Plans',
    columns: [
      PAYER,
      { key: 'plan_name', header: 'Plan Name', required: true, example: 'Blue Advantage HMO' },
      { key: 'line_of_business', header: 'Line of Business', example: 'Medicare Advantage' },
      { key: 'state', header: 'State', example: 'TX' },
      { key: 'is_delegated', header: 'Delegated (Y/N)', example: 'N' },
      { key: 'delegated_group', header: 'Delegated Group', example: '' },
      { key: 'bluecard_role', header: 'BlueCard (home/host)', example: 'home' },
      NOTES,
    ],
    build: v => {
      const bluecard = matchOption(BLUECARD, v.bluecard_role);
      if (bluecard === null) return { error: 'BlueCard must be “home” or “host”' };
      return { data: {
        plan_name: txt(v.plan_name), line_of_business: loose(LINES_OF_BUSINESS, v.line_of_business),
        state: txt(v.state)?.toUpperCase(),
        is_delegated: txt(v.is_delegated) === undefined ? undefined : yes(v.is_delegated),
        delegated_group: txt(v.delegated_group), bluecard_role: bluecard || undefined, notes: txt(v.notes),
      } };
    },
    dupKey: r => n(r.plan_name),
  },
  {
    key: 'ids', sheet: 'Payer IDs', table: 'payer_ids', label: 'Payer IDs',
    columns: [
      PAYER,
      { key: 'electronic_payer_id', header: 'Payer ID', required: true, example: '84980' },
      { key: 'clearinghouse', header: 'Clearinghouse (blank = direct)', example: 'Availity' },
      { key: 'transaction_type', header: 'Used For', example: 'Claims (837)' },
      { key: 'enrollment_required', header: 'Enrollment Required (Y/N)', example: 'N' },
      PLAN, NOTES,
    ],
    build: v => ({ data: {
      electronic_payer_id: txt(v.electronic_payer_id), clearinghouse: txt(v.clearinghouse),
      transaction_type: loose(TRANSACTIONS, v.transaction_type),
      enrollment_required: txt(v.enrollment_required) === undefined ? undefined : yes(v.enrollment_required),
      notes: txt(v.notes),
    } }),
    dupKey: r => [n(r.electronic_payer_id), n(r.clearinghouse), n(r.transaction_type)].join('|'),
  },
  {
    key: 'contacts', sheet: 'Contacts', table: 'payer_contacts', label: 'Contacts',
    columns: [
      PAYER,
      { key: 'department', header: 'Department', required: true, example: 'Appeals' },
      { key: 'phone', header: 'Phone', example: '800-555-0100' },
      { key: 'phone_ext', header: 'Ext / IVR Option', example: '2' },
      { key: 'fax', header: 'Fax', example: '800-555-0199' },
      { key: 'email', header: 'Email', example: '' },
      { key: 'portal_url', header: 'Portal URL', example: 'https://www.availity.com' },
      { key: 'attention_line', header: 'Attention Line', example: 'Attn: Appeals Dept' },
      { key: 'mailing_address', header: 'Mailing Address', example: 'PO Box 660044, Dallas, TX 75266' },
      { key: 'hours', header: 'Hours', example: 'Mon–Fri 8am–5pm CT' },
      PLAN, NOTES,
    ],
    build: v => {
      const dept = matchOption(DEPARTMENTS, v.department);
      if (!dept) return { error: 'Department must be Claims, Authorization, Appeals, Provider Relations, Eligibility or Other' };
      return { data: {
        department: dept, phone: txt(v.phone), phone_ext: txt(v.phone_ext), fax: txt(v.fax), email: txt(v.email),
        portal_url: txt(v.portal_url), attention_line: txt(v.attention_line), mailing_address: txt(v.mailing_address),
        hours: txt(v.hours), notes: txt(v.notes),
      } };
    },
    dupKey: r => r.department,
  },
  {
    key: 'limits', sheet: 'Limits', table: 'payer_limits', label: 'Limits',
    columns: [
      PAYER,
      { key: 'limit_type', header: 'Limit Type (TFL / CCTFL / AFL / RECON)', required: true, example: 'TFL' },
      { key: 'level', header: 'Level', example: '' },
      { key: 'days', header: 'Days', required: true, example: '95' },
      { key: 'measured_from', header: 'Counted From', example: 'Date of service' },
      PLAN,
      { key: 'client', header: 'Client Name (blank = standard)', example: '' },
      NOTES,
    ],
    build: v => {
      const type = matchOption(LIMIT_TYPES, v.limit_type);
      if (!type) return { error: 'Limit Type must be TFL, CCTFL, AFL or RECON' };
      const days = parseInt(v.days, 10);
      if (!(days > 0)) return { error: 'Days must be a number greater than 0' };
      const level = txt(v.level) === undefined ? undefined : parseInt(v.level, 10);
      if (level !== undefined && !(level > 0)) return { error: 'Level must be a number (1, 2…)' };
      return { data: { limit_type: type, level, days, measured_from: loose(MEASURED_FROM, v.measured_from), notes: txt(v.notes) } };
    },
    dupKey: r => `${r.limit_type}|${r.level ?? ''}`,
  },
  {
    key: 'notes', sheet: 'Notes', table: 'payer_notes', label: 'Notes',
    columns: [
      PAYER,
      { key: 'note', header: 'Note', required: true, example: 'Recons must be faxed — mailed recons are returned.' },
      { key: 'category', header: 'Category', example: 'Appeals' },
      { key: 'pinned', header: 'Pinned (Y/N)', example: 'Y' },
      PLAN,
    ],
    build: v => ({ data: {
      note: txt(v.note), category: loose(NOTE_CATEGORIES, v.category),
      pinned: txt(v.pinned) === undefined ? undefined : yes(v.pinned),
    } }),
    dupKey: r => n(r.note),
  },
];

// ── Template ──────────────────────────────────────────────────────────────────
export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const guide = [
    ['Helix Hub — Payer Directory import template'],
    [''],
    ['• Fill in one tab at a time. Delete the example rows before importing.'],
    ['• Every tab except Payers links to its payer by the exact Payer Name (or a payer already in Helix Hub).'],
    ['• Plan Name (optional) must match a plan on the Plans tab or one already in Helix Hub.'],
    ['• Client Name on the Limits tab must match a client in Clients & Payers; leave it blank for the standard limit.'],
    ['• Y/N columns accept Y, Yes, N or No.'],
    ['• Nothing is saved until you review the preview and confirm. Entries that already exist are skipped unless you choose to replace them.'],
    ['• NEVER put patient information (names, member IDs, DOB, claim details) in this file.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), 'Read Me');
  for (const s of SHEETS) {
    const ws = XLSX.utils.aoa_to_sheet([
      s.columns.map(c => (c.required ? `${c.header} *` : c.header)),
      s.columns.map(c => c.example ?? ''),
    ]);
    ws['!cols'] = s.columns.map(c => ({ wch: Math.max(14, c.header.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, s.sheet);
  }
  XLSX.writeFile(wb, 'payer-directory-import-template.xlsx');
}

// ── Reading the file ──────────────────────────────────────────────────────────
const headerNorm = s => (s ?? '').toString().toLowerCase().replace(/\*/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

/** → { sheetKey: [{ rowNum, values }] } for every template tab found (others ignored). */
export function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const out = {};
        for (const s of SHEETS) {
          const name = wb.SheetNames.find(x => x.trim().toLowerCase() === s.sheet.toLowerCase());
          if (!name) continue;
          const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
          const headerIdx = grid.findIndex(r => r.some(c => String(c).trim() !== ''));
          if (headerIdx < 0) { out[s.key] = []; continue; }
          const colFor = grid[headerIdx].map(h => {
            const hn = headerNorm(h);
            return s.columns.find(c => headerNorm(c.header) === hn || c.key.replace(/_/g, '') === hn)?.key ?? null;
          });
          out[s.key] = grid.slice(headerIdx + 1)
            .map((r, i) => ({ rowNum: headerIdx + i + 2, cells: r }))
            .filter(({ cells }) => cells.some(c => String(c).trim() !== ''))
            .map(({ rowNum, cells }) => {
              const values = {};
              colFor.forEach((key, i) => { if (key) values[key] = cells[i]; });
              return { rowNum, values };
            });
        }
        resolve(out);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ── Sorting rows into new / already existing / errors ─────────────────────────
// Payer and plan references: { id } = already in Helix Hub, { newKey } = new in this file.

/**
 * existing = { payers, plans, ids, contacts, limits, notes, clients } (all rows).
 * → { [sheetKey]: { newRows, matches, errors } } where each row carries
 *   { rowNum, data, payerRef, planRef, clientId, existing? }.
 */
export function planImport(parsed, existing) {
  const result = Object.fromEntries(SHEETS.map(s => [s.key, { newRows: [], matches: [], errors: [] }]));
  const payerByName = new Map((existing.payers ?? []).map(p => [n(p.name), p]));
  const filePayers  = new Set();
  const clientByName = new Map((existing.clients ?? []).filter(c => c.active !== false).map(c => [n(c.name), c]));

  // Payers first
  const seen = new Set();
  for (const { rowNum, values } of parsed.payers ?? []) {
    const { data } = SHEETS[0].build(values);
    const r = result.payers;
    if (!data.name) { r.errors.push({ rowNum, message: 'Payer Name is empty' }); continue; }
    const k = n(data.name);
    if (seen.has(k)) { r.errors.push({ rowNum, message: `“${data.name}” is listed twice on this tab` }); continue; }
    seen.add(k);
    const ex = payerByName.get(k);
    if (ex) r.matches.push({ rowNum, data, existing: ex });
    else { r.newRows.push({ rowNum, data }); filePayers.add(k); }
  }

  const payerRefFor = name => {
    const k = n(name);
    if (!k) return null;
    const ex = payerByName.get(k);
    if (ex) return { id: ex.id, key: `id:${ex.id}`, name: ex.name };
    if (filePayers.has(k)) return { newKey: k, key: `new:${k}`, name };
    return null;
  };

  // Plans next, so the other tabs can point at them
  const existingPlans = new Map((existing.plans ?? []).filter(p => p.active !== false).map(p => [`id:${p.payer_id}|${n(p.plan_name)}`, p]));
  const filePlans = new Set();
  const planRefFor = (payerRef, planName) => {
    const pn = n(planName);
    if (!pn) return { ref: null };
    const k = `${payerRef.key}|${pn}`;
    const ex = existingPlans.get(k);
    if (ex) return { ref: { id: ex.id, key: `id:${ex.id}` } };
    if (filePlans.has(k)) return { ref: { newKey: k, key: `new:${k}`, planName } };
    return { error: `Plan “${planName}” isn’t on the Plans tab or in Helix Hub for this payer` };
  };

  for (const sheet of SHEETS.slice(1)) {
    const r = result[sheet.key];
    const existingRows = existing[sheet.key] ?? [];
    const inFile = new Set();
    for (const { rowNum, values } of parsed[sheet.key] ?? []) {
      const missing = sheet.columns.filter(c => c.required && txt(values[c.key]) === undefined).map(c => c.header);
      if (missing.length) { r.errors.push({ rowNum, message: `Missing: ${missing.join(', ')}` }); continue; }
      const payerRef = payerRefFor(values.payer);
      if (!payerRef) { r.errors.push({ rowNum, message: `Payer “${values.payer}” isn’t on the Payers tab or in Helix Hub` }); continue; }
      const built = sheet.build(values);
      if (built.error) { r.errors.push({ rowNum, message: built.error }); continue; }

      let planRef = null;
      if (sheet.key !== 'plans') {
        const p = planRefFor(payerRef, values.plan);
        if (p.error) { r.errors.push({ rowNum, message: p.error }); continue; }
        planRef = p.ref;
      }
      let clientId = null;
      if (sheet.key === 'limits' && txt(values.client) !== undefined) {
        const c = clientByName.get(n(values.client));
        if (!c) { r.errors.push({ rowNum, message: `Client “${values.client}” isn’t in Clients & Payers` }); continue; }
        clientId = c.id;
      }

      const key = [payerRef.key, sheet.dupKey(built.data), planRef?.key ?? '', clientId ?? ''].join('#');
      if (inFile.has(key)) { r.errors.push({ rowNum, message: 'Same entry is listed twice on this tab' }); continue; }
      inFile.add(key);
      if (sheet.key === 'plans') filePlans.add(`${payerRef.key}|${n(built.data.plan_name)}`);

      const row = { rowNum, data: built.data, payerRef, planRef, clientId };
      const ex = payerRef.id == null ? null : existingRows.find(e =>
        e.active !== false && e.payer_id === payerRef.id
        && sheet.dupKey(e) === sheet.dupKey(built.data)
        && (sheet.key === 'plans' || (e.plan_id ?? null) === (planRef?.id ?? (planRef ? -1 : null)))
        && (sheet.key !== 'limits' || (e.client_id ?? null) === clientId));
      // A row pointing at a plan that's new in this file can't match anything already saved
      if (ex) r.matches.push({ ...row, existing: ex });
      else r.newRows.push(row);
    }
  }
  return result;
}
