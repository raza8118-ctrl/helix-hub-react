// PDF → Excel “proper format” (fix to 2.4). Turns the positioned text of each page into tidy tables that
// work for any report: columns come from how values line up across rows, the header from the row above
// the data, and column kinds (date / amount / ID / name…) from the values themselves. Heading names are
// never required — common RCM words only break ties. Everything runs in the browser.
//
// structure(pages) → { auto, table, records, other, summary }
//   table / records: [{ name, header: string[], rows: [{ cells: string[], low: Set|null, page }] }]
//   other: [{ page, text }]  — titles, addresses, page footers, totals: kept, never lost
// buildView(table, edits) → { columns: [{ key, name, kind }], rows } — header / rename / remove / split names /
// sort / filter, always applied to the whole file.

import { toNumber } from './pdfExtract';

// ── Value kinds ───────────────────────────────────────────────────────────────

const ONE_DATE = String.raw`(?:\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2})|\d{4}-\d{1,2}-\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})`;
const DATE_RE = new RegExp(`^${ONE_DATE}(?:\\s*(?:-|–|to|thru)\\s*${ONE_DATE})?$`, 'i');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** First date in the text as a local Date, or null. */
export function parseDate(s) {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})/);
  let y, mo, d;
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; if (m[3].length === 2) y += y < 70 ? 2000 : 1900; }
  else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i))) {
    mo = MONTHS.indexOf(m[1].toLowerCase()) + 1; d = +m[2]; y = +m[3];
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 ? date : null;
}

/** 'empty' | 'date' | 'amount' | 'number' | 'id' | 'text' */
export function kindOf(s) {
  const t = (s ?? '').trim();
  if (!t) return 'empty';
  if (DATE_RE.test(t) && parseDate(t)) return 'date';
  if (/^-?\d{1,12}$/.test(t)) return 'number';
  if (/[$.()]/.test(t) && toNumber(t) !== null) return 'amount';
  if (/^[A-Za-z0-9][A-Za-z0-9\-_/.]{3,}$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 3) return 'id';
  return 'text';
}
const VALUE_KINDS = new Set(['date', 'amount', 'number', 'id']);

const PAGE_RE = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*(?:of|\/)\s*\d+|-\s*\d+\s*-)$/i;
const TOTAL_RE = /^(?:sub[\s-]?totals?|totals?|grand\s+totals?|page\s+totals?|report\s+totals?|count|summary)\b/i;

// ── Pieces → lines → cells ────────────────────────────────────────────────────

// A text item holding several values separated by 2+ spaces (common in reports printed as fixed-width text)
// is split into one piece per value, with positions estimated from the character count.
function splitWide(p) {
  if (!/\S\s{2,}\S/.test(p.str)) return [p];
  const cw = p.w / p.str.length;
  return [...p.str.matchAll(/\S+(?:[ \t]\S+)*/g)].map(m => ({ ...p, x: p.x + m.index * cw, w: m[0].length * cw, str: m[0] }));
}

function pagePieces(page) {
  if (page.pieces?.length) return page.pieces.filter(p => p.str?.trim()).flatMap(splitWide);
  // Service methods return rows only: lay their cells out on a grid
  return page.rows.flatMap((r, ri) => r.map((c, ci) => ({ x: ci * 100, y: -ri * 12, w: 90, h: 8, str: c ?? '' })))
    .filter(p => p.str.trim());
}

