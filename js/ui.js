// Taller — tiny UI helpers: DOM builder, i18n, toasts, modals, hash router glue.

import { STRINGS } from './strings.js';
import { icon } from './icons.js';

// ---------- i18n ----------
let _lang = null;

export function detectLang() {
  const saved = localStorage.getItem('taller-lang');
  if (saved && STRINGS[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return STRINGS[nav] ? nav : 'en';
}
export function getLang() { if (!_lang) _lang = detectLang(); return _lang; }
export function setLang(l) { if (STRINGS[l]) { _lang = l; localStorage.setItem('taller-lang', l); } }

export function t(path, vars) {
  const parts = path.split('.');
  let cur = STRINGS[getLang()];
  for (const p of parts) { cur = cur && cur[p]; }
  if (cur === undefined) { // fallback to EN
    cur = STRINGS.en;
    for (const p of parts) { cur = cur && cur[p]; }
  }
  if (typeof cur !== 'string') return path;
  if (vars) for (const [k, v] of Object.entries(vars)) cur = cur.split(`{${k}}`).join(String(v));
  return cur;
}

// Plural-aware lookup. The string may hold a "singular|plural" pair; the correct
// side is chosen from n. Falls back to the plain string.
// French takes the SINGULAR for 0 as well as 1 ("0 entrée", not "0 entrées"),
// unlike EN/ES/PT — the previous n === 1 test produced wrong French throughout.
export function tn(path, n, vars) {
  const s = t(path, { ...(vars || {}), n });
  if (s.indexOf('|') === -1) return s;
  const parts = s.split('|');
  const abs = Math.abs(Number(n) || 0);
  const singular = getLang() === 'fr' ? abs < 2 : abs === 1;
  return (singular ? parts[0] : parts[1]) || parts[0];
}

// ---------- DOM ----------
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only for trusted app strings
    else if (k.startsWith('on')) {
      // Functions only. A STRING here would fall through to setAttribute and
      // create a live inline handler out of whatever produced it — one refactor
      // away from being an injection sink. Refuse rather than silently allow.
      if (typeof v === 'function') node.addEventListener(k.slice(2), v);
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Highlight query terms inside plain text → returns HTML string.
// Matching is done on the RAW text and the escaping applied afterwards, so a
// query term like "mark", "lt" or "amp" can no longer match inside the markup
// or the HTML entities this function itself produces (which used to mangle the
// snippet into "&<mark>lt</mark>;").
export function highlight(text, terms) {
  const src = String(text);
  const uniq = [...new Set((terms || []).filter(w => w && w.length >= 2))]
    .sort((a, b) => b.length - a.length);
  if (!uniq.length) return escapeHtml(src);
  const rx = new RegExp('(' + uniq.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  let out = '';
  let last = 0;
  let m;
  while ((m = rx.exec(src)) !== null) {
    if (m[0] === '') { rx.lastIndex++; continue; } // guard against zero-length matches
    out += escapeHtml(src.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + escapeHtml(src.slice(last));
}

// ---------- toast ----------
// action (optional): { label, onClick } renders a tappable button (e.g. Undo,
// or "Reload" for an update) and extends the visible time.
// kind (optional): 'ok' shows a check — for confirmations of something the
// technician just did (saved, added, recorded). Errors and notices stay plain.
let toastTimer = null;
export function toast(msg, ms = 2600, action = null, kind = null) {
  let tEl = document.getElementById('toast');
  if (!tEl) {
    tEl = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(tEl);
  }
  clear(tEl);
  if (kind === 'ok') tEl.append(el('span', { class: 'toast-ico' }, icon('circle-check', 20)));
  tEl.append(el('span', { class: 'toast-msg' }, msg));
  if (action && action.label) {
    tEl.append(el('button', {
      class: 'toast-action',
      onclick: () => { tEl.classList.remove('show'); try { action.onClick(); } catch (e) { /* ignore */ } },
    }, action.label));
  }
  tEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => tEl.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
}

// ---------- modal ----------
let _modalSeq = 0;
let _modalDepth = 0;
export function modal({ title, body, actions = [], onClose }) {
  const prevFocus = document.activeElement;
  const overlay = el('div', { class: 'modal-overlay' });
  const titleId = 'modal-title-' + (++_modalSeq);
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  if (title) { box.setAttribute('aria-labelledby', titleId); box.append(el('h2', { id: titleId }, title)); }
  const bodyWrap = el('div', { class: 'modal-body' });
  if (body) bodyWrap.append(body.nodeType ? body : el('p', {}, body));
  box.append(bodyWrap);
  // Hide the rest of the app from assistive tech while the dialog is open,
  // otherwise a screen-reader user simply swipes past the dialog into the page
  // behind it and never knows a decision was being asked of them.
  // Reference-counted: modals nest (the OCR chooser opens the progress modal,
  // then closes itself), and an unconditional un-hide on the inner close left
  // the page reachable behind a dialog that was still open.
  _modalDepth++;
  const bg = [document.getElementById('app'), document.getElementById('appbar')].filter(Boolean);
  if (_modalDepth === 1) {
    for (const nEl of bg) { nEl.setAttribute('aria-hidden', 'true'); try { nEl.inert = true; } catch (e) { /* ignore */ } }
  }

  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    _modalDepth = Math.max(0, _modalDepth - 1);
    if (_modalDepth === 0) {
      for (const nEl of bg) { nEl.removeAttribute('aria-hidden'); try { nEl.inert = false; } catch (e) { /* ignore */ } }
    }
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };
  if (actions.length) {
    const row = el('div', { class: 'modal-actions' });
    for (const a of actions) {
      row.append(el('button', {
        class: 'btn ' + (a.kind || 'btn-secondary'),
        onclick: () => { const r = a.onClick ? a.onClick() : undefined; Promise.resolve(r).then((rr) => { if (rr !== false) close(); }); },
      }, a.label));
    }
    box.append(row);
  }
  // keyboard: Escape closes; Tab is trapped within the dialog
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      // A dialog with no focusable content (e.g. the import-progress modal)
      // used to let focus escape into the page behind it mid-import.
      if (!f.length) { e.preventDefault(); box.focus({ preventScroll: true }); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);

  // The sheet shows a drag handle, so dragging it down must dismiss it.
  // Only from the top strip (handle + title), never from the scrolling body,
  // so it cannot fight a form being scrolled. The entrance animation is
  // dropped once finished: a filled animation would override the drag.
  box.addEventListener('animationend', () => { box.style.animation = 'none'; }, { once: true });
  let dragY0 = null, dragDy = 0;
  box.addEventListener('touchstart', (e) => {
    const tch = e.touches && e.touches[0];
    if (!tch || tch.clientY - box.getBoundingClientRect().top > 40) return;
    if (matchMedia('(min-width: 560px)').matches) return;
    dragY0 = tch.clientY; dragDy = 0; box.style.transition = 'none';
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (dragY0 === null) return;
    dragDy = Math.max(0, e.touches[0].clientY - dragY0);
    box.style.transform = `translateY(${dragDy}px)`;
  }, { passive: true });
  box.addEventListener('touchend', () => {
    if (dragY0 === null) return;
    dragY0 = null; box.style.transition = 'transform .2s ease';
    if (dragDy > 90) { box.style.transform = 'translateY(110%)'; setTimeout(close, 170); }
    else box.style.transform = '';
  });

  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  // move focus into the dialog (first field, else the box)
  setTimeout(() => {
    const focusable = box.querySelector('input:not([type=hidden]), textarea, select, button');
    (focusable || box).focus({ preventScroll: true });
  }, 40);
  return { close, box };
}

// title defaults to a real heading so destructive dialogs (delete equipment,
// delete manual, erase ALL data) are not announced as an unnamed dialog.
export function confirmModal(text, onYes, yesLabel, title) {
  modal({
    title: title || t('common.confirm'), body: text,
    actions: [
      { label: t('common.cancel'), kind: 'btn-secondary' },
      { label: yesLabel || t('common.ok'), kind: 'btn-danger', onClick: onYes },
    ],
  });
}

// Action sheet: a bottom sheet of big, labelled rows (overflow menus).
// items: [{ icon, label, onClick, danger }]. The sheet closes first, then the
// action runs, so an action that opens its own dialog never stacks on this one.
export function actionSheet({ title, items }) {
  let m = null;
  const list = el('div', { class: 'sheet-list' });
  for (const it of items.filter(Boolean)) {
    list.append(el('button', {
      class: 'sheet-item' + (it.danger ? ' danger' : ''),
      onclick: () => { m.close(); setTimeout(() => { try { it.onClick(); } catch (e) { /* ignore */ } }, 30); },
    }, el('span', { class: 'sheet-ico' }, icon(it.icon, 19)), el('span', {}, it.label)));
  }
  m = modal({ title, body: list, actions: [{ label: t('common.close'), kind: 'btn-secondary' }] });
  return m;
}

// Promise-based confirm: resolves true/false.
export function confirmAsync(text, yesLabel, title) {
  return new Promise((resolve) => {
    let decided = false;
    modal({
      title: title || t('common.confirm'), body: text,
      actions: [
        { label: t('common.cancel'), kind: 'btn-secondary', onClick: () => { decided = true; resolve(false); } },
        { label: yesLabel || t('common.ok'), kind: 'btn-primary', onClick: () => { decided = true; resolve(true); } },
      ],
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}

// ---------- clipboard ----------
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // fallback for webviews without clipboard permission
    const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

// ---------- misc ----------
// Locale-aware: French uses "Mo/Go" and a comma decimal separator, and the FR
// string table already said "Mo" while this function emitted "12.4 MB".
export function fmtBytes(n) {
  const fr = getLang() === 'fr';
  const U = fr ? { k: 'Ko', m: 'Mo', g: 'Go' } : { k: 'KB', m: 'MB', g: 'GB' };
  const num = (v, d) => v.toLocaleString(document.documentElement.lang || getLang(), {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
  if (!n) return '0 ' + U.m;
  const mb = n / (1024 * 1024);
  if (mb < 1) return num(n / 1024, 0) + ' ' + U.k;
  if (mb < 1024) return num(mb, 1) + ' ' + U.m;
  return num(mb / 1024, 2) + ' ' + U.g;
}

export function debounce(fn, ms) {
  let id = null;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

export function isOnline() { return navigator.onLine !== false; }

export function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Share the app itself (native sheet when available, copy-link fallback).
export async function shareApp() {
  const url = location.origin + location.pathname;
  const data = { title: 'Taller', text: t('brand.shareText'), url };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (await copyText(url)) toast(t('library.linkCopied'));
}

// Share arbitrary text (feedback etc.) via native sheet; returns false if unsupported.
export async function shareText(text, title) {
  if (navigator.share) {
    try { await navigator.share({ title: title || 'Taller', text }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return true; }
  }
  return false;
}

export function todayISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
