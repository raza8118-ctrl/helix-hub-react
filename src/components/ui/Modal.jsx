import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal — same props as components/shared/Modal (title, onClose, wide), but drawn on <body> so a page's
 * fade-in transform can't clip it, with a full-screen backdrop. Escape or a click on the backdrop closes it.
 */
export default function Modal({ title, onClose, wide = false, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="ui-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`ui-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="ui-modal-h">
          <div className="ui-modal-t">{title}</div>
          <button type="button" className="ui-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ui-modal-b">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
