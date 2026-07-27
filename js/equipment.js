// Taller — equipment register (the CMMS core). Asset-centric: each machine has
// WHO-style inventory fields, a status, a preventive-maintenance schedule, a
// linked manual, a photo, a spare-parts list and a service history.

import { db } from './db.js';
import { el, clear, t, tn, toast, modal, confirmModal, confirmAsync, todayISO, uuid, debounce } from './ui.js';
import { icon } from './icons.js';
import { EQUIPMENT_TYPES, EQUIPMENT_STATUS, PM_PRESETS, DEMO_EQUIPMENT } from './config.js';
import {
  typeMeta, typeName, STATUS_META, statusName, riskName, pmState,
  fmtDate, relDays, todayDate, toISO, downDays, normalizeParts,
} from './model.js';
import { capturePhotoToDb, setPhoto, compress } from './images.js';
import { openLogEntry, historyTimeline } from './logbook.js';
import { qrInto, printOneLabel } from './qr.js';
import { printEquipmentRecord, exportPmCalendar } from './reports.js';
import { openScanner } from './scan.js';
import { findManual } from './manualsources.js';
import { navigate } from './main.js';

const isOOS = (s) => s === 'down' || s === 'awaiting_parts';
function requestPersist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ } }

// Seed a fully-populated demo machine linked to the demo manual, so "Try demo"
// shows the whole product working (dashboard alerts, PM overdue, history, parts).
export async function seedDemoEquipment(manualId, lang) {
  const existing = await db.listEquipment();
  const already = existing.find(e => e.demo);
  if (already) { if (manualId && !already.manualId) { already.manualId = manualId; await db.putEquipment(already); } return already.id; }

  const D = DEMO_EQUIPMENT;
  const loc = D.location[lang] || D.location.en;
  const daysAgoISO = (n) => { const d = todayDate(); d.setDate(d.getDate() - n); return toISO(d); };

  let photoId = null;
  try {
    const res = await fetch('demo/demo-nameplate.png');
    if (res.ok) { const blob = await compress(await res.blob()); photoId = uuid(); await db.putPhoto(photoId, blob); }
  } catch (e) { /* photo optional */ }

  const id = uuid();
  await db.putEquipment({
    id, name: typeName(D.type) + ' · ' + D.model, type: D.type, manufacturer: D.manufacturer,
    model: D.model, serial: D.serial, assetTag: D.assetTag, location: loc, status: D.status,
    power: D.power, pmDays: D.pmDays, lastPmDate: daysAgoISO(D.lastPmDaysAgo),
    acquiredDate: daysAgoISO(D.acquiredDaysAgo), statusSince: daysAgoISO(D.lastPmDaysAgo),
    manualId: manualId || null, parts: [], notes: '',
    photoId, createdAt: Date.now(), demo: true,
  });
  for (const l of D.logs) {
    await db.putLog({ date: daysAgoISO(l.daysAgo), equipmentId: id, type: l.type, status: l.status, minutes: l.minutes, problem: (l.problem[lang] || l.problem.en), photoId: null });
  }
  return id;
}

