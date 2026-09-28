// Taller — backup & restore. Everything a technician enters (equipment, photos,
// service history, settings) lives only on this phone. If the phone is lost,
// wiped, or the browser cache is cleared, it's gone. A backup is the difference
// between a tool you trust for months and a toy. Manuals (your own PDF files) are
// NOT included — they are re-importable; this protects the irreplaceable data and
// keeps the backup small enough to WhatsApp to yourself.

import { db, isQuotaError } from './db.js';
import { el, clear, t, tn, toast, confirmAsync, todayISO } from './ui.js';
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
// LOCAL date, not UTC: a backup taken at 09:00 in Nairobi or 23:00 in Lima
// used to be filed under the wrong day, which matters when a tech is picking
// the right file out of a Downloads folder full of them.
function todayStamp() { return todayISO(); }

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

// A backup that reports success without producing a file is WORSE than no
// backup feature at all: it converts "the tech knows they are unprotected" into
// "the tech believes they are protected", and it silences the 7-day reminder
// that is the only nag in the app. Previously, dismissing the Android share
// sheet (an AbortError — one of the most common gestures on a phone) skipped
// the download fallback, stamped lastBackupAt and toasted "Backup done".
// Now: only a confirmed hand-off stamps the date, and every other outcome is
// reported honestly.
export async function doBackup({ share = false } = {}) {
  let data, json;
  try {
    data = await buildBackup();
    json = JSON.stringify(data);
  } catch (e) {
    toast(t(isQuotaError(e) ? 'common.storageFull' : 'backup.failed'), 5000);
    throw e;
  }
  const filename = `taller-backup-${todayStamp()}.json`;

  if (share && navigator.canShare) {
    try {
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Taller backup' });
        await db.kvSet('lastBackupAt', nowISO());
        toast(t('backup.done'), 3000, null, 'ok');
        return data.counts;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // The user backed out of the share sheet. Nothing was saved anywhere.
        toast(t('backup.cancelled'), 4000);
        return null;
      }
      // Sharing blew up for another reason — fall through to the download.
    }
  }

  try {
    downloadJsonString(json, filename);
  } catch (e) {
    toast(t('backup.failed'), 5000);
    throw e;
  }
  await db.kvSet('lastBackupAt', nowISO());
  toast(t('backup.done'), 3000, null, 'ok');
  return data.counts;
}

// ---------- restore ----------
// Backup files are explicitly designed to be passed around ("small enough to
// WhatsApp to yourself"), which means a restore file is UNTRUSTED INPUT that
// arrives through a chat app. Everything below treats it that way.

const STR = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const NUM = (v, min, max, dflt) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};
const ISO_DATE = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const VALID_STATUS = ['working', 'down', 'awaiting_parts', 'retired'];

// Rebuild each record field by field. Anything not listed is dropped, so a
// hostile or corrupt file cannot smuggle unexpected keys into the database and
// out again through a report, an .ics file or the AI prompt.
function cleanEquipment(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) return null;
  const out = {
    id: e.id.slice(0, 64),
    name: STR(e.name, 160),
    type: STR(e.type, 60) || 'other',
    manufacturer: STR(e.manufacturer, 120),
    model: STR(e.model, 120),
    serial: STR(e.serial, 120),
    assetTag: STR(e.assetTag, 60),
    location: STR(e.location, 160),
    power: STR(e.power, 60),
    notes: STR(e.notes, 4000),
    status: VALID_STATUS.includes(e.status) ? e.status : 'working',
    statusSince: ISO_DATE(e.statusSince),
    pmDays: NUM(e.pmDays, 0, 3650, 0),
    lastPmDate: ISO_DATE(e.lastPmDate),
    acquiredDate: ISO_DATE(e.acquiredDate),
    photoId: typeof e.photoId === 'string' ? e.photoId.slice(0, 64) : null,
    // Keep the NAME of the manual but drop the id: the PDF itself is never in a
    // backup, so a restored id points at nothing and — worse — permanently
    // defeats library.js's re-link path, which only fires when manualId is
    // falsy. Nulling it means re-importing the PDF re-attaches automatically.
    manualId: null,
    manualName: STR(e.manualName, 200),
    parts: Array.isArray(e.parts)
      ? e.parts.map(p => (typeof p === 'string'
        ? { name: STR(p, 120), qty: 1 }
        : { name: STR(p && p.name, 120), qty: NUM(p && p.qty, 1, 9999, 1) }))
        .filter(p => p.name.trim()).slice(0, 200)
      : [],
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt.slice(0, 40) : null,
    createdAt: NUM(e.createdAt, 0, 4e12, Date.now()),
    // `demo` marks the seeded demo machine. Dropping it made "Try the demo"
    // seed a SECOND one after any restore, and re-armed the "protect your
    // data" nag for a fleet containing nothing the technician entered.
    demo: e.demo === true || undefined,
  };
  if (out.demo === undefined) delete out.demo;
  if (!out.name) out.name = [out.manufacturer, out.model].filter(Boolean).join(' ').slice(0, 160);
  return out;
}

