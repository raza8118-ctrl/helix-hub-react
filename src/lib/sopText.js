// Simple SOP text formatting (roadmap 3.3) — stored as plain text with a few marks:
//   **bold**        - bullet item        1. numbered item        ! important line
// Links (http/https) become clickable. Shown on the page by SopText.jsx (React elements,
// never raw HTML) and as escaped HTML in the print copy.

const LINK = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

/** Lines grouped into blocks: { type: 'p' | 'ul' | 'ol' | 'important' | 'gap', lines: [...] } */
export function parseSopText(text) {
  const blocks = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    let type = 'p', content = line;
    let m;
    if ((m = line.match(/^\s*[-•*]\s+(.*)$/))) { type = 'ul'; content = m[1]; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { type = 'ol'; content = m[1]; }
    else if ((m = line.match(/^\s*!\s*(.*)$/))) { type = 'important'; content = m[1]; }
    if (type === 'p' && !content.trim()) { blocks.push({ type: 'gap', lines: [] }); continue; }
    const prev = blocks[blocks.length - 1];
    if (prev && prev.type === type && type !== 'important') prev.lines.push(content);
    else blocks.push({ type, lines: [content] });
  }
  // No gaps at the start/end, and never two in a row
  return blocks.filter((b, i, all) => b.type !== 'gap' || (i > 0 && i < all.length - 1 && all[i - 1].type !== 'gap'));
}

/** Splits a line into pieces: { t: 'text' | 'bold' | 'link', v } */
export function parseSopInline(line) {
  const out = [];
  String(line).split(/(\*\*[^*]+\*\*)/g).forEach(part => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) { out.push({ t: 'bold', v: part.slice(2, -2) }); return; }
    part.split(LINK).forEach((bit, i) => { if (bit) out.push({ t: i % 2 ? 'link' : 'text', v: bit }); });
  });
  return out;
}

export const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inlineHtml = line => parseSopInline(line).map(p => p.t === 'bold' ? `<b>${escHtml(p.v)}</b>` : escHtml(p.v)).join('');

/** Escaped HTML version for the printable copy. */
export function sopTextToHtml(text) {
  return parseSopText(text).map(b => {
    if (b.type === 'gap') return '<div style="height:8px"></div>';
    if (b.type === 'ul' || b.type === 'ol') return `<${b.type}>${b.lines.map(l => `<li>${inlineHtml(l)}</li>`).join('')}</${b.type}>`;
    if (b.type === 'important') return `<div class="important">⚠ ${inlineHtml(b.lines[0])}</div>`;
    return b.lines.map(l => `<div>${inlineHtml(l)}</div>`).join('');
  }).join('');
}

/**
 * Applies a toolbar button to a textarea's text. kind: 'bold' | 'ul' | 'ol' | 'important'.
 * Returns { value, start, end } — the new text and the selection to restore.
 */
export function applySopFormat(value, start, end, kind) {
  if (kind === 'bold') {
    const picked = value.slice(start, end) || 'bold text';
    const next = `${value.slice(0, start)}**${picked}**${value.slice(end)}`;
    return { value: next, start: start + 2, end: start + 2 + picked.length };
  }
  // Line formats apply to every line touched by the selection
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end);
  const lineEnd = nl === -1 ? value.length : nl;
  const strip = l => l.replace(/^\s*([-•*]\s|\d+[.)]\s|!)\s*/, '');
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const already = lines.every(l => kind === 'ul' ? /^\s*[-•*]\s/.test(l) : kind === 'ol' ? /^\s*\d+[.)]\s/.test(l) : /^\s*!/.test(l));
  const changed = lines.map((l, i) => {
    if (already) return strip(l);   // pressing the same button again removes it
    const body = strip(l);
    return kind === 'ul' ? `- ${body}` : kind === 'ol' ? `${i + 1}. ${body}` : `! ${body}`;
  }).join('\n');
  return { value: value.slice(0, lineStart) + changed + value.slice(lineEnd), start: lineStart, end: lineStart + changed.length };
}