function toLines(pieces) {
  const ps = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of ps) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) <= Math.max(2, p.h * 0.5)) line.items.push(p);
    else lines.push({ y: p.y, items: [p] });
  }
  return lines.map(l => {
    const items = l.items.sort((a, b) => a.x - b.x);
    const h = items.map(p => p.h).sort((a, b) => a - b)[Math.floor(items.length / 2)];
    const cells = [];
    for (const p of items) {
      const last = cells[cells.length - 1];
      const gap = last ? p.x - last.x1 : Infinity;
      if (last && gap < Math.max(3, p.h * 0.6)) {
        last.text += (gap > p.h * 0.15 ? ' ' : '') + p.str;
        last.x1 = Math.max(last.x1, p.x + p.w);
        last.parts.push(p);
      } else {
        cells.push({ x0: p.x, x1: p.x + p.w, text: p.str, parts: [p] });
      }
    }
    for (const c of cells) { c.text = c.text.trim().replace(/\s+/g, ' '); c.kind = kindOf(c.text); }
    const text = cells.map(c => c.text).join('  ');
    return {
      y: l.y, h, cells, text,
      noise: cells.length <= 3 && cells.some(c => PAGE_RE.test(c.text)),
      total: TOTAL_RE.test(cells[0]?.text ?? ''),
    };
  });
}

const textShare = l => l.cells.filter(c => c.kind === 'text').length / (l.cells.length || 1);
const isDataLine = l => !l.noise && !l.total && l.cells.length >= 2 && l.cells.some(c => VALUE_KINDS.has(c.kind));

// Column boundaries: x positions that (almost) no cell of the given lines crosses
function findBounds(lines) {
  const cells = lines.flatMap(l => l.cells);
  if (!cells.length) return { bounds: [], minX: 0 };
  const minX = Math.floor(Math.min(...cells.map(c => c.x0)));
  const maxX = Math.ceil(Math.max(...cells.map(c => c.x1)));
  const cover = new Array(maxX - minX + 1).fill(0);
  for (const c of cells) for (let x = Math.floor(c.x0); x < Math.ceil(c.x1); x++) cover[x - minX]++;
  const allowed = Math.floor(lines.length * 0.05);
  const bounds = [];
  let runStart = null;
  cover.forEach((v, i) => {
    if (v <= allowed) { if (runStart === null) runStart = i; }
    else if (runStart !== null) {
      if (i - runStart >= 4) bounds.push(minX + (runStart + i) / 2);
      runStart = null;
    }
  });
  return { bounds, minX };
}

const colOf = (bounds, x) => { let i = 0; while (i < bounds.length && x > bounds[i]) i++; return i; };

// One line → cells by column. Pieces are placed by their centre; a piece running across a column edge is
// split into words so each word lands in its own column.
function assignLine(line, bounds) {
  const out = new Array(bounds.length + 1).fill('');
  const lastX = new Array(bounds.length + 1).fill(null);
  const low = new Set();
  const add = (x0, x1, str, h, isLow) => {
    const col = colOf(bounds, (x0 + x1) / 2);
    const gap = lastX[col] === null ? 0 : x0 - lastX[col];
    out[col] += (out[col] && gap > h * 0.15 ? ' ' : '') + str;
    lastX[col] = x1;
    if (isLow) low.add(col);
  };
  for (const c of line.cells) {
    for (const p of c.parts) {
      const x0 = p.x, x1 = p.x + p.w;
      const crosses = bounds.some(b => b > x0 + 2 && b < x1 - 2);
      if (!crosses || !/\s/.test(p.str.trim())) { add(x0, x1, p.str, p.h, p.low); continue; }
      const cw = p.w / p.str.length;
      for (const m of p.str.matchAll(/\S+/g)) add(x0 + m.index * cw, x0 + (m.index + m[0].length) * cw, m[0], p.h, p.low);
    }
  }
  return { cells: out.map(s => s.trim().replace(/\s+/g, ' ')), low: low.size ? low : null };
}

const norm = s => s.trim().toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

// ── Table layout ──────────────────────────────────────────────────────────────

