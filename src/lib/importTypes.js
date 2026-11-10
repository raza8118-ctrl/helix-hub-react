// Smart Import data types (PO 2026-11-10). Each type describes the fields a file can fill (with alternative column
// names for auto-matching and one example each), how a row is checked, how "the same item" is recognised, how
// existing items are loaded for the preview, and how rows are saved. Stage 1: Code lists. Stage 2: Payers.
import { db } from './supabase';
import { CODE_SETS, normRef, displayRef, setOf } from './refCodes';
import { stampsReady } from './smartImport';
import { DEPARTMENTS, LIMIT_TYPES, labelOf } from './payerOptions';

export const COMMON_TIPS = [
  'One row per item — no merged cells or totals rows.',
  'Several values in one cell (e.g. other names): separate them with commas.',
  'Dates as MM/DD/YYYY.',
  'Reference information only — never patient names, member IDs, dates of birth or claim details.',
];

const yes = v => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());
const int = v => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

// ── Code lists (revenue, HIPPS, ICD-10) ─────────────────────────────────────────────────────
const SET_WORDS = { revenue: ['revenue', 'rev', 'rev code', 'revenue code', 'ub', 'ub04', 'ub 04'], hipps: ['hipps', 'hipps code', 'pdgm'], icd10: ['icd10', 'icd 10', 'icd', 'icd 10 cm', 'icd10cm', 'diagnosis', 'dx'] };
const setFrom = v => {
  const t = String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return '';
  return Object.entries(SET_WORDS).find(([, words]) => words.includes(t) || words.includes(t.replace(/ /g, '')))?.[0] ?? t;
};

async function loadSet(set, onProgress) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db('ref_codes').select('id,code_set,code,description,notes,list_year,retired').eq('code_set', set).order('id').range(from, from + 999);
    if (error) throw new Error('Could not read the current list.');
    out.push(...(data ?? []));
    onProgress?.(`Reading the current ${setOf(set).label} list… ${out.length.toLocaleString()}`);
    if (!data || data.length < 1000) break;
  }
  return out;
}

