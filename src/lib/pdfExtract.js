// PDF → Excel (roadmap 2.4 / 2.4b). Every method returns the same shape:
//   { pages: [{ page: <1-based number>, rows: string[][], low?: [row, col][], scanned?: boolean, ocr?: boolean }] }
// `low` marks cells containing words OCR was unsure of; `scanned` = image page nothing could be read from.
// Methods A (text) and OCR run in the browser. B / C / D send the PDF to a service an admin has set up
// and confirmed is covered by a signed BAA — contract in docs/PDF_EXTRACTION_SERVER.md.

import { loadPdfjs } from './pdfjs';
import { supabase, kv } from './supabase';

// ── Methods ───────────────────────────────────────────────────────────────────
export const EXTRACT_METHODS = [
  { id: 'browser',  label: 'In this browser (digital PDFs)', kind: 'browser',
    hint: 'Nothing leaves this computer. Best for EOBs, remits and reports saved from software.' },
  { id: 'ocr',      label: 'In this browser with OCR (scanned PDFs)', kind: 'browser', ocr: true,
    hint: 'Reads scanned pages too (about 3–10 seconds per scanned page). Nothing leaves this computer. Printed English text only.' },
  { id: 'vercel',   label: 'Vercel serverless function', kind: 'url',
    hint: 'Needs a deployed function and a BAA with Vercel (Enterprise plan).' },
  { id: 'supabase', label: 'Supabase Edge Function', kind: 'supabase',
    hint: 'Needs a deployed Edge Function and a BAA with Supabase (Team plan + HIPAA add-on).' },
  { id: 'server',   label: 'Our own server (AWS / Azure / Google Cloud)', kind: 'url',
    hint: 'Needs a server running the extraction service under a BAA.' },
];

const CONFIG_KEY = 'pdf_extract_engines';

/** { [methodId]: { enabled, url?, functionName?, accessKey?, baa, updatedBy, updatedAt } } for the active company. */
export async function loadMethodConfig() {
  return (await kv.get(CONFIG_KEY)) ?? {};
}
export async function saveMethodConfig(config) {
  return kv.set(CONFIG_KEY, config);
}

/** Ready to use? The browser method always is; service methods need an address, BAA confirmation and to be switched on. */
export function methodReady(method, config) {
  if (method.kind === 'browser') return true;
  if (method.kind === 'soon') return false;
  const c = config?.[method.id];
  if (!c?.enabled || !c.baa) return false;
  return method.kind === 'supabase' ? !!c.functionName?.trim() : /^https:\/\//i.test(c.url ?? '') || (c.url ?? '').startsWith('/');
}

// ── In the browser: text layer (A) and OCR ────────────────────────────────────

// pdf.js text items → positioned pieces { x, y (baseline, up), w, h, str } in PDF points
function textItemsToPieces(items) {
  return items
    .filter(it => it.str && it.str.trim())
    .map(it => {
      const h = Math.abs(it.transform[3]) || Math.abs(it.height) || 8;
      return { x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * h * 0.5, h, str: it.str };
    });
}

// OCR words (image pixels, y down) → the same pieces, converted back to PDF points
function ocrWordsToPieces(words, scale, canvasHeight) {
  return words.map(w => ({
    x: w.x0 / scale,
    y: (canvasHeight - w.y1) / scale,
    w: (w.x1 - w.x0) / scale,
    h: Math.max((w.y1 - w.y0) / scale, 4),
    str: w.text,
    low: w.conf < OCR_LOW_CONFIDENCE,
  }));
}
const OCR_LOW_CONFIDENCE = 60;   // words OCR is less than 60% sure of are flagged for checking

