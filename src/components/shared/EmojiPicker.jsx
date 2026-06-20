import { useState, useRef, useEffect } from 'react';
import { REACTIONS } from '../../lib/constants';

/** Reaction button + popover picker. myReaction is the current user's reaction id (or null). */
export default function EmojiPicker({ myReaction, onReact, size = 16 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const current = REACTIONS.find(r => r.id === myReaction);

  function pick(id) {
    onReact(id === myReaction ? null : id);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn-sm"
        onClick={() => (current ? pick(current.id) : setOpen(v => !v))}
        onContextMenu={e => { e.preventDefault(); setOpen(v => !v); }}
        style={current ? { background: 'rgba(99,102,241,0.12)', border: '1px solid var(--accent)', color: 'var(--accent)' } : {}}
        title={current ? `You reacted ${current.emoji} — click to remove, right-click to change` : 'React'}
      >
        {current ? `${current.emoji} ${current.id.charAt(0).toUpperCase() + current.id.slice(1)}` : '👍 React'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
          display: 'flex', gap: 4, padding: 6, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'var(--shadow)', zIndex: 20,
        }}>
          {REACTIONS.map(r => (
            <button
              key={r.id}
              onClick={() => pick(r.id)}
              title={r.id}
              style={{
                fontSize: size, background: 'none', border: 'none', cursor: 'pointer',
                padding: 4, borderRadius: '50%',
                transform: myReaction === r.id ? 'scale(1.25)' : 'scale(1)',
                transition: 'transform 0.1s',
              }}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
