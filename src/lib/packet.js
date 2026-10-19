// Appeal Packet builder (roadmap 2.5) — runs entirely in the browser.
// Cover sheet + sections in order → one PDF, optional "Page X of Y" stamps, file name from a convention.

import { readPdf } from './pdfTools';
import { readImageFile, buildImagesPdf } from './imageToPdf';

export const PACKET_SECTIONS = [
  { id: 'letter',  label: 'Cover letter' },
  { id: 'form',    label: 'Appeal / Recon form' },
  { id: 'eob',     label: 'EOB / Denial letter' },
  { id: 'auth',    label: 'Auth approval' },
  { id: 'records', label: 'Medical records' },
  { id: 'other',   label: 'Other' },
];

export const PACKET_TYPES = ['Appeal', 'Reconsideration', 'Corrected claim', 'Other'];

// ── Files → PDF bytes ─────────────────────────────────────────────────────────

/** Any File Tools input (PDF or image) → { bytes, pageCount }. Images go on Letter pages with a small margin. */
export async function fileToPdf(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return readPdf(file);
  const images = await readImageFile(file);
  const bytes = await buildImagesPdf(images.map(i => ({ ...i, rotation: 0 })), { pageSize: 'letter', margin: 'small' });
  return { bytes, pageCount: images.length };
}

// ── File name convention ──────────────────────────────────────────────────────

export const NAMING_TOKENS = [
  { token: '{ClaimNo}',     label: 'Claim #' },
  { token: '{Payer}',       label: 'Payer short name' },
  { token: '{Client}',      label: 'Client code' },
  { token: '{Type}',        label: 'Packet type' },
  { token: '{Date}',        label: 'Today (YYYY-MM-DD)' },
  { token: '{DOS}',         label: 'Date of service' },
  { token: '{PatientLast}', label: 'Patient last name' },
];
export const DEFAULT_NAMING = '{ClaimNo}_{Payer}_{Type}_{Date}';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const safePart = s => (s ?? '').toString().trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');

/** "{ClaimNo}_{Payer}_{Type}_{Date}" + values → "A123_BCBSTX_Appeal_2026-10-19.pdf"; empty tokens drop out cleanly. */
export function applyNaming(template, values) {
  const map = {
    '{ClaimNo}': values.claimNo, '{Payer}': values.payer, '{Client}': values.client, '{Type}': values.type,
    '{Date}': today(), '{DOS}': values.dos, '{PatientLast}': values.patientLast,
  };
  let name = (template || DEFAULT_NAMING).replace(/\{[A-Za-z]+\}/g, t => safePart(map[t] ?? ''));
  name = name.replace(/([_\-. ])\1+/g, '$1').replace(/^[_\-. ]+|[_\-. ]+$/g, '').replace(/[_\-. ]+(?=[_\-. ])/g, '');
  return `${name || 'appeal-packet'}.pdf`;
}

// ── Cover sheet ───────────────────────────────────────────────────────────────

// Standard PDF font covers Latin-1 only; anything else prints as "?"
const ansi = s => (s ?? '').toString().replace(/[\r\t]+/g, ' ').replace(/[^\n\x20-\x7e\xa0-\xff–—‘’“”•…]/g, '?');

/**
 * info: { type, payerName, fax, phone, address, claimNo, patient, memberId, dos, sentBy, notes }
 * contents: [{ label, from, to }] (page ranges in the finished packet)
 */