function cleanLog(l) {
  if (!l || typeof l !== 'object') return null;
  return {
    equipmentId: typeof l.equipmentId === 'string' ? l.equipmentId.slice(0, 64) : null,
    equipment: STR(l.equipment, 160),
    date: ISO_DATE(l.date) || todayStamp(),
    type: STR(l.type, 40) || 'repair',
    status: STR(l.status, 40) || 'fixed',
    minutes: NUM(l.minutes, 0, 100000, 0),
    problem: STR(l.problem, 4000),
    photoId: typeof l.photoId === 'string' ? l.photoId.slice(0, 64) : null,
  };
}

// Distinct entries must produce distinct keys. The old key omitted `equipment`
// (the free-text machine name used for anything not in the register) and
// truncated the problem text at 80 chars, so three same-day inspections of
// three different unregistered monitors collapsed into ONE surviving row.
function logKey(l) {
  return [
    l.equipmentId || '', (l.equipment || '').trim().toLowerCase(),
    l.date || '', l.type || '', l.status || '', l.minutes || '',
    (l.problem || '').trim(),
  ].join('\u0000');
}

function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('parse'); }
  if (!data || data.app !== 'taller' || !Array.isArray(data.equipment)) throw new Error('format');
  if (typeof data.schema === 'number' && data.schema > SCHEMA) throw new Error('schema');
  return data;
}

// Read the file and describe what restoring it would do, WITHOUT touching the
// database — so the user can be shown a real confirmation instead of having
// their current fleet state silently overwritten by a file they mis-tapped.
export async function inspectBackup(text) {
  const data = parseBackup(text);
  const incoming = data.equipment.map(cleanEquipment).filter(Boolean);
  const current = await db.listEquipment();
  const byId = new Map(current.map(e => [e.id, e]));
  let added = 0, updated = 0, older = 0;
  for (const e of incoming) {
    const cur = byId.get(e.id);
    if (!cur) { added++; continue; }
    if (cur.updatedAt && e.updatedAt && e.updatedAt < cur.updatedAt) older++;
    else updated++;
  }
  return {
    data,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    equipment: incoming.length, added, updated, older,
    logs: Array.isArray(data.logs) ? data.logs.length : 0,
    photos: data.photos && typeof data.photos === 'object' ? Object.keys(data.photos).length : 0,
    manuals: Array.isArray(data.manualsIndex) ? data.manualsIndex.length : 0,
  };
}

export async function restoreFromText(text, { keepNewer = true, parsed = null } = {}) {
  const data = parsed || parseBackup(text);

  // Photos first (so equipment/logs referencing them resolve).
  // Only data: URLs — a plain https URL here would make the phone call out to
  // whoever authored the file the moment the tech opens it, which both leaks
  // the device's IP and breaks the "nothing leaves the phone" promise.
  let nPhotos = 0;
  if (data.photos && typeof data.photos === 'object') {
    for (const [id, dataUrl] of Object.entries(data.photos)) {
      if (typeof id !== 'string' || typeof dataUrl !== 'string') continue;
      // Accept any image type: compress() returns the ORIGINAL file when
      // canvas.toBlob fails (the low-RAM path this app is built for), so a HEIC
      // or AVIF capture is a legitimate stored photo. Still data: only — a
      // remote URL here would make the phone call out to whoever wrote the file.
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) continue;
      try { await db.putPhoto(id.slice(0, 64), await dataUrlToBlob(dataUrl)); nPhotos++; } catch (e) { /* skip bad photo */ }
    }
  }

  const current = await db.listEquipment();
  const byId = new Map(current.map(e => [e.id, e]));
  let nEq = 0, nSkipped = 0;
  for (const raw of data.equipment) {
    const e = cleanEquipment(raw);
    if (!e) continue;
    const cur = byId.get(e.id);
    // Never let an OLD backup silently revert a machine the tech has since
    // updated (status, parts, PM date, photo). Without updatedAt on both sides
    // we cannot tell, and fall back to the incoming record.
    if (keepNewer && cur && cur.updatedAt && e.updatedAt && e.updatedAt < cur.updatedAt) { nSkipped++; continue; }
    // Keep a locally-attached manual if the incoming record has none.
    if (cur && cur.manualId && !e.manualId) e.manualId = cur.manualId;
    await db.putEquipmentRaw(e); nEq++;
  }

  // Logs use autoincrement integer ids that collide across phones — insert
  // FRESH (drop the old id) and dedupe against existing entries so restoring
  // the same file twice doesn't duplicate history.
  const existing = await db.listLogs();
  const seen = new Set(existing.map(logKey));
  let nLogs = 0;
  for (const raw of (Array.isArray(data.logs) ? data.logs : [])) {
    const rec = cleanLog(raw);
    if (!rec) continue;
    const k = logKey(rec);
    if (seen.has(k)) continue;
    seen.add(k);
    await db.putLog(rec); nLogs++;
  }

  if (data.settings && typeof data.settings === 'object') {
    const s = data.settings;
    if (s.onboarded !== undefined && s.onboarded !== null) await db.kvSet('onboarded', s.onboarded);
    if (s.feedback && typeof s.feedback === 'object') await db.kvSet('feedback', s.feedback);
    if (s.counters && typeof s.counters === 'object') { // merge, keeping the larger count per metric
      const cur = (await db.kvGet('counters')) || {};
      for (const [k, v] of Object.entries(s.counters)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        cur[k] = Math.max(cur[k] || 0, NUM(v, 0, 1e12, 0));
      }
      await db.kvSet('counters', cur);
    }
    try {
      if (['en', 'fr', 'es', 'pt'].includes(s.lang)) localStorage.setItem('taller-lang', s.lang);
      if (['light', 'dark'].includes(s.theme)) localStorage.setItem('taller-theme', s.theme);
      // DELIBERATELY NOT RESTORED: aiEndpoint. A forwarded backup file could
      // silently repoint every future question — plus up to 8 full manual
      // excerpts — at a server chosen by whoever authored the file, and have
      // its replies rendered under the "grounded in your manuals" badge. That
      // is attacker-authored repair advice for life-support equipment. The
      // endpoint ships with the app; a technician who really needs a custom one
      // can set it explicitly in Settings.
    } catch (e) { /* ignore */ }
  }
  // deliberately do NOT stamp lastBackupAt — the merged state on THIS phone
  // has not been backed up yet, so the reminder should still nudge the user.
  return {
    equipment: nEq, logs: nLogs, photos: nPhotos, skipped: nSkipped,
    manuals: Array.isArray(data.manualsIndex) ? data.manualsIndex.length : 0,
  };
}