// Pieces → lines (by height on the page) → cells (by gaps) → columns (by gutters shared across lines).
// → { rows: string[][], low: [row, col][] }
function pageToRows(pieces) {
  if (!pieces.length) return { rows: [], low: [] };

  // Lines: top to bottom, grouping pieces whose baselines are close
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of pieces) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) <= Math.max(2, p.h * 0.5)) line.items.push(p);
    else lines.push({ y: p.y, items: [p] });
  }

  // Cells: pieces on a line that nearly touch belong to the same cell
  const lineCells = lines.map(l => {
    const sorted = l.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const p of sorted) {
      const last = cells[cells.length - 1];
      const gap = last ? p.x - (last.x1) : Infinity;
      if (last && gap < Math.max(3, p.h * 0.6)) {
        last.text += (gap > p.h * 0.15 ? ' ' : '') + p.str;
        last.x1 = Math.max(last.x1, p.x + p.w);
        last.low = last.low || !!p.low;
      } else {
        cells.push({ x0: p.x, x1: p.x + p.w, text: p.str, low: !!p.low });
      }
    }
    return cells;
  });

  // Columns: vertical gaps that no table line (2+ cells) crosses
  const tableLines = lineCells.filter(c => c.length >= 2);
  if (!tableLines.length) {
    return {
      rows: lineCells.map(c => [c.map(x => x.text.trim()).join(' ')]),
      low: lineCells.flatMap((c, r) => (c.some(x => x.low) ? [[r, 0]] : [])),
    };
  }
  const minX = Math.floor(Math.min(...tableLines.flat().map(c => c.x0)));
  const maxX = Math.ceil(Math.max(...tableLines.flat().map(c => c.x1)));
  const cover = new Array(maxX - minX + 1).fill(0);
  for (const cells of tableLines) {
    for (const c of cells) for (let x = Math.floor(c.x0); x < Math.ceil(c.x1); x++) cover[x - minX]++;
  }
  const allowed = Math.floor(tableLines.length * 0.05);   // a few stray lines may cross a gutter
  const bounds = [];
  let runStart = null;
  cover.forEach((v, i) => {
    if (v <= allowed) { if (runStart === null) runStart = i; }
    else if (runStart !== null) {
      if (i - runStart >= 4) bounds.push(minX + (runStart + i) / 2);
      runStart = null;
    }
  });

  const colOf = x => { let i = 0; while (i < bounds.length && x > bounds[i]) i++; return i; };
  const width = bounds.length + 1;
  const low = [];
  const rows = lineCells.map((cells, r) => {
    const row = new Array(width).fill('');
    const lowCols = new Set();
    for (const c of cells) {
      const col = colOf((c.x0 + c.x1) / 2);
      row[col] = row[col] ? `${row[col]} ${c.text.trim()}` : c.text.trim();
      if (c.low) lowCols.add(col);
    }
    lowCols.forEach(col => low.push([r, col]));
    return row;
  });
  return { rows, low };
}

const OCR_DPI = 300;
const OCR_MAX_SIDE_PX = 5000;

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

/**
 * control (optional, for OCR): { cancelled: bool, onCancel: fn } — set cancelled = true and call onCancel() to stop.
 */
async function extractInBrowser(bytes, pageNumbers, onProgress, { ocr = false, control = null } = {}) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages = [];
  let reader = null;      // OCR worker, started only if a scanned page turns up
  let canvas = null;
  try {
    const wanted = pageNumbers?.length ? pageNumbers : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    for (const n of wanted) {
      if (control?.cancelled) throw new Error('cancelled');
      onProgress?.(n, doc.numPages, false);
      const page = await doc.getPage(n);
      const text = await page.getTextContent();
      let result = pageToRows(textItemsToPieces(text.items));
      let scanned = false;
      let usedOcr = false;
      if (!result.rows.length) {
        const ops = await page.getOperatorList();
        scanned = ops.fnArray.some(fn => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject);
        if (scanned && ocr) {
          onProgress?.(n, doc.numPages, true);
          if (!reader) {
            const { startOcr } = await import('./ocr');
            reader = await startOcr();
            if (control) control.onCancel = () => reader.stop();
          }
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(OCR_DPI / 72, OCR_MAX_SIDE_PX / Math.max(base.width, base.height));
          const vp = page.getViewport({ scale });
          canvas ??= document.createElement('canvas');
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          let words;
          try {
            words = await reader.words(await canvasToPngBlob(canvas));
          } catch (err) {
            if (control?.cancelled) throw new Error('cancelled');
            throw err;
          }
          result = pageToRows(ocrWordsToPieces(words, scale, canvas.height));
          usedOcr = true;
          scanned = !result.rows.length;   // still nothing readable
        }
      }
      pages.push({ page: n, rows: result.rows, low: result.low, scanned, ocr: usedOcr });
      page.cleanup();
    }
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (reader) await Promise.resolve().then(() => reader.stop()).catch(() => {});   // may already be stopped by Cancel
    if (control) control.onCancel = null;
    await doc.destroy();
  }
  return { pages };
}

// ── B / C / D: a service set up by an admin ───────────────────────────────────

function checkResult(data) {
  if (!data || !Array.isArray(data.pages)) throw new Error('The extraction service sent back an unexpected answer.');
  return {
    pages: data.pages.map(p => ({
      page: Number(p.page) || 0,
      rows: (Array.isArray(p.rows) ? p.rows : []).map(r => (Array.isArray(r) ? r.map(c => (c == null ? '' : String(c))) : [])),
      scanned: !!p.scanned,
    })),
  };
}