// ---------- list ----------
export async function renderEquipment(container, params = {}) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  const equipment = await db.listEquipment();

  wrap.append(
    el('h2', { class: 'view-title' }, t('equipment.title')),
    el('div', { class: 'row', style: 'gap:10px' },
      el('button', { class: 'btn btn-primary btn-big', style: 'flex:1', onclick: () => equipmentForm(null, () => renderEquipment(container)) },
        icon('plus', 21), t('equipment.add')),
      el('button', { class: 'btn btn-secondary btn-big', 'aria-label': t('scan.title'), onclick: () => openScanner() },
        icon('qr-code', 21), t('scan.scan')),
    ),
  );

  if (!equipment.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-art' }, icon('wrench', 64)),
      el('h2', {}, t('equipment.emptyTitle')),
      el('p', { class: 'muted' }, t('equipment.emptyText')),
      el('button', { class: 'btn btn-primary', onclick: () => equipmentForm(null, () => renderEquipment(container)) }, icon('plus', 18), t('equipment.add')),
    ));
    return;
  }

  // filter state (may be preset from a Home tile deep-link, e.g. ?filter=pmdue)
  const valid = new Set(['all', 'pmdue', ...EQUIPMENT_STATUS]);
  let filter = valid.has(params.filter) ? params.filter : 'all';
  const listEl = el('div', { class: 'eq-list' });
  const search = el('input', { type: 'search', class: 'search-box', placeholder: t('equipment.searchPh'), autocomplete: 'off' });
  let q = '';
  search.addEventListener('input', debounce(() => { q = search.value.trim().toLowerCase(); paint(); }, 200));

  const filterRow = el('div', { class: 'chip-row scroll-x' });
  const filters = [['all', t('equipment.filterAll')], ['pmdue', t('pm.due')], ...EQUIPMENT_STATUS.map(s => [s, statusName(s)])];
  for (const [key, label] of filters) {
    filterRow.append(el('button', {
      class: 'chip' + (filter === key ? ' active' : ''),
      onclick: (e) => { filter = key; filterRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); e.target.closest('.chip').classList.add('active'); paint(); },
    }, label));
  }

  wrap.append(
    el('div', { class: 'search-wrap', style: 'margin-top:12px' }, el('span', { class: 'search-ico' }, icon('search', 18)), search),
    filterRow,
    listEl,
  );

  function paint() {
    clear(listEl);
    let items = equipment;
    if (filter === 'pmdue') items = items.filter(e => { const st = pmState(e).state; return st === 'overdue' || st === 'due'; });
    else if (filter !== 'all') items = items.filter(e => e.status === filter);
    if (q) items = items.filter(e => (`${e.name} ${typeName(e.type)} ${e.model || ''} ${e.serial || ''} ${e.location || ''} ${e.assetTag || ''}`).toLowerCase().includes(q));
    if (!items.length) { listEl.append(el('p', { class: 'muted small center', style: 'padding:20px' }, t('equipment.noneMatch'))); return; }
    for (const eq of items) listEl.append(equipmentCard(eq));
  }
  paint();
}

function equipmentCard(eq) {
  const st = STATUS_META[eq.status] || STATUS_META.working;
  const pm = pmState(eq);
  const thumb = el('img', { class: 'eq-thumb', alt: '' });
  const icoBox = el('div', { class: 'eq-thumb eq-thumb-ico' }, icon('wrench', 24));
  if (eq.photoId) setPhoto(thumb, eq.photoId);

  const pmChip = (pm.state === 'overdue' || pm.state === 'due')
    ? el('span', { class: 'badge badge-warn' }, icon('clock', 12), t('pm.due'))
    : (pm.state === 'soon' ? el('span', { class: 'badge badge-soon' }, icon('clock', 12), t('pm.soon')) : null);
  const dd = downDays(eq);
  const downChip = dd ? el('span', { class: 'badge st-part' }, icon('clock', 12), t('equipment.downDays', { n: dd })) : null;

  return el('button', { class: 'eq-card', onclick: () => navigate('#/equipment/' + eq.id) },
    eq.photoId ? thumb : icoBox,
    el('div', { class: 'eq-info' },
      el('div', { class: 'eq-name' }, eq.name),
      el('div', { class: 'muted small eq-sub' }, typeName(eq.type) + (eq.model ? ' · ' + eq.model : '')),
      el('div', { class: 'eq-meta' },
        eq.location ? el('span', { class: 'eq-loc small muted' }, icon('map-pin', 12), eq.location) : null,
      ),
      el('div', { class: 'eq-badges' },
        el('span', { class: 'badge ' + st.cls }, icon(st.icon, 12), statusName(eq.status)),
        downChip,
        pmChip,
      ),
    ),
    el('span', { class: 'eq-chevron' }, icon('chevron-right', 20)),
  );
}

