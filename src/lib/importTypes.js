// Smart Import data types (PO 2026-11-10). Each type describes the fields a file can fill (with alternative column
// names for auto-matching and one example each), how a row is checked, how "the same item" is recognised, how
// existing items are loaded for the preview, and how rows are saved. Stage 1: Code lists. Stage 2: Payers. Stage 3: Denial codes + steps. Stage 4: SOPs + clients.
import { db } from './supabase';
import { CODE_SETS, normRef, displayRef, setOf } from './refCodes';
import { stampsReady, basicPreview } from './smartImport';
import { CODE_TYPES, normCode, typeOf } from './denials';
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

// ── Denial codes + denial steps (Stage 3) ─────────────────────────────────────────────────────
// Denial codes: the official CARC / RARC list (or any code list) with official wording, plain-English reason and
// retired date. Denial steps: what to do for a code — Common 3Gen steps, one client or one payer (matched with the
// existing steps import rules). Built-in for both: the Helix Denial Guides / _More file (sheet "Denial Guides"), which
// keeps its own rules — new codes, empty plain-English reasons filled, Common 3Gen steps added only where a code has
// none; never an overwrite.
const denialLib = () => import('./denialStepsImport');
const CODE_TYPE_WORDS = { carc: ['carc', 'reason', 'claim adjustment', 'adjustment'], rarc: ['rarc', 'remark'], group: ['group'], other: ['other', 'fiss', 'payer'] };
const codeTypeFrom = v => {
  const s = nn(v);
  if (!s) return '';
  return CODE_TYPES.find(c => c.value === s || nn(c.label) === s)?.value
    ?? Object.entries(CODE_TYPE_WORDS).find(([, words]) => words.some(w => s.includes(w)))?.[0] ?? s;
};
const isoDate = v => {
  const s = t(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s ? null : '';
};
const CODE_TYPE_FIELD = {
  key: 'code_type', label: 'Code type', example: 'CARC', options: CODE_TYPES.map(c => ({ value: c.value, label: `${c.label} — ${c.long}` })),
  synonyms: ['code type', 'type', 'code list', 'list'], keyOnly: true,
};
const GUIDES_NOTE = 'Helix Denial Guides file: codes not in the library are added; a code’s empty plain-English reason is filled; Common 3Gen steps are added only where a code has none. Nothing is overwritten.';

const guidesBuiltIn = {
  id: 'denial_guides', label: 'Helix Denial Guides / More file (sheet “Denial Guides” — new codes and Common 3Gen steps, never overwrites)',
  detect: async file => {
    if (!/\.xlsx?$/i.test(file.name)) return false;
    const XLSX = await import('xlsx');
    return XLSX.read(await file.arrayBuffer(), { bookSheets: true }).SheetNames.some(s => nn(s) === 'denial guides');
  },
  parse: async file => {
    const res = await (await denialLib()).readDenialGuides(file);
    if (!res) return { error: 'This file has no “Denial Guides” sheet.' };
    return res.error ? res : { mode: 'guides', guides: res.guides };
  },
};

async function guidesPreview(input, onProgress) {
  onProgress?.('Reading the Denial library…');
  const [codes, steps] = await Promise.all([allRows('denial_codes'), allRows('denial_steps')]);
  if (codes == null || steps == null) throw new Error('The Denial library isn’t set up in this workspace yet.');
  const plan = (await denialLib()).planDenialGuides(input.guides, { codes, steps });
  const lineOf = code => input.guides.find(g => g.codes.includes(code))?.line ?? null;
  return {
    mode: 'guides', plan, note: GUIDES_NOTE, noOverwrite: true,
    adds: [
      ...plan.newCodes.map(c => ({ rowNum: lineOf(c.code), label: `New code CARC ${c.code}` })),
      ...plan.add.map(a => ({ rowNum: lineOf(a.code), label: `CARC ${a.code} — Common 3Gen steps` })),
    ],
    updates: plan.fillReasons.map(f => ({ rowNum: lineOf(f.code), label: `CARC ${f.code}`, changes: 'Plain-English reason (was empty)', patch: { plain_reason: f.reason } })),
    dups: plan.skipped.map(s => ({ rowNum: s.line, label: `CARC ${s.code}`, why: s.why === 'already has Common 3Gen steps' ? 'Already has Common 3Gen steps — left as they are' : 'Listed twice in the file' })),
    errors: plan.errors.map(e => ({ rowNum: e.line, label: '', why: e.message })),
  };
}

// Same rules as the Denial Guides import, plus the source file name + date; codes and steps re-read first so an
// earlier import can't make a duplicate
async function guidesSave(preview, { stamp, user }, onProgress) {
  const st = (await stampsReady('denial_codes')) ? stamp : {};
  const who = { created_by: user.emp_id, updated_by: user.emp_id };
  const [codes, steps] = await Promise.all([allRows('denial_codes'), allRows('denial_steps')]);
  const plan = (await denialLib()).planDenialGuides(preview.plan.guides, { codes: codes ?? [], steps: steps ?? [] });
  let added = 0, updated = 0;
  if (plan.newCodes.length) {
    onProgress?.('Adding new codes…');
    const { data, error } = await db('denial_codes').insert(plan.newCodes.map(c => ({
      code_type: 'carc', code: c.code, plain_reason: c.reason, source: 'Helix Denial Guides', notes: 'Added from the Helix Denial Guides file', active: true, ...who, ...st,
    }))).select();
    if (error) throw new Error(`Adding codes stopped (${error.message}).`);
    added += data?.length ?? 0;
  }
  for (const f of plan.fillReasons) {
    const { error } = await db('denial_codes').update({ plain_reason: f.reason, updated_by: user.emp_id, updated_at: new Date().toISOString(), ...st }).eq('id', f.codeId);
    if (!error) updated++;
  }
  const carc = new Map();
  ((await allRows('denial_codes')) ?? []).filter(c => c.code_type === 'carc').forEach(c => { if (!carc.has(normCode(c.code))) carc.set(normCode(c.code), c.id); });
  const rows = plan.add.map(a => ({ code_id: carc.get(normCode(a.code)), scope: 'common', client_id: null, payer_id: null, steps: a.steps, notes: a.notes, active: true, ...who, ...st }))
    .filter(r => r.code_id);
  if (rows.length) {
    onProgress?.('Adding Common 3Gen steps…');
    const { data, error } = await db('denial_steps').insert(rows).select();
    if (error) throw new Error(`Adding steps stopped (${error.message}). The codes were saved.`);
    added += data?.length ?? 0;
  }
  return { added, updated, skipped: plan.skipped.length };
}

function denialCodesType() {
  const key = v => `${v.code_type}|${normCode(v.code)}`;
  const type = {
    id: 'denial_codes', title: 'Denial codes', entity: 'denial_code', sheetName: 'Codes',
    intro: 'The official CARC / RARC lists (x12.org) or any denial code list: code, official wording, plain-English reason, retired date.',
    fields: [
      { ...CODE_TYPE_FIELD, required: true, help: 'CARC, RARC, Group or Other — or pick one value for every row' },
      { key: 'code', label: 'Code', required: true, example: '197', keyOnly: true,
        synonyms: ['code', 'reason code', 'remark code', 'carc', 'rarc', 'adjustment reason code', 'code value', 'denial code'] },
      { key: 'official_text', label: 'Official description', example: 'Precertification/authorization/notification/pre-treatment absent.',
        synonyms: ['description', 'official description', 'official text', 'desc', 'long description', 'text', 'code description'] },
      { key: 'plain_reason', label: 'Plain-English reason', example: 'No auth on file for this service',
        synonyms: ['plain english', 'plain english reason', 'simple reason', 'what it means', 'explanation', 'reason'] },
      { key: 'stopped_on', label: 'Retired on', example: '01/01/2026', synonyms: ['stop', 'stop date', 'deactivation date', 'deactivated', 'retired', 'retired on', 'end date'] },
      { key: 'notes', label: 'Notes', example: '', synonyms: ['notes', 'note', 'comments', 'remarks'] },
    ],
    tips: [
      'From x12.org: save the CARC or RARC list as Excel or CSV with a Code and a Description column, then pick “one value for every row” for the code type.',
      '“Stop: 01/01/2026” inside a description is read as the retired date.',
      'A code already in the library gets only its empty fields filled — plain-English reasons you wrote are never changed unless you tick Overwrite.',
    ],
    builtIns: [guidesBuiltIn],
    normalize: v => {
      const official = t(v.official_text);
      const inlineStop = official.match(/Stop:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
      return { ...v, code_type: codeTypeFrom(v.code_type), code: normCode(v.code), official_text: official, plain_reason: t(v.plain_reason),
        stopped_on: isoDate(v.stopped_on) || (inlineStop ? isoDate(inlineStop) : ''), notes: t(v.notes) };
    },
    validate: v => {
      if (!CODE_TYPES.some(c => c.value === v.code_type)) return v.code_type ? `Unknown code type “${v.code_type}” (use CARC, RARC, Group or Other)` : 'Missing code type';
      if (!v.code) return 'Missing code';
      if (v.stopped_on === null) return 'Retired date isn’t a date (use MM/DD/YYYY)';
      if (!v.official_text && !v.plain_reason) return 'Needs an official description or a plain-English reason';
      return null;
    },
    keyOf: key,
    labelOf: v => `${typeOf(v.code_type).label} ${v.code ?? ''}`,
    loadExisting: async () => {
      const rows = await allRows('denial_codes');
      if (rows == null) throw new Error('The Denial library isn’t set up in this workspace yet.');
      return new Map(rows.map(r => [key(r), r]));
    },
    save: async (preview, ctx, onProgress) => {
      if (preview.mode === 'guides') return guidesSave(preview, ctx, onProgress);
      const { stamp, user } = ctx;
      const st = (await stampsReady('denial_codes')) ? stamp : {};
      const who = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
      let added = 0, updated = 0;
      const adds = preview.adds.map(r => ({
        code_type: r.values.code_type, code: r.values.code, official_text: r.values.official_text || null, plain_reason: r.values.plain_reason || null,
        stopped_on: r.values.stopped_on || null, notes: r.values.notes || null, source: 'import', active: true, created_by: user.emp_id, ...who, ...st,
      }));
      for (let i = 0; i < adds.length; i += 500) {
        const { error } = await db('denial_codes').insert(adds.slice(i, i + 500));
        if (error) throw new Error(`Saving new codes stopped at row ${i + 1} (${error.message}).`);
        added += Math.min(500, adds.length - i);
        onProgress?.(`Adding new codes… ${added} of ${adds.length}`);
      }
      for (const u of preview.updates) {
        const { error } = await db('denial_codes').update({ ...u.patch, ...who, ...st }).eq('id', u.existing.id);
        if (error) throw new Error(`Updating ${type.labelOf(u.values)} stopped (${error.message}). Everything before it was saved.`);
        updated++;
        onProgress?.(`Updating codes… ${updated} of ${preview.updates.length}`);
      }
      return { added, updated };
    },
  };
  type.preview = (input, opts, onProgress) => (input.mode === 'guides' ? guidesPreview(input, onProgress) : basicPreview(type, input.records ?? [], opts, onProgress));
  return type;
}

function denialStepsType() {
  const LAYERS = [{ value: 'common', label: 'Common 3Gen steps' }, { value: 'client', label: 'One client' }, { value: 'payer', label: 'One payer' }];
  const layerFrom = v => { const s = nn(v); return !s || /common|3gen|all|standard/.test(s) ? 'common' : /client|agency/.test(s) ? 'client' : /payer|insurance/.test(s) ? 'payer' : s; };
  const layerName = { common: 'Common 3Gen steps', client: 'client steps', payer: 'payer steps' };
  return {
    id: 'denial_steps', title: 'Denial steps', entity: 'denial_step', sheetName: 'Denial steps',
    intro: 'What to do for each denial code — Common 3Gen steps, or steps for one client or one payer. The codes must already be in the Denial library.',
    fields: [
      { ...CODE_TYPE_FIELD, help: 'Blank = CARC' },
      { key: 'code', label: 'Code', required: true, example: '197', keyOnly: true, synonyms: ['code', 'denial code', 'reason code', 'carc', 'rarc', 'remark code'] },
      { key: 'layer', label: 'Applies to', example: 'Common 3Gen steps', options: LAYERS, keyOnly: true,
        synonyms: ['layer', 'applies to', 'scope', 'level'], help: 'Common 3Gen steps, one client or one payer — blank = Common' },
      { key: 'client', label: 'Client', example: '', keyOnly: true, synonyms: ['client', 'client name', 'agency', 'facility'], help: 'When the steps are for one client' },
      { key: 'payer', label: 'Payer', example: '', keyOnly: true, synonyms: ['payer', 'payer name', 'payor', 'insurance'], help: 'When the steps are for one payer (name or other name)' },
      { key: 'steps', label: 'Steps', required: true, example: '1. Check for an auth on file\n2. If found, send a reconsideration with the auth',
        synonyms: ['steps', 'what to do', 'action', 'actions', 'resolution', 'next steps', 'work steps', 'instructions'] },
      { key: 'sop', label: 'Linked SOP title', example: '', synonyms: ['sop', 'linked sop', 'sop title', 'linked sop title'] },
      { key: 'notes', label: 'Notes', example: '', synonyms: ['notes', 'note', 'comments', 'remarks'] },
    ],
    tips: [
      'The code must already be in the Denial library (import the codes first).',
      'Steps on several lines in one cell are kept as separate lines; a line starting with “!” is shown as a warning.',
      'Existing steps for the same code + client / payer are only filled when empty — tick Overwrite to replace them.',
    ],
    downloads: [{ label: '⬇ Steps template (same columns as the export)', run: async () => (await denialLib()).downloadStepsTemplate() }],
    builtIns: [guidesBuiltIn],
    labelOf: v => `${typeOf(codeTypeFrom(v.code_type) || 'carc').label} ${normCode(v.code)}`,
    preview: async (input, { overwrite }, onProgress) => {
      if (input.mode === 'guides') return guidesPreview(input, onProgress);
      onProgress?.('Reading the Denial library…');
      const [codes, steps, clients, payers, sops] = await Promise.all(['denial_codes', 'denial_steps', 'clients', 'payers', 'sops'].map(allRows));
      if (codes == null || steps == null) throw new Error('The Denial library isn’t set up in this workspace yet.');
      const rows = (input.records ?? []).map(({ rowNum, values: v }) => ({
        line: rowNum, type: codeTypeFrom(v.code_type) || 'carc', code: v.code, layer: layerFrom(v.layer), client: v.client, payer: v.payer,
        steps: v.steps, sop: v.sop, notes: v.notes,
      }));
      const diff = (await denialLib()).compareStepsImport(rows, { codes, steps, clients: clients ?? [], payers: payers ?? [], sops: sops ?? [] }, 'replace');
      const label = v => `${v.label} — ${v.scope === 'client' ? `client ${(clients ?? []).find(c => c.id === v.targetId)?.name ?? ''}` : v.scope === 'payer' ? `payer ${(payers ?? []).find(p => p.id === v.targetId)?.name ?? ''}` : layerName.common}`;
      const updates = [], dups = [];
      for (const { existing, values } of diff.update) {
        const patch = {}, changes = [];
        const fill = (col, v, name) => {
          if (v === undefined || v === null || String(existing[col] ?? '') === String(v)) return;
          if (existing[col] == null || existing[col] === '' || overwrite) { patch[col] = v; changes.push(name); }
        };
        fill('steps', values.steps, 'Steps');
        fill('sop_id', values.sopId, 'Linked SOP');
        fill('notes', values.notes, 'Notes');
        if (changes.length) updates.push({ rowNum: values.line, values, existing, patch, label: label(values), changes: changes.join(', ') });
        else dups.push({ rowNum: values.line, label: label(values), why: overwrite ? 'Already the same' : 'Already has steps (empty fields only are filled)' });
      }
      return {
        adds: diff.add.map(v => ({ rowNum: v.line, values: v, label: label(v) })),
        updates, dups,
        errors: diff.errors.map(e => ({ rowNum: e.line, label: '', why: e.message })),
      };
    },
    save: async (preview, ctx, onProgress) => {
      if (preview.mode === 'guides') return guidesSave(preview, ctx, onProgress);
      const { stamp, user } = ctx;
      const st = (await stampsReady('denial_steps')) ? stamp : {};
      const who = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
      let added = 0, updated = 0;
      const rows = preview.adds.map(({ values: v }) => ({
        code_id: v.codeId, scope: v.scope, client_id: v.scope === 'client' ? v.targetId : null, payer_id: v.scope === 'payer' ? v.targetId : null,
        steps: v.steps, sop_id: v.sopId ?? null, notes: v.notes ?? null, active: true, created_by: user.emp_id, ...who, ...st,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db('denial_steps').insert(rows.slice(i, i + 200));
        if (error) throw new Error(`Saving steps stopped (${error.message}). Everything before it was saved.`);
        added += Math.min(200, rows.length - i);
        onProgress?.(`Adding steps… ${added} of ${rows.length}`);
      }
      for (const u of preview.updates) {
        const { error } = await db('denial_steps').update({ ...u.patch, ...who, ...st }).eq('id', u.existing.id);
        if (error) throw new Error(`Updating ${u.label} stopped (${error.message}). Everything before it was saved.`);
        updated++;
      }
      return { added, updated };
    },
  };
}

// ── SOPs + clients (Stage 4) ─────────────────────────────────────────────────────────────────
// SOPs: one row per SOP with its place in the library (category → software → task, each added when missing) and its
// sections. New SOPs come in as drafts (someone reviews and publishes them); an existing SOP (same task + title +
// client) only gets empty sections filled unless "Overwrite". Clients: name, code, project, notes; same name = same client.
const SOP_TEXT = [['summary', 'Summary'], ['purpose', 'Purpose'], ['audience_notes', 'Who uses it'], ['prerequisites', 'Before you start'],
  ['expected_result', 'What you should see'], ['troubleshooting', 'If it goes wrong']];

/** "1. Log in\n2) Open claims\nTip: use Chrome" → [{ text, tip, images: [], video: null }] */
export function stepsFromText(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n|(?:^|\s)(?=\d{1,2}[.)]\s)|\s(?=tip:\s)/i)) {
    const line = raw.trim().replace(/^(?:\d{1,2}[.)]|[-•*])\s*/, '').trim();
    if (!line) continue;
    const tip = line.match(/^tip:\s*(.+)$/i);
    if (tip && out.length) { out[out.length - 1].tip = [out[out.length - 1].tip, tip[1]].filter(Boolean).join(' '); continue; }
    out.push({ text: line, tip: '', images: [], video: null });
  }
  return out;
}
const stepsText = steps => (Array.isArray(steps) ? steps : []).map(s => s?.text ?? '').filter(Boolean).join('\n');

