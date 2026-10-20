// Denial steps Excel template / import / export (roadmap 4.3). Runs in the browser; no PHI belongs in these sheets.
// Import never deletes and blank cells never erase: "skip" leaves existing entries alone, "replace" updates them.
import { S } from './supabase';
import { logAudit } from './audit';
import { CODE_TYPES, normCode, typeOf } from './denials';
import { layerEntry } from './denialSteps';
import { matchPayer } from './payers';

export const STEP_COLUMNS = [
  { key: 'type',   header: 'Code Type',   example: 'CARC', hint: 'CARC, RARC, Group or Other' },
  { key: 'code',   header: 'Code',        example: '197' },
  { key: 'layer',  header: 'Layer',       example: 'common', hint: 'common, client or payer' },
  { key: 'client', header: 'Client',      example: '', hint: 'Client name (layer = client)' },
  { key: 'payer',  header: 'Payer',       example: '', hint: 'Payer name or alias (layer = payer)' },
  { key: 'steps',  header: 'Steps',       example: '1. Check for an auth on file\n2. If found, send a reconsideration with the auth\n! No auth = write-off per client rules' },
  { key: 'sop',    header: 'Linked SOP title', example: '' },
  { key: 'notes',  header: 'Notes',       example: '' },
];

const txt = v => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };
const lower = v => (v ?? '').toString().trim().toLowerCase();

/** Downloads an empty template with one example row and a "How to" sheet. */
export async function downloadStepsTemplate() {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const example = Object.fromEntries(STEP_COLUMNS.map(c => [c.header, c.example]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([example]), 'Denial steps');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(STEP_COLUMNS.map(c => ({ Column: c.header, 'How to fill it': c.hint ?? '' }))), 'How to');
  XLSX.writeFile(wb, 'denial-steps-template.xlsx');
}

/** Reads the first sheet; headers matched by the template names (any letter case). Returns { rows } or { error }. */
export async function readStepsFile(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!json.length) return { error: 'The file is empty.' };
  const headers = Object.keys(json[0]);
  const col = Object.fromEntries(STEP_COLUMNS.map(c => [c.key, headers.find(h => lower(h) === lower(c.header))]));
  if (!col.code || !col.layer || !col.steps) return { error: 'The file needs at least the “Code”, “Layer” and “Steps” columns (use the template).' };
  return {
    rows: json.map((r, i) => ({
      line: i + 2,
      ...Object.fromEntries(STEP_COLUMNS.map(c => [c.key, col[c.key] ? r[col[c.key]] : ''])),
    })),
  };
}

const typeFrom = v => {
  const s = lower(v);
  if (!s) return 'carc';
  return CODE_TYPES.find(t => t.value === s || t.label.toLowerCase() === s)?.value ?? null;
};

/**
 * Checks every row against the library. mode: 'skip' (default) or 'replace'.
 * Returns { add: [values], update: [{ existing, values }], skipped, errors: [{ line, message }] }.
 */
export function compareStepsImport(rows, { codes, steps, clients, payers, sops }, mode = 'skip') {
  const add = [], update = [], errors = [];
  let skipped = 0;
  const seen = new Set();
  for (const r of rows) {
    if (!txt(r.code) && !txt(r.steps)) continue;   // blank line
    const fail = message => errors.push({ line: r.line, message });
    const type = typeFrom(r.type);
    if (!type) { fail(`Unknown code type “${r.type}”.`); continue; }
    const code = codes.find(c => c.code_type === type && normCode(c.code) === normCode(r.code));
    if (!code) { fail(`${typeOf(type).label} ${normCode(r.code)} isn’t in the Denial library.`); continue; }
    const layer = lower(r.layer);
    if (!['common', 'client', 'payer'].includes(layer)) { fail(`Layer must be common, client or payer (got “${r.layer}”).`); continue; }
    let targetId = null;
    if (layer === 'client') {
      const client = clients.find(c => lower(c.name) === lower(r.client));
      if (!client) { fail(`Client “${r.client}” not found.`); continue; }
      targetId = client.id;
    }
    if (layer === 'payer') {
      const payer = payers.find(p => p.active !== false && matchPayer(p, String(r.payer ?? ''))?.score === 0);
      if (!payer) { fail(`Payer “${r.payer}” not found (use the exact name or an alias).`); continue; }
      targetId = payer.id;
    }
    const stepsText = txt(r.steps);
    if (!stepsText) { fail('Steps are empty.'); continue; }
    let sopId;
    if (txt(r.sop)) {
      const sop = sops.find(s => s.active !== false && lower(s.title) === lower(r.sop));
      if (!sop) { fail(`Linked SOP “${r.sop}” not found.`); continue; }
      sopId = sop.id;
    }
    const key = `${code.id}|${layer}|${targetId ?? ''}`;
    if (seen.has(key)) { fail('The same code + layer + client/payer appears more than once in the file.'); continue; }
    seen.add(key);

    const values = { codeId: code.id, scope: layer, targetId, steps: stepsText, sopId, notes: txt(r.notes) ?? undefined, label: `${typeOf(type).label} ${code.code}` };
    const existing = layerEntry(steps, code.id, layer, targetId);
    if (!existing) add.push(values);
    else if (mode === 'replace') update.push({ existing, values });
    else skipped++;
  }
  return { add, update, skipped, errors };
}

/** Saves an import. New entries start unverified; updates change steps and only the non-blank optional cells. */
export async function applyStepsImport(diff, user) {
  let added = 0, updated = 0;
  if (diff.add.length) {
    const rows = await S.set('denial_steps', diff.add.map(v => ({
      code_id: v.codeId, scope: v.scope, client_id: v.scope === 'client' ? v.targetId : null,
      payer_id: v.scope === 'payer' ? v.targetId : null, steps: v.steps, sop_id: v.sopId ?? null, notes: v.notes ?? null,
      active: true, created_by: user.emp_id, updated_by: user.emp_id,
    })));
    added = rows?.length ?? 0;
  }
  for (const { existing, values } of diff.update) {
    const patch = { steps: values.steps, updated_by: user.emp_id, updated_at: new Date().toISOString() };
    if (values.sopId !== undefined) patch.sop_id = values.sopId;
    if (values.notes !== undefined) patch.notes = values.notes;
    if (await S.update('denial_steps', patch, { id: existing.id })) updated++;
  }
  logAudit({ actor: user, action: 'denial_steps_import', entityType: 'denial_step', details: { added, updated, skipped: diff.skipped, errors: diff.errors.length } });
  return { added, updated };
}

/** All active steps as an Excel file in the template layout (re-importable). */
export async function exportSteps({ codes, steps, clients, payers, sops }) {
  const XLSX = await import('xlsx');
  const name = (list, id, key = 'name') => list.find(x => x.id === id)?.[key] ?? '';
  const rows = steps.filter(s => s.active !== false).map(s => {
    const code = codes.find(c => c.id === s.code_id);
    return {
      'Code Type': code ? typeOf(code.code_type).label : '', Code: code?.code ?? '', Layer: s.scope,
      Client: s.scope === 'client' ? name(clients, s.client_id) : '', Payer: s.scope === 'payer' ? name(payers, s.payer_id) : '',
      Steps: s.steps, 'Linked SOP title': s.sop_id ? name(sops, s.sop_id, 'title') : '', Notes: s.notes ?? '',
      Verified: s.verified_at ? s.verified_at.slice(0, 10) : '',
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Denial steps');
  XLSX.writeFile(wb, `denial-steps-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
