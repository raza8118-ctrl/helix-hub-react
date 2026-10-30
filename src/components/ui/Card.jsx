/**
 * Card — the basic surface. variant: 'default' | 'accent' (the thing being worked on) | 'soft' (secondary panel).
 * Title / subtitle / actions render a header row; leave them out for a plain box.
 */
export default function Card({ title, icon, subtitle, actions, variant = 'default', flush = false, dim = false, className = '', style, id, children }) {
  const cls = ['ui-card', variant !== 'default' && variant, flush && 'flush', dim && 'dim', className].filter(Boolean).join(' ');
  const hasHead = title || subtitle || actions;
  return (
    <section className={cls} style={style} id={id}>
      {hasHead && (
        <div className="ui-card-h">
          <div style={{ minWidth: 0 }}>
            {title && <div className="ui-card-t">{icon && <span aria-hidden="true">{icon}</span>}{title}</div>}
            {subtitle && <div className="ui-card-s">{subtitle}</div>}
          </div>
          {actions && <div className="ui-card-a">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A titled part of a card, separated from the part above by a hairline. */
export function CardSection({ title, icon, actions, children, first = false }) {
  return (
    <div className="ui-sec" style={first ? { borderTop: 0, marginTop: 0, paddingTop: 0 } : undefined}>
      {(title || actions) && (
        <div className="ui-sec-h">
          <div className="ui-sec-t">{icon && <span aria-hidden="true">{icon} </span>}{title}</div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/** A small tile inside a section grid (one entry, e.g. a payer contact). */
export function Item({ dim = false, children }) {
  return <div className={`ui-item${dim ? ' dim' : ''}`}>{children}</div>;
}