// ---------- detail ----------
export async function renderEquipmentDetail(container, id) {
  clear(container);
  const eq = await db.getEquipment(id);
  if (!eq) { navigate('#/equipment'); return; }
  const refresh = () => renderEquipmentDetail(container, id);

  const st = STATUS_META[eq.status] || STATUS_META.working;
  const pm = pmState(eq);
  const manual = eq.manualId ? await db.getManual(eq.manualId) : null;
  const logs = await db.logsForEquipment(id);

  const header = el('div', { class: 'detail-header' },
    el('button', { class: 'icon-btn', 'aria-label': t('common.back'), onclick: () => navigate('#/equipment') }, icon('chevron-left', 22)),
    el('div', { class: 'reader-title' }, eq.name),
    el('button', { class: 'icon-btn', 'aria-label': t('common.edit'), onclick: () => equipmentForm(eq, refresh) }, icon('pencil', 18)),
  );

  // hero photo
  const heroImg = el('img', { class: 'eq-hero-img', alt: '' });
  const heroBox = el('button', { class: 'eq-hero', onclick: async () => {
    const pid = await capturePhotoToDb();
    if (pid) { if (eq.photoId) await db.deletePhoto(eq.photoId); eq.photoId = pid; await db.putEquipment(eq); refresh(); }
  } });
  if (eq.photoId) { setPhoto(heroImg, eq.photoId); heroBox.append(heroImg); }
  else heroBox.append(el('div', { class: 'eq-hero-empty' }, icon('camera', 30), el('span', { class: 'small' }, t('equipment.addPhoto'))));

  // status quick-set (records when the status changed → downtime tracking)
  const statusRow = el('div', { class: 'chip-row scroll-x' });
  for (const s of EQUIPMENT_STATUS) {
    const sm = STATUS_META[s];
    statusRow.append(el('button', {
      class: 'chip' + (eq.status === s ? ' active' : ''),
      onclick: async () => {
        // only reset the downtime clock when a machine BECOMES out of service,
        // so toggling down ↔ awaiting-parts doesn't zero continuous downtime
        if (isOOS(s) && !isOOS(eq.status)) eq.statusSince = todayISO();
        eq.status = s;
        await db.putEquipment(eq);
        toast(t('equipment.statusSet', { s: statusName(s) }));
        refresh();
      },
    }, icon(sm.icon, 14), statusName(s)));
  }
  const dd = downDays(eq);
  const downLine = (dd !== null)
    ? el('div', { class: 'down-line' }, icon('clock', 15), dd > 0 ? tn('equipment.downSince', dd, { d: fmtDate(eq.statusSince) }) : t('equipment.downToday'))
    : null;

  // action row
  const actions = el('div', { class: 'action-grid' },
    actionBtn('wrench', 'logbook.logFault', () => openLogEntry({ equipmentId: id, __lockEquipment: true }, refresh)),
    pm.scheduled ? actionBtn('shield-check', 'pm.markDone', async () => {
      eq.lastPmDate = todayISO();
      await db.putEquipment(eq);
      await db.putLog({ date: todayISO(), equipmentId: id, type: 'pm', status: 'fixed', problem: t('pm.autoNote'), minutes: null, photoId: null });
      await db.counterBump('logEntries');
      toast(t('pm.doneToast'));
      refresh();
    }) : null,
    actionBtn('message-circle-question', 'equipment.ask', () => navigate('#/ask' + (manual ? '?manual=' + manual.id : ''))),
    manual ? actionBtn('book-open', 'equipment.openManual', () => navigate('#/reader/' + manual.id + '/1')) : null,
  );

  // PM card
  const pmStateChip = pmCard(eq, pm);

  // specs
  const specs = el('div', { class: 'spec-grid' },
    specItem('factory', 'equipment.manufacturer', eq.manufacturer),
    specItem('tag', 'equipment.model', eq.model),
    specItem('hash', 'equipment.serial', eq.serial),
    specItem('qr-code', 'equipment.assetTag', eq.assetTag),
    specItem('map-pin', 'equipment.location', eq.location),
    specItem('zap', 'equipment.power', eq.power),
    specItem('shield-alert', 'equipment.riskLabel', riskName(typeMeta(eq.type).risk)),
    specItem('calendar', 'equipment.acquired', eq.acquiredDate ? fmtDate(eq.acquiredDate) : null),
  );

  // parts
  const partsCard = renderPartsCard(eq, refresh);

  // manual link
  const manualCard = el('div', { class: 'card section' },
    el('h3', { class: 'section-title' }, icon('book-open', 15), t('equipment.manual')),
    manual
      ? el('button', { class: 'result-card', onclick: () => navigate('#/reader/' + manual.id + '/1') },
          el('div', { class: 'result-manual' }, icon('file-text', 15), manual.name))
      : el('div', {},
          el('button', { class: 'btn btn-secondary btn-block', onclick: () => attachManual(eq, refresh) }, icon('plus', 17), t('equipment.attachManual')),
          el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:8px', onclick: () => findManual({ manufacturer: eq.manufacturer, model: eq.model }) }, icon('globe', 17), t('find.cta')),
        ),
  );

  // history
  const histCard = el('div', { class: 'card section' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('h3', { class: 'section-title', style: 'margin:0' }, icon('clipboard-list', 15), t('equipment.history')),
      el('button', { class: 'btn btn-small btn-secondary', onclick: () => openLogEntry({ equipmentId: id, __lockEquipment: true }, refresh) }, icon('plus', 14), t('logbook.newEntry')),
    ),
    historyTimeline(logs, refresh),
  );

  const notesCard = eq.notes ? el('div', { class: 'card section' },
    el('h3', { class: 'section-title' }, icon('pencil', 15), t('equipment.notes')),
    el('p', { class: 'small' }, eq.notes)) : null;

  // QR label + printable record
  const qrBox = el('div', { class: 'qr-mini' });
  qrInto(qrBox, eq.id, 3);
  const labelsCard = el('div', { class: 'card section' },
    el('h3', { class: 'section-title' }, icon('qr-code', 15), t('qr.title')),
    el('div', { class: 'qr-row' },
      qrBox,
      el('div', { style: 'flex:1' },
        el('p', { class: 'small muted', style: 'margin-top:0' }, t('qr.explain')),
        el('div', { class: 'report-actions' },
          el('button', { class: 'btn btn-small btn-secondary', onclick: () => printOneLabel(eq) }, icon('qr-code', 15), t('qr.printLabel')),
          el('button', { class: 'btn btn-small btn-secondary', onclick: async () => printEquipmentRecord(eq, await db.logsForEquipment(eq.id)) }, icon('printer', 15), t('equipment.printRecord')),
        ),
      ),
    ),
  );

  const delBtn = el('button', { class: 'btn btn-danger btn-block', style: 'margin-top:14px', onclick: () =>
    confirmModal(t('equipment.deleteConfirm', { name: eq.name }), async () => {
      await db.deleteEquipment(id); toast(t('common.done')); navigate('#/equipment');
    }, t('common.delete')) }, icon('trash-2', 18), t('equipment.delete'));

  container.append(header,
    el('div', { class: 'detail-scroll' },
      heroBox,
      el('div', { class: 'view-pad', style: 'padding-top:12px' },
        el('div', { class: 'detail-titlerow' },
          el('div', {},
            el('h2', { class: 'detail-name' }, eq.name),
            el('p', { class: 'muted small', style: 'margin:2px 0 0' }, typeName(eq.type)),
          ),
          el('span', { class: 'badge ' + st.cls + ' badge-lg' }, icon(st.icon, 14), statusName(eq.status)),
        ),
        el('label', { class: 'lbl' }, t('equipment.setStatus')),
        statusRow,
        downLine,
        actions,
        pmStateChip,
        el('div', { class: 'card section' },
          el('h3', { class: 'section-title' }, icon('list', 15), t('equipment.specs')),
          specs,
        ),
        partsCard,
        manualCard,
        histCard,
        notesCard,
        labelsCard,
        delBtn,
      ),
    ),
  );
}

