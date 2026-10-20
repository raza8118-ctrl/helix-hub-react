// SOP screenshots and short videos (roadmap 3.3).
// Private bucket from supabase/migrations/20261020b_sop_media.sql; shown with short-lived signed links.
// SOP media must never show patient information — uploaders confirm this and can black out parts of screenshots.
import { supabase, S, getTablePrefix } from './supabase';
import { logAudit } from './audit';

const BUCKET = 'sop-media';
export const MAX_IMAGES_PER_STEP = 3;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 180;
export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_TARGET_BYTES = 1024 * 1024;

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm'];

/** null if the picture can be used, otherwise a plain-English reason. */
export function checkImageFile(file) {
  if (!file) return 'Choose a picture.';
  if (!IMAGE_TYPES.includes(file.type)) return 'Only PNG, JPG or WEBP pictures can be added.';
  if (file.size > MAX_SOURCE_IMAGE_BYTES) return 'The picture is larger than 20 MB.';
  return null;
}

/** Reads a video's length in seconds (null if the browser can't play it). */
function videoDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = d => { URL.revokeObjectURL(url); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** { error } or { duration } for a video file. */
export async function checkVideoFile(file) {
  if (!file) return { error: 'Choose a video.' };
  if (!VIDEO_TYPES.includes(file.type)) return { error: 'Only MP4 or WEBM videos can be added.' };
  if (file.size > MAX_VIDEO_BYTES) return { error: 'The video is larger than 25 MB. Please trim or record a shorter clip.' };
  const duration = await videoDuration(file);
  if (duration == null) return { error: 'This video can’t be played in the browser. Please save it as MP4.' };
  if (duration > MAX_VIDEO_SECONDS + 1) return { error: 'The video is longer than 3 minutes. Please record a shorter clip.' };
  return { duration: Math.round(duration) };
}

/** Decodes a picture (upright, using its EXIF rotation). */
export function loadBitmap(file) {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

/**
 * Draws the picture with the crop and black-out boxes applied, shrinks it to ≤ 1600 px wide and
 * re-encodes it (this also drops hidden file details such as EXIF). Rectangles are in picture pixels.
 * Returns { blob, width, height, ext }.
 */
export async function renderScreenshot(bitmap, crop, boxes) {
  const area = crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  let scale = Math.min(1, IMAGE_MAX_WIDTH / area.w);
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(area.w * scale));
    canvas.height = Math.max(1, Math.round(area.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, area.x, area.y, area.w, area.h, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (const b of boxes) ctx.fillRect((b.x - area.x) * scale, (b.y - area.y) * scale, b.w * scale, b.h * scale);

    // WEBP keeps screenshot text sharp at a small size; browsers that can't write WEBP get JPEG
    for (const quality of [0.86, 0.72]) {
      let blob = await toBlob(canvas, 'image/webp', quality);
      if (blob?.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
      if (!blob) continue;
      last = { blob, width: canvas.width, height: canvas.height, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
      if (blob.size <= IMAGE_TARGET_BYTES) return last;
    }
    scale *= 0.8;   // still too big: shrink a little and try again
  }
  return last;   // best effort (still well under the 25 MB bucket limit)
}

/**
 * Uploads a screenshot or video for an SOP, records it in sop_media and the audit log.
 * Returns { path } or { error }. The stored path never contains the original file name.
 */
export async function uploadSopMedia({ sopId, kind, blob, ext, width = null, height = null, duration = null, user }) {
  const prefix = getTablePrefix();
  const folder = prefix ? `${prefix.replace(/_+$/, '')}/` : '';
  const path = `${folder}sop_${sopId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: blob.type });
  if (error) {
    console.error('uploadSopMedia error', error.message);
    return { error: 'The upload failed. Please check your connection and try again.' };
  }
  const row = await S.set('sop_media', {
    sop_id: sopId, kind, path, size: blob.size, width, height, duration, active: true, uploaded_by: user.emp_id,
  });
  if (!row?.length) return { error: 'The file was uploaded but could not be recorded. Please try again.' };
  logAudit({ actor: user, action: 'sop_media_upload', entityType: 'sop', entityId: sopId, details: { kind, size: blob.size } });
  return { path };
}

// Signed links are cached for a while so the same picture isn't re-signed on every render
const LINK_SECONDS = 3600;
const linkCache = new Map();   // path → { url, until }

/** Short-lived (1 hour) viewing link, or null. */
export async function sopMediaLink(path) {
  const hit = linkCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (error) { console.error('sopMediaLink error', error.message); return null; }
  const url = data?.signedUrl ?? null;
  if (url) linkCache.set(path, { url, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return url;
}

export const fmtSeconds = s => s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
