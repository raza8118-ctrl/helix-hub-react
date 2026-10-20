import { useState, useEffect, useRef } from 'react';
import { loadBitmap, renderScreenshot, fmtSeconds } from '../../lib/sopMedia';

const PHI_TICK = 'I checked: no patient names, DOB, member IDs, claim numbers or addresses are visible.';

// Larger pop-up than the shared Modal (screenshots need room); Escape closes it
function Shell({ title, onClose, children, maxWidth = 980 }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function PhiCheck({ checked, onChange }) {
  return (
    <label className="row text-sm" style={{
      gap: 8, alignItems: 'flex-start', cursor: 'pointer', padding: '8px 10px', borderRadius: 6,
      border: `1px solid ${checked ? 'var(--success)' : 'var(--danger)'}`, margin: '10px 0',
    }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>{PHI_TICK}</span>
    </label>
  );
}

const norm = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/**
 * Prepares a screenshot before upload, entirely in the browser (roadmap 3.3):
 * crop to the part that matters and draw black boxes over anything sensitive.
 * onUse receives { blob, width, height, ext } (already shrunk and re-encoded, without EXIF).
 */
export default function ScreenshotTool({ file, onCancel, onUse }) {
  const canvasRef = useRef(null);
  const [bitmap, setBitmap] = useState(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState('blackout');   // 'blackout' | 'crop'
  const [boxes, setBoxes] = useState([]);
  const [crop, setCrop] = useState(null);
  const [drag, setDrag] = useState(null);         // { start, end } while drawing
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadBitmap(file).then(b => { if (alive) setBitmap(b); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file]);

  // Redraw the preview: picture, black boxes, crop frame and the box being drawn
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    const line = Math.max(2, Math.round(bitmap.width / 400));
    ctx.drawImage(bitmap, 0, 0);
    ctx.fillStyle = '#000';
    boxes.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));
    if (crop) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, bitmap.width, crop.y);
      ctx.fillRect(0, crop.y + crop.h, bitmap.width, bitmap.height - crop.y - crop.h);
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      ctx.fillRect(crop.x + crop.w, crop.y, bitmap.width - crop.x - crop.w, crop.h);
      ctx.setLineDash([line * 4, line * 3]);
      ctx.lineWidth = line;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.setLineDash([]);
    }
    if (drag) {
      const r = norm(drag.start, drag.end);
      if (mode === 'blackout') { ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
      ctx.lineWidth = line;
      ctx.strokeStyle = mode === 'crop' ? '#fff' : '#ef4444';
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }, [bitmap, boxes, crop, drag, mode]);

  // Pointer position in picture pixels
  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bitmap.width, (e.clientX - rect.left) * bitmap.width / rect.width)),
      y: Math.max(0, Math.min(bitmap.height, (e.clientY - rect.top) * bitmap.height / rect.height)),
    };
  }
  function down(e) {
    if (!bitmap) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setDrag({ start: p, end: p });
  }
  function move(e) { if (drag) setDrag(d => ({ ...d, end: point(e) })); }
  function up() {
    if (!drag) return;
    const r = norm(drag.start, drag.end);
    setDrag(null);
    if (r.w < 4 || r.h < 4) return;
    if (mode === 'crop') setCrop(r); else setBoxes(list => [...list, r]);
  }

  async function use() {
    setBusy(true);
    const result = await renderScreenshot(bitmap, crop, boxes);
    setBusy(false);
    if (result) onUse(result); else setFailed(true);
  }

  return (
    <Shell title="Prepare screenshot" onClose={onCancel}>
      {failed && <p className="text-sm" style={{ color: 'var(--danger)' }}>This picture couldn’t be opened. Please try a PNG or JPG.</p>}
      {!failed && !bitmap && <div className="text-muted">Opening picture…</div>}
      {bitmap && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <button type="button" className={mode === 'blackout' ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={mode === 'blackout'}
              onClick={() => setMode('blackout')}>⬛ Black out</button>
            <button type="button" className={mode === 'crop' ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={mode === 'crop'}
              onClick={() => setMode('crop')}>✂ Crop</button>
            <button type="button" className="btn-sm" disabled={!boxes.length} onClick={() => setBoxes(list => list.slice(0, -1))}>↶ Undo box</button>
            <button type="button" className="btn-sm" disabled={!crop} onClick={() => setCrop(null)}>Remove crop</button>
            <span className="text-sm text-muted">
              {mode === 'blackout' ? 'Drag over anything sensitive to cover it.' : 'Drag around the part to keep.'}
              {boxes.length ? ` · ${boxes.length} box${boxes.length > 1 ? 'es' : ''}` : ''}
            </span>
          </div>
          <div style={{ textAlign: 'center', background: 'var(--surface-2)', borderRadius: 6, padding: 6 }}>
            <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              style={{ maxWidth: '100%', maxHeight: '60vh', cursor: 'crosshair', touchAction: 'none', display: 'inline-block' }} />
          </div>
          <PhiCheck checked={checked} onChange={setChecked} />
          <div className="form-actions">
            <button className="btn-sm" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" disabled={!checked || busy} onClick={use}>{busy ? 'Preparing…' : 'Use this screenshot'}</button>
          </div>
        </>
      )}
    </Shell>
  );
}

/** Lets the uploader watch a video and confirm it shows no patient information before it is uploaded. */
export function VideoConfirm({ file, duration, onCancel, onUse }) {
  const videoRef = useRef(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (videoRef.current) videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <Shell title="Check video before upload" onClose={onCancel} maxWidth={720}>
      <video ref={videoRef} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: '55vh', background: '#000', borderRadius: 6 }} />
      <div className="text-sm text-muted" style={{ marginTop: 4 }}>
        {fmtSeconds(duration)} · {(file.size / 1048576).toFixed(1)} MB — watch it through: videos can’t be blacked out here.
      </div>
      <PhiCheck checked={checked} onChange={setChecked} />
      <div className="form-actions">
        <button className="btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!checked} onClick={onUse}>Upload video</button>
      </div>
    </Shell>
  );
}