function sopsType() {
  let tree = null;   // what the preview found, re-read before saving
  const pathLabel = v => [v.category, v.software, v.task, v.title].join(' › ') + (v.client ? ` (client ${v.client})` : '');
  async function readTree() {
    const [categories, software, tasks, sops, clients] = await Promise.all(['sop_categories', 'sop_software', 'sop_tasks', 'sops', 'clients'].map(allRows));
    if (!categories || !software || !tasks || !sops) throw new Error('The SOP Library isn’t set up in this workspace yet.');
    const pick = list => list.sort((a, b) => (b.active !== false) - (a.active !== false) || a.id - b.id)[0];
    return {
      sops, clients: clients ?? [],
      cat: name => pick(categories.filter(c => nn(c.name) === nn(name))),
      sw: (catId, name) => pick(software.filter(s => s.category_id === catId && nn(s.name) === nn(name))),
      task: (swId, name) => pick(tasks.filter(t2 => t2.software_id === swId && nn(t2.name) === nn(name))),
    };
  }
  const SOP_FIELDS = [
    { key: 'category', label: 'Category', required: true, example: 'Clearinghouse', synonyms: ['category', 'sop category', 'area', 'department'] },
    { key: 'software', label: 'Software', required: true, example: 'Waystar', synonyms: ['software', 'system', 'application', 'app', 'platform', 'tool', 'portal'] },
    { key: 'task', label: 'Task', required: true, example: 'Check claim status', synonyms: ['task', 'process', 'activity', 'task name'] },
    { key: 'title', label: 'SOP title', required: true, example: 'Claim status check in Waystar', synonyms: ['sop title', 'title', 'sop', 'sop name', 'name', 'procedure'] },
    { key: 'client', label: 'Client', example: '', synonyms: ['client', 'client name', 'agency', 'applies to'], help: 'Blank = a common SOP for every client' },
    { key: 'summary', label: 'Short summary', example: 'How to check a claim’s status in Waystar', synonyms: ['summary', 'short summary', 'overview', 'description'] },
    { key: 'purpose', label: 'Purpose', example: 'Use before calling the payer', synonyms: ['purpose', 'why', 'when to use'] },
    { key: 'audience_notes', label: 'Who uses it', example: 'AR callers', synonyms: ['who uses it', 'audience', 'team', 'used by', 'role'] },
    { key: 'prerequisites', label: 'Before you start', example: 'Waystar login', synonyms: ['before you start', 'prerequisites', 'prerequisite', 'requirements', 'access needed'] },
    { key: 'steps', label: 'Steps', example: '1. Log in to Waystar\n2. Open Claim Status\n3. Search the claim', synonyms: ['steps', 'procedure steps', 'instructions', 'how to', 'process steps'] },
    { key: 'expected_result', label: 'What you should see', example: 'The claim status and date', synonyms: ['what you should see', 'expected result', 'result', 'outcome'] },
    { key: 'troubleshooting', label: 'If it goes wrong', example: 'No result: check the payer ID', synonyms: ['if it goes wrong', 'troubleshooting', 'problems', 'issues', 'errors'] },
    { key: 'vendor', label: 'Software vendor', example: 'Claims, claim status, remits', synonyms: ['vendor', 'software vendor', 'also known as'] },
    { key: 'portal_url', label: 'Software login link', example: 'https://www.waystar.com', synonyms: ['login link', 'login url', 'portal url', 'url', 'link', 'website'] },
  ];
  return {
    id: 'sops', title: 'SOPs', entity: 'sop', sheetName: 'SOPs',
    intro: 'Step-by-step guides, one row per SOP, with where it belongs (category → software → task) and its sections.',
    fields: SOP_FIELDS,
    tips: [
      'Steps: one step per line in the Steps cell (1. / 2. numbers are fine). A line starting with “Tip:” becomes a tip for the step above.',
      'Missing categories, software and tasks are added. Software vendor and login link are used only for software that is new.',
      'New SOPs come in as drafts — open each one, check it and publish it. Screenshots and videos are added on the SOP page.',
      'Never put passwords or patient details in an SOP.',
    ],
    builtIns: [{
      // Helix_SOP_Pack.xlsx (sheet "SOPs", one row per SOP in the template sections). Its source link and "verified from
      // official source" note are kept as a "Source" line under Purpose; the SOPs are NOT marked verified (a senior
      // checks the screens before publishing, as the pack's README says).
      id: 'sop_pack', label: 'Helix SOP Pack (sheet “SOPs” — added as drafts with their source links)',
      detect: async file => {
        if (!/\.xlsx?$/i.test(file.name)) return false;
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { sheetRows: 3 });
        const name = wb.SheetNames.find(s => nn(s) === 'sops');
        if (!name) return false;
        const head = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })[0]?.map(nn) ?? [];
        return head.includes('sop title') && head.includes('steps') && head.some(h => h.startsWith('source link'));
      },
      parse: async file => {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer());
        const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.find(s => nn(s) === 'sops')], { header: 1, defval: '', raw: false });
        const head = (grid[0] ?? []).map(h => nn(h).replace(/[^a-z0-9 ]/g, '').trim());
        const col = label => head.indexOf(nn(label).replace(/[^a-z0-9 ]/g, '').trim());
        const C = Object.fromEntries(SOP_FIELDS.map(f => [f.key, [f.label, ...(f.synonyms ?? [])].map(col).find(i => i >= 0) ?? -1]));
        const src = head.findIndex(h => h.startsWith('source link'));
        const ver = head.findIndex(h => h.startsWith('verified'));
        const checked = head.findIndex(h => h.startsWith('last checked'));
        const records = grid.slice(1).map((r, i) => {
          if (!r.some(c => t(c))) return null;
          const values = Object.fromEntries(Object.entries(C).filter(([, c]) => c >= 0).map(([k, c]) => [k, k === 'steps' ? String(r[c] ?? '').trim() : t(r[c])]));
          const source = [src >= 0 && t(r[src]) ? `Source: ${t(r[src]).replace(/\s*;\s*$/, '')}` : '',
            ver >= 0 && t(r[ver]) ? `Checked against official source: ${t(r[ver])}${checked >= 0 && t(r[checked]) ? ` (${t(r[checked])})` : ''}` : '']
            .filter(Boolean).join('\n');
          if (source) values.purpose = [values.purpose, source].filter(Boolean).join('\n\n');
          return { rowNum: i + 2, values };
        }).filter(Boolean);
        return records.length ? { records, mode: 'sop_pack' } : { error: 'The “SOPs” sheet has no SOPs.' };
      },
    }],
    labelOf: v => pathLabel(v),
    preview: async (input, { overwrite }) => {
      tree = await readTree();
      const adds = [], updates = [], dups = [], errors = [];
      const seen = new Set();
      const newParts = { categories: new Set(), software: new Set(), tasks: new Set() };
      for (const { rowNum, values: raw } of input.records ?? []) {
        const v = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, k === 'steps' ? String(x ?? '').trim() : t(x)]));
        const label = pathLabel(v);
        const missing = ['category', 'software', 'task', 'title'].filter(k => !v[k]);
        if (missing.length) { errors.push({ rowNum, label, why: `Missing ${missing.join(', ')}` }); continue; }
        let clientId = null;
        if (v.client) {
          const c = tree.clients.find(x => nn(x.name) === nn(v.client) || (x.code && nn(x.code) === nn(v.client)));
          if (!c) { errors.push({ rowNum, label, why: `Client “${v.client}” isn’t in Clients & Payers` }); continue; }
          clientId = c.id;
        }
        const key = [v.category, v.software, v.task, v.title].map(nn).join('|') + `|${clientId ?? ''}`;
        if (seen.has(key)) { dups.push({ rowNum, label, why: 'Same SOP appears earlier in this file' }); continue; }
        seen.add(key);
        const cat = tree.cat(v.category);
        const sw = cat && tree.sw(cat.id, v.software);
        const task = sw && tree.task(sw.id, v.task);
        if (!cat) newParts.categories.add(nn(v.category));
        if (!sw) newParts.software.add(`${nn(v.category)}|${nn(v.software)}`);
        if (!task) newParts.tasks.add(`${nn(v.category)}|${nn(v.software)}|${nn(v.task)}`);
        const ex = task && tree.sops.find(s => s.task_id === task.id && nn(s.title) === nn(v.title) && (s.client_id ?? null) === clientId);
        const values = { ...v, clientId };
        if (!ex) { adds.push({ rowNum, values, label }); continue; }
        const patch = {}, changes = [];
        for (const [k, name] of SOP_TEXT) {
          if (!v[k] || String(ex[k] ?? '') === v[k]) continue;
          if (!t(ex[k]) || overwrite) { patch[k] = v[k]; changes.push(name); }
        }
        if (v.steps) {
          const steps = stepsFromText(v.steps);
          const had = stepsText(ex.steps);
          if (steps.length && had !== stepsText(steps) && (!had || overwrite)) { patch.steps = steps; changes.push('Steps'); }
        }
        if (changes.length) updates.push({ rowNum, values, existing: ex, patch, label, changes: changes.join(', ') });
        else dups.push({ rowNum, label, why: overwrite ? 'Already the same' : 'Already there (empty sections only are filled)' });
      }
      const parts = [[newParts.categories.size, 'category', 'categories'], [newParts.software.size, 'software', 'software'], [newParts.tasks.size, 'task', 'tasks']]
        .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
      const note = [adds.length ? 'New SOPs are added as drafts — open each one, check it and publish it.' : '',
        parts.length ? `Also adds ${parts.join(', ')} to the library.` : '',
        updates.some(u => u.existing.status === 'published') ? 'Changes to a published SOP: open it and publish a new version so readers see them.' : '']
        .filter(Boolean).join(' ');
      return { adds, updates, dups, errors, note };
    },
    save: async (preview, { stamp, user }, onProgress) => {
      const st = (await stampsReady('sops')) ? stamp : {};
      const who = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
      const base = { active: true, created_by: user.emp_id, ...who, ...st };
      const fresh = await readTree();   // re-read so two imports can't add the same category twice
      const made = new Map();
      const insertOne = async (table, row) => {
        const { data, error } = await db(table).insert(row).select();
        if (error) throw new Error(`Adding to the library stopped (${error.message}). Everything before it was saved.`);
        return data[0];
      };
      const ensure = async (k, find, table, row) => made.get(k) ?? find() ?? made.set(k, await insertOne(table, { ...row, ...base })).get(k);
      let added = 0, updated = 0, parts = 0;
      for (const a of preview.adds) {
        const v = a.values;
        const before = made.size;
        const cat = await ensure(`c|${nn(v.category)}`, () => fresh.cat(v.category), 'sop_categories', { name: v.category });
        const sw = await ensure(`s|${cat.id}|${nn(v.software)}`, () => fresh.sw(cat.id, v.software), 'sop_software',
          { category_id: cat.id, name: v.software, vendor: v.vendor || null, portal_url: v.portal_url || null });
        const task = await ensure(`t|${sw.id}|${nn(v.task)}`, () => fresh.task(sw.id, v.task), 'sop_tasks', { software_id: sw.id, name: v.task });
        parts += made.size - before;
        if (fresh.sops.some(s => s.task_id === task.id && nn(s.title) === nn(v.title) && (s.client_id ?? null) === v.clientId)) continue;   // added meanwhile
        await insertOne('sops', {
          task_id: task.id, title: v.title, client_id: v.clientId, status: 'draft',
          ...Object.fromEntries(SOP_TEXT.map(([k]) => [k, v[k] || null])), steps: v.steps ? stepsFromText(v.steps) : [], ...base,
        });
        added++;
        onProgress?.(`Adding SOPs… ${added} of ${preview.adds.length}`);
      }
      for (const u of preview.updates) {
        const { error } = await db('sops').update({ ...u.patch, ...who, ...st }).eq('id', u.existing.id);
        if (error) throw new Error(`Updating “${u.values.title}” stopped (${error.message}). Everything before it was saved.`);
        updated++;
      }
      return { added, updated, library_parts: parts };
    },
  };
}