function refCodesType() {
  let all = [];   // every current row of the code sets in the file (for "mark missing as retired")
  const key = v => `${v.code_set}|${v.code}`;
  return {
    id: 'ref_codes', title: 'Code lists', entity: 'ref_code', sheetName: 'Codes',
    accept: '.xlsx,.xls,.csv,.txt',
    intro: 'Revenue, HIPPS and ICD-10-CM codes with their descriptions.',
    fields: [
      { key: 'code_set', label: 'Code set', required: true, example: 'ICD-10', options: CODE_SETS.map(s => ({ value: s.value, label: s.label })),
        synonyms: ['code set', 'set', 'code type', 'list', 'type', 'code system'], keyOnly: true,
        help: 'Revenue, HIPPS or ICD-10 — or pick one value for every row' },
      { key: 'code', label: 'Code', required: true, example: 'I50.9', keyOnly: true,
        synonyms: ['code', 'revenue code', 'rev code', 'hipps', 'hipps code', 'icd', 'icd 10', 'icd10', 'icd 10 cm code', 'dx', 'dx code', 'diagnosis code'] },
      { key: 'description', label: 'Description', required: true, example: 'Heart failure, unspecified',
        synonyms: ['description', 'desc', 'long description', 'short description', 'meaning', 'name', 'text', 'title'] },
      { key: 'notes', label: 'Notes', example: 'Use with 0023 for home health', synonyms: ['notes', 'note', 'comments', 'comment', 'remarks'] },
      { key: 'list_year', label: 'List year', example: '2026', synonyms: ['year', 'list year', 'fiscal year', 'fy', 'version', 'effective year'] },
    ],
    tips: ['ICD-10 codes with or without the dot (I50.9 or I509).', 'Revenue codes like 0551 (leading zeros are added: 551 → 0551).'],
    builtIns: [{
      id: 'cms_icd10_txt', label: 'CMS ICD-10-CM codes file (.txt — one code, spaces, then the description)',
      detect: file => /\.txt$/i.test(file.name),
      parse: async file => {
        const text = await file.text();
        const records = text.split(/\r?\n/).map((line, i) => {
          const m = line.match(/^\s*([A-Z0-9.]{3,8})\s+(.+?)\s*$/i);
          return m ? { rowNum: i + 1, values: { code_set: 'icd10', code: m[1], description: m[2] } } : null;
        }).filter(Boolean);
        return records.length ? { records } : { error: 'No codes were found in this text file.' };
      },
    }],
    options: [{ key: 'retireMissing', label: 'Mark codes of the same list that are NOT in this file as “Retired” (they stay searchable; nothing is deleted)' }],
    normalize: v => {
      const code_set = setFrom(v.code_set);
      return { ...v, code_set, code: normRef(code_set, v.code), description: String(v.description ?? '').trim(), list_year: int(v.list_year) ?? '' };
    },
    validate: v => {
      if (!CODE_SETS.some(s => s.value === v.code_set)) return v.code_set ? `Unknown code set “${v.code_set}” (use Revenue, HIPPS or ICD-10)` : 'Missing code set';
      if (!v.code) return 'Missing code';
      if (!v.description) return 'Missing description';
      return null;
    },
    keyOf: key,
    labelOf: v => `${setOf(v.code_set).label} ${displayRef(v.code_set, v.code ?? '')}`,
    loadExisting: async (values, onProgress) => {
      const sets = [...new Set(values.map(v => v.code_set))];
      all = (await Promise.all(sets.map(s => loadSet(s, onProgress)))).flat();
      return new Map(all.map(r => [key(r), r]));
    },
    save: async (preview, { stamp, options, user }, onProgress) => {
      const stampOk = await stampsReady('ref_codes');
      const st = stampOk ? stamp : {};
      const who = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
      let added = 0, updated = 0, retired = 0;
      // new codes, 500 at a time
      const adds = preview.adds.map(r => ({
        code_set: r.values.code_set, code: r.values.code, description: r.values.description, notes: r.values.notes || null,
        list_year: r.values.list_year || null, source: 'import', active: true, retired: false, created_by: user.emp_id, ...who, ...st,
      }));
      for (let i = 0; i < adds.length; i += 500) {
        const { error } = await db('ref_codes').insert(adds.slice(i, i + 500));
        if (error) throw new Error(`Saving new codes stopped at row ${i + 1}: ${error.message}`);
        added += Math.min(500, adds.length - i);
        onProgress?.(`Adding new codes… ${added.toLocaleString()} of ${adds.length.toLocaleString()}`);
      }
      // updates: only the changed fields, grouped so each batch is one save (matched on code set + code)
      const groups = new Map();
      for (const u of preview.updates) {
        const row = { code_set: u.existing.code_set, code: u.existing.code, ...u.patch, ...(u.existing.retired ? { retired: false } : {}), ...who, ...st };
        if (row.list_year === '') delete row.list_year;
        const sig = Object.keys(row).sort().join(',');
        (groups.get(sig) ?? groups.set(sig, []).get(sig)).push(row);
      }
      for (const rows of groups.values()) {
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await db('ref_codes').upsert(rows.slice(i, i + 500), { onConflict: 'code_set,code' });
          if (error) throw new Error(`Updating codes stopped: ${error.message}`);
          updated += Math.min(500, rows.length - i);
          onProgress?.(`Updating codes… ${updated.toLocaleString()} of ${preview.updates.length.toLocaleString()}`);
        }
      }
      // optional: codes of the same sets that are missing from the file → retired (never deleted)
      if (options.retireMissing) {
        const inFile = new Set([...preview.adds, ...preview.updates, ...preview.dups]
          .map(r => r.values && key(r.values)).filter(Boolean));
        const sets = new Set([...preview.adds, ...preview.updates].map(r => r.values.code_set));
        const ids = all.filter(r => sets.has(r.code_set) && !r.retired && !inFile.has(key(r))).map(r => r.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await db('ref_codes').update({ retired: true, ...who }).in('id', ids.slice(i, i + 200));
          if (!error) retired += Math.min(200, ids.length - i);
          onProgress?.(`Marking retired codes… ${retired} of ${ids.length}`);
        }
      }
      return { added, updated, retired };
    },
  };
}

