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
  const bitmap = await loadBitmap(fileOrBlob);
  const { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  canvas.width = canvas.height = 0;
  return blob || fileOrBlob;
}

async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
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
