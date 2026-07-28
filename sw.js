// Taller — service worker. Fully offline after install.
//
// THREE tiers, because "offline" is the product promise and it must be both
// achievable on a 2G link and honestly reportable to the technician:
//
//   CORE (atomic, ~0.5 MB): the app shell. If this fails, install fails —
//     that is correct: a half-cached shell is worse than none.
//   ESSENTIAL (~1.9 MB): pdf.js + QR + the demo. Reading a manual offline IS
//     the product, so pdf.js cannot be best-effort-and-forgotten. It is
//     fetched after CORE, retried on activate and on demand, and its state is
//     reportable to the page (OFFLINE_STATUS below) so the UI can tell the
//     technician whether it is actually safe to lose signal.
//   OPTIONAL (~7.5 MB): the OCR engine + language data. NEVER precached —
//     downloading an OCR engine nobody asked for over a metered 2G link was
//     costing 20-40 min of the install and could strand the user with no
//     offline app at all. Fetched on first OCR use and kept by the runtime
//     handler, which is exactly what the UI has always promised.
//
// Two caches: PRECACHE (version-scoped, cleaned on activate) and RUNTIME
// (stable name, never wiped) so a technician who downloaded the OCR engine
// keeps it across app updates.
//
// The new worker does NOT auto-skipWaiting: it waits, the page shows an
// "update ready" prompt, and only takes over when the user accepts — so an
// in-progress render/import/OCR is never hot-swapped under a live session.

const VERSION = 'taller-v0.6';
const PRECACHE = `${VERSION}-shell`;
const RUNTIME = 'taller-runtime'; // stable across releases

// Small, must-succeed critical shell (atomic addAll). ~0.5 MB.
const CORE = [
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

// Needed for the core loop (open a manual, scan/print a label, run the demo).
// Cached into the STABLE runtime cache so they survive future updates.
const ESSENTIAL = [
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/qr/qrcode.js',
  './demo/demo-manual.pdf',
  './demo/demo-manual-fr.pdf',
  './demo/demo-manual-es.pdf',
  './demo/demo-manual-pt.pdf',
  './demo/demo-nameplate.png',
];

// Deliberately NOT precached — see header. Listed so the status check can
// report OCR availability without hard-coding paths elsewhere.
const OPTIONAL_OCR = [
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/eng.traineddata.gz',
];

// Always bypass the HTTP cache when (pre)caching, otherwise a client that
// loaded within the CDN max-age window precaches the PREVIOUS revision of a
// file into the new version-scoped shell and then serves stale code for ever.
function freshRequest(u) {
  return new Request(u, { cache: 'reload' });
}

async function addAllFresh(cache, urls) {
  // Parallel but capped: on a 2G link, firing everything at once just makes
  // every request time out together.
  const CONCURRENCY = 4;
  let i = 0;
  const results = [];
  async function worker() {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const res = await fetch(freshRequest(u));
        if (!res || !res.ok) throw new Error('bad status ' + (res && res.status));
        await cache.put(u, res);
        results.push({ u, ok: true });
      } catch (e) {
        results.push({ u, ok: false });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return results;
}

async function cacheEssential() {
  const rt = await caches.open(RUNTIME);
  const missing = [];
  for (const u of ESSENTIAL) if (!(await rt.match(u))) missing.push(u);
  if (!missing.length) return { ok: true, missing: [] };
  const res = await addAllFresh(rt, missing);
  const failed = res.filter((r) => !r.ok).map((r) => r.u);
  return { ok: failed.length === 0, missing: failed };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const pre = await caches.open(PRECACHE);
    // Atomic: must succeed or install fails (correct — a partial shell is a trap).
    await pre.addAll(CORE.map(freshRequest));
    // Then the essentials. Best-effort so one flaky download can't abort the
    // install, but retried on activate and reported to the page.
    await cacheEssential();
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
    // Second chance for anything that failed during install.
    cacheEssential().catch(() => {});
  })());
});

async function offlineStatus() {
  const [pre, rt] = await Promise.all([caches.open(PRECACHE), caches.open(RUNTIME)]);
  const missingCore = [];
  for (const u of CORE) if (!(await pre.match(u))) missingCore.push(u);
  const missingEssential = [];
  for (const u of ESSENTIAL) if (!(await rt.match(u))) missingEssential.push(u);
  let ocr = true;
  for (const u of OPTIONAL_OCR) if (!(await rt.match(u))) { ocr = false; break; }
  return {
    version: VERSION,
    ready: missingCore.length === 0 && missingEssential.length === 0,
    shellReady: missingCore.length === 0,
    pdfReady: !missingEssential.some((u) => u.indexOf('pdfjs') !== -1),
    ocrReady: ocr,
    missing: missingCore.length + missingEssential.length,
  };
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
    return;
  }
  // The page asks "is it safe to lose signal?" — answer honestly, and repair
  // anything missing while we still have a connection.
  if (data && data.type === 'OFFLINE_STATUS') {
    const port = event.ports && event.ports[0];
    event.waitUntil((async () => {
      let st = await offlineStatus();
      if (!st.ready && data.repair) {
        await cacheEssential().catch(() => {});
        st = await offlineStatus();
      }
      if (port) port.postMessage(st);
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== location.origin) return; // never touch cross-origin (e.g. AI worker)

  // navigations → cached shell first (offline start)
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(PRECACHE)
        .then((c) => c.match('./index.html'))
        .then((hit) => hit || caches.match('./index.html'))
        .then((hit) => hit || fetch(req))
        .catch(() => fetch(req))
    );
    return;
  }

  event.respondWith((async () => {
    // Look in the version-scoped shell FIRST, then the stable runtime cache.
    // A bare caches.match() searches in cache-creation order, so the older
    // RUNTIME cache would shadow a freshly-updated shell copy of the same URL.
    const pre = await caches.open(PRECACHE);
    const shellHit = await pre.match(req, { ignoreSearch: true });
    if (shellHit) return shellHit;
    const rt = await caches.open(RUNTIME);
    const rtHit = await rt.match(req, { ignoreSearch: true });
    if (rtHit) return rtHit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        // Keep the worker alive until the body has finished streaming into the
        // cache — otherwise a large asset (OCR core, pdf worker) can be dropped
        // when the SW is terminated right after respondWith settles.
        event.waitUntil(rt.put(req, copy).catch(() => {}));
      }
      return res;
    } catch (e) {
      // Offline and not cached: fail with a body the caller can recognise
      // rather than a generic network error.
      return new Response('offline-uncached', { status: 504, statusText: 'offline-uncached' });
    }
  })());
});
