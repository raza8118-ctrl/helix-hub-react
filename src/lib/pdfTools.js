// PDF helpers for File Tools — everything runs in the browser with pdf-lib.
// Files never leave this computer (HIPAA: no third-party converters, no uploads).
// pdf-lib is imported on demand so it only loads when File Tools is used.

const pdfLib = () => import('pdf-lib');

/** Reads a PDF → { bytes, pageCount }. Throws Error('password') or Error('damaged'). */
export async function readPdf(file) {
  const { PDFDocument } = await pdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes);
    return { bytes, pageCount: doc.getPageCount() };
  } catch (err) {
    throw new Error(/encrypt/i.test(err?.message ?? '') ? 'password' : 'damaged');
  }
}

/**
 * Builds one PDF from pages in order.
 * pages: [{ fileId, index }] (index is 0-based within its file); files: Map(fileId → bytes).
 */
export async function buildPdf(pages, files) {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  const sources = new Map();
  for (const { fileId, index } of pages) {
    if (!sources.has(fileId)) sources.set(fileId, await PDFDocument.load(files.get(fileId)));
    const [copied] = await out.copyPages(sources.get(fileId), [index]);
    out.addPage(copied);
  }
  return out.save();
}

/** "2, 5-7" → sorted 1-based numbers within 1..max, or { error }. Accepts – and — as dashes. */
export function parsePageList(text, max) {
  const nums = new Set();
  for (const raw of text.split(',')) {
    const part = raw.trim().replace(/[–—]/g, '-');
    if (!part) continue;
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { error: `“${raw.trim()}” isn’t a page number or range` };
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (a < 1 || b < a || b > max) return { error: `Pages must be between 1 and ${max}` };
    for (let i = a; i <= b; i++) nums.add(i);
  }
  if (!nums.size) return { error: 'Enter page numbers, e.g. 2, 5-7' };
  return { pages: [...nums].sort((x, y) => x - y) };
}

/** Saves bytes as a file on this computer. */
export function downloadPdf(bytes, fileName) {
  const name = /\.pdf$/i.test(fileName) ? fileName : `${fileName || 'merged'}.pdf`;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
