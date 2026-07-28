// Taller — boot, router, tabs, onboarding, settings ("More"), desktop brand panel, SW.

import { CONFIG } from './config.js';
import { db } from './db.js';
import { el, clear, t, getLang, setLang, toast, confirmModal, fmtBytes, shareApp } from './ui.js';
import { icon } from './icons.js';
import { renderLibrary, importDemo } from './library.js';
import { renderAsk, aiEndpoint } from './ask.js';
import { renderLog } from './logbook.js';
import { renderFeedback } from './feedback.js';
import { renderReader, cleanupReader } from './reader.js';
import { renderHome } from './home.js';
import { renderEquipment, renderEquipmentDetail } from './equipment.js';
import { renderReports } from './reports.js';
import { renderBackup } from './backup.js';
import { openScanner } from './scan.js';

let deferredInstall = null;
let currentCleanup = null;
let installBtn = null;

// ---------- router ----------
export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const h = (location.hash || '#/library').replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = {};
  if (queryPart) for (const kv of queryPart.split('&')) {
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return { name: segs[0] || 'home', segs, params };
}

const TABS = [
  { name: 'home', ico: 'home', labelKey: 'nav.home' },
  { name: 'equipment', ico: 'wrench', labelKey: 'nav.equipment' },
  { name: 'library', ico: 'book-open', labelKey: 'nav.library' },
  { name: 'ask', ico: 'message-circle-question', labelKey: 'nav.ask' },
  { name: 'more', ico: 'settings-2', labelKey: 'nav.more' },
];

async function render() {
  const view = document.getElementById('view');
  const { name, segs, params } = parseHash();

  if (currentCleanup) { try { currentCleanup(); } catch (e) { /* ignore */ } currentCleanup = null; }
  if (name !== 'reader') cleanupReader();

  const tabFor = { reader: 'library', equipment: 'equipment', reports: 'more', log: 'more', feedback: 'more', backup: 'more' };
  document.querySelectorAll('.tab').forEach(b => {
    b.classList.toggle('active', b.dataset.name === name || tabFor[name] === b.dataset.name);
  });
  const immersive = name === 'reader' || (name === 'equipment' && segs[1]);
  document.body.classList.toggle('reader-mode', immersive);

  view.scrollTop = 0;
  view.classList.remove('view-enter');
  void view.offsetWidth; // restart animation
  view.classList.add('view-enter');

  switch (name) {
    case 'reader': {
      const ret = await renderReader(view, { id: segs[1], page: segs[2], q: params.q });
      if (typeof ret === 'function') currentCleanup = ret;
      break;
    }
    case 'equipment':
      if (segs[1]) await renderEquipmentDetail(view, segs[1]);
      else await renderEquipment(view, params);
      break;
    case 'library': await renderLibrary(view); break;
    case 'ask': await renderAsk(view, params); break;
    case 'reports': await renderReports(view); break;
    case 'backup': await renderBackup(view); break;
    case 'log': await renderLog(view); break;
    case 'more': renderMore(view); break;
    case 'feedback': await renderFeedback(view); break;
    default: await renderHome(view); break;
  }
}

