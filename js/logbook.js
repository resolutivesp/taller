// Taller — fault & preventive-maintenance history. Entries can link to a piece
// of equipment and carry a photo. Target: under a minute per entry.

import { db, isQuotaError } from './db.js';
import { el, clear, t, tn, toast, modal, confirmModal, todayISO } from './ui.js';
import { icon } from './icons.js';
import { capturePhotoToDb, setPhoto } from './images.js';
import { normalizeParts, fmtDate } from './model.js';
import { navigate } from './main.js';

const isOOS = (s) => s === 'down' || s === 'awaiting_parts';
// mapping from a log outcome to the machine's resulting status
const STATUS_TO_MACHINE = { fixed: 'working', pending: 'down', part: 'awaiting_parts' };

const TYPE_KEYS = { repair: 'logbook.typeRepair', pm: 'logbook.typePM', inspection: 'logbook.typeInspection' };
const STATUS_META = {
  fixed: { key: 'logbook.statusFixed', cls: 'st-fixed' },
  pending: { key: 'logbook.statusPending', cls: 'st-pending' },
  part: { key: 'logbook.statusPart', cls: 'st-part' },
};

// ---------- global history view ----------
export async function renderLog(container) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  const logs = await db.listLogs();
  const equipment = await db.listEquipment();
  const eqName = (id) => { const e = equipment.find(x => x.id === id); return e ? e.name : null; };

  wrap.append(
    el('h2', { class: 'view-title' }, t('logbook.title')),
    el('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => openLogEntry({}, () => renderLog(container)) },
      icon('plus', 21), t('logbook.newEntry')),
  );

  if (!logs.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-art' }, icon('clipboard-list', 64)),
      el('p', { class: 'muted' }, t('logbook.empty')),
    ));
    return;
  }

  wrap.append(el('p', { class: 'muted small', style: 'margin:12px 0 4px' }, tn('logbook.entries', logs.length)));
  const list = el('div', { class: 'log-list' });
  wrap.append(list);

  // Render a page at a time. A 300-machine fleet after a year is thousands of
  // entries, and every card parses an icon SVG and resolves a photo blob out of
  // IndexedDB — building them all froze the view for seconds on open and pulled
  // every photo into memory at once. Cards (and their photos) are created only
  // when the technician asks for them.
  const PAGE = 50;
  let shown = 0;
  const moreBtn = el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:10px', onclick: () => showMore() });
  const showMore = () => {
    for (const entry of logs.slice(shown, shown + PAGE)) {
      list.append(logCard(entry, eqName(entry.equipmentId), () => renderLog(container)));
    }
    shown = Math.min(shown + PAGE, logs.length);
    const left = logs.length - shown;
    moreBtn.style.display = left ? '' : 'none';
    clear(moreBtn).append(icon('chevron-down', 18), t('logbook.showMore', { n: Math.min(PAGE, left) }));
  };
  showMore();
  wrap.append(moreBtn);

  wrap.append(el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:12px', onclick: () => exportCsv(logs, equipment) },
    icon('download', 18), t('logbook.export')));
}

// A compact timeline (used inside equipment detail).
export function historyTimeline(logs, onRefresh) {
  const wrap = el('div', { class: 'timeline' });
  if (!logs.length) { wrap.append(el('p', { class: 'muted small' }, t('logbook.emptyEquip'))); return wrap; }
  for (const entry of logs) {
    const st = STATUS_META[entry.status] || STATUS_META.pending;
    const dot = entry.type === 'pm' ? 'shield-check' : entry.type === 'inspection' ? 'search' : 'wrench';
    wrap.append(el('button', { class: 'tl-item', onclick: () => openLogEntry(entry, onRefresh) },
      el('div', { class: 'tl-dot ' + st.cls }, icon(dot, 14)),
      el('div', { class: 'tl-body' },
        el('div', { class: 'tl-head' },
          el('span', { class: 'tl-date' }, fmtDate(entry.date)),
          el('span', { class: 'badge ' + st.cls }, t(st.key)),
        ),
        entry.problem ? el('p', { class: 'tl-text small' }, entry.problem) : null,
        el('span', { class: 'muted tiny' }, t(TYPE_KEYS[entry.type] || TYPE_KEYS.repair) + (entry.minutes ? ' · ' + entry.minutes + ' min' : '')),
      ),
    ));
  }
  return wrap;
}