function analysePage(lines) {
  let dataIdx = lines.map((l, i) => (isDataLine(l) ? i : -1)).filter(i => i >= 0);
  if (dataIdx.length < 2) {
    dataIdx = lines.map((l, i) => (!l.noise && !l.total && l.cells.length >= 3 ? i : -1)).filter(i => i >= 0);
  }
  if (!dataIdx.length) return null;
  let first = dataIdx[0];
  const last = dataIdx[dataIdx.length - 1];

  // Header: the nearest mostly-text line just above the data (a header made of codes like “ICD10” can look
  // like data, so the first data line itself counts if it is mostly text and the next one isn't)
  let header = null;
  const fl = lines[first];
  if (dataIdx.length > 1 && textShare(fl) >= 0.7 && textShare(lines[dataIdx[1]]) < 0.7) {
    header = first;
    dataIdx = dataIdx.slice(1);
    first = dataIdx[0];
  } else {
    for (let k = first - 1; k >= Math.max(0, first - 4); k--) {
      const l = lines[k];
      if (l.noise) continue;
      if (l.cells.length >= 2 && textShare(l) >= 0.7) { header = k; break; }
    }
  }
  const { bounds, minX } = findBounds(dataIdx.map(i => lines[i]));

  // A header printed on two lines (“Patient” over “Name”): the line just above, close and all text,
  // with each of its cells inside one column
  let headerTop = header;
  if (header !== null && header > 0) {
    const up = lines[header - 1];
    const gap = up.y - lines[header].y;
    const fits = up.cells.every(c => bounds.filter(b => b > c.x0 + 2 && b < c.x1 - 2).length === 0);
    if (!up.noise && textShare(up) === 1 && gap < lines[header].h * 1.6 && up.cells.length <= lines[header].cells.length && fits) {
      headerTop = header - 1;
    }
  }
  return { dataIdx: new Set(dataIdx), first, last, header, headerTop, bounds, minX };
}

function buildTables(pages) {
  const tables = [];
  const other = [];
  let prev = null;

  for (const pg of pages) {
    const lines = pg.lines;
    const a = analysePage(lines);
    if (!a) { lines.forEach(l => other.push({ page: pg.page, text: l.text })); continue; }

    const headerCells = (bounds) => {
      if (a.header === null) return null;
      const names = assignLine(lines[a.header], bounds).cells;
      if (a.headerTop !== a.header) {
        const top = assignLine(lines[a.headerTop], bounds).cells;
        return names.map((n, i) => [top[i], n].filter(Boolean).join(' '));
      }
      return names;
    };
    const sig = a.header === null ? null : norm(lines[a.header].text);

    // Same table as before? Same header text, or (no header) data that fits the previous table's columns
    let t = sig ? tables.find(x => x.sig === sig) : null;
    if (!t && !sig && prev) {
      const dx = a.minX - prev.minX;
      const cells = [...a.dataIdx].flatMap(i => lines[i].cells);
      const crossing = cells.filter(c => prev.bounds.some(b => b + dx > c.x0 + 2 && b + dx < c.x1 - 2)).length;
      if (crossing <= cells.length * 0.1) t = prev;
    }
    const dx = t ? a.minX - t.minX : 0;
    const bounds = t ? t.bounds.map(b => b + dx) : a.bounds;
    if (!t) {
      t = { sig, bounds: a.bounds, minX: a.minX, header: headerCells(a.bounds), rows: [], sections: false };
      tables.push(t);
    } else if (!t.header && sig) {
      t.header = headerCells(bounds);
    }
    prev = t;

    let section = '';
    let lastRow = null;
    lines.forEach((l, i) => {
      if (a.header !== null && i >= a.headerTop && i <= a.header) return;
      const inside = i >= a.first && i <= a.last;
      const after = i > a.last && lastRow && lines[i - 1] && lines[i - 1].y - l.y < l.h * 1.8 && i === a.last + 1;
      if ((!inside && !after) || l.noise || l.total) { other.push({ page: pg.page, text: l.text }); return; }

      if (a.dataIdx.has(i)) {
        const r = assignLine(l, bounds);
        lastRow = { cells: r.cells, low: r.low, page: pg.page, section, y: l.y, h: l.h };
        t.rows.push(lastRow);
        return;
      }
      // Wrapped text belongs to the row above: close below it, text only, few cells
      const gap = lastRow ? lastRow.y - l.y : Infinity;
      if (lastRow && gap < l.h * 1.8 && textShare(l) === 1 && l.cells.length <= Math.ceil((bounds.length + 1) / 2)) {
        const r = assignLine(l, bounds);
        r.cells.forEach((c, ci) => { if (c) lastRow.cells[ci] = lastRow.cells[ci] ? `${lastRow.cells[ci]} ${c}` : c; });
        if (r.low) { lastRow.low ??= new Set(); r.low.forEach(x => lastRow.low.add(x)); }
        lastRow.y = l.y;
        return;
      }
      if (after) { other.push({ page: pg.page, text: l.text }); return; }
      // A single line between rows (“Payer: Medicare”, “Provider – Smith”) labels the rows below it
      if (l.cells.length === 1) {
        const m = l.text.match(/^([^:]{1,40}):\s*(.+)$/);
        section = m ? m[2].trim() : l.text;
        if (m && !t.sectionName) t.sectionName = m[1].trim();
        t.sections = true;
        return;
      }
      const r = assignLine(l, bounds);
      lastRow = { cells: r.cells, low: r.low, page: pg.page, section, y: l.y, h: l.h };
      t.rows.push(lastRow);
    });
  }

  return {
    tables: tables.filter(t => t.rows.length).map((t, i, all) => {
      const width = t.bounds.length + 1;
      let header = t.header ?? new Array(width).fill('');
      let rows = t.rows.map(r => ({ cells: r.cells, low: r.low, page: r.page, section: r.section }));
      if (t.sections) {
        header = [t.sectionName || 'Section', ...header];
        rows = rows.map(r => ({ ...r, cells: [r.section, ...r.cells], low: r.low && new Set([...r.low].map(c => c + 1)) }));
      }
      // Drop columns that never hold anything
      const keep = header.map((_, c) => !!header[c] || rows.some(r => r.cells[c]));
      const pick = arr => arr.filter((_, c) => keep[c]);
      const index = []; keep.forEach((k, c) => { if (k) index[c] = index.length; });
      return {
        name: all.length > 1 ? `Table ${i + 1}` : 'Table',
        header: pick(header),
        rows: rows.map(r => ({
          cells: pick(r.cells),
          low: r.low && new Set([...r.low].filter(c => keep[c]).map(c => index[c])),
          page: r.page,
        })),
      };
    }),
    other,
  };
}

