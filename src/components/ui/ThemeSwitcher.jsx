import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../../lib/constants';

/**
 * Theme picker (Frost Glass, 2026-11-06). The choice is saved by the parent (App → prefs_<emp_id>.theme).
 *   variant "bar"  — top bar: four swatches in a row on wide screens, one swatch button with a menu on narrow ones
 *   variant "grid" — Profile: four larger cards
 */
export default function ThemeSwitcher({ value, onChange, variant = 'bar' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = THEMES.find(t => t.id === value) ?? THEMES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = id => { setOpen(false); if (id !== value) onChange(id); };
  const dot = t => <i className="ui-theme-dot" style={{ background: t.accent }} aria-hidden="true" />;

  if (variant === 'grid') {
    return (
      <div className="ui-theme-grid" role="radiogroup" aria-label="Theme">
        {THEMES.map(t => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === current.id}
            className={`ui-theme-card${t.id === current.id ? ' on' : ''}`} onClick={() => pick(t.id)}>
            <span className="ui-theme-preview" style={{ background: t.bg }} aria-hidden="true">
              <span style={{ background: t.topbar }} />
              <span style={{ background: t.accent }} />
            </span>
            <span className="ui-theme-name">{t.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="ui-theme" ref={wrap}>
      <div className="ui-theme-seg" role="radiogroup" aria-label="Theme">
        {THEMES.map(t => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === current.id}
            className={t.id === current.id ? 'on' : ''} onClick={() => pick(t.id)} title={`${t.label} theme`}>
            {dot(t)}<span>{t.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="ui-theme-mini" onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open} title={`Theme: ${current.label}`} aria-label={`Theme: ${current.label}`}>
        {dot(current)}
      </button>
      {open && (
        <div className="ui-theme-menu" role="menu">
          {THEMES.map(t => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === current.id}
              className={t.id === current.id ? 'on' : ''} onClick={() => pick(t.id)}>
              {dot(t)}<span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
