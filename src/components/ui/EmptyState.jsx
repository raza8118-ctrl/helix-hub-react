/**
 * Shown where a list or section has nothing in it.
 * Full: <EmptyState icon="📇" title="No payers yet">Admins can add them in Clients & Payers.</EmptyState>
 * compact = one muted line inside a card section (no icon box).
 */
export default function EmptyState({ icon, title, action, compact = false, children }) {
  if (compact) return <div className="ui-empty compact">{icon && <span aria-hidden="true">{icon}</span>}<span>{title}{children}</span></div>;
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty-ico" aria-hidden="true">{icon}</div>}
      {title && <div className="ui-empty-t">{title}</div>}
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}