function actionBtn(ico, key, onclick) {
  return el('button', { class: 'action-btn', onclick }, icon(ico, 22), el('span', {}, t(key)));
}

function specItem(ico, key, value) {
  return el('div', { class: 'spec-item' },
    el('span', { class: 'spec-ico' }, icon(ico, 15)),
    el('div', {}, el('span', { class: 'spec-label' }, t(key)), el('span', { class: 'spec-value' }, value || '—')),
  );
}

function pmCard(eq, pm) {
  if (!pm.scheduled) {
    return el('div', { class: 'card section' },
      el('h3', { class: 'section-title' }, icon('shield-check', 15), t('pm.title')),
      el('p', { class: 'muted small', style: 'margin:0' }, t('pm.none')),
    );
  }
  const stateCls = { overdue: 'pm-overdue', due: 'pm-overdue', soon: 'pm-soon', ok: 'pm-ok' }[pm.state] || 'pm-ok';
  const stateLabel = pm.state === 'overdue' ? tn('pm.overdueBy', -pm.days)
    : pm.state === 'due' ? t('pm.dueToday')
    : pm.state === 'soon' ? tn('pm.dueIn', pm.days)
    : t('pm.nextOn', { d: fmtDate(pm.nextIso) });
  return el('div', { class: 'card section pm-card ' + stateCls },
    el('h3', { class: 'section-title' }, icon('shield-check', 15), t('pm.title')),
    el('div', { class: 'pm-row' },
      el('div', {}, el('span', { class: 'spec-label' }, t('pm.every')), el('span', { class: 'spec-value' }, t('pm.everyDays', { n: eq.pmDays }))),
      el('div', {}, el('span', { class: 'spec-label' }, t('pm.lastDone')), el('span', { class: 'spec-value' }, eq.lastPmDate ? fmtDate(eq.lastPmDate) : '—')),
    ),
    el('div', { class: 'pm-state ' + stateCls }, icon('clock', 15), stateLabel),
    el('button', { class: 'btn btn-small btn-secondary', style: 'margin-top:10px', onclick: () => exportPmCalendar([eq]) },
      icon('calendar', 15), t('pm.remind')),
  );
}

