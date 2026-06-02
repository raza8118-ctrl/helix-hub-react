import { useEffect } from 'react';

/** Accessible modal. Press Escape or click overlay to close. */
export default function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={wide ? { maxWidth: 680 } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn-icon" onClick={onClose} aria-label="Close modal">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
