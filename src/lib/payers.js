// Payer name/alias matching — shared by the Payer Directory and any payer picker.

// Case/space/punctuation-insensitive: "BCBS-TX", "bcbs tx" and "BCBSTX" all match
const norm = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const wordsOf = s => (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well a payer matches the typed text (lower score is better), plus the alias
 * that matched when it wasn't the name. null = no match.
 */
export function matchPayer(payer, query) {
  const q = norm(query);
  if (!q) return null;
  const words = wordsOf(query);
  let best = null;
  for (const [text, alias] of [[payer.name, null], ...(payer.aliases ?? []).map(a => [a, a])]) {
    const n = norm(text);
    if (!n) continue;
    const textWords = wordsOf(text);
    let score = null;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (words.length > 1 && words.every(w => textWords.some(tw => tw.startsWith(w)))) score = 2;   // "blue texas"
    else if (textWords.some(tw => tw.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 3;
    if (score != null && (!best || score < best.score)) best = { score, alias };
  }
  return best;
}

/** Best matches first; each result carries `matchedAlias` when an alias (not the name) matched. */
export function searchPayers(payers, query, limit = 12) {
  return (payers ?? [])
    .map(p => ({ payer: p, m: matchPayer(p, query) }))
    .filter(r => r.m)
    .sort((a, b) => a.m.score - b.m.score || (a.payer.name ?? '').localeCompare(b.payer.name ?? ''))
    .slice(0, limit)
    .map(r => ({ ...r.payer, matchedAlias: r.m.alias }));
}
