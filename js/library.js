// Taller — Library view: import PDFs, list manuals, search across all manuals.

import { CONFIG, DEMO_SUGGESTIONS } from './config.js';
import { db } from './db.js';
import { el, clear, t, tn, getLang, toast, confirmModal, confirmAsync, modal, fmtBytes, debounce, highlight, uuid, shareApp } from './ui.js';
import { icon } from './icons.js';
import { openPdf, extractText, isScanned } from './pdfengine.js';
import { indexManual, unindexManual, searchPages, makeSnippet } from './search.js';
import { startOcr } from './ocr.js';
import { seedDemoEquipment } from './equipment.js';
import { findManual } from './manualsources.js';
import { navigate } from './main.js';

export async function importFiles(fileList, onAllDone, extra = {}) {
  const all = [...fileList];
  const files = all.filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { if (all.length) toast(t('library.onlyPdf'), 4000); return []; }

  const ids = [];
  for (const file of files) {
    const mb = file.size / (1024 * 1024);
    if (mb > CONFIG.bigFileWarnMB) {
      const goOn = await confirmAsync(t('library.bigFileWarn', { mb: mb.toFixed(0) }));
      if (!goOn) continue;
    }
    const id = await importOne(file, extra);
    if (id) ids.push(id);
  }
  if (onAllDone) onAllDone();
  return ids;
}

async function importOne(file, extra = {}) {
  const status = el('div', { class: 'import-status' }, t('library.readingFile'));
  const barFill = el('div', { class: 'progress-fill', style: 'width:0%' });
  const body = el('div', {},
    el('p', { class: 'muted small row' }, icon('file-text', 16), file.name),
    el('div', { class: 'progress' }, barFill),
    status,
    el('p', { class: 'muted small' }, t('library.keepOpen')),
  );
  const m = modal({ title: t('library.importing'), body, actions: [] });

  const setProg = (frac, msg) => {
    barFill.style.width = Math.round(frac * 100) + '%';
    if (msg) status.textContent = msg;
  };

  const id = uuid();
  let doc = null;
  try {
    doc = await openPdf(file);
    const total = doc.numPages;
    setProg(0.05, t('library.extracting', { x: 1, y: total }));
    const extract = await extractText(doc, (p, tot) =>
      setProg(0.05 + 0.6 * (p / tot), t('library.extracting', { x: p, y: tot })));

    const scanned = isScanned(extract, total);
    setProg(0.7, t('library.indexing'));
    const records = await indexManual(id, extract.pages, (done, tot) =>
      setProg(0.7 + 0.2 * (tot ? done / tot : 1), t('library.indexing')));

    setProg(0.92, t('library.indexing'));
    await db.putPages(records);
    await db.putFile(id, file);
    await db.putManual({
      id,
      name: prettyName(file.name),
      fileName: file.name,
      size: file.size,
      numPages: total,
      scanned,
      ocrPages: 0,
      createdAt: Date.now(),
      ...extra,
    });
    await db.counterBump('manualsImported');
    // re-link any equipment that remembers this manual by name but lost its id
    // (e.g. after a backup restore on a new phone, then re-importing the PDF)
    try {
      const nm = prettyName(file.name);
      for (const e of await db.listEquipment()) {
        if (!e.manualId && e.manualName && e.manualName === nm) { e.manualId = id; await db.putEquipment(e); }
      }
    } catch (e) { /* ignore */ }
    setProg(1);
    m.close();
    toast(t('library.imported', { name: prettyName(file.name) }));
    return id;
  } catch (e) {
    console.error('import failed', e);
    m.close();
    try { await unindexManual(id); await db.deleteManualCascade(id); } catch (e2) { /* ignore */ }
    toast(t('library.importFailed'), 4000);
    return null;
  } finally {
    if (doc) { try { doc.destroy(); } catch (e) { /* ignore */ } }
  }
}

function prettyName(fileName) {
  return fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || 'Manual';
}

