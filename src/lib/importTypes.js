// Smart Import data types (PO 2026-11-10). Each type describes the fields a file can fill (with alternative column
// names for auto-matching and one example each), how a row is checked, how "the same item" is recognised, how
// existing items are loaded for the preview, and how rows are saved. Stage 1: Code lists.
import { db } from './supabase';
import { CODE_SETS, normRef, displayRef, setOf } from './refCodes';
import { stampsReady } from './smartImport';

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

/** A fresh data type by id (each import gets its own, so nothing is shared between two open imports). */
export function importType(id) {
  switch (id) {
    case 'ref_codes': return refCodesType();
    default: return null;
  }
}

export { yes, int };
