// Taller — pdf.js wrapper: lazy loading, text extraction, page rendering.
// pdf.js (Apache-2.0) is vendored in /vendor/pdfjs (legacy build).

let _pdfjs = null;
let _pdfjsLoading = null;

// Thrown when the pdf.js engine itself could not be loaded (offline and not
// cached). Callers must distinguish this from "this PDF is damaged" — telling a
// technician their manual is corrupt when the engine simply is not cached is
// how you lose a user permanently.
export class PdfEngineUnavailable extends Error {
  constructor() { super('pdf-engine-unavailable'); this.name = 'PdfEngineUnavailable'; }
}

export async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  // Do NOT memoise a rejected promise: a failure while offline must not poison
  // the session for ever — retry the next time the user tries, when they may
  // well have signal again.
  if (_pdfjsLoading) return _pdfjsLoading;
  _pdfjsLoading = (async () => {
    let mod;
    try {
      mod = await import('../vendor/pdfjs/pdf.min.mjs');
    } catch (e) {
      throw new PdfEngineUnavailable();
    }
    const pdfjs = mod.default || mod;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
    _pdfjs = pdfjs;
    return pdfjs;
  })();
  try {
    return await _pdfjsLoading;
  } finally {
    if (!_pdfjs) _pdfjsLoading = null; // allow a retry after a failure
  }
}

// Is the engine ready to use without the network? Used to pre-flight actions
// that would otherwise dead-end minutes later.
export function pdfEngineLoaded() { return !!_pdfjs; }

// pdf.js compares maxImageSize against WIDTH * HEIGHT IN PIXELS, not bytes:
//   if (-1 !== maxImageSize && width * height > maxImageSize) { warn(...); return; }
// The old value (8 * 1024 * 1024 = 8.39 MP) was written as if it were bytes and
// sat just BELOW the size of a standard 300 dpi page scan:
//   A4  @300dpi = 2480 x 3508 =  8.70 MP  -> silently dropped
//   Letter@300dpi = 2550 x 3300 = 8.42 MP -> silently dropped
// Because ignoreErrors defaults to true, the image was discarded with only a
// console warning: scanned manuals imported "successfully", then rendered as
// BLANK WHITE PAGES, and OCR dutifully processed those blank canvases and
// found no text. 300 dpi is the standard archival scan resolution for service
// manuals, i.e. the app's single most important real-world input.
// 24 MP covers A4/A3 at 300 dpi and A4 at 400-500 dpi while still bounding a
// single decode to roughly 100 MB on a 2 GB phone.
const MAX_IMAGE_PIXELS = 24 * 1000 * 1000;

export async function openPdf(blob) {
  const pdfjs = await loadPdfJs();
  const data = await blob.arrayBuffer();
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableAutoFetch: false,
    // keep memory bounded on low-RAM devices (cap any single decoded image)
    maxImageSize: MAX_IMAGE_PIXELS,
  });
  return task.promise; // PDFDocumentProxy
}

// Extract text page by page. onProgress(pageDone, total).
// Returns { pages: [{page, text}], charCount, textPages }
export async function extractText(doc, onProgress) {
  const total = doc.numPages;
  const pages = [];
  let charCount = 0;
  let textPages = 0;
  for (let p = 1; p <= total; p++) {
    let text = '';
    try {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      text = joinTextItems(tc.items);
      page.cleanup();
    } catch (e) {
      text = '';
    }
    text = text.trim();
    if (text.length > 20) textPages++;
    charCount += text.length;
    pages.push({ page: p, text });
    if (onProgress) onProgress(p, total);
    if (p % 5 === 0) await new Promise(r => setTimeout(r, 0)); // keep UI alive
  }
  return { pages, charCount, textPages };
}

// Join pdf.js text items into readable text with line breaks.
function joinTextItems(items) {
  let out = '';
  let lastY = null;
  for (const it of items) {
    if (!it.str) { if (it.hasEOL) out += '\n'; continue; }
    const y = it.transform ? it.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      if (!out.endsWith('\n')) out += '\n';
    } else if (out && !out.endsWith(' ') && !out.endsWith('\n')) {
      out += ' ';
    }
    out += it.str;
    if (it.hasEOL) out += '\n';
    if (y !== null) lastY = y;
  }
  // normalize whitespace but keep line structure
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
}