// ── Records (Label: value) layout ─────────────────────────────────────────────

const LABEL_WORD = /^(?:[A-Za-z][A-Za-z.'/&()-]*#?|#)$/;
const GENERIC_LABEL = /^(?:#|no\.?|num|number|id|date|amount|amt|code|type|name)$/i;
const looksLabelCase =w => /^[A-Z][a-z]/.test(w) || /^[A-Z]{1,3}\.?#?$/.test(w) || w === '#' || /^[a-z]+$/.test(w);

// The words that could form a label, read backwards from just before a colon (at most 4)
function labelWords(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = words.length - 1; i >= 0 && out.length < 4; i--) {
    if (!LABEL_WORD.test(words[i])) break;
    out.unshift(words[i]);
  }
  return { words: out, before: words.slice(0, words.length - out.length).join(' ') };
}

function findPairs(pages) {
  // occurrences: { page, line, cell, s (segment), words (candidate label words) } → later label, k, value
  const occ = [];
  pages.forEach(pg => pg.lines.forEach((l, li) => {
    l.cells.forEach((c, ci) => {
      const text = c.text.replace(/([A-Za-z.])\s*#\s*(?=[A-Za-z0-9])(?!:)/g, '$1 #: ');
      if (!text.includes(':')) return;
      const segs = text.split(':');
      for (let s = 0; s < segs.length - 1; s++) {
        const { words } = labelWords(segs[s]);
        if (!words.length) continue;
        occ.push({ page: pg.page, line: li, cell: ci, s, words, nextSeg: segs[s + 1], lastSeg: s + 1 === segs.length - 1, nextCell: l.cells[ci + 1] });
      }
    });
  }));
  if (!occ.length) return [];

  // Pick each label: the longest run of words that also starts labels elsewhere in the file
  const freq = new Map();
  for (const o of occ) for (let k = 1; k <= o.words.length; k++) {
    const key = o.words.slice(-k).join(' ').toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  for (const o of occ) {
    const f1 = freq.get(o.words.slice(-1).join(' ').toLowerCase());
    let k = 1;
    if (f1 >= 2) {
      const need = Math.max(2, f1 * 0.3);
      for (let j = o.words.length; j >= 1; j--) {
        if (freq.get(o.words.slice(-j).join(' ').toLowerCase()) >= need) { k = j; break; }
      }
    } else {
      // seen once: keep the words that look like a label (Title Case or short codes)
      k = 0;
      for (let j = o.words.length - 1; j >= 0 && looksLabelCase(o.words[j]); j--) k++;
      k = Math.max(1, k);
    }
    // “#”, “No”, “ID”, “Date”… alone say little: keep the word before (“Check #”, “Claim No”)
    if (k < o.words.length && GENERIC_LABEL.test(o.words.slice(-k).join(' ')) && looksLabelCase(o.words[o.words.length - k - 1])) k++;
    o.label = o.words.slice(-k).join(' ').replace(/\s+#/, ' #');
    o.k = k;
  }
  // Values: the text up to the next label in the same cell, or the next cell when the label ends its cell
  occ.forEach((o, i) => {
    const n = occ[i + 1];
    let value = o.nextSeg;
    if (n && n.page === o.page && n.line === o.line && n.cell === o.cell && n.s === o.s + 1) {
      const words = o.nextSeg.trim().split(/\s+/);
      value = words.slice(0, Math.max(0, words.length - n.k)).join(' ');
    }
    o.usedNext = false;
    if (!value.trim() && o.lastSeg && o.nextCell && !o.nextCell.text.includes(':')) {
      value = o.nextCell.text;
      o.usedNext = true;
    }
    o.value = value.trim().replace(/[,;]$/, '');
  });
  return occ;
}

function buildRecords(pages) {
  const occ = findPairs(pages);
  const count = new Map();
  for (const o of occ) count.set(o.label.toLowerCase(), (count.get(o.label.toLowerCase()) ?? 0) + 1);
  const max = Math.max(0, ...count.values());
  const isRecordLabel = l => (count.get(l.toLowerCase()) ?? 0) >= Math.max(2, max * 0.5);
  const recordLabels = [...count.keys()].filter(isRecordLabel);

  // Labels printed once per page before any record label (Check #, Payee…) fill down onto the records after them
  const firstRecordLine = new Map();
  for (const o of occ) if (isRecordLabel(o.label)) {
    const k = o.page;
    if (!firstRecordLine.has(k) || o.line < firstRecordLine.get(k)) firstRecordLine.set(k, o.line);
  }
  const pageCount = pages.length;
  const isContext = o => !isRecordLabel(o.label) && (count.get(o.label.toLowerCase()) ?? 0) <= pageCount
    && o.line < (firstRecordLine.get(o.page) ?? Infinity);

  const columns = [];
  const colIndex = new Map();
  const col = label => {
    const k = label.toLowerCase();
    if (!colIndex.has(k)) { colIndex.set(k, columns.length); columns.push(label); }
    return colIndex.get(k);
  };
  const records = [];
  const context = {};
  let cur = null;
  const usedLines = new Set();
  const usedCells = new Set();
  for (const o of occ) {
    usedLines.add(`${o.page}|${o.line}`);
    usedCells.add(`${o.page}|${o.line}|${o.cell}`);
    if (o.usedNext) usedCells.add(`${o.page}|${o.line}|${o.cell + 1}`);
    if (isContext(o)) { context[col(o.label)] = o.value; continue; }
    const c = col(o.label);
    if (!cur || cur.values[c] !== undefined) {
      cur = { values: { ...context }, page: o.page };
      records.push(cur);
    }
    cur.values[c] = o.value;
  }

  const other = [];
  pages.forEach(pg => pg.lines.forEach((l, li) => {
    if (!usedLines.has(`${pg.page}|${li}`)) { other.push({ page: pg.page, text: l.text }); return; }
    const rest = l.cells.filter((_, ci) => !usedCells.has(`${pg.page}|${li}|${ci}`)).map(c => c.text).join('  ');
    if (rest.trim()) other.push({ page: pg.page, text: rest });
  }));

  return {
    tables: records.length ? [{
      name: 'Records',
      header: columns,
      rows: records.map(r => ({ cells: columns.map((_, i) => r.values[i] ?? ''), low: null, page: r.page })),
    }] : [],
    other,
    recordLabels: recordLabels.length,
    pairLines: usedLines.size,
  };
}

// ── Whole file ────────────────────────────────────────────────────────────────

export function structure(pages) {
  const prepared = pages.filter(p => p.rows.length || p.pieces?.length).map(p => ({ page: p.page, lines: toLines(pagePieces(p)) }));
  const table = buildTables(prepared);
  const records = buildRecords(prepared);
  const lineCount = prepared.reduce((s, p) => s + p.lines.filter(l => !l.noise).length, 0);
  const tableRows = table.tables.reduce((s, t) => s + t.rows.length, 0);
  const recordRows = records.tables[0]?.rows.length ?? 0;

  let auto = 'raw';
  if (recordRows >= 2 && records.recordLabels >= 3 && records.pairLines >= lineCount * 0.35) auto = 'records';
  else if (tableRows >= 2) auto = 'table';
  else if (recordRows >= 1 && records.recordLabels >= 2) auto = 'records';

  return {
    auto,
    table: table.tables, tableOther: table.other,
    records: records.tables, recordsOther: records.other,
    summary: { tableRows, recordRows, tables: table.tables.length, columns: table.tables[0]?.header.length ?? 0, recordColumns: records.tables[0]?.header.length ?? 0 },
  };
}

// ── Review: header, rename, remove, split names, sort, filter ─────────────────

const NAME_HEAD = /name|patient|member|beneficiary|insured|subscriber|guarantor|resident|client|\bpt\b/i;
const NOT_PERSON_HEAD = /provider|payer|payor|insurance|plan|facility|agency|company|doctor|physician|clinic|user|file|employee|staff|rendering|referring|attending/i;
const COMMA_NAME = /^[A-Za-z][A-Za-z'’ .-]*,\s*[A-Za-z][A-Za-z'’ .-]*$/;
const PLAIN_NAME = /^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){1,3}$/;

function columnKind(values) {
  const filled = values.filter(v => v && v.trim());
  if (!filled.length) return 'text';
  const tally = {};
  for (const v of filled) { const k = kindOf(v); tally[k] = (tally[k] ?? 0) + 1; }
  // amounts and plain numbers in one column are amounts
  if ((tally.amount ?? 0) && (tally.amount ?? 0) + (tally.number ?? 0) >= filled.length * 0.6) return 'amount';
  const [best, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return n >= filled.length * 0.6 ? best : 'text';
}

function isNameColumn(name, values) {
  const filled = values.filter(v => v && v.trim());
  if (filled.length < 1 || NOT_PERSON_HEAD.test(name)) return false;
  const comma = filled.filter(v => COMMA_NAME.test(v)).length / filled.length;
  if (comma >= 0.6) return true;
  const plain = filled.filter(v => COMMA_NAME.test(v) || PLAIN_NAME.test(v)).length / filled.length;
  return NAME_HEAD.test(name) && plain >= 0.6;
}

/** “DOE, JOHN A” → [DOE, JOHN A]; “DOE JOHN” (capitals, no comma) → last name first; “John Doe” → first name first. */
export function splitName(v) {
  const t = (v ?? '').trim();
  if (!t) return ['', ''];
  if (t.includes(',')) {
    const i = t.indexOf(',');
    return [t.slice(0, i).trim(), t.slice(i + 1).trim()];
  }
  const words = t.split(/\s+/);
  if (words.length === 1) return [t, ''];
  if (t === t.toUpperCase()) return [words[0], words.slice(1).join(' ')];
  return [words[words.length - 1], words.slice(0, -1).join(' ')];
}

const KIND_NAMES = { date: 'Date', amount: 'Amount', number: 'Number', id: 'ID', text: 'Text' };

/**
 * table: { header, rows } from structure(). edits: { headerRow (index into table.rows) | null, renames { key: name },
 * removed Set(keys), splitNames bool, sort { key, dir: 1 | -1 } | null, filter string }.
 * Column keys: original column index as text; split names add “L” / “F”.
 */
export function buildView(table, { headerRow = null, renames = {}, removed = new Set(), splitNames = true, sort = null, filter = '' } = {}) {
  let header = table.header;
  let rows = table.rows.map((r, index) => ({ ...r, index }));   // index = position in table.rows (for “use as header”)
  if (headerRow !== null && rows[headerRow]) {
    const key = rows[headerRow].cells.map(norm).join('|');
    header = rows[headerRow].cells;
    rows = rows.filter(r => r.cells.map(norm).join('|') !== key);
  }
  // A header repeated inside the data (page tops read as rows) is dropped everywhere
  const headerKey = header.map(norm).join('|');
  if (header.some(h => h.trim())) rows = rows.filter(r => r.cells.map(norm).join('|') !== headerKey);

  const width = rows.reduce((m, r) => Math.max(m, r.cells.length), header.length);
  const columns = [];
  const used = new Map();
  const uniq = n => { const c = (used.get(n) ?? 0) + 1; used.set(n, c); return c === 1 ? n : `${n} ${c}`; };
  const nameCols = [];
  for (let c = 0; c < width; c++) {
    const values = rows.map(r => r.cells[c] ?? '');
    const kind = columnKind(values);
    const fromFile = (header[c] ?? '').trim();
    if (splitNames && isNameColumn(fromFile, values)) nameCols.push(c);
    columns.push({ c, kind, fromFile });
  }
  const out = [];
  for (const col of columns) {
    const k = String(col.c);
    if (nameCols.includes(col.c)) {
      const base = nameCols.length > 1 ? `${col.fromFile || 'Name'} – ` : '';
      out.push({ key: `${k}L`, c: col.c, part: 0, kind: 'text', name: renames[`${k}L`] || uniq(`${base}Last Name`) });
      out.push({ key: `${k}F`, c: col.c, part: 1, kind: 'text', name: renames[`${k}F`] || uniq(`${base}First Name`) });
    } else {
      const auto = col.fromFile || (isNameColumn('name', rows.map(r => r.cells[col.c] ?? '')) ? 'Name' : KIND_NAMES[col.kind]);
      out.push({ key: k, c: col.c, part: null, kind: col.kind, name: renames[k] || uniq(auto) });
    }
  }
  const visible = out.filter(o => !removed.has(o.key));

  let result = rows.map(r => ({
    cells: visible.map(o => {
      const v = r.cells[o.c] ?? '';
      return o.part === null ? v : splitName(v)[o.part];
    }),
    low: r.low ? new Set(visible.map((o, i) => (r.low.has(o.c) ? i : -1)).filter(i => i >= 0)) : null,
    page: r.page,
    index: r.index,
  }));

  const q = filter.trim().toLowerCase();
  if (q) result = result.filter(r => r.cells.some(c => c.toLowerCase().includes(q)));

  const si = sort ? visible.findIndex(o => o.key === sort.key) : -1;
  if (si >= 0) {
    const kind = visible[si].kind;
    const val = v => {
      if (!v) return null;
      if (kind === 'date') return parseDate(v)?.getTime() ?? null;
      if (kind === 'amount' || kind === 'number') return toNumber(v);
      return v.toLowerCase();
    };
    result = result
      .map((r, i) => ({ r, i, v: val(r.cells[si]) }))
      .sort((a, b) => {
        if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;   // blanks last
        const d = typeof a.v === 'number' ? a.v - b.v : a.v.localeCompare(b.v, undefined, { numeric: true });
        return d * sort.dir || a.i - b.i;
      })
      .map(x => x.r);
  }
  return { columns: visible.map(o => ({ key: o.key, name: o.name, kind: o.kind })), allColumns: out, rows: result, total: rows.length };
}
