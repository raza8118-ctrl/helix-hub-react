/**
 * Table wrapper: rounded, scrolls sideways on phones, sticky header. Write a normal <table> inside;
 * put className="num" on number cells, "muted" on secondary cells, "mark" on highlighted (changed) values.
 */
export default function Table({ dense = false, maxHeight, children, style }) {
  return (
    <div className={`ui-table${dense ? ' dense' : ''}`} style={{ ...(maxHeight ? { maxHeight } : null), ...style }}>
      <table>{children}</table>
    </div>
  );
}
