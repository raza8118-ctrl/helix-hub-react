// Images → PDF for File Tools (roadmap 2.3) — runs entirely in the browser.
// JPG/PNG are embedded as-is (no quality loss); WEBP/BMP/GIF are converted losslessly to PNG;
// TIFF (including multi-page fax TIFFs) is decoded with utif. HEIC is not supported.

const EXT = name => (name.split('.').pop() ?? '').toLowerCase();
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'];

// JPEG EXIF orientation (1 = upright). Phones often store photos sideways plus this tag.
function jpegOrientation(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {   // "Exif"
      const tiff = off + 10;
      const little = v.getUint16(tiff) === 0x4949;
      const ifd = tiff + v.getUint32(tiff + 4, little);
      const entries = v.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > v.byteLength) break;
        if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + len;
  }
  return 1;
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? b.arrayBuffer().then(x => resolve(new Uint8Array(x)), reject) : reject(new Error('png'))), 'image/png');
  });
}
function canvasToJpeg(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? b.arrayBuffer().then(x => resolve(new Uint8Array(x)), reject) : reject(new Error('jpeg'))), 'image/jpeg', quality);
  });
}

// Draw any browser-readable image (respecting EXIF rotation) and re-encode it
async function viaCanvas(blob, asJpeg) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (asJpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const bytes = asJpeg ? await canvasToJpeg(canvas) : await canvasToPng(canvas);
  const out = { kind: asJpeg ? 'jpg' : 'png', bytes, width: canvas.width, height: canvas.height, aspect: canvas.width / canvas.height };
  canvas.width = canvas.height = 0;
  return out;
}

async function pixelSize(blob) {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  return size;
}

// Every page of a TIFF; fax TIFFs often have different X/Y resolution (e.g. 204×98 dpi)
async function readTiff(bytes) {
  const UTIF = (await import('utif')).default;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ifds = UTIF.decode(buf);
  const pages = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd, ifds);
    if (!ifd.width || !ifd.height) continue;
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = document.createElement('canvas');
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), ifd.width, ifd.height), 0, 0);
    const xRes = ifd.t282?.[0] || 1;
    const yRes = ifd.t283?.[0] || xRes;
    pages.push({ kind: 'png', bytes: await canvasToPng(canvas), width: ifd.width, height: ifd.height, aspect: (ifd.width / xRes) / (ifd.height / yRes) });
    canvas.width = canvas.height = 0;
  }
  return pages;
}

/**
 * Reads one image file → [{ kind: 'jpg'|'png', bytes, width, height, aspect }] (several for multi-page TIFF).
 * Throws Error('heic') | Error('unsupported') | Error('damaged').
 */
export async function readImageFile(file) {
  const ext = EXT(file.name);
  if (ext === 'heic' || ext === 'heif' || /heic|heif/i.test(file.type)) throw new Error('heic');
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error('unsupported');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (ext === 'tif' || ext === 'tiff') {
      const pages = await readTiff(bytes);
      if (!pages.length) throw new Error('damaged');
      return pages;
    }
    const blob = new Blob([bytes], { type: file.type || `image/${ext}` });
    if (ext === 'jpg' || ext === 'jpeg') {
      // Upright photos are embedded untouched; rotated ones are redrawn upright first
      if (jpegOrientation(bytes) !== 1) return [await viaCanvas(blob, true)];
      const { width, height } = await pixelSize(blob);
      return [{ kind: 'jpg', bytes, width, height, aspect: width / height }];
    }
    if (ext === 'png') {
      const { width, height } = await pixelSize(blob);
      return [{ kind: 'png', bytes, width, height, aspect: width / height }];
    }
    return [await viaCanvas(blob, false)];   // webp / bmp / gif (first frame) → lossless PNG
  } catch (err) {
    if (err.message === 'damaged') throw err;
    throw new Error('damaged');
  }
}

const PAGE_SIZES = { letter: [612, 792], a4: [595.28, 841.89] };
const FIT_LONG_SIDE = 792;   // "fit to image": page matches the image shape, long side 11 in

/**
 * images: [{ kind, bytes, aspect, rotation }] in order → PDF bytes.
 * options: { pageSize: 'fit' | 'letter' | 'a4', margin: 'none' | 'small' }
 * Rotation is applied as page rotation (lossless).
 */
export async function buildImagesPdf(images, { pageSize = 'fit', margin = 'none' } = {}) {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const pad = margin === 'small' ? 18 : 0;
  for (const im of images) {
    const embedded = im.kind === 'jpg' ? await pdf.embedJpg(im.bytes) : await pdf.embedPng(im.bytes);
    let pw;
    let ph;
    if (pageSize === 'fit') {
      [pw, ph] = im.aspect >= 1 ? [FIT_LONG_SIDE, FIT_LONG_SIDE / im.aspect] : [FIT_LONG_SIDE * im.aspect, FIT_LONG_SIDE];
      pw += pad * 2; ph += pad * 2;
    } else {
      const [a, b] = PAGE_SIZES[pageSize];
      [pw, ph] = im.aspect > 1 ? [b, a] : [a, b];   // landscape paper for wide images
    }
    const page = pdf.addPage([pw, ph]);
    const boxW = pw - pad * 2;
    const boxH = ph - pad * 2;
    const scale = Math.min(boxW / im.aspect, boxH);   // image height that fits the box
    const h = scale;
    const w = scale * im.aspect;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    if (im.rotation) page.setRotation(degrees(im.rotation));
  }
  return pdf.save();
}
