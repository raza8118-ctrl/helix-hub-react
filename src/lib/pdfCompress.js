// PDF size/quality options for File Tools (roadmap 2.2) — runs entirely in the browser.
// pdf.js draws scanned pages so they can be re-saved smaller; pdf-lib rebuilds the PDF.
// Pages with real text are copied untouched so their text stays sharp and selectable.

export const MB = 1024 * 1024;

// Quality levels (product owner, 2026-10-19): High = original quality (lossless),
// Medium = portal-friendly, Low = smallest but still readable (never below ~100 dpi).
export const QUALITY_LEVELS = [
  { id: 'high',   label: 'High',   hint: 'Original quality — no loss' },
  { id: 'medium', label: 'Medium', hint: 'Smaller, very readable — good for most portals' },
  { id: 'low',    label: 'Low',    hint: 'Smallest, still readable — for strict upload limits' },
];
const RENDER = {
  medium: { dpi: 150, quality: 0.75 },
  low:    { dpi: 110, quality: 0.6 },
};
const MAX_SIDE_PX = 4000;          // keeps very large scans within browser canvas limits
const SCANNED_TEXT_CHARS = 200;    // an image page with less real text than this counts as a scan

export const levelLabel = id => (id === 'original' ? 'Original' : QUALITY_LEVELS.find(l => l.id === id)?.label ?? id);
export const fmtMb = bytes => `${(bytes / MB).toFixed(bytes < MB ? 2 : 1)} MB`;

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

// A page is treated as a scan when it draws an image and has little real text
async function isScannedPage(page, OPS) {
  const ops = await page.getOperatorList();
  const drawsImage = ops.fnArray.some(fn => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject);
  if (!drawsImage) return false;
  const text = await page.getTextContent();
  const chars = text.items.reduce((n, it) => n + (it.str?.trim().length ?? 0), 0);
  return chars < SCANNED_TEXT_CHARS;
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? blob.arrayBuffer().then(b => resolve(new Uint8Array(b)), reject) : reject(new Error('jpeg'))),
      'image/jpeg', quality);
  });
}

/** Lossless: same pages and quality, just repacked (object streams). */
async function losslessRepack(bytes) {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  return { bytes: await doc.save({ useObjectStreams: true }), compressedPages: 0 };
}

/** Re-saves scanned pages at the level's dpi / JPEG quality; other pages are copied as-is. */
async function recompress(bytes, levelId, onProgress) {
  const { dpi, quality } = RENDER[levelId];
  const [pdfjs, { PDFDocument }] = await Promise.all([loadPdfjs(), import('pdf-lib')]);
  const src = await pdfjs.getDocument({ data: bytes.slice() }).promise;   // pdf.js takes ownership of its copy
  const original = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let compressedPages = 0;

  try {
    for (let i = 1; i <= src.numPages; i++) {
      onProgress?.(i, src.numPages);
      const page = await src.getPage(i);
      if (await isScannedPage(page, pdfjs.OPS)) {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(dpi / 72, MAX_SIDE_PX / Math.max(base.width, base.height));
        const vp = page.getViewport({ scale });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const jpg = await out.embedJpg(await canvasToJpeg(canvas, quality));
        const newPage = out.addPage([base.width, base.height]);
        newPage.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
        compressedPages++;
      } else {
        const [copied] = await out.copyPages(original, [i - 1]);
        out.addPage(copied);
      }
      page.cleanup();
    }
  } finally {
    canvas.width = canvas.height = 0;   // free the canvas memory
    await src.destroy();
  }
  return { bytes: await out.save({ useObjectStreams: true }), compressedPages };
}

/**
 * Applies the save choice to a finished PDF.
 * choice = { mode: 'original' | 'compress', level: 'high'|'medium'|'low', maxMb?: number }
 * With maxMb, steps down from the chosen level until the file fits (never below Low).
 * → { bytes, level, originalSize, finalSize, compressedPages, note }
 */
export async function finalizePdf(bytes, choice, onProgress) {
  const originalSize = bytes.length;
  const keepOriginal = note => ({ bytes, level: 'original', originalSize, finalSize: originalSize, compressedPages: 0, note });
  if (choice.mode !== 'compress') return keepOriginal('');

  const limit = choice.maxMb > 0 ? choice.maxMb * MB : null;
  const ids = QUALITY_LEVELS.map(l => l.id);
  const tryOrder = limit ? ids.slice(ids.indexOf(choice.level)) : [choice.level];

  let result = null;
  let used = null;
  for (const id of tryOrder) {
    result = id === 'high' ? await losslessRepack(bytes) : await recompress(bytes, id, onProgress);
    used = id;
    if (!limit || result.bytes.length <= limit) break;
  }

  const fits = !limit || result.bytes.length <= limit;
  if (result.bytes.length >= originalSize) {
    return keepOriginal(
      (used === 'high'
        ? 'The file is already as compact as it can be without losing quality, so the original was kept.'
        : 'This file has no scanned pages to shrink (or is already compressed), so the original was kept.')
      + (limit && originalSize > limit ? ` It is still over your ${choice.maxMb} MB limit — use Split to make smaller parts.` : ''),
    );
  }

  let note = '';
  if (!fits) note = `Even at Low quality this is ${fmtMb(result.bytes.length)}, over your ${choice.maxMb} MB limit — use Split to make smaller parts.`;
  else if (used !== choice.level) note = `Used ${levelLabel(used)} quality to get under ${choice.maxMb} MB.`;
  return { bytes: result.bytes, level: used, originalSize, finalSize: result.bytes.length, compressedPages: result.compressedPages, note };
}
