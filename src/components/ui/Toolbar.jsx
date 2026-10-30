/**
 * Filter / action row (the Team Dashboard filter bar). Children wrap onto new lines on small screens.
 * Put <ToolbarSpacer /> between left-side filters and right-side actions.
 */
export default function Toolbar({ children, style }) {
  return <div className="ui-toolbar" style={style}>{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ui-toolbar-sp" aria-hidden="true" />;
}