export async function importDemo() {
  const ui = getLang();
  const manualLang = ui === 'fr' ? 'fr' : 'en'; // demo manual exists in EN + FR
  const file = manualLang === 'fr' ? 'demo/demo-manual-fr.pdf' : 'demo/demo-manual.pdf';
  const name = manualLang === 'fr' ? 'Démo — OpenMed SP-100 Aspirateur.pdf' : 'Demo — OpenMed SP-100 Suction Pump.pdf';
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error('demo fetch failed');
    const blob = await res.blob();
    const f = new File([blob], name, { type: 'application/pdf' });
    const ids = await importFiles([f], null, { demoLang: manualLang });
    if (ids[0]) { try { await seedDemoEquipment(ids[0], ui); } catch (e) { console.warn('seed failed', e); } }
    navigate('#/'); // land on the now-populated dashboard
  } catch (e) {
    toast(t('library.demoOffline'), 4000);
  }
}

// ---------- view ----------

export async function renderLibrary(container) {
  clear(container);

  const fileInput = el('input', {
    type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: 'display:none',
    onchange: async (e) => {
      const files = e.target.files;
      await importFiles(files, () => renderLibrary(container));
      e.target.value = '';
    },
  });

  const results = el('div', { class: 'search-results' });
  const listWrap = el('div', {});

  const runFromChip = async (q) => {
    searchInput.value = q;
    await runSearch(q, results);
    listWrap.style.display = 'none';
    db.counterBump('searches');
  };

  const searchInput = el('input', {
    type: 'search', class: 'search-box', placeholder: t('library.searchAll'),
    autocomplete: 'off',
    oninput: debounce(async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) { clear(results); listWrap.style.display = ''; return; }
      await runSearch(q, results);
      listWrap.style.display = 'none';
      db.counterBump('searches');
    }, 350),
  });

  container.append(
    fileInput,
    el('div', { class: 'view-pad' },
      el('div', { class: 'search-wrap' },
        el('span', { class: 'search-ico' }, icon('search', 18)),
        searchInput,
      ),
      results,
      listWrap,
    ),
  );

  await renderManualList(listWrap, fileInput, container, runFromChip);
}

async function runSearch(q, results) {
  const { terms, hits } = await searchPages(q, { limit: 20 });
  clear(results);
  results.append(el('h3', { class: 'section-title' }, icon('file-search', 15), t('search.resultsFor', { q })));
  if (!hits.length) {
    results.append(
      el('p', { class: 'muted' }, t('search.noResults')),
      el('p', { class: 'muted small' }, t('search.tips')),
    );
    return;
  }
  for (const h of hits) {
    const rec = await db.getPage(h.manualId, h.page);
    const man = await db.getManual(h.manualId);
    if (!rec || !man) continue;
    const snippet = makeSnippet(rec.text, terms);
    results.append(
      el('button', {
        class: 'result-card',
        onclick: () => navigate(`#/reader/${h.manualId}/${h.page}?q=${encodeURIComponent(q)}`),
      },
        el('div', { class: 'result-head' },
          el('span', { class: 'result-manual' }, icon('book-open', 14), man.name),
          el('span', { class: 'badge badge-page' }, t('search.page', { n: h.page })),
        ),
        el('p', { class: 'result-snippet', html: highlight(snippet, terms) }),
      ),
    );
  }
}