function renderPartsCard(eq, refresh) {
  const card = el('div', { class: 'card section' });
  const rebuild = () => {
    clear(card);
    card.append(el('h3', { class: 'section-title' }, icon('package', 15), t('equipment.partsNeeded')));
    eq.parts = normalizeParts(eq); // migrate legacy strings in place
    const parts = eq.parts;
    if (!parts.length) card.append(el('p', { class: 'muted small' }, t('equipment.noParts')));
    else {
      const list = el('div', { class: 'parts-list' });
      parts.forEach((p, i) => {
        const qtyIn = el('input', { type: 'number', class: 'input part-qty-input', min: '1', value: String(p.qty || 1), 'aria-label': t('equipment.qty') });
        qtyIn.addEventListener('change', async () => { p.qty = Math.max(1, parseInt(qtyIn.value, 10) || 1); qtyIn.value = String(p.qty); await db.putEquipment(eq); });
        list.append(el('div', { class: 'part-chip' },
          qtyIn,
          el('span', { class: 'part-name' }, p.name),
          el('button', { class: 'part-x', 'aria-label': t('common.delete'), onclick: async () => { eq.parts.splice(i, 1); await db.putEquipment(eq); toast(t('common.done')); rebuild(); } }, icon('x', 15)),
        ));
      });
      card.append(list);
    }
    const nameInput = el('input', { class: 'input', placeholder: t('equipment.partPh'), 'aria-label': t('equipment.partsNeeded') });
    const qtyInput = el('input', { type: 'number', class: 'input qty-input', value: '1', min: '1', 'aria-label': t('equipment.qty') });
    const add = async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      eq.parts = normalizeParts(eq); eq.parts.push({ name, qty });
      const flipped = eq.status === 'working';
      if (flipped) { eq.status = 'awaiting_parts'; eq.statusSince = todayISO(); }
      await db.putEquipment(eq); nameInput.value = ''; qtyInput.value = '1';
      toast(t('common.done'));
      if (flipped && refresh) refresh(); else rebuild(); // full refresh updates the header badge
    };
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    card.append(el('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, nameInput, qtyInput,
      el('button', { class: 'btn btn-secondary', 'aria-label': t('common.add'), onclick: add }, icon('plus', 17))));
  };
  rebuild();
  return card;
}

async function attachManual(eq, refresh) {
  const manuals = await db.listManuals();
  if (!manuals.length) {
    confirmModal(t('equipment.noManualsYet'), () => navigate('#/library'), t('ask.goAdd'));
    return;
  }
  const sel = el('select', { class: 'select' }, el('option', { value: '' }, '—'),
    ...manuals.map(m => el('option', { value: m.id }, m.name)));
  modal({
    title: t('equipment.attachManual'), body: sel,
    actions: [
      { label: t('common.cancel'), kind: 'btn-secondary' },
      { label: t('common.save'), kind: 'btn-primary', onClick: async () => { const m = manuals.find(x => x.id === sel.value); eq.manualId = sel.value || null; eq.manualName = m ? m.name : null; await db.putEquipment(eq); toast(t('common.done')); refresh(); } },
    ],
  });
}