// Decide if a document is a scan: few text pages relative to total.
export function isScanned(extract, numPages) {
  if (numPages === 0) return false;
  const ratio = extract.textPages / numPages;
  const avgChars = extract.charCount / numPages;
  return ratio < 0.25 || avgChars < 40;
}

// Render one page into a canvas. Returns {canvas, cssW, cssH, viewport, dpr}.
// scale is CSS pixels per PDF unit; caps total pixels to protect low-RAM phones.
// pdf.js refuses to render twice into the same canvas concurrently ("Cannot use
// the same canvas during multiple render() operations"). The reader reuses one
// canvas and fires paint() without awaiting, so tapping "next" twice while a
// slow scanned page rasterises used to throw, get swallowed, and leave the page
// number ahead of what is actually drawn — the reader silently SKIPPED a page.
// Track the in-flight task per canvas and cancel it before starting the next.
const _activeRenders = new WeakMap();

export async function renderPage(doc, pageNum, cssWidth, zoom = 1, canvas = null) {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  let scale = (cssWidth / base.width) * zoom;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // cap total rendered pixels at ~6MP
  const MAX_PX = 6 * 1024 * 1024;
  let px = base.width * scale * dpr * base.height * scale * dpr;
  if (px > MAX_PX) scale *= Math.sqrt(MAX_PX / px);
  const viewport = page.getViewport({ scale: scale * dpr });
  const c = canvas || document.createElement('canvas');

  // Cancel any render still running on this canvas and wait for it to unwind.
  const prev = _activeRenders.get(c);
  if (prev) {
    try { prev.cancel(); } catch (e) { /* already finished */ }
    try { await prev.promise; } catch (e) { /* expected: RenderingCancelledException */ }
  }

  c.width = Math.floor(viewport.width);
  c.height = Math.floor(viewport.height);
  c.style.width = Math.floor(viewport.width / dpr) + 'px';
  c.style.height = Math.floor(viewport.height / dpr) + 'px';
  const ctx = c.getContext('2d', { alpha: false });
  const task = page.render({ canvasContext: ctx, viewport });
  _activeRenders.set(c, task);
  try {
    await task.promise;
  } finally {
    if (_activeRenders.get(c) === task) _activeRenders.delete(c);
    page.cleanup();
  }
  return { canvas: c, cssW: Math.floor(viewport.width / dpr), cssH: Math.floor(viewport.height / dpr), viewport, dpr };
}

// Compute CSS-pixel rectangles of term occurrences on a page, matching the
// geometry of a renderPage() call that produced `viewport` and `dpr`.
export async function termRects(doc, pageNum, terms, viewport, dpr, maxRects = 150) {
  if (!_pdfjs || !terms || !terms.length) return [];
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nterms = [...new Set(terms.map(norm).filter(w => w.length >= 2))];
  if (!nterms.length) return [];
  const page = await doc.getPage(pageNum);
  let items = [];
  try { items = (await page.getTextContent()).items; } catch (e) { items = []; }
  const rects = [];
  for (const it of items) {
    if (!it.str || rects.length >= maxRects) continue;
    const s = norm(it.str);
    for (const term of nterms) {
      let idx = s.indexOf(term);
      while (idx !== -1 && rects.length < maxRects) {
        const tx = _pdfjs.Util.transform(viewport.transform, it.transform);
        const fontH = Math.hypot(tx[2], tx[3]) || (it.height * viewport.scale);
        const w = it.width * viewport.scale;
        const f0 = idx / Math.max(s.length, 1);
        const f1 = (idx + term.length) / Math.max(s.length, 1);
        rects.push({
          x: (tx[4] + w * f0) / dpr,
          y: (tx[5] - fontH) / dpr,
          w: (w * (f1 - f0)) / dpr,
          h: (fontH * 1.18) / dpr,
        });
        idx = s.indexOf(term, idx + term.length);
      }
    }
  }
  page.cleanup();
  return rects;
}

// Render page to an offscreen canvas for OCR (grayscale handled by consumer).
export async function renderPageForOcr(doc, pageNum, maxSide = 1500) {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 3);
  const viewport = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.floor(viewport.width);
  c.height = Math.floor(viewport.height);
  const ctx = c.getContext('2d', { alpha: false });
  ctx.filter = 'grayscale(1)';
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return c;
}
