// Appeal PDF (roadmap 5.4) — built entirely in the browser with pdf-lib; never uploaded, saved or logged.
// Order: fax cover sheet (no patient details) → cover letter → payer form (pre-filled when it has a field map).
import { APPEAL_LEVELS, DENIAL_TYPES } from './appeals';

const pdfLib = () => import('pdf-lib');
const PAGE = [612, 792];   // US Letter

// Standard PDF fonts cover Latin-1 only; anything else prints as "?"
const ansi = s => (s ?? '').toString().replace(/[\r\t]+/g, ' ').replace(/[^\n\x20-\x7e\xa0-\xff–—‘’“”•…]/g, '?');
const todayUS = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; };

// ── Cover letter ────────────────────────────────────────────────────────────

/** Splits one paragraph into lines that fit `width` at `size`. */
function wrap(text, font, size, width) {
  const words = text.split(/(\s+)/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line + w;
    if (font.widthOfTextAtSize(next, size) <= width || !line.trim()) { line = next; continue; }
    lines.push(line.trimEnd());
    line = w.trimStart();
    // A single word longer than the line: hard-break it
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  lines.push(line.trimEnd());
  return lines;
}

/** The letter text on Letter-size pages: Times 12 pt, 1" margins, wrapped, "Page X of Y" at the bottom. */
export async function buildLetterPdf(text) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const size = 12, lead = 15, margin = 72, width = PAGE[0] - margin * 2;
  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - margin;
  for (const para of ansi(text).split('\n')) {
    const lines = para.trim() ? wrap(para, font, size, width) : [''];
    for (const l of lines) {
      if (y < margin + lead) { page = pdf.addPage(PAGE); y = PAGE[1] - margin; }
      if (l) page.drawText(l, { x: margin, y, size, font });
      y -= lead;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: (PAGE[0] - font.widthOfTextAtSize(label, 9)) / 2, y: 36, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
  });
  return pdf.save();
}

// ── Fax cover sheet (no patient details) ────────────────────────────────────