// ---------- "More" view ----------
function renderMore(container) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  wrap.append(el('h2', { class: 'view-title' }, t('more.title')));

  // Tools menu
  wrap.append(el('div', { class: 'menu-list' },
    menuItem('activity', t('reports.title'), () => navigate('#/reports')),
    menuItem('clipboard-list', t('logbook.title'), () => navigate('#/log')),
    menuItem('shield-check', t('backup.title'), () => navigate('#/backup')),
  ));

  // Feedback CTA + share
  wrap.append(
    el('button', { class: 'btn btn-accent btn-block btn-big', onclick: () => navigate('#/feedback') },
      icon('target', 21), t('more.feedbackCta')),
    el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:10px', onclick: () => shareApp() },
      icon('share-2', 19), t('library.shareApp')),
  );

  // Language
  const langRow = el('div', { class: 'chip-row' });
  for (const [code, label] of [['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português']]) {
    langRow.append(el('button', {
      class: 'chip' + (getLang() === code ? ' active' : ''),
      onclick: () => { setLang(code); applyLangDom(); render(); },
    }, label));
  }
  wrap.append(section('languages', t('more.language'), langRow));

  // Theme
  const themeRow = el('div', { class: 'chip-row' });
  const curTheme = localStorage.getItem('taller-theme') || 'auto';
  for (const [v, key] of [['auto', 'more.themeAuto'], ['light', 'more.themeLight'], ['dark', 'more.themeDark']]) {
    themeRow.append(el('button', {
      class: 'chip' + (curTheme === v ? ' active' : ''),
      onclick: () => { localStorage.setItem('taller-theme', v); applyTheme(); renderMore(container); },
    }, t(key)));
  }
  wrap.append(section('sun-moon', t('more.theme'), themeRow));

  // Install
  if (deferredInstall) {
    wrap.append(el('button', {
      class: 'btn btn-primary btn-block', onclick: async () => {
        deferredInstall.prompt();
        const { outcome } = await deferredInstall.userChoice;
        if (outcome === 'accepted') { deferredInstall = null; syncInstallBtn(); renderMore(container); }
      },
    }, icon('download', 19), t('library.installApp')));
  }

  // AI status
  const endpoint = aiEndpoint();
  const aiInput = el('input', { class: 'input', placeholder: 'https://…workers.dev', value: localStorage.getItem('taller-ai-endpoint') || '' });
  aiInput.addEventListener('change', () => {
    localStorage.setItem('taller-ai-endpoint', aiInput.value.trim());
    toast(t('common.done'));
  });
  wrap.append(section('sparkles', t('more.aiTitle'),
    el('p', { class: 'muted small', style: 'margin-top:0' }, endpoint ? '🟢 ' + t('more.aiOn') : '⚪ ' + t('more.aiOff')),
    el('details', { class: 'small' },
      el('summary', { class: 'muted' }, t('more.aiUrl') + ' (' + t('common.optional') + ')'),
      aiInput,
    ),
  ));

  // Storage
  const storageP = el('p', { class: 'muted small', style: 'margin:0' }, '…');
  db.storageEstimate().then(async ({ usage }) => {
    let persisted = false;
    try { persisted = navigator.storage && await navigator.storage.persisted(); } catch (e) { /* ignore */ }
    storageP.textContent = t('library.storage', { used: fmtBytes(usage) }) + ' · ' +
      (persisted ? t('more.persistOn') : t('more.persistOff'));
  });
  wrap.append(section('hard-drive', t('more.storageTitle'), storageP));

  // About
  wrap.append(section('shield-check', t('more.aboutTitle'),
    el('p', { class: 'small', style: 'margin-top:0' }, t('more.aboutText')),
    el('p', { class: 'muted small' }, t('more.disclaimer')),
    el('p', { class: 'small row' },
      el('a', { href: CONFIG.repoUrl, target: '_blank', rel: 'noopener' }, t('more.source')),
      el('span', { class: 'muted' }, '· ' + t('more.license')),
    ),
    el('p', { class: 'muted small' }, t('more.version') + ' ' + CONFIG.version),
  ));

  // Danger zone
  wrap.append(el('button', {
    class: 'btn btn-danger btn-block', onclick: () => {
      confirmModal(t('more.resetConfirm'), async () => {
        await db.wipeAll();
        location.hash = '#/library';
        location.reload();
      }, t('common.delete'));
    },
  }, icon('trash-2', 18), t('more.reset')));
}

function section(ico, title, ...children) {
  return el('div', { class: 'card section' },
    el('h3', { class: 'section-title' }, icon(ico, 15), title),
    ...children);
}

function menuItem(ico, label, onclick) {
  return el('button', { class: 'menu-item', onclick },
    el('span', { class: 'menu-ico' }, icon(ico, 19)),
    el('span', { class: 'menu-label' }, label),
    icon('chevron-right', 18),
  );
}