function logCard(entry, equipmentName, refresh) {
  const st = STATUS_META[entry.status] || STATUS_META.pending;
  const thumb = el('img', { class: 'log-thumb', alt: '' });
  if (entry.photoId) setPhoto(thumb, entry.photoId); else thumb.style.display = 'none';
  return el('button', { class: 'log-card', onclick: () => openLogEntry(entry, refresh) },
    el('div', { class: 'log-row' },
      entry.photoId ? thumb : el('div', { class: 'log-typeico ' + st.cls }, icon(entry.type === 'pm' ? 'shield-check' : 'wrench', 18)),
      el('div', { class: 'log-main' },
        el('div', { class: 'log-head' },
          el('span', { class: 'log-equip' }, equipmentName || entry.equipment || t('logbook.noEquip')),
          el('span', { class: 'badge ' + st.cls }, t(st.key)),
        ),
        el('div', { class: 'muted small' }, `${fmtDate(entry.date)} · ${t(TYPE_KEYS[entry.type] || TYPE_KEYS.repair)}${entry.minutes ? ' · ' + entry.minutes + ' min' : ''}`),
        entry.problem ? el('p', { class: 'log-problem small' }, entry.problem) : null,
      ),
    ),
  );
}

// ---------- entry form (also used by equipment detail & home quick action) ----------
export async function openLogEntry(existing, onSaved) {
  existing = existing || {};
  const manuals = await db.listManuals();
  const equipment = await db.listEquipment();

  // equipment selector (only when not already scoped to one)
  let equipmentId = existing.equipmentId || null;
  let equipmentFreeText = existing.equipment || '';
  const scoped = !!existing.equipmentId && !!existing.__lockEquipment;

  const eqSelect = el('select', { class: 'select' },
    el('option', { value: '' }, t('logbook.noEquip')),
    ...equipment.map(e => el('option', { value: e.id }, e.name)),
    el('option', { value: '__free' }, t('logbook.otherEquip')),
  );
  if (equipmentId) eqSelect.value = equipmentId;
  const freeInput = el('input', { class: 'input', placeholder: t('logbook.equipmentPh'), value: equipmentFreeText, style: equipmentId || !equipmentFreeText ? 'display:none' : '' });
  eqSelect.addEventListener('change', () => {
    if (eqSelect.value === '__free') { freeInput.style.display = ''; equipmentId = null; }
    else { freeInput.style.display = 'none'; equipmentId = eqSelect.value || null; }
  });

  const problem = el('textarea', { class: 'input', rows: 3, placeholder: t('logbook.problemPh') });
  problem.value = existing.problem || '';

  let type = existing.type || 'repair';
  let status = existing.status || 'fixed';
  let minutes = existing.minutes || null;
  let photoId = existing.photoId || null;

  const typeRow = chipRow(Object.keys(TYPE_KEYS), k => t(TYPE_KEYS[k]), type, v => type = v);
  const statusRow = chipRow(Object.keys(STATUS_META), k => t(STATUS_META[k].key), status, v => { status = v; reflectMachine(); });
  const minRow = chipRow(['5', '15', '30', '60'], v => v + "'", minutes ? String(minutes) : null, v => minutes = v ? parseInt(v, 10) : null, true);

  // When logging a fault ON a specific machine, offer to set the machine's status
  // to match the outcome (fixed → working, pending → down, part → awaiting parts),
  // so the dashboard stays truthful without a second action. This closes the loop.
  const updateChk = el('input', { type: 'checkbox', checked: true });
  const machineLabel = el('b', {});
  const partInput = el('input', { class: 'input', placeholder: t('equipment.partPh'), 'aria-label': t('equipment.partsNeeded'), style: 'margin-top:8px' });
  const partWrap = el('div', { style: 'display:none' }, partInput);
  function reflectMachine() {
    const ms = STATUS_TO_MACHINE[status] || 'working';
    machineLabel.textContent = t('equipment.status.' + ms);
    partWrap.style.display = ms === 'awaiting_parts' ? '' : 'none';
  }
  reflectMachine();
  const machineBlock = scoped ? el('div', { class: 'machine-block' },
    el('label', { class: 'check-row small' }, updateChk, el('span', {}, t('logbook.setMachine') + ' '), machineLabel),
    partWrap,
  ) : null;

  // photo
  const photoImg = el('img', { class: 'form-photo', alt: '' });
  // A capture is written to IndexedDB the moment it is taken. Dropping the
  // reference alone (remove, replace, cancel) left a 150-300 KB blob in the
  // database forever, on a phone where running out of storage is a real failure
  // mode. Reclaim anything captured in this dialog — but never the photo the
  // saved entry still points at, or its thumbnail would break.
  const originalPhoto = existing.photoId || null;
  const dropCaptured = async () => {
    if (photoId && photoId !== originalPhoto) { try { await db.deletePhoto(photoId); } catch (e) { /* ignore */ } }
  };
  const photoWrap = el('div', { class: 'form-photo-wrap', style: photoId ? '' : 'display:none' }, photoImg,
    // icon-only control: without a label a screen reader announces just "button"
    el('button', { class: 'photo-x', 'aria-label': t('common.delete'), onclick: async () => { await dropCaptured(); photoId = null; photoWrap.style.display = 'none'; } }, icon('x', 15)));
  if (photoId) setPhoto(photoImg, photoId);
  const photoBtn = el('button', { class: 'btn btn-secondary btn-block', onclick: async () => {
    photoBtn.disabled = true;
    try {
      const id = await capturePhotoToDb();
      if (id) { await dropCaptured(); photoId = id; await setPhoto(photoImg, id); photoWrap.style.display = ''; }
    } catch (e) {
      // A throw here (a full phone is the likely one) used to leave the button
      // disabled for the rest of the dialog, with nothing said about why.
      toast(isQuotaError(e) ? t('common.storageFull') : t('common.error'));
    } finally { photoBtn.disabled = false; }
  } }, icon('camera', 18), t('logbook.addPhoto'));

  const body = el('div', { class: 'form' },
    scoped ? null : el('label', { class: 'lbl' }, t('logbook.equipment')),
    scoped ? null : eqSelect,
    scoped ? null : freeInput,
    el('label', { class: 'lbl' }, t('logbook.problem')), problem,
    el('label', { class: 'lbl' }, t('logbook.type')), typeRow,
    el('label', { class: 'lbl' }, t('logbook.status')), statusRow,
    machineBlock,
    el('label', { class: 'lbl' }, t('logbook.minutes') + ' (' + t('common.optional') + ')'), minRow,
    photoWrap, photoBtn,
  );

  let saving = false; // guards the save handler (see below)
  let saved = false;  // tells the close handler not to reclaim a photo now in use
  const actions = [
    { label: t('common.cancel'), kind: 'btn-secondary' },
    {
      label: existing.id ? t('common.save') : t('logbook.saveEntry'), kind: 'btn-primary',
      onClick: async () => {
        if (!problem.value.trim() && !equipmentId && !freeInput.value.trim()) { toast(t('common.error')); return false; }
        // The dialog stays open until this resolves, and it awaits several
        // times. A second tap in that window re-entered and wrote a SECOND
        // entry, because a new entry carries no id and the store hands out a
        // fresh autoincremented key each time. Block re-entry and grey the
        // button, so a double-tap on a slow phone can't duplicate the record.
        if (saving) return false;
        saving = true;
        const saveBtn = dlg.box.querySelector('.modal-actions .btn-primary');
        if (saveBtn) saveBtn.disabled = true;
        const entry = {
          date: existing.date || todayISO(),
          equipmentId: equipmentId || existing.equipmentId || null,
          equipment: equipmentId ? '' : (freeInput.value.trim() || existing.equipment || ''),
          problem: problem.value.trim(),
          type, status, minutes: minutes || null, photoId,
        };
        if (existing.id) entry.id = existing.id;
        try {
          const key = await db.putLog(entry);
          // Adopt the key the store assigned: if anything below fails and the
          // technician taps Save again, that retry updates this entry instead
          // of inserting a duplicate.
          if (entry.id == null && key != null) { entry.id = key; existing.id = key; }
          saved = true;
          // the entry no longer points at the photo it was opened with
          if (originalPhoto && originalPhoto !== photoId) { try { await db.deletePhoto(originalPhoto); } catch (e) { /* ignore */ } }
          await db.counterBump('logEntries');
          // close the loop: reflect the outcome onto the machine's status
          if (scoped && updateChk.checked) {
            const machine = await db.getEquipment(existing.equipmentId);
            if (machine) {
              const ms = STATUS_TO_MACHINE[status] || 'working';
              if (isOOS(ms) && !isOOS(machine.status)) machine.statusSince = todayISO();
              machine.status = ms;
              if (ms === 'awaiting_parts' && partInput.value.trim()) {
                machine.parts = normalizeParts(machine);
                machine.parts.push({ name: partInput.value.trim(), qty: 1 });
              }
              await db.putEquipment(machine);
            }
          }
        } catch (e) {
          // keep the dialog (and the typed work) open so the save can be retried
          toast(isQuotaError(e) ? t('common.storageFull') : t('common.error'));
          return false;
        } finally {
          saving = false;
          if (saveBtn) saveBtn.disabled = false;
        }
        toast(t('logbook.saved'));
        if (onSaved) onSaved(entry);
      },
    },
  ];
  if (existing.id) {
    actions.splice(1, 0, {
      label: t('common.delete'), kind: 'btn-danger',
      onClick: () => confirmModal(t('common.confirmDelete'), async () => {
        await db.deleteLog(existing.id);
        if (onSaved) onSaved(null);
      }, t('common.delete')),
    });
  }

  // onClose covers every way out that isn't a save — Cancel, Escape, tapping the
  // backdrop, deleting the entry — each of which used to strand the captured
  // photo's blob in the database with nothing referencing it.
  const dlg = modal({
    title: existing.id ? t('common.edit') : t('logbook.newEntry'), body, actions,
    onClose: () => { if (!saved) dropCaptured(); },
  });
  if (!existing.id && !scoped) setTimeout(() => (scoped ? problem : eqSelect).focus(), 60);
}

