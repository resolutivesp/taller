// Taller — QR asset tags. Print a label per machine, stick it on, and scan it
// (see scan.js) to jump straight to that machine's record + manual + history.
// The QR encodes a deep link to this app so a plain phone-camera scan also works.

import { el, clear, t, toast, escapeHtml } from './ui.js';
import { typeName } from './model.js';

let _qrReady = null;
export function ensureQr() {
  if (window.qrcode) return Promise.resolve();
  if (_qrReady) return _qrReady;
  const s = document.createElement('script');
  s.src = 'vendor/qr/qrcode.js';
  _qrReady = new Promise((resolve, reject) => {
    // A 200 that isn't the library (an offline fallback page from the service
    // worker) "loads" fine and only blows up later inside qrSvgString.
    s.onload = () => (window.qrcode ? resolve() : reject(new Error('qr: script loaded without qrcode')));
    s.onerror = () => reject(new Error('qr: script failed to load'));
    document.head.append(s);
  }).catch((e) => {
    // Never memoise a REJECTION: one failed load (a tunnel, a flaky hotspot)
    // used to poison every QR in the session, with no retry even once the
    // connection came back. Drop the dead script tag and let the next call try.
    _qrReady = null;
    s.remove();
    throw e;
  });
  return _qrReady;
}

export function deepLink(id) {
  return location.origin + location.pathname + '#/equipment/' + id;
}

export function qrSvgString(text, cell = 4, margin = 0) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin, scalable: true });
}

// Render a QR for one machine into a DOM node.
export async function qrInto(node, id, cell = 4) {
  try { await ensureQr(); node.innerHTML = qrSvgString(deepLink(id), cell); }
  catch (e) {
    // An empty white square told the technician nothing about why the code
    // never appeared — name the reason so they know to reconnect once.
    clear(node);
    node.append(el('span', { class: 'muted tiny', style: 'display:block;padding:4px;line-height:1.25' }, t('qr.unavailable')));
  }
}

function openPrintable(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    const a = el('a', { href: url, download: 'taller-labels.html', style: 'display:none' });
    document.body.append(a); a.click(); a.remove();
    toast(t('reports.downloaded'));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// One printable label (used by the sheet and the single-machine print).
function labelHtml(eq) {
  const svg = qrSvgString(deepLink(eq.id), 4, 0);
  const tag = eq.assetTag || eq.serial || '';
  return `<div class="label">
    <div class="qr">${svg}</div>
    <div class="meta">
      ${tag ? `<div class="tag">${escapeHtml(tag)}</div>` : ''}
      <div class="nm">${escapeHtml(eq.name)}</div>
      <div class="ty">${escapeHtml(typeName(eq.type))}${eq.location ? ' · ' + escapeHtml(eq.location) : ''}</div>
      <div class="brand">Taller</div>
    </div>
  </div>`;
}

const LABEL_CSS = `
body{font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#0c1c2c;margin:14px}
h1{font-size:16px;color:#0e7c72;margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.label{display:flex;gap:10px;align-items:center;border:1px dashed #9aa7ad;border-radius:8px;padding:10px;break-inside:avoid}
.qr{width:96px;height:96px;flex:0 0 auto}.qr svg{width:100%;height:100%}
.tag{font-weight:800;font-size:15px}.nm{font-weight:700}.ty{color:#5d6c7b;font-size:12px}
.brand{color:#0e7c72;font-weight:800;font-size:11px;margin-top:3px;letter-spacing:.04em}
button{font:inherit;padding:8px 14px;border:0;border-radius:8px;background:#0e7c72;color:#fff;font-weight:700;cursor:pointer;margin-bottom:10px}
@media print{.noprint{display:none}.grid{grid-template-columns:repeat(2,1fr)}}
@page{margin:10mm}`;

// Encoding one QR is a couple of milliseconds of pure main-thread work, so a
// 300-machine fleet froze the phone for several seconds with the button looking
// dead. Build in batches, yielding to the event loop between them so the browser
// can paint — and say how far along it is.
const LABEL_BATCH = 20;

export async function printLabels(equipment) {
  const list = equipment.filter(e => e.status !== 'retired');
  if (!list.length) { toast(t('qr.noneToLabel')); return; }
  try {
    await ensureQr();
    const parts = [];
    for (let i = 0; i < list.length; i++) {
      parts.push(labelHtml(list[i]));
      if ((i + 1) % LABEL_BATCH === 0 && i + 1 < list.length) {
        toast(t('qr.building', { n: i + 1, total: list.length }), 1500);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(t('qr.labelsTitle'))}</title><style>${LABEL_CSS}</style></head><body>
    <h1>${escapeHtml(t('qr.labelsTitle'))} — ${list.length}</h1>
    <p class="noprint"><button onclick="window.print()">${escapeHtml(t('reports.print'))}</button></p>
    <div class="grid">${parts.join('')}</div></body></html>`;
    openPrintable(html);
  } catch (e) {
    // Invoked as a bare onclick, so an unhandled rejection here meant the tap
    // did nothing at all — no window, no toast — when the QR script wasn't
    // cached and the phone was offline.
    toast(t('qr.libFailed'));
  }
}

export async function printOneLabel(eq) {
  try {
    await ensureQr();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(eq.name)}</title><style>${LABEL_CSS}</style></head><body>
    <p class="noprint"><button onclick="window.print()">${escapeHtml(t('reports.print'))}</button></p>
    <div class="grid" style="grid-template-columns:1fr">${labelHtml(eq)}</div></body></html>`;
    openPrintable(html);
  } catch (e) { // same silent-tap failure as printLabels
    toast(t('qr.libFailed'));
  }
}
