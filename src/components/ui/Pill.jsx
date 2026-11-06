/**
 * Status pill (Frost Glass, 2026-11-06): small rounded label in a status colour from the theme.
 * tone: 'good' | 'warn' | 'bad' | 'neutral' (default) | 'accent'. Used for Prod % / Quality % / "Missing" etc.
 */
export default function Pill({ tone = 'neutral', title, children }) {
  return <span className={`ui-pill ${tone}`} title={title}>{children}</span>;
}
