// Taller — service worker. Fully offline after install.
//
// Two caches:
//   PRECACHE (version-scoped): the small critical app shell. Re-fetched on each
//     release; old versions are cleaned up on activate.
//   RUNTIME (STABLE name): heavy vendored assets (pdf.js worker, OCR engine +
//     language data, QR, demo files) and anything fetched at runtime. This cache
//     is NEVER wiped on update, so a technician who downloaded the ~7 MB OCR
//     engine keeps it offline across app updates.
//
// The new worker does NOT auto-skipWaiting: it waits, the page shows an "update
// ready" prompt, and only takes over when the user accepts — so an in-progress
// render/import/OCR is never hot-swapped under a live session.

const VERSION = 'taller-v0.5.1';
const PRECACHE = `${VERSION}-shell`;
const RUNTIME = 'taller-runtime'; // stable across releases

// Small, must-succeed critical shell (atomic addAll).
const CRITICAL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/config.js',
  './js/strings.js',
  './js/icons.js',
  './js/db.js',
  './js/ui.js',
  './js/model.js',
  './js/images.js',
  './js/pdfengine.js',
  './js/search.js',
  './js/home.js',
  './js/equipment.js',
  './js/library.js',
  './js/reader.js',
  './js/ask.js',
  './js/logbook.js',
  './js/reports.js',
  './js/backup.js',
  './js/qr.js',
  './js/scan.js',
  './js/manualsources.js',
  './js/feedback.js',
  './js/ocr.js',
  './vendor/minisearch/minisearch.js',
  './vendor/fonts/manrope-latin-wght-normal.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

// Large/optional assets — best-effort so one flaky download can't abort install.
// Cached into the STABLE runtime cache so they survive future updates.
const HEAVY = [
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/qr/qrcode.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/eng.traineddata.gz',
  './vendor/tesseract/fra.traineddata.gz',
  './demo/demo-manual.pdf',
  './demo/demo-manual-fr.pdf',
  './demo/demo-nameplate.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const pre = await caches.open(PRECACHE);
    await pre.addAll(CRITICAL); // must succeed, or install fails (correct)
    const rt = await caches.open(RUNTIME);
    await Promise.allSettled(HEAVY.map((u) => rt.add(u))); // best-effort
    // NOTE: no skipWaiting — the page decides when to activate a new version.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k === PRECACHE || k === RUNTIME) return null; // keep current shell + runtime
      return caches.delete(k); // drop only old version shells
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch cross-origin (e.g. AI worker)

  // navigations → cached shell first (offline start)
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(RUNTIME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
