/**
 * Status badge. tone: 'neutral' (default) | 'good' | 'warn' | 'bad' | 'info' | 'accent'.
 */
export default function Badge({ tone = 'neutral', title, style, children }) {
  return <span className={`ui-badge${tone !== 'neutral' ? ` ${tone}` : ''}`} title={title} style={style}>{children}</span>;
}

/** Clickable pill (quick picks, A–Z lists). on = selected. */
export function Chip({ on = false, children, type = 'button', className = '', ...rest }) {
  return <button type={type} className={`ui-chip${on ? ' on' : ''} ${className}`.trim()} aria-pressed={on} {...rest}>{children}</button>;
}

/** Inline message box. tone: 'neutral' | 'info' | 'good' | 'warn' | 'bad'. */
export function Notice({ tone = 'neutral', icon, children, style }) {
  return (
    <div className={`ui-notice${tone !== 'neutral' ? ` ${tone}` : ''}`} role={tone === 'bad' ? 'alert' : undefined} style={style}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <div className="ui-notice-body">{children}</div>
    </div>
  );
}
