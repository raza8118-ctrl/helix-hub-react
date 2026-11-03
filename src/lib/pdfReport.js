// File Tools → PDF to Excel "Clean table" (PO request 2026-11-03). Rebuilds a printed report (e.g. Waystar "RTP
// Productivity Report") as one row per record, from the positions of the words on each page:
//   1. the header row gives the columns — each header's left / right edge sets its column's range;
//   2. every word goes into the column it overlaps most;
//   3. a row starts only when the first ("key") column holds a date — any other line is joined onto the row above
//      (text columns with a space, ID columns such as NPI / BNF ID / PCN / MRN with none);
//   4. page junk (titles, addresses, report date, repeated headers, "Page X of Y", copyright / logo lines, lines that
//      repeat on most pages) is removed; section bands ("All Provider(s)") become a Section column;
//   5. dates, amounts and plain numbers are typed for Excel; IDs stay text.
// Runs in the browser only. Shows and exports every field as printed (PO request) — nothing is masked or logged.
import { parseDate, kindOf } from './pdfStructure';
import { toNumber } from './pdfExtract';

const PAGE_RE = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*(?:of|\/)\s*\d+|-\s*\d+\s*-)$/i;
const PAGE_ANYWHERE = /\bpage\s+\d+\s+(?:of|\/)\s+\d+\b/i;
const COPYRIGHT_RE = /©|\(c\)\s*\d{4}|copyright|all rights reserved|confidential|proprietary/i;
const TOTAL_RE = /^(?:sub[\s-]?totals?|totals?|grand\s+totals?|page\s+totals?|report\s+totals?|count)\b/i;
const ID_HEAD = /\b(?:npi|provider|bnf|mbi|hic[n]?|pcn|mrn|icn|dcn|acct|account|claim|member|policy|subscriber|tin|tax|id|#)\b/i;
const DATE_HEAD = /(?:date|dt\b|dt$|worked|from|thru|through|dos|admit|discharge)/i;
const AMOUNT_HEAD = /(?:charge|amount|amt|balance|paid|billed|allowed|payment|adjust|\$)/i;
const NAME_HEAD = /name|patient|beneficiary/i;
const BNF_HEAD = /\bbnf\b|\bmbi\b|\bhic|member\s*id|beneficiary\s*id/i;

const norm = s => s.toLowerCase().replace(/[^a-z0-9/#$]+/g, ' ').trim();

// ── Pieces → lines ────────────────────────────────────────────────────────────

// A text item holding several values separated by 2+ spaces is split, with positions estimated from character counts
function splitWide(p) {
  if (!/\S\s{2,}\S/.test(p.str)) return [p];
  const cw = p.w / p.str.length;
  return [...p.str.matchAll(/\S+(?:[ \t]\S+)*/g)].map(m => ({ ...p, x: p.x + m.index * cw, w: m[0].length * cw, str: m[0] }));
}

function toLines(pieces) {
  const ps = pieces.filter(p => p.str?.trim()).flatMap(splitWide).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of ps) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) <= Math.max(2, p.h * 0.45)) line.items.push(p);
    else lines.push({ y: p.y, items: [p] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map(i => i.str.trim()).join(' ');
  }
  return lines;
}

// Neighbouring words with a small gap are one cell ("BNF" + "ID" → "BNF ID")
function mergeWords(items) {
  const cells = [];
  for (const p of items) {
    const last = cells[cells.length - 1];
    if (last && p.x - last.x1 < Math.max(2.5, p.h * 0.45)) {
      last.text += (p.x - last.x1 > p.h * 0.12 ? ' ' : '') + p.str.trim();
      last.x1 = Math.max(last.x1, p.x + p.w);
    } else cells.push({ x0: p.x, x1: p.x + p.w, text: p.str.trim(), h: p.h });
  }
  return cells;
}

// ── Header row ────────────────────────────────────────────────────────────────

function looksLikeHeader(cells) {
  if (cells.length < 4) return false;
  const words = cells.filter(c => /^[A-Za-z][A-Za-z0-9 /#$().'-]{0,24}$/.test(c.text) && kindOf(c.text) !== 'date');
  return words.length >= cells.length * 0.8;
}

/** Finds the header line on each page: by a template's header names, or by the line that repeats as a header. */
function findHeaders(pageLines, template) {
  const found = pageLines.map(lines => {
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      const cells = mergeWords(lines[i].items);
      if (template) {
        const names = new Set(cells.map(c => norm(c.text)));
        const hits = template.headers.filter(h => names.has(norm(h.text))).length;
        if (hits >= Math.max(3, template.headers.length * 0.7)) return { index: i, cells };
      } else if (looksLikeHeader(cells)) {
        return { index: i, cells, sig: cells.map(c => norm(c.text)).join('|') };
      }
    }
    return null;
  });
  if (template) return found;
  // Without a template, keep the header signature found on most pages (a title line can look header-like once)
  const counts = new Map();
  found.forEach(f => f && counts.set(f.sig, (counts.get(f.sig) ?? 0) + 1));
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].split('|').length - a[0].split('|').length)[0]?.[0];
  return found.map(f => (f && f.sig === best ? f : null));
}

