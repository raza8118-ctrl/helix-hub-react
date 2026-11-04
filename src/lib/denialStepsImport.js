// Denial steps Excel template / import / export (roadmap 4.3). Runs in the browser; no PHI belongs in these sheets.
// Import never deletes and blank cells never erase: "skip" leaves existing entries alone, "replace" updates them.
import { S, db } from './supabase';
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

// ── Helix_Denial_Guides.xlsx (PO request 2026-11-04) → "Common 3Gen steps" layer only ─────────────────────────
// Each guide row names its codes ("CO-197 / PR-197", "CO-B9") and has plain-English sections. Codes missing from the
// library are added; an existing code's plain-English reason is filled only when it has none; a code that already has
// Common 3Gen steps is skipped. Never client SOPs, never an overwrite.

const GUIDE_SECTIONS = [
  ['causes', /common.*causes/i, 'Common causes'],
  ['check', /check before/i, 'Check before calling'],
  ['questions', /questions/i, 'Questions to ask the payer rep'],
  ['next', /next action/i, 'Next action by outcome'],
  ['prevent', /prevent/i, 'How to prevent it'],
  ['note', /claim note/i, 'Claim note template'],
];
const GROUP_CODE_RE = /\b(?:CO|PR|OA|PI|CR)-([A-Z]?\d{1,3})\b/gi;

// "1) Search … 2) Check …" → one numbered line each
const asLines = text => {
  const t = (text ?? '').toString().trim();
  if (!/(^|\s)1\)\s/.test(t)) return t;
  return t.split(/\s*(?=(?:^|\s)\d{1,2}\)\s)/).map(x => x.trim().replace(/^(\d{1,2})\)\s*/, '$1. ')).filter(Boolean).join('\n');
};

/** → { guides: [{ line, codes: [code], reason, steps, notes }] } or null when the file isn't a Denial Guides file. */
export async function readDenialGuides(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const name = wb.SheetNames.find(s => s.trim().toLowerCase() === 'denial guides');
  if (!name) return null;
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
  const hi = grid.findIndex(r => r.some(c => /^code\(s\)$|^codes?$/i.test(String(c).trim())));
  if (hi < 0) return { error: 'The “Denial Guides” sheet has no “Code(s)” column.' };
  const head = grid[hi].map(h => String(h).trim());
  const col = re => head.findIndex(h => re.test(h));
  const C = { codes: col(/^code/i), name: col(/denial name/i), means: col(/what it means/i), tools: col(/related tools/i) };
  const sections = GUIDE_SECTIONS.map(([key, re, label]) => ({ key, label, i: col(re) })).filter(x => x.i >= 0);
  const guides = [];
  grid.slice(hi + 1).forEach((r, k) => {
    const cell = i => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const codesText = cell(C.codes);
    if (!codesText) return;
    const codes = [...new Set([...codesText.matchAll(GROUP_CODE_RE)].map(m => m[1].toUpperCase()))];
    const nameText = cell(C.name);
    const means = cell(C.means);
    const steps = sections.map(s => (cell(s.i) ? `${s.label}:\n${asLines(cell(s.i))}` : null)).filter(Boolean).join('\n\n');
    guides.push({
      line: hi + k + 2, codesText, codes,
      reason: [nameText, means].filter(Boolean).join(': ') || null,
      steps, notes: cell(C.tools) ? `Related tools: ${cell(C.tools)}` : null,
    });
  });
  return { guides };
}

/**
 * → { newCodes: [{ code, reason }], fillReasons: [{ codeId, reason }], add: [{ code, steps, notes }], skipped: [{ line, code, why }],
 *     errors: [{ line, message }] } — nothing is saved here.
 */
export function planDenialGuides(guides, { codes, steps }) {
  const out = { guides, newCodes: [], fillReasons: [], add: [], skipped: [], errors: [] };
  const seen = new Set();
  for (const g of guides) {
    if (!g.codes.length) { out.errors.push({ line: g.line, message: `No CO-/PR- code found in “${g.codesText}”.` }); continue; }
    if (!g.steps) { out.errors.push({ line: g.line, message: 'The guide has no steps.' }); continue; }
    for (const code of g.codes) {
      if (seen.has(code)) { out.skipped.push({ line: g.line, code, why: 'listed twice in the file' }); continue; }
      seen.add(code);
      const existing = codes.find(c => c.code_type === 'carc' && normCode(c.code) === normCode(code));
      if (!existing) out.newCodes.push({ code, reason: g.reason });
      else if (!txt(existing.plain_reason) && g.reason) out.fillReasons.push({ codeId: existing.id, code, reason: g.reason });
      if (existing && layerEntry(steps, existing.id, 'common')) { out.skipped.push({ line: g.line, code, why: 'already has Common 3Gen steps' }); continue; }
      out.add.push({ code, steps: g.steps, notes: g.notes });
    }
  }
  return out;
}

/** Saves the plan: new codes, empty reasons filled, new Common 3Gen steps (unverified). Nothing is deleted or replaced. */
export async function applyDenialGuides(staleplan, user) {
  const stamp = { created_by: user.emp_id, updated_by: user.emp_id };
  // Fresh from the database, so a screen opened before an earlier import can't add a code or Common steps twice
  const { data: freshCodes } = await db('denial_codes').select('*');
  const { data: freshSteps } = await db('denial_steps').select('*');
  const plan = planDenialGuides(staleplan.guides, { codes: freshCodes ?? [], steps: freshSteps ?? [] });
  const codeIds = new Map();
  let addedCodes = 0;
  if (plan.newCodes.length) {
    const rows = await S.set('denial_codes', plan.newCodes.map(c => ({
      code_type: 'carc', code: c.code, plain_reason: c.reason, source: 'Helix Denial Guides', notes: 'Added from the Helix Denial Guides file', active: true, ...stamp,
    })));
    (rows ?? []).forEach(r => codeIds.set(normCode(r.code), r.id));
    addedCodes = rows?.length ?? 0;
  }
  let reasons = 0;
  for (const f of plan.fillReasons) {
    if (await S.update('denial_codes', { plain_reason: f.reason, updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: f.codeId })) reasons++;
  }
  const { data: all } = await db('denial_codes').select('id,code,code_type').eq('code_type', 'carc');
  (all ?? []).forEach(c => { if (!codeIds.has(normCode(c.code))) codeIds.set(normCode(c.code), c.id); });
  const rows = plan.add.map(a => ({ code_id: codeIds.get(normCode(a.code)), scope: 'common', client_id: null, payer_id: null, steps: a.steps, notes: a.notes, active: true, ...stamp }))
    .filter(r => r.code_id);
  const saved = rows.length ? await S.set('denial_steps', rows) : [];
  const result = { codes: addedCodes, reasons, steps: saved?.length ?? 0, skipped: plan.skipped.length };
  logAudit({ actor: user, action: 'denial_guides_import', entityType: 'denial_step', details: result });
  return result;
}
