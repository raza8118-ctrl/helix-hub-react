/**
 * Page header — the Team Dashboard hero, sized for tool pages.
 * <PageHeader icon="📇" kicker="Workbench" title="Payer Directory" subtitle="…" actions={<Button>…</Button>} />
 */
export default function PageHeader({ icon, kicker, title, subtitle, actions, children }) {
  return (
    <header className="ui-ph">
      <div className="ui-ph-main">
        {icon && <div className="ui-ph-icon" aria-hidden="true">{icon}</div>}
        <div style={{ minWidth: 0 }}>
          {kicker && <div className="ui-ph-kicker">{kicker}</div>}
          <h1 className="ui-ph-title">{title}</h1>
          {subtitle && <div className="ui-ph-sub">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="ui-ph-actions">{actions}</div>}
      {children}
    </header>
  );
}