// ── Payers (Stage 2) ─────────────────────────────────────────────────────────────────────────
// A flat file (one row per payer; a payer may repeat for more payer IDs) is turned into the Payer Directory's tabs
// (payers, payer IDs, contacts, limits) and checked with the same rules as the existing payer import (planImport:
// the same payer = same name or one of its other names). Built-ins keep their own rules: the Starter / _More file and
// the Claim.MD list add new payers only; the multi-tab Helix template fills / overwrites like any Smart Import.
const PAYER_TABLE = { payers: 'payers', plans: 'payer_plans', ids: 'payer_ids', contacts: 'payer_contacts', limits: 'payer_limits', notes: 'payer_notes' };
const BOOL_KEYS = ['is_delegated', 'enrollment_required', 'pinned'];
const SOURCE_KEYS = ['source', 'source_links', 'verified_at', 'verified_by', 'verification_note'];
const nn = s => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
const t = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const payerLib = () => import('./payerImport');   // brings in the Excel library only when payers are imported

async function allRows(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db(table).select('*').order('id').range(from, from + 999);
    if (error) return null;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function flatToParsed(records) {
  const { limitDays } = await payerLib();
  const parsed = { payers: [], ids: [], contacts: [], limits: [], notes: [] };
  const byName = new Map();
  for (const { rowNum, values: v } of records) {
    const name = t(v.name);
    if (!name) { parsed.payers.push({ rowNum, values: { name: '' } }); continue; }
    let p = byName.get(nn(name));
    if (!p) {
      p = { rowNum, name, aliases: new Map(), payer_type: '', notes: '', ids: new Map(), contacts: new Map(), limits: new Map(), limitNotes: [] };
      byName.set(nn(name), p);
    }
    String(v.aliases ?? '').split(/[,;|]/).map(t).filter(a => a && nn(a) !== nn(name)).forEach(a => p.aliases.set(nn(a), a));
    p.payer_type ||= t(v.payer_type);
    p.notes ||= t(v.notes);
    String(v.payer_id ?? '').split(/[,;|/]/).map(t).filter(Boolean).forEach(id => {
      const k = `${id.toUpperCase()}|${nn(v.clearinghouse)}`;
      if (!p.ids.has(k)) p.ids.set(k, { rowNum, values: { payer: name, electronic_payer_id: id, clearinghouse: t(v.clearinghouse), transaction_type: t(v.used_for) } });
    });
    // contacts: one per department, later rows fill what earlier rows left empty
    const contact = (dept, vals) => {
      if (!Object.values(vals).some(Boolean)) return;
      const c = p.contacts.get(dept) ?? { rowNum, values: { payer: name, department: dept } };
      for (const [k, x] of Object.entries(vals)) if (x && !c.values[k]) c.values[k] = x;
      p.contacts.set(dept, c);
    };
    contact('Claims', { mailing_address: t(v.claims_address) });
    contact('Appeals', { mailing_address: t(v.appeals_address) });
    contact('Provider Relations', { phone: t(v.phone), fax: t(v.fax), portal_url: t(v.portal_url) });
    for (const [key, type, from, label] of [['tfl', 'TFL', 'Date of service', 'Timely filing'], ['afl', 'AFL', 'Denial / EOB date', 'Appeal limit']]) {
      const text = t(v[key]);
      if (!text || p.limits.has(type)) continue;
      const days = /^\d{1,4}$/.test(text) ? parseInt(text, 10) : limitDays(text);
      if (days) p.limits.set(type, { rowNum, values: { payer: name, limit_type: type, days: String(days), measured_from: from, notes: /^\d+$/.test(text) ? '' : text } });
      else p.limitNotes.push({ rowNum, values: { payer: name, note: `${label}: ${text}`, category: type === 'AFL' ? 'Appeals' : 'Claims' } });
    }
  }
  for (const p of byName.values()) {
    parsed.payers.push({ rowNum: p.rowNum, values: { name: p.name, aliases: [...p.aliases.values()].join(','), payer_type: p.payer_type, notes: p.notes } });
    parsed.ids.push(...p.ids.values());
    parsed.contacts.push(...p.contacts.values());
    parsed.limits.push(...p.limits.values());
    parsed.notes.push(...p.limitNotes);
  }
  return parsed;
}

function payersType() {
  const NEW_ONLY_NOTE = {
    starter: 'Payer Directory Starter / More file: only payers not already here are added (matched by name or other name), with their IDs, contacts, limits and notes. Payers already here are left exactly as they are. Payers not marked “Yes” in “Verified from official source?” get the ⚠ needs-verification flag.',
    claimmd: 'Claim.MD payer list: only payers not already here are added (matched by name or other name), with their other names and payer IDs (clearinghouse “Claim.MD”), marked not verified (⚠). Payers already here are not changed.',
  };
  let sheets = [];
  const label = (key, d, payerRef, existing) => {
    const payer = key === 'payers' ? (existing?.name ?? d.name) : payerRef?.name;
    switch (key) {
      case 'payers':   return payer;
      case 'plans':    return `${payer} — plan ${d.plan_name}`;
      case 'ids':      return `${payer} — payer ID ${d.electronic_payer_id ?? existing?.electronic_payer_id}${d.clearinghouse ? ` (${d.clearinghouse})` : ''}`;
      case 'contacts': return `${payer} — ${labelOf(DEPARTMENTS, d.department)} contact`;
      case 'limits':   return `${payer} — ${labelOf(LIMIT_TYPES, d.limit_type)}${d.level ? ` level ${d.level}` : ''}`;
      default:         return `${payer} — note “${String(d.note ?? existing?.note ?? '').slice(0, 40)}”`;
    }
  };
  const colLabel = (sheet, k) => (sheet.columns.find(c => c.key === k)?.header ?? k).replace(/\s*\(.*?\)\s*/g, '');
  function patchFor(sheet, data, existing, overwrite) {
    const patch = {};
    const changes = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || k === 'name' || k === 'plan_name' || SOURCE_KEYS.includes(k)) continue;
      const old = existing[k];
      if (k === 'aliases') {   // other names are only ever added
        const add = (v ?? []).filter(a => nn(a) !== nn(existing.name) && !(old ?? []).some(o => nn(o) === nn(a)));
        if (add.length) { patch.aliases = [...(old ?? []), ...add]; changes.push('Other names'); }
        continue;
      }
      if (String(old ?? '') === String(v)) continue;
      const empty = old == null || old === '';
      if (empty || overwrite) { patch[k] = v; changes.push(colLabel(sheet, k)); }
    }
    return { patch, changes: changes.join(', ') };
  }
  const forInsert = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === undefined ? (BOOL_KEYS.includes(k) ? false : k === 'aliases' ? [] : null) : v]));
  async function insertChunks(table, rows, onProgress, what) {
    const saved = [];
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db(table).insert(rows.slice(i, i + 200)).select();
      if (error) throw new Error(`Saving ${what} stopped (${error.message}). Everything before it was saved — importing the same file again recognises it.`);
      saved.push(...(data ?? []));
      onProgress?.(`Adding ${what}… ${saved.length.toLocaleString()} of ${rows.length.toLocaleString()}`);
    }
    return saved;
  }
  const fileKind = async file => (/\.(xlsx|xls|csv)$/i.test(file.name) ? (await payerLib()).detectPayerFile(file) : null);

  return {
    id: 'payers', title: 'Payers', entity: 'payer_import', sheetName: 'Payers',
    intro: 'Payers with their other names, payer IDs, phone / fax / portal, mailing addresses and filing limits. One row per payer.',
    fields: [
      { key: 'name', label: 'Payer name', required: true, example: 'Blue Cross Blue Shield of Texas',
        synonyms: ['payer', 'payer name', 'payor', 'payor name', 'insurance', 'insurance name', 'insurance company', 'carrier', 'health plan'] },
      { key: 'aliases', label: 'Other names', example: 'BCBSTX, Blue Cross Texas', synonyms: ['aliases', 'alias', 'other names', 'aka', 'alternate names', 'also known as', 'short name'] },
      { key: 'payer_type', label: 'Payer type', example: 'Commercial', synonyms: ['payer type', 'type', 'line of business', 'lob', 'insurance type', 'category', 'plan type'] },
      { key: 'payer_id', label: 'Payer ID', example: '84980', synonyms: ['payer id', 'payerid', 'payer ids', 'edi id', 'edi payer id', 'electronic payer id', 'cpid', 'payer number'] },
      { key: 'clearinghouse', label: 'Clearinghouse', example: 'Availity', synonyms: ['clearinghouse', 'clearing house', 'via'] },
      { key: 'used_for', label: 'Payer ID used for', example: 'Claims (837)', synonyms: ['used for', 'transaction', 'transaction type'] },
      { key: 'phone', label: 'Provider phone', example: '800-555-0100', synonyms: ['phone', 'phone number', 'provider phone', 'provider services phone', 'customer service', 'telephone'] },
      { key: 'fax', label: 'Fax', example: '800-555-0199', synonyms: ['fax', 'fax number'] },
      { key: 'portal_url', label: 'Portal / website', example: 'https://www.availity.com', synonyms: ['portal', 'portal url', 'website', 'web site', 'url', 'link'] },
      { key: 'claims_address', label: 'Claims mailing address', example: 'PO Box 660044, Dallas, TX 75266', synonyms: ['claims address', 'claims mailing address', 'claim address', 'mailing address', 'address'] },
      { key: 'appeals_address', label: 'Appeals mailing address', example: 'PO Box 660717, Dallas, TX 75266', synonyms: ['appeals address', 'appeal address', 'appeals mailing address'] },
      { key: 'tfl', label: 'Timely filing limit', example: '95 days', synonyms: ['tfl', 'timely filing', 'timely filing limit', 'filing limit', 'tfl days'] },
      { key: 'afl', label: 'Appeal limit', example: '180 days from denial', synonyms: ['afl', 'appeal limit', 'appeal filing limit', 'appeal days', 'appeal timely filing'] },
      { key: 'notes', label: 'Notes', example: 'Recons must be faxed', synonyms: ['notes', 'note', 'comments', 'comment', 'remarks'] },
    ],
    tips: [
      'A payer already in the directory is recognised by its name or one of its other names.',
      'Several payer IDs: put them in one cell separated by commas, or repeat the payer on more rows.',
      'Filing limits: a number of days (95) or text like “180 days from denial”. Text without days is kept as a payer note.',
    ],
    downloads: [{ label: '⬇ Multi-tab payer template (plans, contacts, limits, notes)', run: async () => (await payerLib()).downloadTemplate() }],
    builtIns: [
      {
        id: 'starter', label: 'Helix Payer Directory Starter / More file (adds new payers only)',
        detect: async file => (await fileKind(file)) === 'starter',
        parse: async file => {
          const res = await (await payerLib()).readStarterWorkbook(file);
          return res.error ? res : { parsed: res.parsed, mode: 'starter' };
        },
      },
      {
        id: 'template', label: 'Helix multi-tab payer template (Payers, Plans, Payer IDs, Contacts, Limits, Notes tabs)',
        detect: async file => {
          if (!/\.xlsx?$/i.test(file.name)) return false;
          const XLSX = await import('xlsx');
          const names = XLSX.read(await file.arrayBuffer(), { bookSheets: true }).SheetNames.map(nn);
          return names.includes('payers') && (names.includes('read me') || ['plans', 'payer ids', 'contacts', 'limits', 'notes'].filter(x => names.includes(x)).length >= 2);
        },
        parse: async file => {
          const parsed = await (await payerLib()).readWorkbook(file);
          return Object.keys(parsed).length ? { parsed, mode: 'template' } : { error: 'No template tabs were found.' };
        },
      },
      {
        id: 'claimmd', label: 'Claim.MD payer list download (adds new payers only)',
        detect: async file => /claim[\W_]?md|payer[\W_]?list/i.test(file.name) && (await fileKind(file)) === 'claimmd',
        parse: async file => {
          const res = await (await payerLib()).readClaimMdWorkbook(file);
          return res.error ? res : { parsed: res.parsed, mode: 'claimmd' };
        },
      },
    ],
    labelOf: v => t(v.name),
    preview: async (input, { overwrite }, onProgress) => {
      const lib = await payerLib();
      sheets = lib.SHEETS;
      const mode = input.mode ?? 'flat';
      const parsed = input.parsed ?? await flatToParsed(input.records ?? []);
      onProgress?.('Reading the Payer Directory…');
      const [payers, plans, ids, contacts, limits, notes, clients] = await Promise.all(
        ['payers', 'payer_plans', 'payer_ids', 'payer_contacts', 'payer_limits', 'payer_notes', 'clients'].map(allRows));
      if (payers == null || plans == null) throw new Error('The Payer Directory tables aren’t set up in this workspace yet.');
      const newOnly = mode === 'starter' || mode === 'claimmd';
      const plan = lib.planImport(parsed, { payers, plans, ids, contacts, limits, notes, clients: clients ?? [] },
        { matchAliases: mode !== 'template', newPayersOnly: newOnly });
      const adds = [], updates = [], dups = [], errors = [];
      let skipped = 0;
      for (const s of sheets) {
        const p = plan[s.key];
        p.errors.forEach(e => errors.push({ rowNum: e.rowNum, label: s.label, why: e.message }));
        p.newRows.forEach(r => adds.push({ ...r, sheet: s.key, label: label(s.key, r.data, r.payerRef) }));
        p.matches.forEach(m => {
          const l = label(s.key, m.data, m.payerRef, m.existing);
          const { patch, changes } = newOnly ? { patch: {} } : patchFor(s, m.data, m.existing, overwrite);
          if (Object.keys(patch).length) updates.push({ ...m, sheet: s.key, label: l, patch, changes });
          else dups.push({ rowNum: m.rowNum, label: l, why: newOnly ? 'Already in the directory — left as it is' : overwrite ? 'Already the same' : 'Already there (empty fields only are filled)' });
        });
        skipped += p.skippedExisting ?? 0;
      }
      const note = [NEW_ONLY_NOTE[mode], skipped ? `${skipped.toLocaleString()} detail${skipped === 1 ? '' : 's'} (IDs, contacts, limits, notes) of payers already here are left as they are.` : '']
        .filter(Boolean).join(' ');
      return { adds, updates, dups, errors, note, noOverwrite: newOnly };
    },
    save: async (preview, { stamp, user }, onProgress) => {
      const st = (await stampsReady('payers')) ? stamp : {};
      const who = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
      const detail = {};
      const count = (k, what) => { detail[k] ??= { added: 0, updated: 0 }; detail[k][what]++; };
      const adds = k => preview.adds.filter(a => a.sheet === k);
      const base = { active: true, created_by: user.emp_id, ...who, ...st };
      // 1. payers, 2. plans (other rows may point at new ones), 3. IDs, contacts, limits, notes
      const newPayerId = new Map();
      (await insertChunks('payers', adds('payers').map(r => ({ ...forInsert(r.data), ...base })), onProgress, 'payers'))
        .forEach(p => { newPayerId.set(nn(p.name), p.id); count('payers', 'added'); });
      const payerIdOf = ref => ref.id ?? newPayerId.get(ref.newKey);
      const newPlanId = new Map();
      (await insertChunks('payer_plans', adds('plans').map(r => ({ ...forInsert(r.data), payer_id: payerIdOf(r.payerRef), ...base })), onProgress, 'plans'))
        .forEach(p => { newPlanId.set(`${p.payer_id}|${nn(p.plan_name)}`, p.id); count('plans', 'added'); });
      const planIdOf = (ref, payerId) => (ref == null ? null : ref.id ?? newPlanId.get(`${payerId}|${nn(ref.planName)}`) ?? null);
      for (const k of ['ids', 'contacts', 'limits', 'notes']) {
        const rows = adds(k).map(r => {
          const payerId = payerIdOf(r.payerRef);
          return { ...forInsert(r.data), payer_id: payerId, plan_id: planIdOf(r.planRef, payerId), ...(k === 'limits' ? { client_id: r.clientId } : {}), ...base };
        });
        (await insertChunks(PAYER_TABLE[k], rows, onProgress, sheets.find(s => s.key === k)?.label.toLowerCase() ?? k)).forEach(() => count(k, 'added'));
      }
      // updates: only the changed fields of each existing row
      let done = 0;
      for (const u of preview.updates) {
        const { error } = await db(PAYER_TABLE[u.sheet]).update({ ...u.patch, ...who, ...st }).eq('id', u.existing.id);
        if (error) throw new Error(`Updating ${u.label} stopped (${error.message}). Everything before it was saved.`);
        count(u.sheet, 'updated');
        onProgress?.(`Updating… ${++done} of ${preview.updates.length}`);
      }
      const sum = what => Object.values(detail).reduce((s, d) => s + d[what], 0);
      return { added: sum('added'), updated: sum('updated'), detail };
    },
  };
}

/** A fresh data type by id (each import gets its own, so nothing is shared between two open imports). */
export function importType(id) {
  switch (id) {
    case 'ref_codes': return refCodesType();
    case 'payers':    return payersType();
    default: return null;
  }
}

export { yes, int };
