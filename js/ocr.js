// Taller — optional on-device OCR for scanned manuals (tesseract.js, Apache-2.0).
// Strict low-RAM discipline: one worker, one page at a time, downscaled grayscale
// images, worker terminated at the end. First run needs internet once (~7 MB),
// afterwards the engine is cached by the service worker.

import { db, isQuotaError } from './db.js';
import { el, clear, t, toast, modal, getLang, isOnline } from './ui.js';
import { icon } from './icons.js';
import { openPdf, renderPageForOcr, PdfEngineUnavailable } from './pdfengine.js';
import { indexManual } from './search.js';

let _scriptLoaded = false;

// Thrown when the engine itself could not be obtained (offline, never cached).
// "We could not download the OCR engine" and "OCR ran and failed on this page"
// need completely different actions from the technician, so they must not share
// one message.
class OcrEngineUnavailable extends Error {
  constructor() { super('ocr-engine-unavailable'); this.name = 'OcrEngineUnavailable'; }
}

// The code half of the engine. Without these three files nothing can start —
// they can only come from the network or the service-worker cache.
const OCR_CODE = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
];

async function allCached(urls) {
  if (!('caches' in window)) return false;
  try {
    for (const u of urls) {
      if (!(await caches.match(new URL(u, document.baseURI).href))) return false;
    }
    return true;
  } catch (e) { return false; }
}

// Pre-flight: the service worker no longer precaches the ~7.5 MB engine (it is
// fetched on first use), so an installed, fully-offline app can still be unable
// to run OCR. Answering this BEFORE the Start button is offered is the
// difference between a clear "connect once" and a dead end 3 minutes in.
async function engineStatus(lang) {
  const code = await allCached(OCR_CODE);
  const data = code && await allCached([`vendor/tesseract/${lang}.traineddata.gz`]);
  return { code, ready: code && data, online: isOnline() };
}

function loadTesseractScript() {
  if (_scriptLoaded && window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/tesseract/tesseract.min.js';
    s.onload = () => { _scriptLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('tesseract script load failed'));
    document.head.append(s);
  });
}

export function startOcr(manual, onDone) {
  let lang = getLang() === 'fr' ? 'fra' : 'eng';

  const langRow = el('div', { class: 'chip-row' });
  for (const [code, label] of [['eng', 'English'], ['fra', 'Français']]) {
    const chip = el('button', {
      class: 'chip' + (lang === code ? ' active' : ''),
      onclick: () => {
        langRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        lang = code;
        refresh(); // language data is downloaded per language — re-check it
      },
    }, label);
    langRow.append(chip);
  }

  const note = el('p', { class: 'muted small' }, t('ocr.firstTime'));
  const body = el('div', {},
    el('p', { class: 'small' }, t('ocr.intro')),
    note,
    el('p', { class: 'lbl' }, t('ocr.lang')),
    langRow,
  );

  const m = modal({
    title: t('ocr.title'), body,
    actions: [
      { label: t('common.cancel'), kind: 'btn-secondary' },
      { label: t('ocr.start'), kind: 'btn-primary', onClick: () => { runOcr(manual, lang, onDone); } },
    ],
    onClose: () => window.removeEventListener('online', refresh),
  });

  // Say what will actually happen, and refuse to start a run that cannot
  // possibly work (engine not on the device AND no connection to fetch it) —
  // otherwise the dead end only shows up minutes into the run.
  const startBtn = m.box.querySelector('.modal-actions .btn-primary');
  const refresh = async () => {
    const st = await engineStatus(lang);
    const blocked = !st.code && !st.online;
    clear(note);
    note.className = blocked ? 'ctx-chip' : 'muted small';
    if (blocked) note.append(icon('wifi-off', 16), t('ocr.needInternet'));
    else note.append(st.ready ? t('ocr.engineReady') : t('ocr.firstTime'));
    if (startBtn) {
      if (blocked) startBtn.setAttribute('disabled', '');
      else startBtn.removeAttribute('disabled');
    }
  };
  refresh();
  // They were told to connect: pick that up while the dialog is still open.
  window.addEventListener('online', refresh);
  return m;
}