// ---------- onboarding ----------
async function maybeOnboard() {
  const done = await db.kvGet('onboarded');
  if (done) return;
  const overlay = el('div', { class: 'onboard' });

  const langRow = el('div', { class: 'chip-row center' });
  for (const [code, label] of [['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português']]) {
    langRow.append(el('button', {
      class: 'chip' + (getLang() === code ? ' active' : ''),
      onclick: () => { setLang(code); applyLangDom(); overlay.remove(); maybeOnboard(); },
    }, label));
  }

  const point = (ico, tKey, sKey) => el('div', { class: 'onboard-point' },
    el('div', { class: 'pt-ico' }, icon(ico, 22)),
    el('div', {}, el('b', {}, t(tKey)), el('p', {}, t(sKey))),
  );

  // ORDER MATTERS. Measured on a 360x640 phone, the old layout put ~950px of
  // hero + three marketing bullets + the language row ABOVE the first button,
  // so a technician opening the link from WhatsApp saw a logo, a headline and
  // no action at all — the very first moment of the product, and it required
  // blind scrolling. Language row and CTAs now come first, the CTA block is
  // sticky, and the explanatory points sit below where they belong.
  //
  // "Try the demo" is now the PRIMARY action. More than half of technicians in
  // these hospitals have no service manual PDF at all, so making "Add my first
  // manual" the primary CTA pointed the majority straight at an OS file picker
  // and a dead end. The demo shows the whole product working in 3 seconds.
  const finish = async (fn) => { await db.kvSet('onboarded', 1); overlay.remove(); fn(); };

  overlay.append(
    el('div', { class: 'onboard-box' },
      el('div', { class: 'onboard-hero' },
        el('img', { class: 'onboard-logo', src: 'icons/icon-192.png', alt: 'Taller' }),
        el('h1', {}, t('onboarding.welcome')),
        el('p', { class: 'tagline' }, t('tagline')),
      ),
      el('div', { class: 'onboard-body' },
        el('p', { class: 'lbl center' }, t('onboarding.chooseLang')),
        langRow,
        el('div', { class: 'onboard-cta' },
          el('button', {
            class: 'btn btn-primary btn-block btn-big',
            onclick: () => finish(() => importDemo()),
          }, icon('rocket', 20), t('onboarding.tryDemo')),
          el('button', {
            class: 'btn btn-secondary btn-block', style: 'margin-top:9px',
            onclick: () => finish(() => navigate('#/library')),
          }, icon('plus', 19), t('onboarding.start')),
        ),
        el('div', { class: 'onboard-scroll-cue' }, icon('chevron-down', 15), t('onboarding.more')),
        point('book-open', 'onboarding.p1t', 'onboarding.p1s'),
        point('file-search', 'onboarding.p2t', 'onboarding.p2s'),
        point('heart-handshake', 'onboarding.p3t', 'onboarding.p3s'),
        el('button', {
          class: 'btn btn-ghost-link',
          onclick: () => finish(() => navigate('#/backup')),
        }, icon('hard-drive', 16), t('onboarding.restore')),
      ),
    ),
  );
  document.getElementById('app').append(overlay);
}

// ---------- desktop brand panel (forum visitors on PC) ----------
function renderSidebrand() {
  const aside = document.getElementById('sidebrand');
  if (!aside) return;
  clear(aside);

  const point = (ico, tKey, sKey) => el('div', { class: 'brand-point' },
    el('div', { class: 'pt-ico' }, icon(ico, 21)),
    el('div', {}, el('b', {}, t(tKey)), el('p', {}, t(sKey))),
  );

  const qrBox = el('div', { class: 'qr-box' });
  aside.append(
    el('div', { class: 'brand-panel' },
      el('div', { class: 'brand-head' },
        el('img', { src: 'icons/icon-192.png', alt: '' }),
        el('div', {},
          el('h1', {}, 'Taller'),
          el('p', {}, t('tagline')),
        ),
      ),
      point('book-open', 'onboarding.p1t', 'onboarding.p1s'),
      point('file-search', 'onboarding.p2t', 'onboarding.p2s'),
      point('heart-handshake', 'onboarding.p3t', 'onboarding.p3s'),
      el('div', { class: 'qr-card' },
        qrBox,
        el('div', {},
          el('b', {}, t('brand.scanTitle')),
          el('p', {}, t('brand.scanText')),
        ),
      ),
      el('p', { class: 'brand-foot' },
        t('brand.foot'), ' · ',
        el('a', { href: CONFIG.repoUrl, target: '_blank', rel: 'noopener' }, 'GitHub'),
      ),
    ),
  );

  // QR only matters on desktop widths; load the tiny generator lazily.
  if (matchMedia('(min-width: 1024px)').matches) {
    loadScript('vendor/qr/qrcode.js').then(() => {
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(location.origin + location.pathname);
        qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch (e) { qrBox.remove(); }
    }).catch(() => qrBox.remove());
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}

// ---------- environment niceties ----------
function applyTheme() {
  const v = localStorage.getItem('taller-theme') || 'auto';
  const dark = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0a1120' : '#0e7c72';
}

function applyLangDom() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('.tab').forEach(b => {
    const tab = TABS.find(x => x.name === b.dataset.name);
    if (tab) b.querySelector('.tab-label').textContent = t(tab.labelKey);
  });
  document.title = 'Taller — ' + t('tagline');
  // These two were set once at boot, so switching language left the app bar in
  // the old one.
  const scanBtn = document.querySelector('#appbar .bar-btn[data-role="scan"]');
  if (scanBtn) scanBtn.setAttribute('aria-label', t('scan.title'));
  if (installBtn) {
    const lbl = installBtn.querySelector('.bar-btn-label');
    if (lbl) lbl.textContent = t('library.installApp');
  }
  renderSidebrand();
}

function syncInstallBtn() {
  if (!installBtn) return;
  installBtn.style.display = deferredInstall ? '' : 'none';
}