/** info: { toName, toFax, toPhone, fromName, fromClient, pages } */
export async function buildFaxCover(info) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(PAGE);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 60;
  let y = PAGE[1] - 80;
  page.drawText('FAX', { x: L, y, size: 36, font: bold });
  y -= 18;
  page.drawLine({ start: { x: L, y }, end: { x: PAGE[0] - L, y }, thickness: 1.5, color: rgb(0.3, 0.3, 0.3) });
  y -= 36;
  const row = (label, value) => {
    page.drawText(label, { x: L, y, size: 13, font: bold });
    ansi(value || '—').split('\n').forEach((t, i) => page.drawText(t.slice(0, 70), { x: L + 120, y: y - i * 16, size: 13, font }));
    y -= Math.max(1, ansi(value || '').split('\n').length) * 16 + 14;
  };
  row('To:', info.toName ? `${info.toName} — Appeals` : 'Appeals');
  row('Fax:', info.toFax);
  if (info.toPhone) row('Phone:', info.toPhone);
  row('From:', [info.fromName, info.fromClient].filter(Boolean).join(', '));
  row('Date:', todayUS());
  row('Pages:', `${info.pages} (including this cover sheet)`);
  row('Re:', 'Appeal — please route to the Appeals department');
  y -= 20;
  const notice = 'CONFIDENTIALITY NOTICE: The pages following this cover sheet contain confidential information, '
    + 'which may include protected health information, intended only for the recipient named above. If you received '
    + 'this fax in error, please notify the sender immediately and destroy all copies. Any review, use, disclosure or '
    + 'distribution by anyone other than the intended recipient is prohibited.';
  for (const l of wrap(notice, font, 10, PAGE[0] - L * 2)) {
    page.drawText(l, { x: L, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 13;
  }
  return pdf.save();
}

// ── Fillable payer forms ────────────────────────────────────────────────────

/**
 * Fields of a fillable PDF: [{ name, type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'other', page }].
 * Returns { fields } or { error } (encrypted / unreadable files, XFA-only forms have no fields).
 */
export async function listFormFields(bytes) {
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = await pdfLib();
  try {
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    const fields = pdf.getForm().getFields().map(f => {
      const type = f instanceof PDFTextField ? 'text' : f instanceof PDFCheckBox ? 'checkbox'
        : f instanceof PDFDropdown ? 'dropdown' : f instanceof PDFRadioGroup ? 'radio' : 'other';
      const widget = f.acroField.getWidgets()[0];
      const pageIndex = widget ? pages.findIndex(p => p.ref === widget.P()) : -1;
      return { name: f.getName(), type, page: pageIndex >= 0 ? pageIndex + 1 : null };
    });
    return { fields };
  } catch {
    return { error: 'This form can’t be read (it may be password-protected or damaged).' };
  }
}

// Check-box rules: always, or when the appeal level / denial type matches
export const CHECK_RULES = [
  { value: 'always', label: 'Always tick' },
  ...APPEAL_LEVELS.map(l => ({ value: `level:${l.value}`, label: `Tick when level = ${l.label}` })),
  ...DENIAL_TYPES.map(t => ({ value: `type:${t.value}`, label: `Tick when denial type = ${t.label}` })),
];
const ruleMatches = (when, ctx) => when === 'always'
  || (when?.startsWith('level:') && when.slice(6) === ctx.level)
  || (when?.startsWith('type:') && when.slice(5) === ctx.type);

/**
 * Fills a form using its field map. values = { '[TOKEN]': value }, ctx = { level, type }.
 * Returns { bytes, filled } — the form unchanged when it can't be filled.
 */
export async function fillForm(bytes, fieldMap, values, ctx, { flatten = true } = {}) {
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, StandardFonts } = await pdfLib();
  try {
    const pdf = await PDFDocument.load(bytes);
    const form = pdf.getForm();
    let filled = 0;
    for (const [name, rule] of Object.entries(fieldMap ?? {})) {
      let field;
      try { field = form.getField(name); } catch { continue; }   // field no longer in this file
      if (field instanceof PDFCheckBox) {
        if (rule.kind === 'check' && ruleMatches(rule.when, ctx)) { field.check(); filled++; }
        continue;
      }
      const value = rule.kind === 'token' ? String(values[rule.token] ?? '') : rule.kind === 'text' ? String(rule.text ?? '') : '';
      if (!value) continue;
      try {
        if (field instanceof PDFTextField) {
          let v = field.isMultiline() ? ansi(value) : ansi(value).replace(/\s*\n+\s*/g, ', ');
          const max = field.getMaxLength();
          if (max && v.length > max) v = v.slice(0, max);
          field.setText(v);
          filled++;
        } else if (field instanceof PDFDropdown) {
          const option = field.getOptions().find(o => o.toLowerCase() === value.toLowerCase());
          if (option) { field.select(option); filled++; }
        }
      } catch { /* one awkward field shouldn't stop the rest */ }
    }
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
    if (flatten) form.flatten();
    return { bytes: await pdf.save(), filled };
  } catch {
    return { bytes, filled: 0 };
  }
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** parts = [Uint8Array] in order → one PDF. */
export async function mergePdfs(parts) {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return out.save();
}

/** Page count of a PDF. */
export async function pageCount(bytes) {
  const { PDFDocument } = await pdfLib();
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
}

/**
 * The whole appeal PDF. opts: { letterText, form: { bytes, fieldMap, flatten } | null, values, ctx, cover: info | null }.
 * The fax cover's page count includes itself.
 */
export async function buildAppealPdf({ letterText, form, values, ctx, cover }) {
  const parts = [];
  if (letterText?.trim()) parts.push(await buildLetterPdf(letterText));
  if (form?.bytes) {
    const done = form.fieldMap ? await fillForm(form.bytes, form.fieldMap, values, ctx, { flatten: form.flatten }) : { bytes: form.bytes };
    parts.push(done.bytes);
  }
  if (cover) {
    let pages = 1;
    for (const p of parts) pages += await pageCount(p);
    parts.unshift(await buildFaxCover({ ...cover, pages }));
  }
  if (!parts.length) throw new Error('Nothing to build.');
  return parts.length === 1 ? parts[0] : mergePdfs(parts);
}
