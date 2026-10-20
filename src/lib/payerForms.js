import { supabase, S, getTablePrefix } from './supabase';
import { logAudit } from './audit';

// Private bucket from supabase/migrations/20261019b_payer_forms_storage.sql
const BUCKET = 'payer-forms';
export const MAX_FORM_BYTES = 10 * 1024 * 1024;
export const FORM_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];

const CONTENT_TYPES = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const extOf = name => (name ?? '').split('.').pop().toLowerCase();

/** null if the file is acceptable, otherwise a plain-English reason. */
export function checkFormFile(file) {
  if (!file) return 'Choose a file to upload.';
  if (!FORM_EXTENSIONS.includes(extOf(file.name))) return 'Only PDF, Word (.doc/.docx) or Excel (.xls/.xlsx) files can be uploaded.';
  if (file.size > MAX_FORM_BYTES) return 'The file is larger than 10 MB.';
  return null;
}

/** Uploads into the active company's folder; returns the storage path, or null on failure. */
export async function uploadPayerForm(payerId, file) {
  const prefix = getTablePrefix();
  const folder = prefix ? `${prefix.replace(/_+$/, '')}/` : '';
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${folder}payer_${payerId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: CONTENT_TYPES[extOf(file.name)],
  });
  if (error) { console.error('uploadPayerForm error', error.message); return null; }
  return path;
}

/** Short-lived (60 s) download link, or null. */
export async function payerFormLink(path, fileName) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60, { download: fileName || true });
  if (error) { console.error('payerFormLink error', error.message); return null; }
  return data?.signedUrl ?? null;
}

// ── Appeal Builder (roadmap 5.4) ────────────────────────────────────────────

/** The form file itself (for pre-filling in the browser), or null. */
export async function loadPayerFormBytes(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) { console.error('loadPayerFormBytes error', error?.message); return null; }
  return new Uint8Array(await data.arrayBuffer());
}

/** True once the 5.4 database update has been run (the row carries field_map). */
export const hasFieldMaps = form => form != null && 'field_map' in form;

/** Saves where appeal values go in a fillable form (no patient data). Returns true when saved. */
export async function saveFieldMap(form, fieldMap, user) {
  const ok = await S.update('payer_forms', { field_map: fieldMap, updated_by: user.emp_id, updated_at: new Date().toISOString() }, { id: form.id });
  if (ok) logAudit({ actor: user, action: 'payer_form_fields_map', entityType: 'payer_form', entityId: form.id, details: { fields: Object.keys(fieldMap).length } });
  return !!ok;
}
