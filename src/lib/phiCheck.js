// Patient-identifier check for text that is about to leave the browser (PO 2026-11-11, Coding Assistant).
// Pure — no imports — so it runs in the app and in the Node tests (npm test). Blocks; never replaces or sends anything.

// ── 1. Patient-identifier check (blocks — nothing is replaced or sent) ─────────────────────
const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MBI_CH = '[AC-HJKMNP-RT-Y]';   // Medicare Beneficiary Identifier letters (no S L O I B Z)
const CHECKS = [
  { kind: 'mbi', what: 'a Medicare number (MBI)', re: new RegExp(`\\b[1-9]${MBI_CH}[${MBI_CH.slice(1, -1)}0-9]\\d-?${MBI_CH}[${MBI_CH.slice(1, -1)}0-9]\\d-?${MBI_CH}{2}\\d{2}\\b`, 'gi') },
  { kind: 'ssn', what: 'a Social Security number', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'date', what: 'a date (date of birth / service)', re: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g },
  { kind: 'date', what: 'a date (date of birth / service)', re: new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b|\\b\\d{1,2}\\s+${MONTHS}\\.?\\s+(?:19|20)\\d{2}\\b`, 'gi') },
  { kind: 'dob', what: 'a date-of-birth word', re: /\b(?:dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date|born(?:\s+on)?)\b/gi },
  { kind: 'phone', what: 'a phone number', re: /(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g },
  { kind: 'email', what: 'an email address', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { kind: 'label', what: 'a patient label (name / MRN / member ID…)', re: /\b(?:patient(?:'s)?\s+name|pt\.?\s+name|name|patient|pt|mrn|medical\s+record(?:\s+(?:number|no|#))?|member\s*(?:id|#|number|no)|subscriber\s*(?:id|#)|policy\s*(?:#|number|no)|account\s*(?:#|number|no)|acct\.?|hicn|mbi|ssn|social\s+security|address|addr|phone|tel)\s*[:#]/gi },
  { kind: 'idword', what: 'an ID word (MRN, member ID, MBI, SSN…)', re: /\b(?:mrn|member\s*id|subscriber\s*id|medicare\s*(?:number|id|#)|medicaid\s*(?:number|id|#)|hicn|mbi|ssn|social\s+security)\b/gi },
  { kind: 'title', what: 'a person’s name (Mr / Mrs / Ms…)', re: /\b(?:Mr|Mrs|Ms|Mx|MR|MRS)\.\s*[A-Z][A-Za-z'-]+|\b(?:Mrs|Miss|MRS|MISS)\s+[A-Z][A-Za-z'-]+/g },   // "MS" alone = multiple sclerosis
  { kind: 'number', what: 'a long number (ID / account / phone)', re: /\b\d{7,}\b/g },
  { kind: 'address', what: 'a street address', re: /\b\d{1,6}\s+(?:[A-Za-z0-9'.-]+\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|circle|cir|highway|hwy|parkway|pkwy|terrace|ter)\b\.?/gi },
  { kind: 'address', what: 'a state + ZIP code', re: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g },
  { kind: 'age', what: 'an age over 89', re: /\b(?:9\d|1[01]\d)\s*-?\s*(?:y\/?o|yo|yrs?|years?)(?:[-\s]old)?\b/gi },
];

/**
 * → [{ kind, what, match, index }] — empty when nothing looks like a patient identifier. Runs in the browser only.
 * ICD-10-CM codes (I50.9, S72.001A) never match: identifiers checked here start with a digit or a word.
 */
export function findIdentifiers(text) {
  const s = String(text ?? '');
  const out = [];
  for (const c of CHECKS) {
    for (const m of s.matchAll(c.re)) out.push({ kind: c.kind, what: c.what, match: m[0], index: m.index });
  }
  // one finding per place in the text
  return out.sort((a, b) => a.index - b.index).filter((f, i, a) => !a.slice(0, i).some(p => f.index < p.index + p.match.length));
}