// ---------- create/edit form ----------
export async function equipmentForm(existing, onSaved, prefill = {}) {
  const isNew = !existing;
  const eq = existing ? { ...existing } : {
    id: uuid(), name: '', type: 'suction_pump', status: 'working',
    pmDays: typeMeta('suction_pump').pm, lastPmDate: todayISO(), statusSince: todayISO(), parts: [], createdAt: Date.now(),
    ...(prefill || {}),
  };

  const manuals = await db.listManuals();
  const equipment = await db.listEquipment();
  const locations = [...new Set(equipment.map(e => e.location).filter(Boolean))];
  const CODE = { autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' };

  const nameInput = el('input', { class: 'input', value: eq.name || '', placeholder: t('equipment.namePh'), maxlength: 80, 'aria-label': t('equipment.name') });

  const typeSel = el('select', { class: 'select', 'aria-label': t('equipment.type') },
    ...EQUIPMENT_TYPES.map(ty => el('option', { value: ty.key }, typeName(ty.key))));
  typeSel.value = eq.type;

  const mfr = el('input', { class: 'input', value: eq.manufacturer || '', placeholder: 'OpenMed Instruments', 'aria-label': t('equipment.manufacturer') });
  const model = el('input', { class: 'input', value: eq.model || '', placeholder: 'SP-100', 'aria-label': t('equipment.model'), ...CODE });
  const serial = el('input', { class: 'input', value: eq.serial || '', placeholder: t('equipment.serialPh'), 'aria-label': t('equipment.serial'), ...CODE });
  const assetTag = el('input', { class: 'input', value: eq.assetTag || '', placeholder: 'BME-014', 'aria-label': t('equipment.assetTag'), ...CODE });
  const dl = el('datalist', { id: 'loc-list' }, ...locations.map(l => el('option', { value: l })));
  const location = el('input', { class: 'input', list: 'loc-list', value: eq.location || '', placeholder: t('equipment.locationPh'), 'aria-label': t('equipment.location') });
  const power = el('input', { class: 'input', value: eq.power || '', placeholder: '220 V', 'aria-label': t('equipment.power'), autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false' });
  const acquired = el('input', { type: 'date', class: 'input', value: eq.acquiredDate || '' });
  const notes = el('textarea', { class: 'input', rows: 2, placeholder: t('equipment.notesPh') }); notes.value = eq.notes || '';

  let status = eq.status || 'working';
  const statusRow = chipRowSingle(EQUIPMENT_STATUS, s => statusName(s), status, v => status = v, s => STATUS_META[s].icon);

  // PM interval presets + custom + last done
  let pmDays = eq.pmDays != null ? eq.pmDays : typeMeta(eq.type).pm;
  const pmRow = el('div', { class: 'chip-row' });
  const buildPm = () => {
    clear(pmRow);
    for (const d of PM_PRESETS) {
      pmRow.append(el('button', {
        type: 'button', class: 'chip' + (pmDays === d ? ' active' : ''),
        onclick: () => { pmDays = d; buildPm(); },
      }, d === 0 ? t('pm.noneShort') : t('pm.everyDays', { n: d })));
    }
  };
  buildPm();
  const lastPm = el('input', { type: 'date', class: 'input', value: eq.lastPmDate || todayISO() });

  // manual link
  const manualSel = el('select', { class: 'select' }, el('option', { value: '' }, '—'),
    ...manuals.map(m => el('option', { value: m.id }, m.name)));
  if (eq.manualId) manualSel.value = eq.manualId;

  // photo (originalPhoto lets us reclaim replaced/removed blobs instead of leaking them)
  const originalPhoto = eq.photoId || null;
  let photoId = originalPhoto;
  const photoImg = el('img', { class: 'form-photo', alt: t('equipment.addPhoto') });
  const dropCaptured = async () => { if (photoId && photoId !== originalPhoto) { try { await db.deletePhoto(photoId); } catch (e) { /* ignore */ } } };
  const photoWrap = el('div', { class: 'form-photo-wrap', style: photoId ? '' : 'display:none' }, photoImg,
    el('button', { class: 'photo-x', 'aria-label': t('common.delete'), onclick: async () => { await dropCaptured(); photoId = null; photoWrap.style.display = 'none'; } }, icon('x', 15)));
  if (photoId) setPhoto(photoImg, photoId);
  const photoBtn = el('button', { class: 'btn btn-secondary btn-block', onclick: async () => {
    photoBtn.disabled = true;
    try {
      const pid = await capturePhotoToDb();
      if (pid) { await dropCaptured(); photoId = pid; await setPhoto(photoImg, pid); photoWrap.style.display = ''; }
    } catch (e) { toast(t('common.error')); }
    finally { photoBtn.disabled = false; }
  } }, icon('camera', 18), t('equipment.addPhoto'));

  // when type changes, refresh PM default + risk hint (only if user hasn't customised pm)
  typeSel.addEventListener('change', () => {
    const def = typeMeta(typeSel.value);
    pmDays = def.pm; buildPm();
    riskHint.textContent = t('equipment.riskAuto', { r: riskName(def.risk) });
  });
  const riskHint = el('p', { class: 'muted tiny', style: 'margin:4px 0 0' }, t('equipment.riskAuto', { r: riskName(typeMeta(eq.type).risk) }));

  const body = el('div', { class: 'form' },
    dl,
    el('label', { class: 'lbl' }, t('equipment.name') + ' *'), nameInput,
    el('label', { class: 'lbl' }, t('equipment.type')), typeSel, riskHint,
    photoWrap, photoBtn,
    el('div', { class: 'form-2col' },
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.manufacturer')), mfr),
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.model')), model),
    ),
    el('div', { class: 'form-2col' },
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.serial')), serial),
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.assetTag')), assetTag),
    ),
    el('div', { class: 'form-2col' },
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.location')), location),
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.power')), power),
    ),
    el('label', { class: 'lbl' }, t('equipment.statusLabel')), statusRow,
    el('label', { class: 'lbl' }, t('pm.title')), pmRow,
    el('label', { class: 'lbl' }, t('pm.lastDone')), lastPm,
    el('label', { class: 'lbl' }, t('equipment.acquired') + ' (' + t('common.optional') + ')'), acquired,
    manuals.length ? el('label', { class: 'lbl' }, t('equipment.manual')) : null,
    manuals.length ? manualSel : null,
    el('label', { class: 'lbl' }, t('equipment.notes')), notes,
  );

  const doSave = async () => {
    if (!nameInput.value.trim()) { toast(t('equipment.needName')); return false; }
    const oldStatus = existing ? existing.status : null;
    const becameOOS = isOOS(status) && !isOOS(oldStatus);
    const chosen = manualSel.value ? manuals.find(m => m.id === manualSel.value) : null;
    Object.assign(eq, {
      name: nameInput.value.trim(), type: typeSel.value,
      manufacturer: mfr.value.trim(), model: model.value.trim(), serial: serial.value.trim(),
      assetTag: assetTag.value.trim(), location: location.value.trim(), power: power.value.trim(),
      status, pmDays, lastPmDate: lastPm.value || null, acquiredDate: acquired.value || null,
      statusSince: isNew ? todayISO() : (becameOOS ? todayISO() : (eq.statusSince || todayISO())),
      manualId: manualSel.value || null, manualName: chosen ? chosen.name : null,
      notes: notes.value.trim(), photoId,
    });
    // reclaim a replaced photo blob
    if (!isNew && originalPhoto && originalPhoto !== photoId) { try { await db.deletePhoto(originalPhoto); } catch (e) { /* ignore */ } }
    await db.putEquipment(eq);
    if (isNew) await db.counterBump('equipmentAdded');
    requestPersist();
    toast(t('equipment.saved'));
    if (onSaved) onSaved(eq);
    return true;
  };

  const actions = [{ label: t('common.cancel'), kind: 'btn-secondary' }];
  if (isNew) actions.push({
    label: t('equipment.saveAdd'), kind: 'btn-secondary',
    onClick: async () => { if (!(await doSave())) return false; equipmentForm(null, onSaved, { location: location.value.trim() }); },
  });
  actions.push({
    label: isNew ? t('equipment.save') : t('common.save'), kind: 'btn-primary',
    onClick: async () => { if (!(await doSave())) return false; },
  });
  modal({ title: isNew ? t('equipment.add') : t('common.edit'), body, actions });
  if (isNew) setTimeout(() => nameInput.focus(), 60);
}

function chipRowSingle(values, labelFn, current, onPick, icoFn) {
  const row = el('div', { class: 'chip-row scroll-x' });
  for (const v of values) {
    const chip = el('button', {
      type: 'button', class: 'chip' + (String(current) === String(v) ? ' active' : ''),
      onclick: () => { row.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); onPick(v); },
    }, icoFn ? icon(icoFn(v), 14) : null, labelFn(v));
    row.append(chip);
  }
  return row;
}