async function buildCoverSheet(info, contents) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 54;
  let y = 792 - 64;
  const line = (label, value, size = 11) => {
    if (!value) return;
    page.drawText(ansi(label), { x: L, y, size, font: bold });
    const lines = ansi(value).split('\n');
    lines.forEach((t, i) => page.drawText(t.slice(0, 80), { x: L + 140, y: y - i * (size + 3), size, font }));
    y -= Math.max(1, lines.length) * (size + 3) + 6;
  };

  page.drawText(ansi(`${info.type || 'Appeal'} Packet`), { x: L, y, size: 22, font: bold });
  y -= 14;
  page.drawLine({ start: { x: L, y }, end: { x: 612 - L, y }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
  y -= 26;

  line('To:', info.payerName);
  line('Fax:', info.fax);
  line('Phone:', info.phone);
  line('Mail to:', info.address);
  y -= 6;
  line('Claim #:', info.claimNo);
  line('Patient:', info.patient);
  line('Member ID:', info.memberId);
  line('Date(s) of service:', info.dos);
  line('Sent by:', info.sentBy);
  line('Date sent:', today());
  line('Notes:', info.notes);

  y -= 10;
  page.drawText('Contents', { x: L, y, size: 13, font: bold });
  y -= 20;
  for (const c of contents) {
    const pages = c.from === c.to ? `page ${c.from}` : `pages ${c.from}–${c.to}`;
    page.drawText(ansi(c.label), { x: L + 10, y, size: 11, font });
    page.drawText(ansi(pages), { x: 612 - L - font.widthOfTextAtSize(ansi(pages), 11), y, size: 11, font });
    y -= 17;
    if (y < 80) break;
  }
  const total = contents.length ? contents[contents.length - 1].to : 1;
  page.drawText(ansi(`Total pages including this cover: ${total}`), { x: L, y: 60, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
  page.drawText('CONFIDENTIAL — contains protected health information.', { x: L, y: 44, size: 9, font: bold, color: rgb(0.45, 0.1, 0.1) });
  return pdf.save();
}

// ── Page numbers ──────────────────────────────────────────────────────────────

// Draws text at the visual bottom-right of a page, whatever its /Rotate value
function stampBottomRight(page, text, font, degrees, size = 9, margin = 18) {
  const { x: bx, y: by, width: w, height: h } = page.getMediaBox();
  const tw = font.widthOfTextAtSize(text, size);
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const at = {
    0:   { x: bx + w - margin - tw, y: by + margin,          r: 0 },
    90:  { x: bx + w - margin,      y: by + h - margin - tw, r: 90 },
    180: { x: bx + margin + tw,     y: by + h - margin,      r: 180 },
    270: { x: bx + margin,          y: by + margin + tw,     r: 270 },
  }[rot] ?? { x: bx + w - margin - tw, y: by + margin, r: 0 };
  page.drawText(text, { x: at.x, y: at.y, size, font, rotate: degrees(at.r) });
}

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * sections: [{ label, files: [{ bytes, pageCount }] }] in order (empty sections are skipped).
 * options: { cover: info | null, pageNumbers: bool, prefix: string }
 * → Uint8Array (the finished packet)
 */
export async function assemblePacket(sections, { cover = null, pageNumbers = true, prefix = '' } = {}) {
  const { PDFDocument, StandardFonts, degrees } = await import('pdf-lib');
  const used = sections.filter(s => s.files.length);

  // Page ranges for the contents list
  let next = cover ? 2 : 1;
  const contents = used.map(s => {
    const n = s.files.reduce((a, f) => a + f.pageCount, 0);
    const range = { label: s.label, from: next, to: next + n - 1 };
    next += n;
    return range;
  });

  const out = await PDFDocument.create();
  if (cover) {
    const coverDoc = await PDFDocument.load(await buildCoverSheet(cover, contents));
    const [p] = await out.copyPages(coverDoc, [0]);
    out.addPage(p);
  }
  for (const s of used) {
    for (const f of s.files) {
      const src = await PDFDocument.load(f.bytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
  }

  if (pageNumbers) {
    const font = await out.embedFont(StandardFonts.Helvetica);
    const all = out.getPages();
    const pre = ansi(prefix.trim());
    all.forEach((p, i) => stampBottomRight(p, `${pre ? `${pre} – ` : ''}Page ${i + 1} of ${all.length}`, font, degrees));
  }
  return out.save();
}