async function renderManualList(wrap, fileInput, container, runFromChip) {
  clear(wrap);
  const manuals = await db.listManuals();

  wrap.append(el('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => fileInput.click() },
    icon('plus', 21), t('library.addManual')));

  // "I don't have the manual" is the most-cited BMET pain — point them at the
  // free public libraries so an empty shelf isn't a dead end. (Clean-room: links only.)
  wrap.append(el('button', { class: 'btn btn-ghost btn-block', onclick: () => findManual() },
    icon('globe', 18), t('find.cta')));

  // guided suggestions when the demo manual is around (first-experience magic)
  const demoMan = manuals.find(mn => mn.demoLang);
  if (demoMan && manuals.length <= 3) {
    const sugg = DEMO_SUGGESTIONS[demoMan.demoLang] || DEMO_SUGGESTIONS.en;
    wrap.append(
      el('h3', { class: 'section-title' }, icon('lightbulb', 15), t('library.suggestTitle')),
      el('div', { class: 'suggest-row' },
        ...sugg.search.map(q => el('button', { class: 'suggest-chip', onclick: () => runFromChip(q) },
          icon('search', 14), q)),
      ),
    );
  }

  if (!manuals.length) {
    wrap.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-art' }, icon('book-open', 64)),
        el('h2', {}, t('library.emptyTitle')),
        el('p', { class: 'muted' }, t('library.emptyText')),
        el('button', { class: 'btn btn-secondary', onclick: () => importDemo() }, icon('rocket', 18), t('library.demoBtn')),
      ),
    );
  } else {
    const list = el('div', { class: 'manual-list' });
    for (const man of manuals) {
      list.append(manualCard(man, container));
    }
    wrap.append(list);
  }

  // beta / validation banner
  wrap.append(
    el('div', { class: 'beta-card' },
      el('h3', {}, icon('target', 18), t('library.betaTitle')),
      el('p', { class: 'small' }, t('library.betaText')),
      el('button', { class: 'btn btn-accent', onclick: () => navigate('#/feedback') }, icon('send', 17), t('library.betaCta')),
      el('button', { class: 'btn btn-ghost', onclick: () => shareApp() }, icon('share-2', 17), t('library.shareApp')),
    ),
  );

  const est = await db.storageEstimate();
  if (est.usage) {
    wrap.append(el('p', { class: 'muted small center' }, t('library.storage', { used: fmtBytes(est.usage) })));
  }
}

function manualCard(man, container) {
  const scanBadge = man.scanned
    ? el('span', { class: 'badge badge-warn' }, icon('scan-text', 13), t('library.scannedBadge'))
    : null;

  const card = el('div', { class: 'manual-card' },
    el('button', { class: 'manual-main', onclick: () => navigate(`#/reader/${man.id}/1`) },
      el('div', { class: 'manual-icon' }, icon('file-text', 23)),
      el('div', { class: 'manual-info' },
        el('div', { class: 'manual-name' }, man.name),
        el('div', { class: 'muted small' },
          `${tn('library.pages', man.numPages)} · ${fmtBytes(man.size)}`),
        scanBadge,
      ),
    ),
    el('div', { class: 'manual-actions' },
      man.scanned ? el('button', {
        class: 'btn btn-small btn-secondary',
        onclick: () => startOcr(man, () => renderLibrary(container)),
      }, icon('scan-text', 15), t('library.makeSearchable')) : null,
      el('div', { class: 'row', style: 'justify-content:flex-end' },
        el('button', {
          class: 'icon-btn', 'aria-label': t('library.rename'),
          onclick: () => renameManual(man, container),
        }, icon('pencil', 17)),
        el('button', {
          class: 'icon-btn', 'aria-label': t('library.deleteManual'),
          onclick: () => confirmModal(t('library.deleteConfirm', { name: man.name }), async () => {
            await unindexManual(man.id);
            await db.deleteManualCascade(man.id);
            toast(t('common.done'));
            renderLibrary(container);
          }, t('common.delete')),
        }, icon('trash-2', 17)),
      ),
    ),
  );
  return card;
}

function renameManual(man, container) {
  const input = el('input', { class: 'input', value: man.name, maxlength: 80 });
  modal({
    title: t('library.rename'),
    body: el('div', {}, input),
    actions: [
      { label: t('common.cancel'), kind: 'btn-secondary' },
      {
        label: t('common.save'), kind: 'btn-primary',
        onClick: async () => {
          const name = input.value.trim();
          if (!name) return false;
          const fresh = await db.getManual(man.id);
          fresh.name = name;
          await db.putManual(fresh);
          toast(t('library.renamed'));
          renderLibrary(container);
        },
      },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 80);
}
