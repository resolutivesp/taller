// Taller — PDF reader: render, navigate, zoom (buttons + pinch + double-tap),
// find-in-manual, and in-page highlighting of search terms over the canvas.

import { db } from './db.js';
import { el, clear, t, toast, copyText, debounce, highlight } from './ui.js';
import { icon } from './icons.js';
import { openPdf, renderPage, termRects } from './pdfengine.js';
import { searchPages, makeSnippet } from './search.js';
import { navigate } from './main.js';

let _doc = null;
let _docId = null;
let _renderSeq = 0;

export function cleanupReader() {
  if (_doc) { try { _doc.destroy(); } catch (e) { /* ignore */ } }
  _doc = null; _docId = null;
}

export async function renderReader(container, params) {
  const { id } = params;
  let page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const query = params.q || '';
  let hlTerms = query ? query.split(/\s+/).filter(w => w.length >= 2) : [];

  clear(container);
  const man = await db.getManual(id);
  if (!man) { navigate('#/library'); return; }

  if (_docId !== id) {
    cleanupReader();
    const blob = await db.getFile(id);
    if (!blob) { navigate('#/library'); return; }
    try {
      _doc = await openPdf(blob);
      _docId = id;
    } catch (e) {
      toast(t('library.importFailed'), 4000);
      navigate('#/library');
      return;
    }
  }
  const total = _doc.numPages;
  page = Math.min(page, total);
  let zoom = 1;

  // --- header ---
  const pageLabel = el('span', { class: 'reader-pages' }, t('reader.pageOf', { p: page, n: total }));
  const header = el('div', { class: 'reader-header' },
    el('button', { class: 'icon-btn', 'aria-label': t('common.back'), onclick: () => navigate('#/library') }, icon('chevron-left', 22)),
    el('div', { class: 'reader-title' }, man.name),
    pageLabel,
  );

  // --- search context chip ---
  let ctxChip = null;
  if (query) {
    const rec = await db.getPage(id, page);
    if (rec && rec.text) {
      ctxChip = el('div', { class: 'ctx-chip' },
        el('div', { class: 'small', html: '<b>' + t('reader.resultCtx') + '</b> ' + highlight(makeSnippet(rec.text, hlTerms, 170), hlTerms) }),
        el('button', { class: 'icon-btn', 'aria-label': t('common.close'), onclick: () => ctxChip.remove() }, icon('x', 16)),
      );
    }
  }

  // --- stage ---
  const canvas = el('canvas', { class: 'pdf-canvas', role: 'img' });
  const holder = el('div', { class: 'page-holder' }, canvas);
  const stage = el('div', { class: 'reader-stage' }, holder);

  // --- find bar ---
  const findResults = el('div', { class: 'find-results' });
  const findInput = el('input', {
    type: 'search', class: 'search-box', placeholder: t('reader.findInManual'), autocomplete: 'off',
    oninput: debounce(async (e) => {
      const q = e.target.value.trim();
      clear(findResults);
      if (q.length < 2) return;
      const { terms, hits } = await searchPages(q, { manualId: id, limit: 10 });
      if (!hits.length) { findResults.append(el('p', { class: 'muted small' }, t('search.noResults'))); return; }
      for (const h of hits) {
        const rec = await db.getPage(id, h.page);
        findResults.append(el('button', {
          class: 'result-card compact',
          onclick: () => {
            findWrap.style.display = 'none';
            hlTerms = q.split(/\s+/).filter(w => w.length >= 2);
            goto(h.page);
          },
        },
          el('span', { class: 'badge badge-page' }, t('search.page', { n: h.page })),
          el('span', { class: 'result-snippet small', html: highlight(makeSnippet(rec ? rec.text : '', terms, 110), terms) }),
        ));
      }
      db.counterBump('searches');
    }, 350),
  });
  const findWrap = el('div', { class: 'find-wrap', style: 'display:none' }, findInput, findResults);

  // --- toolbar ---
  const pageInput = el('input', {
    type: 'number', class: 'page-input', min: 1, max: total, value: page,
    onchange: (e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= total) goto(v); },
  });
  const toolBtn = (ico, label, onclick) =>
    el('button', { class: 'tool-btn', 'aria-label': label, onclick }, icon(ico, 21));

  const toolbar = el('div', { class: 'reader-toolbar' },
    toolBtn('chevron-left', t('reader.prevPage'), () => goto(page - 1)),
    pageInput,
    toolBtn('chevron-right', t('reader.nextPage'), () => goto(page + 1)),
    el('span', { class: 'tool-sep' }),
    toolBtn('zoom-out', t('reader.zoomOut'), () => setZoom(zoom / 1.4)),
    toolBtn('zoom-in', t('reader.zoomIn'), () => setZoom(zoom * 1.4)),
    el('span', { class: 'tool-sep' }),
    toolBtn('search', t('reader.findInManual'), () => {
      findWrap.style.display = findWrap.style.display === 'none' ? '' : 'none';
      if (findWrap.style.display === '') findInput.focus();
    }),
    toolBtn('clipboard', t('reader.copyPageText'), async () => {
      const rec = await db.getPage(id, page);
      if (rec && rec.text && rec.text.trim()) {
        const head = `${man.name} — p.${page}\n\n`;
        if (await copyText(head + rec.text)) toast(t('reader.copiedPage'));
      } else {
        toast(t('reader.noTextPage'));
      }
    }),
  );

  container.append(header, ctxChip || '', findWrap, stage, toolbar);

  // --- rendering + highlights ---
  async function paint() {
    const seq = ++_renderSeq;
    const cssWidth = Math.max(280, stage.clientWidth - 12);
    canvas.classList.add('turning');
    holder.querySelectorAll('.hl-rect').forEach(n => n.remove());
    try {
      const r = await renderPage(_doc, page, cssWidth, zoom, canvas);
      if (seq !== _renderSeq) return;
      canvas.classList.remove('turning');
      pageLabel.textContent = t('reader.pageOf', { p: page, n: total });
      canvas.setAttribute('aria-label', man.name + ' — ' + t('reader.pageOf', { p: page, n: total }));
      pageInput.value = page;
      if (hlTerms.length) {
        const rects = await termRects(_doc, page, hlTerms, r.viewport, r.dpr);
        if (seq !== _renderSeq) return;
        for (const rc of rects) {
          holder.append(el('span', {
            class: 'hl-rect',
            style: `left:${rc.x.toFixed(1)}px; top:${rc.y.toFixed(1)}px; width:${rc.w.toFixed(1)}px; height:${rc.h.toFixed(1)}px`,
          }));
        }
      }
    } catch (e) {
      canvas.classList.remove('turning');
      console.error('render failed', e);
    }
  }

  function goto(p) {
    if (p < 1 || p > total) return;
    page = p;
    history.replaceState(null, '', `#/reader/${id}/${p}${query ? '?q=' + encodeURIComponent(query) : ''}`);
    if (ctxChip) { ctxChip.remove(); ctxChip = null; }
    paint();
  }

  function setZoom(z, focus) {
    const prev = zoom;
    zoom = Math.min(4, Math.max(0.6, z));
    paint().then(() => {
      if (focus && zoom > prev) {
        // keep tapped point roughly centered
        stage.scrollLeft = Math.max(0, focus.fx * stage.scrollWidth - stage.clientWidth / 2);
        stage.scrollTop = Math.max(0, focus.fy * stage.scrollHeight - stage.clientHeight / 2);
      }
    });
  }

  // swipe page navigation (only when not zoomed in)
  let touchX = null, touchY = null;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX === null || zoom > 1.05) { touchX = null; return; }
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 64 && Math.abs(dy) < 48) goto(dx < 0 ? page + 1 : page - 1);
    touchX = null;
  }, { passive: true });

  // pinch zoom
  let pinchDist = null, pinchStartZoom = 1;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchDist = dist(e.touches);
      pinchStartZoom = zoom;
    }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchDist) {
      const f = dist(e.touches) / pinchDist;
      holder.style.transform = `scale(${f})`;
      holder.style.transformOrigin = 'center top';
    }
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (pinchDist && e.touches.length < 2) {
      const f = parseFloat((holder.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || 1);
      holder.style.transform = '';
      pinchDist = null;
      setZoom(pinchStartZoom * f);
    }
  }, { passive: true });

  // double-tap zoom toward the tapped point
  let lastTap = 0;
  stage.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300 && e.touches.length === 0) {
      const tch = e.changedTouches[0];
      const rect = stage.getBoundingClientRect();
      const fx = (stage.scrollLeft + (tch.clientX - rect.left)) / Math.max(stage.scrollWidth, 1);
      const fy = (stage.scrollTop + (tch.clientY - rect.top)) / Math.max(stage.scrollHeight, 1);
      setZoom(zoom > 1.05 ? 1 : 2.1, { fx, fy });
    }
    lastTap = now;
  }, { passive: true });

  function dist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  await paint();
  return cleanupReader;
}