// Column ranges: halfway between one header's right edge and the next one's left edge
function rangesFrom(headers) {
  return headers.map((h, i) => ({
    name: h.text,
    lo: i === 0 ? -Infinity : (headers[i - 1].x1 + h.x0) / 2,
    hi: i === headers.length - 1 ? Infinity : (h.x1 + headers[i + 1].x0) / 2,
  }));
}

function columnOf(item, ranges) {
  const x0 = item.x, x1 = item.x + item.w;
  let best = -1, bestOverlap = -1;
  ranges.forEach((r, i) => {
    const o = Math.min(x1, r.hi) - Math.max(x0, r.lo);
    if (o > bestOverlap) { bestOverlap = o; best = i; }
  });
  // Doesn't fit: its centre lies outside the column, or most of it sits in other columns (long text running a little
  // under an empty neighbour is fine)
  const fit = item.w > 0 ? bestOverlap / item.w : 1;
  const mid = (x0 + x1) / 2;
  return { col: best, misfit: fit < 0.35 || mid < ranges[best].lo || mid > ranges[best].hi };
}

// ── Kinds ─────────────────────────────────────────────────────────────────────

function guessKinds(names, rows) {
  return names.map((name, c) => {
    const vals = rows.map(r => r.cells[c]).filter(Boolean);
    const share = k => (vals.length ? vals.filter(v => kindOf(v) === k || (k === 'amount' && kindOf(v) === 'number')).length / vals.length : 0);
    if (ID_HEAD.test(name) && !DATE_HEAD.test(name)) return 'id';
    if (DATE_HEAD.test(name) && share('date') >= 0.8) return 'date';
    if (AMOUNT_HEAD.test(name) && vals.every(v => toNumber(v) !== null)) return 'amount';
    if (vals.length && vals.every(v => /^-?\d{1,6}(?:\.\d+)?$/.test(v)) && !vals.some(v => /^0\d/.test(v))) return 'number';
    if (share('date') >= 0.9) return 'date';
    return 'text';
  });
}

// ── Build ─────────────────────────────────────────────────────────────────────

/**
 * pages: [{ page, pieces: [{ x, y, w, h, str }] }] (in-browser reader / OCR).
 * template (optional): { name, headers: [{ text, x0, x1 }], keyColumn, kinds: { [header]: kind }, sections: [] }.
 * → null when no header row is found, else
 *   { columns: [{ name, kind }], rows: [{ page, section, cells: string[], misfit: string[] }], removed: [{ page, text, why }],
 *     headers: [{ text, x0, x1 }], keyColumn, hasSections }
 */
