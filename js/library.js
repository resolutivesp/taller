// Taller — Library view: import PDFs, list manuals, search across all manuals.

import { CONFIG, DEMO_SUGGESTIONS } from './config.js';
import { db, isQuotaError } from './db.js';
import { el, clear, t, tn, getLang, toast, confirmModal, confirmAsync, modal, actionSheet, fmtBytes, debounce, highlight, uuid, shareApp } from './ui.js';
import { icon } from './icons.js';
import { art } from './art.js';
import { openPdf, extractText, isScanned, PdfEngineUnavailable } from './pdfengine.js';
import { indexManual, unindexManual, unindexPages, persistIndex, searchPages, makeSnippet } from './search.js';
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
    let id = null;
    try {
      id = await importOne(file, extra);
    } catch (e) {
      // Cancel means "stop", not "skip this one": carrying on with the rest of
      // a multi-file selection ignores what the technician just asked for.
      if (e instanceof ImportCancelled) break;
      console.error('import failed', e);
    }
    if (id) ids.push(id);
  }
  if (onAllDone) onAllDone();
  return ids;
}

// Tapping Cancel travels through the same catch as a real failure, so a
// half-written manual is always cleaned up the same way.
class ImportCancelled extends Error {
  constructor() { super('import-cancelled'); this.name = 'ImportCancelled'; }
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
  // Extracting a 400-page manual runs 6-30 s on the target phone. With no
  // action in this dialog the only way out was killing the app mid-write.
  let cancelled = false;
  const m = modal({
    title: t('library.importing'), body,
    actions: [{ label: t('common.cancel'), kind: 'btn-secondary', onClick: () => { cancelled = true; } }],
  });

  const setProg = (frac, msg) => {
    // Neither extractText nor indexManual takes an abort signal, but both call
    // this on every step — throwing from here is what actually stops the loop.
    if (cancelled) throw new ImportCancelled();
    barFill.style.width = Math.round(frac * 100) + '%';
    if (msg) status.textContent = msg;
  };