// ---------- reminder logic ----------
export async function needsBackup() {
  const equipment = await db.listEquipment();
  // Don't nag about protecting data the technician has not entered yet: a
  // fleet consisting only of the seeded demo machine is not worth backing up,
  // and the reminder lands right on top of the first-run "wow" moment.
  const real = equipment.filter(e => !e.demo);
  if (!real.length) return false;
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
  );
}

// Dismiss control for the reminder. It used to be a <span onclick> nested
// INSIDE the <button> above — invalid HTML, unreachable by keyboard, and
// invisible to screen readers. Now it is a sibling button in a wrapper.
export function backupReminder(onGo) {
  const wrap = el('div', { class: 'backup-reminder-wrap' });
  wrap.append(
    backupReminderCard(onGo),
    el('button', {
      class: 'br-x', type: 'button', 'aria-label': t('common.dismiss'),
      onclick: () => { reminderDismissed = true; wrap.remove(); },
    }, icon('x', 18)),
  );
  return wrap;
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

  // restore — inspect the file and ASK before touching anything. Picking the
  // wrong file out of a Downloads folder used to overwrite the live fleet
  // state instantly, with no warning and no way back.
  const fileInput = el('input', {
    type: 'file', accept: 'application/json,.json', style: 'display:none',
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const text = await f.text();
        const info = await inspectBackup(text);
        const when = info.exportedAt
          ? new Date(info.exportedAt).toLocaleString(document.documentElement.lang || 'en')
          : t('backup.unknownDate');
        const lines = el('div', {},
          el('p', { style: 'margin-top:0' }, t('backup.confirmIntro', { d: when })),
          el('ul', { class: 'restore-summary' },
            el('li', {}, tn('backup.confirmAdd', info.added, { n: info.added })),
            el('li', {}, tn('backup.confirmUpdate', info.updated, { n: info.updated })),
            info.older ? el('li', {}, tn('backup.confirmOlder', info.older, { n: info.older })) : null,
            el('li', {}, tn('backup.confirmLogs', info.logs, { n: info.logs })),
          ),
        );
        const ok = await confirmAsync(lines, t('backup.confirmGo'), t('backup.restoreTitle'));
        if (!ok) return;
        const res = await restoreFromText(text, { parsed: info.data });
        toast(tn('backup.restored', res.equipment, { n: res.equipment }), 4500);
        if (res.skipped) toast(tn('backup.skippedNewer', res.skipped, { n: res.skipped }), 6000);
        if (res.manuals) toast(tn('backup.reimport', res.manuals, { n: res.manuals }), 6000);
        location.hash = '#/';
      } catch (err) {
        const key = err && err.message === 'schema' ? 'backup.tooNew'
          : isQuotaError(err) ? 'common.storageFull' : 'backup.badFile';
        toast(t(key), 5000);
      }
    },
  });
  wrap.append(
    el('h3', { class: 'section-title' }, icon('download', 17), t('backup.restoreTitle')),
    el('div', { class: 'card' },
      el('p', { class: 'small', style: 'margin-top:0' }, t('backup.restoreText')),
      fileInput,
      el('button', { class: 'btn btn-secondary btn-block', onclick: () => fileInput.click() }, icon('hard-drive', 18), t('backup.restoreBtn')),
    ),
    el('p', { class: 'muted tiny center' }, t('backup.manualsNote')),
  );
}