function detectWebview() {
  const ua = navigator.userAgent || '';
  const isWv = /; wv\)/.test(ua) || /FB_IAB|FBAN|Instagram/.test(ua);
  const fromWhatsApp = /android-app:\/\/com\.whatsapp/.test(document.referrer || '');
  if ((isWv || fromWhatsApp) && !matchMedia('(display-mode: standalone)').matches) {
    const bar = el('div', { class: 'chrome-banner small' },
      t('more.openInChrome'),
      el('button', { class: 'icon-btn', 'aria-label': t('common.dismiss'), onclick: () => bar.remove() }, icon('x', 16)),
    );
    document.getElementById('app').prepend(bar);
  }
}

// ---------- offline readiness ----------
// "Works fully offline after the first load" is the product promise AND one of
// the four kill-criteria questions. It used to be unverifiable: every precache
// failure was silent. Ask the worker what it actually has.
export function offlineStatus({ repair = false, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    if (!sw || !sw.controller) { resolve(null); return; }
    let done = false;
    const ch = new MessageChannel();
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    ch.port1.onmessage = (e) => finish(e.data);
    setTimeout(() => finish(null), timeout);
    try { sw.controller.postMessage({ type: 'OFFLINE_STATUS', repair }, [ch.port2]); }
    catch (e) { finish(null); }
  });
}

async function announceOfflineReady() {
  const st = await offlineStatus({ repair: true, timeout: 8000 });
  // Never cover the onboarding CTAs with this. The overlay is full-screen and
  // has no tab bar, so a toast anchored 88px from the bottom lands squarely on
  // the primary button during the first five seconds — the single moment the
  // product has to prove itself. Wait until the user is through onboarding.
  for (let i = 0; i < 120 && document.querySelector('.onboard'); i++) {
    await new Promise(r => setTimeout(r, 1000));
  }
  if (document.querySelector('.onboard')) return; // still onboarding after 2 min: drop it
  // A null status means the probe timed out or there was no controller — we
  // do NOT know whether the app is offline-ready, and asserting that it is
  // defeats the entire point of asking. Say nothing rather than something false.
  if (!st) return;
  if (st.ready) toast(t('more.offlineReady'), 4500);
  else if (st.shellReady) toast(t('more.offlinePartial'), 7000);
  else toast(t('more.offlineFailed'), 7000);
}

// ---------- boot ----------
async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // app bar: scan (one tap from anywhere during rounds) + install
  const appbar = document.getElementById('appbar');
  appbar.append(el('button', {
    class: 'bar-btn', 'aria-label': t('scan.title'), dataset: { role: 'scan' },
    onclick: () => openScanner(),
  }, icon('qr-code', 16)));
  installBtn = el('button', { class: 'bar-btn', style: 'display:none', onclick: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') { deferredInstall = null; syncInstallBtn(); }
  } }, icon('download', 15), el('span', { class: 'bar-btn-label' }, t('library.installApp')));
  appbar.append(installBtn);

  // tab bar
  const nav = document.getElementById('tabs');
  for (const tab of TABS) {
    nav.append(el('button', {
      class: 'tab', dataset: { name: tab.name },
      onclick: () => navigate('#/' + tab.name),
    },
      el('span', { class: 'tab-ico' }, icon(tab.ico, 21)),
      el('span', { class: 'tab-label' }, t(tab.labelKey)),
    ));
  }
  applyLangDom();

  window.addEventListener('hashchange', render);
  await render();
  await maybeOnboard();
  detectWebview();

  // install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    syncInstallBtn();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    syncInstallBtn();
    toast(t('library.installed'), 4000);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  });

  // storage persistence (best effort)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

  // service worker — controlled update handoff (no auto hot-swap)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // Capture control state at boot. On a FIRST visit the page starts
      // uncontrolled, so when the worker finally activates and calls
      // clients.claim() the old unconditional reload fired — wiping a
      // half-typed equipment form, an open scanner, or an OCR run, and able to
      // land mid-import between putPages() and putManual(). Only reload when a
      // NEW worker replaces one that was already in charge.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;   // first install: nothing to swap out
        if (reloading) return; reloading = true; location.reload();
      });
      const promptUpdate = (worker) => {
        toast(t('more.updateReady'), 8000, { label: t('more.reload'), onClick: () => worker.postMessage('SKIP_WAITING') });
      };
      if (!hadController) {
        // First install. The old check ANDed on !controller after activation,
        // which is never true (activate awaits clients.claim), so the
        // "ready to work offline" confirmation could never appear at all.
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'activated') announceOfflineReady();
            // A failed precache leaves the worker redundant. Silence here used
            // to mean the technician had no idea the app was NOT offline-ready.
            if (nw.state === 'redundant') toast(t('more.offlineFailed'), 6000);
          });
        });
      } else if (reg.waiting) {
        promptUpdate(reg.waiting);
      } else {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (nw) nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
          });
        });
      }
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  }
}

boot();