function clientsType() {
  const key = v => nn(v.name);
  return {
    id: 'clients', title: 'Clients', entity: 'client', sheetName: 'Clients',
    intro: 'Your clients (agencies / facilities): name, short code, project and notes.',
    fields: [
      { key: 'name', label: 'Client name', required: true, example: 'Sunrise Home Health', keyOnly: true,
        synonyms: ['client', 'client name', 'name', 'agency', 'agency name', 'facility', 'customer', 'account'] },
      { key: 'code', label: 'Code', example: 'SRHH', synonyms: ['code', 'client code', 'short name', 'abbreviation', 'id'] },
      { key: 'project', label: 'Project', example: 'PMB', synonyms: ['project', 'process', 'team', 'line'] },
      { key: 'notes', label: 'Notes', example: '', synonyms: ['notes', 'note', 'comments', 'remarks'] },
    ],
    tips: ['A client already in the list is recognised by its name (any letter case).', 'Codes are saved in capitals.'],
    normalize: v => ({ ...v, name: t(v.name), code: t(v.code).toUpperCase(), project: t(v.project), notes: t(v.notes) }),
    validate: v => (v.name ? null : 'Missing client name'),
    keyOf: key,
    labelOf: v => v.name ?? '',
    loadExisting: async () => {
      const rows = await allRows('clients');
      if (rows == null) throw new Error('The Clients list isn’t set up in this workspace yet.');
      return new Map(rows.map(r => [key(r), r]));
    },
    save: async (preview, { stamp, user }) => {
      const st = (await stampsReady('clients')) ? stamp : {};
      const who = { updated_by: user.emp_id, updated_at: new Date().toISOString() };
      let added = 0, updated = 0;
      if (preview.adds.length) {
        const { data, error } = await db('clients').insert(preview.adds.map(({ values: v }) => ({
          name: v.name, code: v.code || null, project: v.project || null, notes: v.notes || null, active: true, created_by: user.emp_id, ...who, ...st,
        }))).select();
        if (error) throw new Error(`Saving clients stopped (${error.message}).`);
        added = data?.length ?? 0;
      }
      for (const u of preview.updates) {
        const { error } = await db('clients').update({ ...u.patch, ...who, ...st }).eq('id', u.existing.id);
        if (error) throw new Error(`Updating ${u.values.name} stopped (${error.message}). Everything before it was saved.`);
        updated++;
      }
      return { added, updated };
    },
  };
}

/** A fresh data type by id (each import gets its own, so nothing is shared between two open imports). */
export function importType(id) {
  switch (id) {
    case 'ref_codes': return refCodesType();
    case 'payers':    return payersType();
    case 'denial_codes': return denialCodesType();
    case 'denial_steps': return denialStepsType();
    case 'sops':         return sopsType();
    case 'clients':      return clientsType();
    default: return null;
  }
}

export { yes, int };
