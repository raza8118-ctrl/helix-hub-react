import { useEffect } from 'react';

/** Self-dismissing notification banner, fixed to the top-right of the viewport. */
export default function Toast({ message, onClose, duration = 6000 }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [message, duration, onClose]);

  if (!message) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 70, right: 20, zIndex: 999,
        background: 'var(--accent)', color: '#fff',
        padding: '10px 16px', borderRadius: 8,
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        maxWidth: 280,
      }}
    >
      🔔 {message}
    </div>
  );
}