async function extractViaService(method, cfg, file, pageNumbers) {
  const form = new FormData();
  form.append('file', file, file.name);
  if (pageNumbers?.length) form.append('pages', pageNumbers.join(','));

  if (method.kind === 'supabase') {
    const { data, error } = await supabase.functions.invoke(cfg.functionName.trim(), { body: form });
    if (error) throw new Error(`The Supabase function failed: ${error.message}`);
    return checkResult(typeof data === 'string' ? JSON.parse(data) : data);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await fetch(cfg.url.trim(), {
      method: 'POST',
      body: form,
      headers: cfg.accessKey ? { Authorization: `Bearer ${cfg.accessKey}` } : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`The extraction service answered with an error (${res.status}).`);
    return checkResult(await res.json());
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The extraction service took too long (over 3 minutes).');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the chosen method. bytes = Uint8Array of the PDF, file = the original File (for services).
 * onProgress(page, total, isOcr). control = { cancelled, onCancel } lets the OCR method be stopped.
 */
export async function extractTables({ methodId, config, file, bytes, pageNumbers, onProgress, control }) {
  const method = EXTRACT_METHODS.find(m => m.id === methodId);
  if (!method || !methodReady(method, config)) throw new Error('That method isn’t set up yet.');
  if (method.kind === 'browser') return extractInBrowser(bytes, pageNumbers, onProgress, { ocr: !!method.ocr, control });
  return extractViaService(method, config[method.id], file, pageNumbers);
}

// ── Tidying and Excel output ──────────────────────────────────────────────────

const norm = row => row.map(c => c.trim().toLowerCase()).join('|');

// "$1,234.56" → 1234.56, "(12.00)" → -12, "45%" stays text. Dates, IDs with leading zeros and long
// numbers like claim numbers (13+ digits, which Excel would round) stay text.
function toNumber(s) {
  const t = s.trim();
  if (!t || /^0\d/.test(t.replace(/^\$/, ''))) return null;
  if (!t.includes('.') && t.replace(/\D/g, '').length > 12) return null;
  const m = t.match(/^(\()?-?\$?\s?[\d,]*\.?\d+(\))?$/);
  if (!m || (m[1] && !m[2]) || (!m[1] && m[2])) return null;
  if (/,/.test(t) && !/^\(?-?\$?\s?\d{1,3}(,\d{3})*(\.\d+)?\)?$/.test(t)) return null;
  const n = parseFloat(t.replace(/[$,()\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return m[1] ? -Math.abs(n) : n;
}

/**
 * pages → sheets [{ name, rows }].
 * options: { combine: bool (all pages in one sheet), skipRepeatedHeaders: bool }
 */
export function arrangeSheets(pages, { combine = true, skipRepeatedHeaders = true } = {}) {
  const usable = pages.filter(p => p.rows.length);
  const firstTableRow = usable.flatMap(p => p.rows).find(r => r.filter(c => c.trim()).length >= 2);
  const headerKey = firstTableRow ? norm(firstTableRow) : null;

  const cleaned = usable.map((p, i) => {
    // OCR doubt marks per row index → set of columns
    const lowByRow = new Map();
    for (const [r, c] of p.low ?? []) {
      if (!lowByRow.has(r)) lowByRow.set(r, new Set());
      lowByRow.get(r).add(c);
    }
    let seenHeader = false;
    const keep = r => {
      if (!r.some(c => c.trim())) return false;
      if (!skipRepeatedHeaders || !headerKey || norm(r) !== headerKey) return true;
      // keep the header once: on the first page when combining, on every page when separate
      if (combine ? i === 0 && !seenHeader : !seenHeader) { seenHeader = true; return true; }
      return false;
    };
    const rows = [];
    const lows = [];   // per kept row: Set of doubtful columns, or null
    p.rows.forEach((r, ri) => { if (keep(r)) { rows.push(r); lows.push(lowByRow.get(ri) ?? null); } });
    return { page: p.page, rows, lows };
  });

  if (combine) return [{ name: 'Extracted', rows: cleaned.flatMap(p => p.rows), lows: cleaned.flatMap(p => p.lows) }];
  return cleaned.map(p => ({ name: `Page ${p.page}`, rows: p.rows, lows: p.lows }));
}

/** Builds and downloads the .xlsx. numbersAsNumbers turns amounts into real numbers Excel can add up. */
export async function downloadXlsx(sheets, fileName, { numbersAsNumbers = true } = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const s of sheets) {
    const width = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const aoa = s.rows.map(r => {
      const padded = [...r, ...new Array(width - r.length).fill('')];
      return numbersAsNumbers ? padded.map(c => { const n = toNumber(c); return n === null ? c : n; }) : padded;
    });
    let name = s.name.slice(0, 31) || 'Sheet';
    for (let i = 2; used.has(name); i++) name = `${s.name.slice(0, 27)} (${i})`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const out = /\.xlsx$/i.test(fileName) ? fileName : `${fileName || 'extracted'}.xlsx`;
  XLSX.writeFile(wb, out);
}
