import { useEffect } from 'react';

// ── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_COLORS = {
  green:  { bg: '#dcfce7', fg: '#15803d' },
  red:    { bg: '#fee2e2', fg: '#dc2626' },
  yellow: { bg: '#fef9c3', fg: '#b45309' },
  orange: { bg: '#ffedd5', fg: '#c2410c' },
  blue:   { bg: '#dbeafe', fg: '#1d4ed8' },
  purple: { bg: '#ede9fe', fg: '#7c3aed' },
  amber:  { bg: '#fef3c7', fg: '#d97706' },
  gray:   { bg: 'var(--surface-2)', fg: 'var(--text-muted)' },
};

export function Badge({ label, color = 'gray' }) {
  const c = BADGE_COLORS[color] ?? BADGE_COLORS.gray;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg,
      letterSpacing: '0.02em',
    }}>
      {label}
    </span>
  );
}

// ── KPI stat card ─────────────────────────────────────────────────────────────
export function KPI({ label, value, color = 'var(--accent)', sub, icon }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      borderTop: `3px solid ${color}`,
      padding: '14px 18px',
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        display: 'flex', alignItems: 'center', gap: 5,
        marginBottom: 4,
      }}>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
const BTN_VARIANTS = {
  primary: { background: 'var(--accent)',    color: '#fff'                },
  amber:   { background: '#f59e0b',          color: '#fff'                },
  green:   { background: '#10b981',          color: '#fff'                },
  danger:  { background: '#ef4444',          color: '#fff'                },
  light:   { background: 'var(--surface-2)', color: 'var(--text)',  border: '1px solid var(--border)' },
  ghost:   { background: 'transparent',      color: 'var(--text-muted)', border: '1px solid var(--border)' },
};

export function Btn({ children, onClick, variant = 'primary', style, disabled }) {
  const v = BTN_VARIANTS[variant] ?? BTN_VARIANTS.primary;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 'var(--radius-sm)',
        fontSize: 13, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none', opacity: disabled ? 0.5 : 1,
        transition: 'opacity 0.15s ease',
        ...v, ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, children, maxWidth = 520 }) {
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box fade-in-scale"
        style={{ maxWidth }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Inp(props) {
  return <input {...props} />;
}

// ── Select ────────────────────────────────────────────────────────────────────
export function SelectInput({ children, ...props }) {
  return <select {...props}>{children}</select>;
}

// ── Textarea ──────────────────────────────────────────────────────────────────
export function Textarea(props) {
  return <textarea {...props} />;
}

// ── Section heading ───────────────────────────────────────────────────────────
export function H2({ children, icon, style }) {
  return (
    <h2 style={{
      fontSize: 14, fontWeight: 700, color: 'var(--text)',
      display: 'flex', alignItems: 'center', gap: 7,
      marginBottom: 12,
      ...style,
    }}>
      {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      {children}
    </h2>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
export function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 8,
      ...style,
    }}>
      {children}
    </div>
  );
}
