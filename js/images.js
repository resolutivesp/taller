// Taller — on-device photo capture + compression. Photos never leave the phone.
// A BMET works visually: nameplate/rating labels, the fault, the part. We keep
// storage tiny on low-end phones by downscaling to ~1280px and JPEG ~0.72.

import { db } from './db.js';
import { uuid } from './ui.js';

const MAX_SIDE = 1280;
const QUALITY = 0.72;

// Open the camera (or gallery) and return the chosen File, or null if cancelled.
export function pickPhoto({ camera = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } setTimeout(() => input.remove(), 0); };
    input.addEventListener('change', () => done(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => done(null)); // modern Chrome fires this on dismiss
    // last-resort fallback (older browsers): only after a long delay, and only if no file arrived —
    // a slow phone can deliver a large capture's `change` well after focus returns, so keep this generous.
    window.addEventListener('focus', () => setTimeout(() => {
      if (!settled && (!input.files || !input.files.length)) done(null);
    }, 1500), { once: true });
    document.body.append(input);
    input.click();
  });
}

// Compress a File/Blob to a JPEG Blob no larger than MAX_SIDE on its long edge.
export async function compress(fileOrBlob, maxSide = MAX_SIDE, quality = QUALITY) {
  const bitmap = await loadBitmap(fileOrBlob, maxSide);
  const { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  let blob = null;
  try {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close(); // free the decoded source before toBlob allocates
    blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  } finally {
    // Release the canvas backing store (w*h*4 bytes) on EVERY exit — including
    // the toBlob-returned-null path and a drawImage failure. A leaked
    // 1280x960 canvas per photo is ~5 MB the phone never gets back.
    canvas.width = canvas.height = 0;
    if (bitmap.close) { try { bitmap.close(); } catch (e) { /* already closed */ } }
  }
  return blob || fileOrBlob;
}

// Does createImageBitmap honour resizeWidth/resizeHeight? Some engines accept
// the dictionary and ignore it; we must not assume the bitmap came back small.
// Probed once on an 8x8 canvas, then cached.
let _resizeOk = null;
async function supportsBitmapResize() {
  if (_resizeOk !== null) return _resizeOk;
  _resizeOk = false;
  try {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const bmp = await createImageBitmap(c, { resizeWidth: 4, resizeHeight: 4 });
    _resizeOk = bmp.width === 4 && bmp.height === 4;
    if (bmp.close) bmp.close();
    c.width = c.height = 0;
  } catch (e) { _resizeOk = false; }
  return _resizeOk;
}

// Pixel size without decoding the pixels: an <img> only needs the header to
// report naturalWidth/Height, so this stays cheap on a 12 MP capture — and it
// tells us WHICH edge to constrain below. Resolves null if it cannot be read.
function probeSize(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    img.onload = () => done({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => done(null);
    img.src = url;
  });
}

async function loadBitmap(blob, maxSide = MAX_SIDE) {
  if ('createImageBitmap' in window) {
    // Downscale DURING the decode. Decoding first and shrinking afterwards
    // materialises the full sensor image: a 12 MP phone capture is a 48 MB
    // bitmap (190 MB on a 50 MP sensor) — enough to have the tab killed on a
    // 2 GB device while adding a nameplate photo. Resizing at decode time caps
    // the peak at ~5 MB (1280 x 960 x 4).
    // Only ONE dimension is passed, so the browser derives the other from the
    // source and the aspect ratio can never be distorted — even if the probe
    // reported pre-rotation dimensions for an EXIF-rotated photo and we
    // constrained the short edge (the bitmap is then merely larger than needed,
    // and the canvas step below still lands on the right size).
    if (maxSide > 0 && await supportsBitmapResize()) {
      const size = await probeSize(blob);
      if (size && size.w > 0 && size.h > 0 && Math.max(size.w, size.h) > maxSide) {
        const opts = { imageOrientation: 'from-image', resizeQuality: 'high' };
        if (size.w >= size.h) opts.resizeWidth = maxSide; else opts.resizeHeight = maxSide;
        try { return await createImageBitmap(blob, opts); } catch (e) { /* fall through */ }
      }
    }
    // honour EXIF orientation so portrait phone photos aren't stored sideways
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    try { return await createImageBitmap(blob); } catch (e) { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Capture → compress → store. Returns the new photo id (or null if cancelled).
export async function capturePhotoToDb(opts) {
  const file = await pickPhoto(opts);
  if (!file) return null;
  const blob = await compress(file);
  const id = uuid();
  await db.putPhoto(id, blob);
  await db.counterBump('photos');
  return id;
}

// Set an <img> to a stored photo. The object URL is revoked as soon as the image
// has decoded, so repainting a list of thumbnails never leaks blob URLs.
export async function setPhoto(imgEl, photoId) {
  if (!photoId) { imgEl.removeAttribute('src'); return false; }
  const blob = await db.getPhoto(photoId);
  if (!blob) { imgEl.removeAttribute('src'); return false; }
  const url = URL.createObjectURL(blob);
  const revoke = () => URL.revokeObjectURL(url);
  imgEl.addEventListener('load', revoke, { once: true });
  imgEl.addEventListener('error', revoke, { once: true });
  imgEl.src = url;
  return true;
}
export const photoUrl = setPhoto;
