import { useState, useEffect } from 'react';
import { sopMediaLink, fmtSeconds } from '../../lib/sopMedia';

// Signed (private, short-lived) link for one stored file; undefined while loading, null if it failed
function useMediaLink(path) {
  const [link, setLink] = useState({ path: null, url: undefined });
  useEffect(() => {
    let alive = true;
    if (path) sopMediaLink(path).then(url => { if (alive) setLink({ path, url }); });
    return () => { alive = false; };
  }, [path]);
  return link.path === path ? link.url : undefined;
}

const frame = {
  border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/** Screenshot thumbnail; click to see it full size. */
export function SopImage({ image, alt, height = 150 }) {
  const url = useMediaLink(image?.path);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = e => { if (e.key === 'Escape') setBig(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [big]);

  if (url === undefined) return <div className="text-sm text-muted" style={{ ...frame, width: 200, height }}>Loading…</div>;
  if (!url) return <div className="text-sm text-muted" style={{ ...frame, width: 200, height }}>Picture unavailable</div>;
  return (
    <>
      <button type="button" onClick={() => setBig(true)} title="Click to enlarge"
        style={{ ...frame, padding: 0, cursor: 'zoom-in', maxWidth: '100%', overflow: 'hidden' }}>
        <img src={url} alt={alt} loading="lazy" style={{ display: 'block', maxWidth: '100%', maxHeight: height, objectFit: 'contain' }} />
      </button>
      {big && (
        <div className="modal-overlay" onClick={() => setBig(false)} style={{ cursor: 'zoom-out', padding: 16 }}>
          <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: '92vh', objectFit: 'contain', borderRadius: 6, background: '#fff' }} />
        </div>
      )}
    </>
  );
}

/** Short video played inside the page. */
export function SopVideo({ video, maxWidth = 640 }) {
  const url = useMediaLink(video?.path);
  if (url === undefined) return <div className="text-sm text-muted" style={{ ...frame, maxWidth, height: 120 }}>Loading video…</div>;
  if (!url) return <div className="text-sm text-muted" style={{ ...frame, maxWidth, height: 120 }}>Video unavailable</div>;
  return (
    <div style={{ maxWidth }}>
      <video src={url} controls preload="metadata" playsInline style={{ width: '100%', borderRadius: 6, background: '#000', display: 'block' }} />
      {video.duration != null && <div className="text-sm text-muted" style={{ marginTop: 2 }}>🎬 {fmtSeconds(video.duration)}</div>}
    </div>
  );
}
