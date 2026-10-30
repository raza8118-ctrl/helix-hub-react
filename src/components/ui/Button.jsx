/**
 * Button. variant: 'primary' (one per area — the main action) | 'secondary' (default) | 'ghost' | 'danger' | 'success'.
 * size: 'md' (default) | 'sm' | 'xs'. loading shows a spinner and disables the button. type defaults to "button".
 */
export default function Button({ variant = 'secondary', size = 'md', loading = false, block = false, active = false, className = '', disabled, children, type = 'button', ...rest }) {
  const cls = ['ui-btn', variant, size !== 'md' && size, block && 'block', active && 'on', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="ui-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A text-only button that looks like a link. */
export function LinkButton({ className = '', children, type = 'button', ...rest }) {
  return <button type={type} className={`ui-link ${className}`.trim()} {...rest}>{children}</button>;
}