function chipRow(values, labelFn, current, onPick, toggleable = false) {
  const row = el('div', { class: 'chip-row' });
  for (const v of values) {
    const chip = el('button', {
      type: 'button',
      class: 'chip' + (String(current) === String(v) ? ' active' : ''),
      onclick: () => {
        const isActive = chip.classList.contains('active');
        row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        if (toggleable && isActive) { onPick(null); return; }
        chip.classList.add('active');
        onPick(v);
      },
    }, labelFn(v));
    row.append(chip);
  }
  return row;
}

function exportCsv(logs, equipment) {
  const eqName = (id) => { const e = equipment.find(x => x.id === id); return e ? e.name : ''; };
  // Same formula-injection guard as the reports export: a "problem" note typed
  // starting with = + - @ tab or CR is EXECUTED by the spreadsheet when the
  // administrator opens the file. Plain numbers are left readable.
  const esc = (s) => {
    let v = String(s == null ? '' : s);
    if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const typeLabel = (k) => t(TYPE_KEYS[k] || TYPE_KEYS.repair);
  const statusLabel = (k) => t((STATUS_META[k] || STATUS_META.pending).key);
  const header = [t('logbook.date'), t('logbook.equipment'), t('logbook.type'), t('logbook.status'), t('logbook.minutes'), t('logbook.problem')];
  const rows = [
    header.map(esc).join(','),
    ...logs.map(l => [l.date, eqName(l.equipmentId) || l.equipment, typeLabel(l.type), statusLabel(l.status), l.minutes || '', l.problem].map(esc).join(',')),
  ];
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'taller-log.csv', style: 'display:none' });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  toast(t('logbook.exported'));
}