  const id = uuid();
  let doc = null;
  // Page records held in memory: the ONLY usable input for index cleanup,
  // because db.getPagesForManual(id) stays empty until putPages() succeeds.
  let records = null;
  let indexHint = null;
  try {
    doc = await openPdf(file);
    const total = doc.numPages;
    setProg(0.05, t('library.extracting', { x: 1, y: total }));
    const extract = await extractText(doc, (p, tot) =>
      setProg(0.05 + 0.6 * (p / tot), t('library.extracting', { x: p, y: tot })));

    const scanned = isScanned(extract, total);
    // Store the file BEFORE touching the search index. Quota exhaustion is by
    // far the likeliest failure on a 2 GB phone and this blob is the biggest
    // write of the import, so failing here costs nothing to undo.
    setProg(0.68, t('library.saving'));
    await db.putFile(id, file);

    setProg(0.7, t('library.indexing'));
    // Upper bound on the chunk ids indexManual can create for each page. It
    // targets ~1600-char parts and a short part is always followed by a >1500
    // one, so parts average >750 chars; this over-counts on purpose, and
    // discarding an id that was never added costs a map lookup. Only used if
    // indexManual itself is interrupted, when no records come back.
    indexHint = extract.pages.map(pg => ({
      page: pg.page, parts: Math.ceil((pg.text || '').length / 700) + 2,
    }));
    records = await indexManual(id, extract.pages, (done, tot) =>
      setProg(0.7 + 0.2 * (tot ? done / tot : 1), t('library.indexing')));

    setProg(0.92, t('library.saving'));
    await db.putPages(records);
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
    // Past the point of no return: the manual is committed, so do NOT run the
    // cancel check in setProg here and throw away work that is already saved.
    barFill.style.width = '100%';
    m.close();
    toast(t('library.imported', { name: prettyName(file.name) }), 3200, null, 'ok');
    return id;
  } catch (e) {
    m.close();
    // Two INDEPENDENT cleanups. They used to share one try: when the phone was
    // full, unindexing (which writes the index back) threw as well and the
    // manual's rows plus its multi-MB file blob were left behind for ever.
    try {
      // unindexManual() derives chunk ids from db.getPagesForManual(), which is
      // empty when the import died before putPages — it removed NOTHING and the
      // chunks stayed in the index for ever, surfacing as search hits whose
      // page lookup returns null. The in-memory records are the real list.
      const hint = records || indexHint;
      if (hint) { await unindexPages(id, hint); await persistIndex(); }
    } catch (e2) { /* ignore */ }
    try { await db.deleteManualCascade(id); } catch (e2) { /* ignore */ }

    if (e instanceof ImportCancelled) { toast(t('library.importCancelled')); throw e; }
    console.error('import failed', e);
    // "Your manual is damaged" is the wrong thing to say for the two failures
    // that are not about the file at all — each needs a different action.
    if (e instanceof PdfEngineUnavailable) toast(t('library.engineOffline'), 6000);
    else if (isQuotaError(e)) toast(t('library.storageFull'), 6000);
    else toast(t('library.importFailed'), 4000);
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
  // The demo is the escape hatch for a technician with no manual of their own —
  // the documented majority case. Shipping it in EN+FR only meant Lusophone
  // Africa and Latin America met the product in a foreign language at the exact
  // moment it was supposed to prove itself.
  const DEMO_MANUALS = {
    en: { file: 'demo/demo-manual.pdf',    name: 'Demo — OpenMed SP-100 Suction Pump.pdf' },
    fr: { file: 'demo/demo-manual-fr.pdf', name: 'Démo — OpenMed SP-100 Aspirateur.pdf' },
    es: { file: 'demo/demo-manual-es.pdf', name: 'Demo — OpenMed SP-100 Aspirador de secreciones.pdf' },
    pt: { file: 'demo/demo-manual-pt.pdf', name: 'Demo — OpenMed SP-100 Aspirador de secreções.pdf' },
  };
  const manualLang = DEMO_MANUALS[ui] ? ui : 'en';
  const { file, name } = DEMO_MANUALS[manualLang];
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error('demo fetch failed');
    const blob = await res.blob();
    const f = new File([blob], name, { type: 'application/pdf' });
    const ids = await importFiles([f], null, { demoLang: manualLang });
    // Nothing imported: importOne has already explained why (engine missing,
    // phone full, cancelled). Do not navigate away from that message onto an
    // empty dashboard as if it had worked.
    if (!ids.length) return;
    try { await seedDemoEquipment(ids[0], ui); } catch (e) { console.warn('seed failed', e); }
    navigate('#/'); // land on the now-populated dashboard
  } catch (e) {
    // The demo PDF ships with the app and is served from the cache offline, so
    // the engine is the other thing that can be missing here. importOne reports
    // it for the import itself; this is the same honest message for anything
    // that fails outside it — never "your PDF is damaged".
    if (e instanceof PdfEngineUnavailable) { toast(t('library.engineOffline'), 6000); return; }
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
    autocomplete: 'off', 'aria-label': t('common.search'),
    oninput: debounce(async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) { clear(results); listWrap.style.display = ''; return; }
      await runSearch(q, results);
      listWrap.style.display = 'none';
      db.counterBump('searches');
    }, 350),
  });

  const nManuals = (await db.listManuals()).length;
  container.append(
    fileInput,
    el('div', { class: 'view-pad' },
      el('div', { class: 'title-row' },
        el('h2', { class: 'view-title' }, t('library.title'),
          nManuals ? el('span', { class: 'title-count' }, String(nManuals)) : null),
      ),
      el('div', { class: 'search-wrap' },
        el('span', { class: 'search-ico' }, icon('search', 19)),
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
  results.append(el('h3', { class: 'section-title' }, icon('file-search', 17), t('search.resultsFor', { q })));
  if (!hits.length) {
    results.append(
      el('p', { class: 'muted' }, t('search.noResults')),
      el('p', { class: 'muted small' }, t('search.tips')),
    );
    return;
  }
  // One round-trip per hit, all in flight together, and each manual fetched
  // once: 20 hits used to mean 40 STRICTLY SERIALIZED IndexedDB transactions
  // (page, manual, page, manual…) before the first result could be drawn.
  const manIds = [...new Set(hits.map(h => h.manualId))];
  const [pageRecs, manRecs] = await Promise.all([
    Promise.all(hits.map(h => db.getPage(h.manualId, h.page))),
    Promise.all(manIds.map(mid => db.getManual(mid))),
  ]);
  const mans = new Map();
  manRecs.forEach((man, i) => mans.set(manIds[i], man));

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const rec = pageRecs[i];
    const man = mans.get(h.manualId);
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

  // "I don't have the manual" is the most-cited BMET pain — the free public
  // libraries sit right next to Add, so an empty shelf is never a dead end.
  // (Clean-room: links only.)
  wrap.append(el('div', { class: 'btn-pair' },
    el('button', { class: 'btn btn-primary', onclick: () => fileInput.click() },
      icon('file-plus-2', 20), t('library.addShort')),
    el('button', { class: 'btn btn-secondary', onclick: () => findManual() },
      icon('globe', 19), t('find.ctaShort')),
  ));

  // guided suggestions when the demo manual is around (first-experience magic)
  const demoMan = manuals.find(mn => mn.demoLang);
  if (demoMan && manuals.length <= 3) {
    const sugg = DEMO_SUGGESTIONS[demoMan.demoLang] || DEMO_SUGGESTIONS.en;
    wrap.append(
      el('h3', { class: 'section-title' }, icon('lightbulb', 17), t('library.suggestTitle')),
      el('div', { class: 'suggest-row' },
        ...sugg.search.map(q => el('button', { class: 'suggest-chip', onclick: () => runFromChip(q) },
          icon('search', 14), q)),
      ),
    );
  }

  if (!manuals.length) {
    wrap.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-art' }, art('manuals')),
        el('h2', {}, t('library.emptyTitle')),
        el('p', { class: 'muted' }, t('library.emptyText')),
        el('button', { class: 'btn btn-secondary', onclick: () => importDemo() }, icon('rocket', 18), t('library.demoBtn')),
      ),
    );
  } else {
    wrap.append(el('h3', { class: 'section-title' }, icon('book-marked', 17), t('library.yours')));
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
      el('div', { class: 'manual-icon' }, icon('file-text', 22)),
      el('div', { class: 'manual-info' },
        el('div', { class: 'manual-name' }, man.name),
        el('div', { class: 'muted small' },
          `${tn('library.pages', man.numPages)} · ${fmtBytes(man.size)}`),
        scanBadge,
      ),
    ),
    el('div', { class: 'manual-actions' },
      man.scanned ? el('button', {
        class: 'btn btn-small btn-soft',
        onclick: () => startOcr(man, () => renderLibrary(container)),
      }, icon('scan-text', 15), t('library.makeSearchable')) : null,
      el('button', {
        class: 'icon-btn', 'aria-label': t('library.moreOptions') + ': ' + man.name,
        onclick: () => actionSheet({
          title: man.name,
          items: [
            { icon: 'book-open', label: t('common.open'), onClick: () => navigate(`#/reader/${man.id}/1`) },
            { icon: 'pencil', label: t('library.rename'), onClick: () => renameManual(man, container) },
            man.scanned ? { icon: 'scan-text', label: t('library.makeSearchable'), onClick: () => startOcr(man, () => renderLibrary(container)) } : null,
            { icon: 'trash-2', label: t('library.deleteManual'), danger: true, onClick: () => confirmModal(t('library.deleteConfirm', { name: man.name }), async () => {
              await unindexManual(man.id);
              await db.deleteManualCascade(man.id);
              toast(t('common.done'));
              renderLibrary(container);
            }, t('common.delete')) },
          ],
        }),
      }, icon('ellipsis-vertical', 20)),
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
          toast(t('library.renamed'), 2400, null, 'ok');
          renderLibrary(container);
        },
      },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 80);
}
