import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FEED_BUCKET } from '../../lib/constants';

// Security stage 5 (2026-11-01): Team Feed / announcement photos are private. Their saved address (the old public
// link) is turned into a 1-hour signed link when shown — which needs a valid session for that company. Any other
// image (Giphy GIFs, local previews) is shown as it is.
const PUBLIC_PART = `/storage/v1/object/public/${FEED_BUCKET}/`;
const LINK_SECONDS = 3600;
const cache = new Map();   // path → { url, until }

function feedPath(src) {
  const i = typeof src === 'string' ? src.indexOf(PUBLIC_PART) : -1;
  return i < 0 ? null : decodeURIComponent(src.slice(i + PUBLIC_PART.length).split('?')[0]);
}

async function signedUrl(path) {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(FEED_BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return data.signedUrl;
}

export default function SecureImage({ src, ...props }) {
  const path = feedPath(src);
  const [signed, setSigned] = useState(() => (path ? cache.get(path)?.url ?? null : null));

  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    signedUrl(path).then(url => { if (alive) setSigned(url); });
    return () => { alive = false; };
  }, [path]);

  if (!path) return <img src={src} {...props} />;
  if (!signed) return null;   // still signing, or no access
  return <img src={signed} {...props} />;
}
