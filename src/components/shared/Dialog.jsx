import { useState, useEffect, useRef } from 'react';

// App-wide styled dialogs replacing the browser's confirm / alert / prompt.
// <DialogHost /> is mounted once (main.jsx); call the helpers from anywhere:
//   if (!await confirmDialog({ title: 'Delete task?', message: '…', tone: 'danger', confirmText: 'Delete' })) return;
//   await alertDialog({ title: 'Saved', message: '…', tone: 'success' });
//   const label = await promptDialog({ title: 'Holiday label', placeholder: 'e.g. Eid' });   // null if cancelled
// tone: 'danger' | 'warning' | 'success' | 'info' (default)
// requireText: user must type this exactly (case-insensitive) before confirming.

let showDialog = null;   // set by the mounted host

function open(kind, opts) {
  if (!showDialog) {   // host not mounted — fall back to the browser
    const text = [opts.title, opts.message].filter(Boolean).join('\n\n');
    if (kind === 'alert')  { window.alert(text); return Promise.resolve(); }
    if (kind === 'prompt') return Promise.resolve(window.prompt(text, opts.defaultValue ?? ''));
    return Promise.resolve(window.confirm(text));
  }
  return new Promise(resolve => showDialog({ kind, ...opts, resolve }));
}

export const confirmDialog = opts => open('confirm', opts);
export const alertDialog   = opts => open('alert', opts);
export const promptDialog  = opts => open('prompt', opts);

const TONES = {
  danger:  { color: 'var(--danger)',  bg: 'rgba(239,68,68,0.12)',  icon: '🗑', btn: 'btn-danger'  },
  warning: { color: 'var(--warning)', bg: 'rgba(245,158,11,0.14)', icon: '⚠', btn: 'btn-primary' },
  success: { color: 'var(--success)', bg: 'rgba(16,185,129,0.14)', icon: '✓', btn: 'btn-primary' },
  info:    { color: 'var(--accent)',  bg: 'rgba(124,58,237,0.12)', icon: 'ℹ', btn: 'btn-primary' },
};

export function DialogHost() {
  const [queue, setQueue] = useState([]);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const okRef    = useRef(null);
  const d = queue[0];

  useEffect(() => {
    showDialog = dlg => setQueue(q => [...q, dlg]);
    return () => { showDialog = null; };
  }, []);

  useEffect(() => {
    if (!d) return;
    setValue(d.defaultValue ?? '');
    setTimeout(() => (inputRef.current ?? okRef.current)?.focus(), 30);
  }, [d]);

  if (!d) return null;

  const tone   = TONES[d.tone] ?? TONES.info;
  const typed  = d.kind === 'prompt' || d.requireText;
  const locked = d.requireText && value.trim().toUpperCase() !== String(d.requireText).toUpperCase();

  function close(result) {
    d.resolve(result);
    setQueue(q => q.slice(1));
  }
  const cancel  = () => close(d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined);
  const confirm = () => {
    if (locked) return;
    close(d.kind === 'prompt' ? value : d.kind === 'confirm' ? true : undefined);
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={cancel}
      onKeyDown={e => { if (e.key === 'Escape') cancel(); if (e.key === 'Enter' && typed) confirm(); }}>
      <div className="modal-box fade-in-scale" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title"
        style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-body" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: tone.bg, color: tone.color, fontSize: 18, fontWeight: 700,
          }}>{tone.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="dlg-title" className="modal-title" style={{ marginTop: 2 }}>{d.title}</div>
            {d.message && (
              <div className="text-sm" style={{ color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                {d.message}
              </div>
            )}
            {typed && (
              <div style={{ marginTop: 12 }}>
                {d.requireText && (
                  <label className="text-sm" style={{ display: 'block', marginBottom: 5 }}>
                    Type <strong>{d.requireText}</strong> to confirm
                  </label>
                )}
                <input ref={inputRef} type="text" value={value} placeholder={d.placeholder ?? ''}
                  onChange={e => setValue(e.target.value)} style={{ width: '100%' }} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          {d.kind !== 'alert' && (
            <button className="btn-sm" onClick={cancel}>{d.cancelText ?? 'Cancel'}</button>
          )}
          <button ref={okRef} className={tone.btn} onClick={confirm} disabled={locked}>
            {d.confirmText ?? (d.kind === 'alert' ? 'OK' : d.kind === 'prompt' ? 'Save' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
