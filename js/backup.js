// Taller — backup & restore. Everything a technician enters (equipment, photos,
// service history, settings) lives only on this phone. If the phone is lost,
// wiped, or the browser cache is cleared, it's gone. A backup is the difference
// between a tool you trust for months and a toy. Manuals (your own PDF files) are
// NOT included — they are re-importable; this protects the irreplaceable data and
// keeps the backup small enough to WhatsApp to yourself.

import { db } from './db.js';
import { el, clear, t, tn, toast, fmtBytes, shareText } from './ui.js';
import { icon } from './icons.js';

const SCHEMA = 2;
let reminderDismissed = false;

// ---------- helpers ----------
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}
function nowISO() { return new Date().toISOString(); }
function todayStamp() { return new Date().toISOString().slice(0, 10); }

// ---------- build ----------
export async function buildBackup() {
  const equipment = await db.listEquipment();
  const logs = await db.listLogs();

  const photoIds = new Set();
  equipment.forEach(e => { if (e.photoId) photoIds.add(e.photoId); });
  logs.forEach(l => { if (l.photoId) photoIds.add(l.photoId); });
  const photos = {};
  for (const id of photoIds) {
    const blob = await db.getPhoto(id);
    if (blob) photos[id] = await blobToDataUrl(blob);
  }

  const settings = {
    onboarded: await db.kvGet('onboarded'),
    feedback: await db.kvGet('feedback'),
    counters: await db.kvGet('counters'),
    lang: localStorage.getItem('taller-lang') || null,
    theme: localStorage.getItem('taller-theme') || null,
    aiEndpoint: localStorage.getItem('taller-ai-endpoint') || null,
  };

  const manuals = await db.listManuals();
  return {
    app: 'taller', schema: SCHEMA, exportedAt: nowISO(),
    counts: { equipment: equipment.length, logs: logs.length, photos: Object.keys(photos).length },
    manualsIndex: manuals.map(m => ({ name: m.name, numPages: m.numPages })),
    equipment, logs, photos, settings,
  };
}

function downloadJsonString(json, filename) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export async function doBackup({ share = false } = {}) {
  const data = await buildBackup();
  const json = JSON.stringify(data); // serialize once
  const filename = `taller-backup-${todayStamp()}.json`;
  let shared = false;
  if (share && navigator.canShare) {
    try {
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Taller backup' }); shared = true; }
    } catch (e) { if (e && e.name === 'AbortError') shared = true; }
  }
  if (!shared) downloadJsonString(json, filename);
  await db.kvSet('lastBackupAt', nowISO());
  toast(t('backup.done'));
  return data.counts;
}

// ---------- restore (merge/upsert by id) ----------
export async function restoreFromText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('parse'); }
  if (!data || data.app !== 'taller' || !Array.isArray(data.equipment)) throw new Error('format');
  if (typeof data.schema === 'number' && data.schema > SCHEMA) throw new Error('schema'); // file from a newer app

  // photos first (so equipment/logs referencing them resolve)
  let nPhotos = 0;
  if (data.photos) for (const [id, dataUrl] of Object.entries(data.photos)) {
    try { await db.putPhoto(id, await dataUrlToBlob(dataUrl)); nPhotos++; } catch (e) { /* skip bad photo */ }
  }
  let nEq = 0;
  for (const e of data.equipment) { if (e && e.id) { await db.putEquipment(e); nEq++; } }

  // logs use autoincrement integer ids that collide across phones — insert FRESH
  // (drop the old id so new autoincrement ids are assigned) and dedupe against
  // existing entries so restoring the same file twice doesn't duplicate history.
  const existing = await db.listLogs();
  const logKey = (l) => [l.equipmentId || '', l.date || '', l.type || '', l.status || '', l.minutes || '', (l.problem || '').slice(0, 80)].join('|');
  const seen = new Set(existing.map(logKey));
  let nLogs = 0;
  for (const l of (data.logs || [])) {
    const rec = { ...l }; delete rec.id;
    const k = logKey(rec);
    if (seen.has(k)) continue;
    seen.add(k);
    await db.putLog(rec); nLogs++;
  }

  if (data.settings) {
    const s = data.settings;
    if (s.onboarded !== undefined && s.onboarded !== null) await db.kvSet('onboarded', s.onboarded);
    if (s.feedback) await db.kvSet('feedback', s.feedback);
    if (s.counters) { // merge, keeping the larger count per metric
      const cur = (await db.kvGet('counters')) || {};
      for (const [k, v] of Object.entries(s.counters)) cur[k] = Math.max(cur[k] || 0, v || 0);
      await db.kvSet('counters', cur);
    }
    try {
      if (s.lang) localStorage.setItem('taller-lang', s.lang);
      if (s.theme) localStorage.setItem('taller-theme', s.theme);
      if (s.aiEndpoint) localStorage.setItem('taller-ai-endpoint', s.aiEndpoint);
    } catch (e) { /* ignore */ }
  }
  // deliberately do NOT stamp lastBackupAt — the merged state on THIS phone
  // has not been backed up yet, so the reminder should still nudge the user.
  return { equipment: nEq, logs: nLogs, photos: nPhotos, manuals: (data.manualsIndex || []).length };
}