export function buildReport(pages, template = null) {
  const pageLines = pages.map(p => toLines(p.pieces ?? []));
  const found = findHeaders(pageLines, template);
  const first = found.find(Boolean);
  if (!first) return null;

  const tmplHeaders = template?.headers?.length ? template.headers : null;
  const baseHeaders = (tmplHeaders ?? first.cells.map(c => ({ text: c.text, x0: c.x0, x1: c.x1 })));
  const names = baseHeaders.map(h => h.text);
  const keyColumn = template?.keyColumn ?? 0;
  const knownSections = new Set((template?.sections ?? []).map(norm));
  const headerSig = names.map(norm).join(' ');

  // Lines that sit at the same height with the same text on most pages are page furniture
  const repeated = new Map();
  if (pages.length >= 3) {
    pageLines.forEach(lines => {
      const seen = new Set();
      lines.forEach(l => { const k = `${Math.round(l.y / 3)}|${norm(l.text)}`; if (!seen.has(k)) { seen.add(k); repeated.set(k, (repeated.get(k) ?? 0) + 1); } });
    });
  }
  const isRepeated = l => (repeated.get(`${Math.round(l.y / 3)}|${norm(l.text)}`) ?? 0) >= Math.max(3, pages.length * 0.6);

  const rows = [];
  const removed = [];
  let section = null;
  let current = null;
  const idCols = new Set(names.map((n, i) => (template?.kinds?.[n] ?? (ID_HEAD.test(n) && !DATE_HEAD.test(n) ? 'id' : '')) === 'id' ? i : -1).filter(i => i >= 0));

  pageLines.forEach((lines, pi) => {
    const pageNo = pages[pi].page ?? pi + 1;
    const header = found[pi];
    const pageHeaders = header && !template
      ? header.cells.map(c => ({ text: c.text, x0: c.x0, x1: c.x1 }))
      : header && template
        ? baseHeaders.map(h => { const c = header.cells.find(x => norm(x.text) === norm(h.text)); return c ? { text: h.text, x0: c.x0, x1: c.x1 } : h; })
        : baseHeaders;
    const ranges = rangesFrom(pageHeaders.length === names.length ? pageHeaders : baseHeaders);
    const start = header ? header.index + 1 : 0;

    lines.forEach((l, li) => {
      const text = l.text.trim();
      if (header && li < header.index) { removed.push({ page: pageNo, text, why: 'Page heading' }); return; }
      if (header && li === header.index) return;   // the header itself
      if (li < start) return;
      if (norm(text) === headerSig) { removed.push({ page: pageNo, text, why: 'Repeated column headers' }); return; }
      if (PAGE_RE.test(text) || PAGE_ANYWHERE.test(text)) { removed.push({ page: pageNo, text, why: 'Page number' }); return; }
      if (COPYRIGHT_RE.test(text)) { removed.push({ page: pageNo, text, why: 'Copyright / logo' }); return; }

      // Words → columns
      const cells = new Array(names.length).fill('');
      const misfit = new Set();
      for (const item of l.items) {
        const { col, misfit: off } = columnOf(item, ranges);
        const s = item.str.trim();
        cells[col] = cells[col] ? `${cells[col]} ${s}` : s;
        if (off) misfit.add(names[col]);
      }
      const key = cells[keyColumn];
      const startsRecord = !!key && kindOf(key) === 'date';

      if (!startsRecord) {
        // Section band: text in the key column that isn't a date (or a known section name), nothing much else
        const filled = cells.filter(Boolean).length;
        if ((key && filled <= 2) || knownSections.has(norm(text))) {
          section = text;
          return;
        }
        if (TOTAL_RE.test(text)) { removed.push({ page: pageNo, text, why: 'Totals line' }); return; }
        if (isRepeated(l)) { removed.push({ page: pageNo, text, why: 'Repeats on every page' }); return; }
        if (!current) { removed.push({ page: pageNo, text, why: 'Before the first row' }); return; }
        // Wrapped line → join onto the row above, column by column
        cells.forEach((v, c) => {
          if (!v) return;
          const prev = current.cells[c];
          current.cells[c] = !prev ? v : idCols.has(c) ? prev + v : `${prev} ${v}`;
        });
        misfit.forEach(m => current.misfit.add(m));
        return;
      }

      current = { page: pageNo, section, cells, misfit };
      rows.push(current);
    });
  });

  const kinds = names.map(n => template?.kinds?.[n] ?? null);
  const guessed = guessKinds(names, rows);
  const columns = names.map((n, i) => ({ name: n, kind: kinds[i] ?? guessed[i] }));
  return {
    columns,
    rows: rows.map(r => ({ ...r, misfit: [...r.misfit] })),
    removed,
    headers: baseHeaders,
    keyColumn,
    hasSections: rows.some(r => r.section),
  };
}

/** Typed value for Excel / totals: Date for dates, number for amounts and numbers, text otherwise (IDs always text). */
export function typedValue(v, kind) {
  if (!v) return '';
  if (kind === 'date') return parseDate(v) ?? v;
  if (kind === 'amount' || kind === 'number') { const n = toNumber(v); return n === null ? v : n; }
  return v;
}

/** The checks shown before download. */
export function reportChecks(report) {
  const { columns, rows } = report;
  const find = re => columns.findIndex(c => re.test(c.name));
  const nameCol = find(NAME_HEAD);
  const bnfCol = find(BNF_HEAD);
  const amountCol = columns.findIndex(c => c.kind === 'amount');
  const perPage = new Map();
  rows.forEach(r => perPage.set(r.page, (perPage.get(r.page) ?? 0) + 1));
  const blank = col => (col < 0 ? null : rows.map((r, i) => (r.cells[col] ? -1 : i)).filter(i => i >= 0));
  const total = amountCol < 0 ? null : rows.reduce((s, r) => s + (toNumber(r.cells[amountCol]) ?? 0), 0);
  return {
    total: rows.length,
    perPage: [...perPage.entries()].map(([page, count]) => ({ page, count })),
    blanks: [
      { column: columns[nameCol]?.name, rows: blank(nameCol) },
      { column: columns[bnfCol]?.name, rows: blank(bnfCol) },
      { column: columns[amountCol]?.name, rows: blank(amountCol) },
    ].filter(b => b.column),
    amountColumn: columns[amountCol]?.name ?? null,
    totalAmount: total,
    misfits: rows.map((r, i) => (r.misfit.length ? { row: i, columns: r.misfit } : null)).filter(Boolean),
  };
}
