// ICD-10-CM yearly files (PO 2026-11-11): reads one CSV in the background so the page never freezes, works out which of
// the four files it is from its header, and hands rows back 1,000 at a time in the shape the import function expects.
// Reference data only (codes, notes, index terms) — no patient data.

let rows = [];
let kind = null;

/** RFC-4180 CSV: quotes, commas and line breaks inside quotes. */
function parseCsv(text) {
  const out = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c !== '')) out.push(row);
  return out;
}

const norm = h => String(h ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
const code = v => String(v ?? '').trim().toUpperCase().replace(/\./g, '');
const txt = v => { const s = String(v ?? '').trim(); return s === '' ? null : s; };

function detect(head) {
  const h = head.map(norm);
  const has = s => h.some(x => x.startsWith(s));
  if (has('billable') && has('long description')) return 'codes';
  if (has('note type')) return 'notes';
  if (has('index term')) return 'index';
  if (h[0] === 'change' && has('description')) return 'changes';
  return null;
}

function map(k, head, grid) {
  const h = head.map(norm);
  const col = (...names) => h.findIndex(x => names.some(n => x === n || x.startsWith(n)));
  if (k === 'codes') {
    const c = { code: col('code (with dot)', 'code'), plain: h.indexOf('code'), bill: col('billable'), short: col('short description'), long: col('long description'),
      chapter: col('chapter'), section: col('section'), change: h.findIndex(x => /^fy\d{4} change/.test(x)) };
    return grid.map(r => {
      const ch = norm(r[c.change]);
      return { code: code(r[c.plain >= 0 ? c.plain : c.code]), billable: /^yes/i.test(String(r[c.bill] ?? '').trim()), short: txt(r[c.short]), long: txt(r[c.long]),
        chapter: txt(r[c.chapter]), section: txt(r[c.section]), change: ch.startsWith('new') ? 'new' : ch.startsWith('revis') ? 'revised' : null };
    });
  }
  if (k === 'notes') {
    const c = { code: col('code'), type: col('note type'), note: h.indexOf('note') };
    return grid.map(r => ({ code: code(r[c.code]), type: txt(r[c.type]) ?? 'Note', note: txt(r[c.note]) }));
  }
  if (k === 'index') {
    const c = { term: col('index term'), code: h.indexOf('code'), see: h.indexOf('see'), also: col('see also') };
    return grid.map(r => ({ term: txt(r[c.term]), code: c.code >= 0 ? code(r[c.code]) || null : null, see: txt(r[c.see]), see_also: txt(r[c.also]) }));
  }
  const c = { change: col('change'), code: col('code'), desc: col('description') };
  return grid.map(r => ({ change: txt(r[c.change]), code: code(r[c.code]), description: txt(r[c.desc]) }));
}

self.onmessage = async e => {
  const { cmd } = e.data;
  try {
    if (cmd === 'load') {
      const text = await e.data.file.text();
      const grid = parseCsv(text);
      const head = grid.shift() ?? [];
      kind = detect(head);
      if (!kind) { self.postMessage({ cmd: 'loaded', error: 'This file isn’t one of the four ICD-10-CM files (codes, coding notes, index terms, changes).' }); return; }
      rows = map(kind, head, grid);
      const fy = head.map(norm).map(x => x.match(/^fy(\d{4})/)?.[1]).find(Boolean) ?? null;
      self.postMessage({ cmd: 'loaded', kind, total: rows.length, fy: fy ? Number(fy) : null });
    } else if (cmd === 'batch') {
      self.postMessage({ cmd: 'batch', start: e.data.start, rows: rows.slice(e.data.start, e.data.start + (e.data.size ?? 1000)) });
    }
  } catch (err) {
    self.postMessage({ cmd: e.data.cmd === 'load' ? 'loaded' : 'batch', error: String(err?.message ?? err) });
  }
};
