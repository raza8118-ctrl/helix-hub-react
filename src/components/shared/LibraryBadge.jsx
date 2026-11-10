// Master Library badges (PO 2026-11-10): where an item in Payer Directory / Denial Navigator / SOP Library / Code Lookup comes from.
const LABELS = {
  master: ['Master', 'From the Helix Hub Master Library — read-only'],
  company: ['Company', 'Your company’s own item'],
  override: ['Company override', 'Your company’s version — shown instead of the 3Gen standard below'],
  standard: ['3Gen standard', 'The Master Library version — read-only'],
};

export default function LibraryBadge({ kind }) {
  const [label, title] = LABELS[kind] ?? [kind, ''];
  return <span className={`lib-badge lib-${kind}`} title={title}>{label}</span>;
}