async function runOcr(manual, lang, onDone) {
  let stopped = false;
  const barFill = el('div', { class: 'progress-fill', style: 'width:0%' });
  const status = el('div', { class: 'import-status' }, t('ocr.progress', { x: 1, y: manual.numPages }));
  const body = el('div', {},
    el('div', { class: 'progress' }, barFill),
    status,
    el('p', { class: 'muted small' }, t('ocr.savedAsYouGo')),
    el('p', { class: 'muted small' }, t('library.keepOpen')),
  );
  const m = modal({
    title: t('ocr.title'), body,
    actions: [{ label: t('common.stop'), kind: 'btn-danger', onClick: () => { stopped = true; return false; } }],
  });

  let worker = null;
  let doc = null;
  let done = 0;
  let pending = [];

  // Save every few pages instead of once at the very end. A 200-page scan is
  // 15-30 minutes of work; holding all of it in RAM meant a tab kill, an OOM or
  // one accidental back-navigation at minute 25 threw away everything. The
  // resume check in the loop skips pages that already have text, so an early
  // flush is also exactly what lets a stopped run continue where it left off.
  const FLUSH_EVERY = 5;
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const records = await indexManual(manual.id, batch);
    await db.putPages(records);
    const fresh = await db.getManual(manual.id);
    if (fresh) {
      fresh.ocrPages = (fresh.ocrPages || 0) + batch.length;
      await db.putManual(fresh);
    }
  };

  try {
    const base = document.baseURI;
    try {
      await loadTesseractScript();
      worker = await window.Tesseract.createWorker(lang, 1, {
        workerPath: new URL('vendor/tesseract/worker.min.js', base).href,
        corePath: new URL('vendor/tesseract/tesseract-core-simd-lstm.wasm.js', base).href,
        langPath: new URL('vendor/tesseract/', base).href.replace(/\/$/, ''),
        gzip: true,
      });
    } catch (e) {
      // A full phone while caching the engine is a storage problem, not a
      // connectivity one — don't mislabel it.
      if (isQuotaError(e)) throw e;
      console.warn('OCR engine unavailable', e);
      throw new OcrEngineUnavailable();
    }

    const blob = await db.getFile(manual.id);
    doc = await openPdf(blob);
    const total = doc.numPages;

    for (let p = 1; p <= total; p++) {
      if (stopped) break;
      const existing = await db.getPage(manual.id, p);
      if (existing && existing.text && existing.text.trim().length > 20) {
        // already has text (born-digital page or previously OCRed)
        barFill.style.width = Math.round((p / total) * 100) + '%';
        continue;
      }
      status.textContent = t('ocr.progress', { x: p, y: total });
      let canvas = await renderPageForOcr(doc, p, 1500);
      try {
        const res = await worker.recognize(canvas);
        const text = (res && res.data && res.data.text ? res.data.text : '').trim();
        if (text.length > 5) {
          pending.push({ page: p, text });
          done++;
        }
      } finally {
        canvas.width = 0; canvas.height = 0; canvas = null;
      }
      if (pending.length >= FLUSH_EVERY) await flush();
      barFill.style.width = Math.round((p / total) * 100) + '%';
      await new Promise(r => setTimeout(r, 30)); // let UI breathe / thermals
    }

    const completed = !stopped;
    await flush();
    // ONLY a run that reached the last page may clear the scan flag. library.js
    // renders "Make searchable" only while manual.scanned is true, so clearing
    // it after a stop at page 3 of 200 removed the only way to finish the job —
    // delete-and-re-import was the sole recovery.
    if (completed) {
      const fresh = await db.getManual(manual.id);
      // ocrPages covers the resume case: a run that finishes the last 3 blank
      // pages of a manual OCRed in an earlier session still made it searchable.
      // Nothing found on any run at all leaves the flag (and the button) alone
      // so the technician can retry in the other language.
      if (fresh && fresh.scanned && (done > 0 || (fresh.ocrPages || 0) > 0)) {
        fresh.scanned = false;
        await db.putManual(fresh);
      }
    }

    m.close();
    toast(stopped ? t('ocr.stopped', { n: done }) : t('ocr.done', { n: done }), 4500);
    if (onDone) onDone();
  } catch (e) {
    console.error('OCR failed', e);
    m.close();
    // Three failures the technician acts on differently: no engine (connect
    // once), no space (free some), or OCR genuinely could not run here. One
    // generic message left them with nothing to try.
    if (e instanceof OcrEngineUnavailable || e instanceof PdfEngineUnavailable) toast(t('ocr.needInternet'), 6000);
    else if (isQuotaError(e)) toast(t('ocr.storageFull'), 6000);
    else toast(t('ocr.failed'), 5000);
    if (done > 0 && onDone) onDone(); // some pages were saved — refresh the list
  } finally {
    if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } }
    if (doc) { try { doc.destroy(); } catch (e) { /* ignore */ } }
  }
}
