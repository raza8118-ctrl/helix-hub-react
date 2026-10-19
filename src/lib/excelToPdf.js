// Excel / CSV → PDF for File Tools (roadmap 2.3) — runs entirely in the browser.
// Reads values as Excel displays them (SheetJS) and draws a table with pdf-lib.
// Colours, fonts, charts and pictures are not copied (the free SheetJS edition can't read styles).

export const SHEET_EXTENSIONS = ['xlsx', 'xls', 'csv'];
export const BIG_SHEET_ROWS = 20000;

/** → [{ name, rows: string[][], widths: number[] (in characters) }] — empty sheets dropped. */
export async function readSheets(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false })
      .map(r => r.map(c => String(c ?? '')));
    // Drop columns that are empty in every row
    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const used = Array.from({ length: colCount }, (_, c) => rows.some(r => (r[c] ?? '').trim() !== ''));
    const keep = used.map((u, i) => (u ? i : -1)).filter(i => i >= 0);
    const trimmed = rows.map(r => keep.map(c => r[c] ?? ''));
    const sheetCols = ws['!cols'] ?? [];
    const widths = keep.map((c, i) => {
      const declared = sheetCols[c]?.wch ?? (sheetCols[c]?.wpx ? sheetCols[c].wpx / 7 : null);
      const longest = trimmed.reduce((m, r) => Math.max(m, (r[i] ?? '').length), 0);
      return Math.min(Math.max(declared ?? longest, 4), 45);
    });
    return { name, rows: trimmed, widths };
  }).filter(s => s.rows.length > 0);
}

// The standard PDF font (WinAnsi) covers Latin-1 plus these; anything else becomes "?"
const EXTRA_OK = new Set('–—‘’‚“”„•…€™ŠšŒœŽžŸƒ†‡ˆ‰‹›˜'.split(''));
function sanitize(text, stats) {
  let out = '';
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) {
    const code = ch.codePointAt(0);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || EXTRA_OK.has(ch)) out += ch;
    else { out += '?'; stats.replaced++; }
  }
  return out;
}

function fitText(font, text, size, maxWidth, stats) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  stats.truncated++;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {   // longest prefix that fits with an ellipsis
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, mid)}…`, size) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

const PAGE = { portrait: [612, 792], landscape: [792, 612] };
const MARGIN = 36;
const CELL_PAD = 3;

/**
 * sheets: from readSheets (only the chosen ones), in order.
 * options: { orientation: 'portrait'|'landscape', fitWidth: bool, header: bool }
 * fitWidth shrinks the font so every column fits the page width; otherwise wide sheets
 * continue on extra pages (columns split into page-wide groups).
 * → { bytes, warnings: { replaced, truncated } }
 */
export async function buildSheetsPdf(sheets, { orientation = 'landscape', fitWidth = true, header = true } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAGE[orientation];
  const usableW = pw - MARGIN * 2;
  const stats = { replaced: 0, truncated: 0 };
  const grey = rgb(0.7, 0.7, 0.7);

  for (const sheet of sheets) {
    const rows = sheet.rows.map(r => r.map(c => sanitize(c, stats)));
    const headRow = header ? rows[0] : null;
    const body = header ? rows.slice(1) : rows;

    // Column widths in points at a base font size, then fit or group
    let size = 9;
    let colW = sheet.widths.map(w => w * size * 0.55 + CELL_PAD * 2);
    let groups;
    if (fitWidth) {
      const total = colW.reduce((a, b) => a + b, 0);
      if (total > usableW) {
        const k = usableW / total;
        size = Math.max(5, size * k);
        colW = colW.map(w => w * k);
      }
      groups = [colW.map((_, i) => i)];
    } else {
      groups = [];
      let cur = [];
      let curW = 0;
      colW.forEach((w, i) => {
        const cw = Math.min(w, usableW);
        if (cur.length && curW + cw > usableW) { groups.push(cur); cur = []; curW = 0; }
        cur.push(i); curW += cw;
      });
      if (cur.length) groups.push(cur);
      colW = colW.map(w => Math.min(w, usableW));
    }
    const rowH = size * 1.7;

    groups.forEach(cols => {
      let page = null;
      let y = 0;
      const title = `${sheet.name}${groups.length > 1 ? ` — columns ${cols[0] + 1}–${cols[cols.length - 1] + 1}` : ''}`;
      const drawRow = (cells, isHead) => {
        let x = MARGIN;
        if (isHead) page.drawRectangle({ x, y: y - rowH, width: cols.reduce((s, c) => s + colW[c], 0), height: rowH, color: rgb(0.92, 0.92, 0.95) });
        for (const c of cols) {
          page.drawRectangle({ x, y: y - rowH, width: colW[c], height: rowH, borderColor: grey, borderWidth: 0.5 });
          const f = isHead ? bold : font;
          const text = fitText(f, cells[c] ?? '', size, colW[c] - CELL_PAD * 2, stats);
          if (text) page.drawText(text, { x: x + CELL_PAD, y: y - rowH + (rowH - size) / 2 + size * 0.2, size, font: f });
          x += colW[c];
        }
        y -= rowH;
      };
      const newPage = () => {
        page = pdf.addPage([pw, ph]);
        y = ph - MARGIN;
        page.drawText(fitText(bold, title, 10, usableW, stats), { x: MARGIN, y: y - 10, size: 10, font: bold });
        y -= 18;
        if (headRow) drawRow(headRow, true);   // header repeated on every page
      };
      newPage();
      if (!body.length && !headRow) return;
      for (const r of body) {
        if (y - rowH < MARGIN + 14) newPage();
        drawRow(r, false);
      }
    });
  }

  // Page numbers
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: p.getWidth() - MARGIN - font.widthOfTextAtSize(label, 8), y: MARGIN / 2, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  });

  return { bytes: await pdf.save(), warnings: stats };
}