// ---------- reminder logic ----------
export async function needsBackup() {
  const equipment = await db.listEquipment();
  if (!equipment.length) return false;
  if (reminderDismissed) return false;
  const last = await db.kvGet('lastBackupAt');
  if (!last) return true;
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  return days >= 7;
}

export function backupReminderCard(onGo) {
  return el('button', { class: 'backup-reminder', onclick: onGo },
    el('div', { class: 'br-ico' }, icon('shield-alert', 20)),
    el('div', { class: 'br-body' },
      el('b', {}, t('backup.remindTitle')),
      el('span', { class: 'small' }, t('backup.remindText')),
    ),
    el('span', { class: 'br-x', onclick: (e) => { e.stopPropagation(); reminderDismissed = true; e.currentTarget.closest('.backup-reminder').remove(); } }, icon('x', 16)),
  );
}

// ---------- view ----------
export async function renderBackup(container) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);
  wrap.append(el('h2', { class: 'view-title' }, t('backup.title')));

  const last = await db.kvGet('lastBackupAt');
  const equipment = await db.listEquipment();
  const logs = await db.listLogs();

  wrap.append(el('div', { class: 'card' },
    el('p', { class: 'small', style: 'margin-top:0' }, t('backup.intro')),
    el('div', { class: 'backup-stat' },
      el('span', {}, icon('wrench', 15), ' ' + t('reports.total') + ': ' + equipment.length),
      el('span', {}, icon('clipboard-list', 15), ' ' + t('logbook.title') + ': ' + logs.length),
    ),
    el('p', { class: 'muted small' }, last ? t('backup.lastAt', { d: new Date(last).toLocaleString(document.documentElement.lang || 'en') }) : t('backup.never')),
  ));

  wrap.append(el('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => doBackup({ share: false }) },
    icon('download', 20), t('backup.now')));
  if (navigator.canShare) {
    wrap.append(el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:10px', onclick: () => doBackup({ share: true }) },
      icon('share-2', 19), t('backup.share')));
  }

  // restore
  const fileInput = el('input', {
    type: 'file', accept: 'application/json,.json', style: 'display:none',
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const text = await f.text();
        const res = await restoreFromText(text);
        toast(tn('backup.restored', res.equipment), 4500);
        if (res.manuals) toast(t('backup.reimport', { n: res.manuals }), 6000);
        location.hash = '#/';
      } catch (err) {
        toast(t(err && err.message === 'schema' ? 'backup.tooNew' : 'backup.badFile'), 4500);
      }
    },
  });
  wrap.append(
    el('h3', { class: 'section-title' }, icon('download', 15), t('backup.restoreTitle')),
    el('div', { class: 'card' },
      el('p', { class: 'small', style: 'margin-top:0' }, t('backup.restoreText')),
      fileInput,
      el('button', { class: 'btn btn-secondary btn-block', onclick: () => fileInput.click() }, icon('hard-drive', 18), t('backup.restoreBtn')),
    ),
    el('p', { class: 'muted tiny center' }, t('backup.manualsNote')),
  );
}
