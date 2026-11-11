// SOP reference documents (PO 2026-11-11; migration 55): PDFs attached to an SOP (e.g. the ICD-10-CM Official Guidelines),
// stored in the private sop-media bucket in the company's folder (co_master/ for the Master Library) and opened with a
// short-lived link. Nothing is ever deleted — a document is hidden (inactive) instead. Reference documents only, no PHI.
import { db, supabase, getTablePrefix } from './supabase';
import { logAudit } from './audit';
import { MASTER_PREFIX } from './masterLibrary';
import { sopMediaLink } from './sopMedia';

const BUCKET = 'sop-media';
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

/** Active documents of an SOP; master = read the Master Library's table (a master SOP shown in a company). null = not set up. */
export async function loadSopDocuments(sopId, { master = false } = {}) {
  const q = master ? supabase.from(MASTER_PREFIX + 'sop_documents') : db('sop_documents');
  const { data, error } = await q.select('*').eq('sop_id', sopId).neq('active', false).order('uploaded_at');
  return error ? null : data ?? [];
}

export function checkDocFile(file) {
  if (!file) return 'Choose a PDF file.';
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'Only PDF files can be added.';
  if (file.size > MAX_DOC_BYTES) return 'The PDF is larger than 25 MB.';
  return null;
}

/** Uploads a PDF into the active company's folder (co_master/ inside the Master Library) and records it. → { row } or { error } */
export async function uploadSopDocument({ sopId, file, title, user }) {
  const bad = checkDocFile(file);
  if (bad) return { error: bad };
  const prefix = getTablePrefix();
  const folder = prefix ? `${prefix.replace(/_+$/, '')}/` : '';
  const path = `${folder}sop_${sopId}/doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: 'application/pdf' });
  if (error) return { error: `The upload failed (${error.message}). Please try again.` };
  const { data, error: e2 } = await db('sop_documents').insert({
    sop_id: sopId, title: title.trim() || file.name.replace(/\.pdf$/i, ''), path, file_name: file.name, size: file.size, active: true, uploaded_by: user.emp_id,
  }).select();
  if (e2 || !data?.length) return { error: 'The file was uploaded but could not be recorded. Please try again.' };
  logAudit({ actor: user, action: 'sop_document_add', entityType: 'sop', entityId: sopId, details: { title: data[0].title, size: file.size } });
  return { row: data[0] };
}

/** Hides a document (never deleted). */
export async function hideSopDocument(doc, user) {
  const { error } = await db('sop_documents').update({ active: false }).eq('id', doc.id);
  if (!error) logAudit({ actor: user, action: 'sop_document_hide', entityType: 'sop', entityId: doc.sop_id, details: { title: doc.title } });
  return !error;
}

/** A 1-hour link to open the PDF, or null. */
export const sopDocumentLink = path => sopMediaLink(path);
