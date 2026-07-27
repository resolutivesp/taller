// Taller — scan an asset QR to open its machine. Walk up to a broken device,
// scan the label, see its history and manual. Uses the built-in BarcodeDetector
// (Chrome/Android — the target) with a typed-code fallback for damaged labels or
// unsupported browsers. Works fully offline.

import { db } from './db.js';
import { el, t, toast } from './ui.js';
import { icon } from './icons.js';
import { equipmentForm } from './equipment.js';
import { navigate } from './main.js';

export function scanSupported() {
  return typeof window.BarcodeDetector !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Resolve a scanned string to a machine. Pure + testable.
export function parseScan(text, equipment) {
  const raw = (text || '').trim();
  if (!raw) return { eq: null, query: '' };
  let id = null;
  const m = raw.match(/#\/(?:equipment|eq)\/([A-Za-z0-9_-]+)/);
  if (m) id = m[1];
  else if (raw.startsWith('taller:eq:')) id = raw.slice('taller:eq:'.length);
  if (id) {
    const eq = equipment.find(e => e.id === id);
    if (eq) return { eq, query: '' };
  }
  const q = raw.toLowerCase();
  if (q.length < 2) return { eq: null, query: raw }; // too short to match safely
  const eq = equipment.find(e =>
    (e.assetTag && e.assetTag.toLowerCase() === q) ||
    (e.serial && e.serial.toLowerCase() === q)) ||
    equipment.find(e => (e.name || '').toLowerCase().includes(q));
  return { eq: eq || null, query: raw };
}

export async function openScanner() {
  const equipment = await db.listEquipment();
  let stream = null, stopped = false, raf = null;

  const video = el('video', { class: 'scan-video', autoplay: '', muted: '', playsinline: '' });
  const frame = el('div', { class: 'scan-frame' });
  const hint = el('p', { class: 'scan-hint', role: 'status', 'aria-live': 'polite' }, t('scan.hint'));
  const actions = el('div', { class: 'scan-actions' });

  const manualInput = el('input', {
    class: 'input', placeholder: t('scan.typePh'), autocomplete: 'off',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', inputmode: 'text',
  });
  const manualGo = () => resolve(manualInput.value);
  manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') manualGo(); });

  const closeBtn = el('button', { class: 'icon-btn', style: 'color:#fff', 'aria-label': t('common.close'), onclick: () => close() }, icon('x', 22));
  const overlay = el('div', { class: 'scan-overlay', role: 'dialog', 'aria-label': t('scan.title') },
    el('div', { class: 'scan-top' }, el('span', {}, t('scan.title')), closeBtn),
    el('div', { class: 'scan-stage' }, video, frame),
    hint,
    actions,
    el('div', { class: 'scan-manual' },
      el('span', { class: 'small' }, t('scan.orType')),
      el('div', { class: 'row', style: 'gap:8px;width:100%' }, manualInput,
        el('button', { class: 'btn btn-primary', 'aria-label': t('common.search'), onclick: manualGo }, icon('search', 18))),
    ),
  );
  document.getElementById('app').append(overlay);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => manualInput.focus({ preventScroll: true }), 200);

  function close() {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(tk => tk.stop());
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function resolve(text) {
    const { eq, query } = parseScan(text, equipment);
    if (eq) { close(); navigate('#/equipment/' + eq.id); return; }
    // not found → stay open, explain, and offer to add it (don't dump the tech out)
    hint.textContent = query ? t('scan.notFound', { q: query.slice(0, 24) }) : t('scan.hint');
    manualInput.value = '';
    manualInput.focus({ preventScroll: true });
    actions.replaceChildren();
    if (query && query.length >= 2) {
      actions.append(el('button', {
        class: 'btn btn-accent', onclick: () => { close(); equipmentForm(null, () => navigate('#/equipment'), { assetTag: query }); },
      }, icon('plus', 18), t('scan.addNew')));
    }
  }

  if (scanSupported()) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length && codes[0].rawValue) { resolve(codes[0].rawValue); return; }
        } catch (e) { /* frame not ready */ }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (e) {
      hint.textContent = t('scan.noCamera');
      video.style.display = 'none'; frame.style.display = 'none';
    }
  } else {
    hint.textContent = t('scan.unsupported');
    video.style.display = 'none'; frame.style.display = 'none';
  }
}
