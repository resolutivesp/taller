// Taller — optional on-device OCR for scanned manuals (tesseract.js, Apache-2.0).
// Strict low-RAM discipline: one worker, one page at a time, downscaled grayscale
// images, worker terminated at the end. First run needs internet once (~7 MB),
// afterwards the engine is cached by the service worker.

import { db } from './db.js';
import { el, t, toast, modal, getLang, isOnline } from './ui.js';
import { openPdf, renderPageForOcr } from './pdfengine.js';
import { indexManual } from './search.js';

let _scriptLoaded = false;

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
      },
    }, label);
    langRow.append(chip);
  }

  const body = el('div', {},
    el('p', { class: 'small' }, t('ocr.intro')),
    el('p', { class: 'muted small' }, t('ocr.firstTime')),
    el('p', { class: 'lbl' }, t('ocr.lang')),
    langRow,
  );

  const m = modal({
    title: t('ocr.title'), body,
    actions: [
      { label: t('common.cancel'), kind: 'btn-secondary' },
      { label: t('ocr.start'), kind: 'btn-primary', onClick: () => { runOcr(manual, lang, onDone); } },
    ],
  });
  return m;
}

async function runOcr(manual, lang, onDone) {
  let stopped = false;
  const barFill = el('div', { class: 'progress-fill', style: 'width:0%' });
  const status = el('div', { class: 'import-status' }, t('ocr.progress', { x: 1, y: manual.numPages }));
  const body = el('div', {},
    el('div', { class: 'progress' }, barFill),
    status,
    el('p', { class: 'muted small' }, t('library.keepOpen')),
  );
  const m = modal({
    title: t('ocr.title'), body,
    actions: [{ label: t('common.stop'), kind: 'btn-danger', onClick: () => { stopped = true; return false; } }],
  });

  let worker = null;
  let doc = null;
  let done = 0;
  const updatedPages = [];

  try {
    await loadTesseractScript();
    const base = document.baseURI;
    worker = await window.Tesseract.createWorker(lang, 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', base).href,
      corePath: new URL('vendor/tesseract/tesseract-core-simd-lstm.wasm.js', base).href,
      langPath: new URL('vendor/tesseract/', base).href.replace(/\/$/, ''),
      gzip: true,
    });

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
          updatedPages.push({ page: p, text });
          done++;
        }
      } finally {
        canvas.width = 0; canvas.height = 0; canvas = null;
      }
      barFill.style.width = Math.round((p / total) * 100) + '%';
      await new Promise(r => setTimeout(r, 30)); // let UI breathe / thermals
    }

    if (updatedPages.length) {
      const records = await indexManual(manual.id, updatedPages);
      await db.putPages(records);
      const fresh = await db.getManual(manual.id);
      fresh.scanned = false;
      fresh.ocrPages = (fresh.ocrPages || 0) + updatedPages.length;
      await db.putManual(fresh);
    }

    m.close();
    toast(stopped ? t('ocr.stopped', { n: done }) : t('ocr.done', { n: done }), 4500);
    if (onDone) onDone();
  } catch (e) {
    console.error('OCR failed', e);
    m.close();
    toast(isOnline() ? t('ocr.failed') : t('ocr.failed') + ' — ' + t('ocr.firstTime'), 5000);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } }
    if (doc) { try { doc.destroy(); } catch (e) { /* ignore */ } }
  }
}
