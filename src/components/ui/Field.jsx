/**
 * Form field: label + control + hint / error. Put a plain <input>, <select> or <textarea> inside —
 * the field styles it, so existing value / onChange code stays exactly as it was.
 * <Field label="Payer ID" required hint="e.g. 84980"><input value={v} onChange={…} /></Field>
 */
export default function Field({ label, required = false, hint, error, children, style }) {
  return (
    <div className="ui-field" style={style}>
      {label && <label>{label}{required && <span className="req"> *</span>}</label>}
      {children}
      {hint && <div className="ui-field-hint">{hint}</div>}
      {error && <div className="ui-field-err" role="alert">{error}</div>}
    </div>
  );
}

/**
 * Checkbox or radio with its text — the box keeps its size and the text wraps beside it.
 * inline = small muted version for toolbars ("Show inactive").
 */
export function Check({ type = 'checkbox', inline = false, children, className = '', title, ...input }) {
  return (
    <label className={`ui-check${inline ? ' inline' : ''} ${className}`.trim()} title={title}>
      <input type={type} {...input} />
      <span>{children}</span>
    </label>
  );
}

/** The footer row of a form (Cancel / Save). split = first child left, the rest right. */
export function FormActions({ split = false, children }) {
  return <div className={`ui-actions${split ? ' split' : ''}`}>{children}</div>;
}
