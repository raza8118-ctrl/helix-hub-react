// Builds a FAKE "RTP Productivity Report"-style PDF for testing File Tools → PDF to Excel (Clean table).
// Every name and number is made up. Output goes to samples/ (gitignored — never committed):
//   samples/fake-rtp-productivity.pdf   the report
//   samples/fake-rtp-expected.json      the rows the Clean table should produce
// Run:  node scripts/make-sample-rtp-pdf.mjs
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 792, H = 612, SIZE = 7, LINE = 10;
// [header, x, align]
const COLS = [
  ['Worked', 20], ['Provider', 64], ['NPI', 104], ['Location', 156], ['Name', 196], ['BNF ID', 296], ['PCN', 350],
  ['MRN', 428], ['Charges', 522, 'right'], ['TOB', 532], ['FromDt', 558], ['ThruDt', 600], ['S/L', 642], ['Reason', 660],
  ['Days', 752, 'right'], ['SV', 772, 'right'],
];
const NAME_W = 96, PCN_W = 74, REASON_W = 84;   // wider text wraps onto the next line

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const digits = n => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
const LAST = ['ZORVANDEL', 'QUELLINGHAM-ASHFORTH', 'MARVETTI', 'PLONKERWICZ', 'TESSALINE', 'VORMBRIDGE-HALLOWAY', 'KESTRIN', 'ORBALDO'];
const FIRST = ['ALEXANDRIANA', 'BRIX', 'CORVALEE', 'DESMONDO', 'EULALIETTE', 'FINNIGAR', 'GWENDOLYN', 'HOLT'];
const REASONS = ['Missing HIPPS code', 'Invalid occurrence code for this type of bill', 'NPI mismatch', 'Dates overlap prior claim on file', 'Missing attending NPI'];
const date = (m, d) => `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/2026`;

function makeRecords(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const from = 1 + Math.floor(rnd() * 20);
    out.push({
      Section: i < Math.ceil(n * 0.7) ? 'All Provider(s)' : 'Moved Out of RTP',
      Worked: date(10, 1 + (i % 28)),
      Provider: '00' + digits(4),                       // leading zeros must survive
      NPI: '1' + digits(9),
      Location: 'HH' + String(1 + (i % 4)).padStart(2, '0'),
      Name: `${pick(LAST)}, ${pick(FIRST)}`,
      'BNF ID': digits(1) + 'EG' + digits(1) + 'TE' + digits(1) + 'MK' + digits(2),
      PCN: (i % 3 === 0 ? 'PCN' + digits(18) : 'PCN' + digits(9)),   // some too long for the column → split over two lines
      MRN: '000' + digits(6),
      Charges: Math.round(rnd() * 900000) / 100,
      TOB: pick(['0322', '0329', '0811', '0329']),
      FromDt: date(9, from),
      ThruDt: date(9, from + 7),
      'S/L': pick(['S', 'L']),
      Reason: pick(REASONS),
      Days: String(5 + Math.floor(rnd() * 25)),
      SV: String(1 + Math.floor(rnd() * 9)),
    });
  }
  return out;
}

const money = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function wrap(font, text, width) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, SIZE) <= width) lines[lines.length - 1] = next;
    else lines.push(w);
  }
  return lines;
}
function splitLong(font, text, width) {   // IDs break mid-string, like report writers do
  const out = [];
  let cur = '';
  for (const ch of text) {
    if (font.widthOfTextAtSize(cur + ch, SIZE) > width) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const records = makeRecords(64);
const PER_PAGE = 24;
const pages = Math.ceil(records.length / PER_PAGE);

const text = (page, s, x, y, { f = font, align = 'left', size = SIZE } = {}) => {
  const w = f.widthOfTextAtSize(s, size);
  page.drawText(s, { x: align === 'right' ? x - w : x, y, size, font: f });
};

let section = null;
for (let p = 0; p < pages; p++) {
  const page = doc.addPage([W, H]);
  // Page junk: company, address, logo, title, report date — repeated on every page
  text(page, 'WAYSTAR', 700, 585, { f: bold, size: 12 });
  text(page, 'Demo Home Health Billing Co (FAKE)', 20, 590, { f: bold, size: 9 });
  text(page, '123 Sample Street, Testville, TX 75000', 20, 579);
  text(page, 'RTP Productivity Report', 330, 572, { f: bold, size: 11 });
  text(page, 'Report Date: 10/31/2026', 20, 560);
  // Column headers
  let y = 540;
  for (const [h, x, align] of COLS) text(page, h, x, y, { f: bold, align });
  y -= LINE * 1.4;
  section = null;   // the band is shown again on each page

  for (const r of records.slice(p * PER_PAGE, (p + 1) * PER_PAGE)) {
    if (r.Section !== section) {
      section = r.Section;
      text(page, section, 20, y, { f: bold });
      y -= LINE;
    }
    const nameLines = wrap(font, r.Name, NAME_W);
    const pcnLines = splitLong(font, r.PCN, PCN_W);
    const reasonLines = wrap(font, r.Reason, REASON_W);
    const lines = Math.max(nameLines.length, pcnLines.length, reasonLines.length);
    const cell = { ...r, Charges: money(r.Charges) };
    for (const [h, x, align] of COLS) {
      if (h === 'Name' || h === 'PCN' || h === 'Reason') continue;
      text(page, cell[h], x, y, { align });
    }
    for (let k = 0; k < lines; k++) {
      if (nameLines[k]) text(page, nameLines[k], 196, y - k * LINE);
      if (pcnLines[k]) text(page, pcnLines[k], 350, y - k * LINE);
      if (reasonLines[k]) text(page, reasonLines[k], 660, y - k * LINE);
    }
    y -= LINE * lines;
  }
  // Footer junk
  text(page, `Page ${p + 1} of ${pages}`, 370, 24);
  text(page, '© 2026 Waystar. All rights reserved. Confidential.', 20, 24);
}

mkdirSync('samples', { recursive: true });
writeFileSync('samples/fake-rtp-productivity.pdf', await doc.save());
writeFileSync('samples/fake-rtp-expected.json', JSON.stringify({ pages, rows: records }, null, 1));
console.log(`samples/fake-rtp-productivity.pdf — ${pages} pages, ${records.length} rows (all fake)`);
