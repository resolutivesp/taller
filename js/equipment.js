// Taller — equipment register (the CMMS core). Asset-centric: each machine has
// WHO-style inventory fields, a status, a preventive-maintenance schedule, a
// linked manual, a photo, a spare-parts list and a service history.

import { db, isQuotaError } from './db.js';
import { el, clear, t, tn, toast, modal, confirmModal, confirmAsync, todayISO, uuid, debounce } from './ui.js';
import { icon } from './icons.js';
import { art } from './art.js';
import { EQUIPMENT_TYPES, EQUIPMENT_STATUS, PM_PRESETS, DEMO_EQUIPMENT } from './config.js';
import {
  typeMeta, typeName, STATUS_META, statusName, riskName, pmState, pmNeedsAction,
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
  const add = () => equipmentForm(null, () => renderEquipment(container));

  // The total lives on the "All" chip below; the title row keeps room for a
  // long title ("Equipamentos") next to the Add button in every language.
  wrap.append(el('div', { class: 'title-row' },
    el('h2', { class: 'view-title' }, t('equipment.title')),
    equipment.length ? el('button', { class: 'btn btn-primary btn-small', onclick: add }, icon('plus', 18), t('common.add')) : null,
  ));

  if (!equipment.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-art' }, art('equipment')),
      el('h2', {}, t('equipment.emptyTitle')),
      el('p', { class: 'muted' }, t('equipment.emptyText')),
      el('button', { class: 'btn btn-primary btn-big', onclick: add }, icon('plus', 20), t('equipment.add')),
    ));
    return;
  }

  // filter state (may be preset from a Home deep-link, e.g. ?filter=pmdue)
  const valid = new Set(['all', 'pmdue', ...EQUIPMENT_STATUS]);
  let filter = valid.has(params.filter) ? params.filter : 'all';
  const cnt = { all: equipment.length, pmdue: equipment.filter(e => pmNeedsAction(pmState(e).state)).length };
  for (const s of EQUIPMENT_STATUS) cnt[s] = equipment.filter(e => e.status === s).length;

  const listEl = el('div', { class: 'eq-list' });
  const search = el('input', { type: 'search', class: 'search-box', placeholder: t('equipment.searchPh'), autocomplete: 'off', 'aria-label': t('common.search') });
  let q = '';
  search.addEventListener('input', debounce(() => { q = search.value.trim().toLowerCase(); paint(); }, 200));

  // Filters with nothing in them are hidden (except the active one): a row of
  // six chips where four say "0" is noise, and the counts answer the question
  // before the tap.
  const filterRow = el('div', { class: 'chip-row scroll-x' });
  const filters = [['all', t('equipment.filterAll')], ['pmdue', t('pm.due')], ...EQUIPMENT_STATUS.map(s => [s, statusName(s)])];
  for (const [key, label] of filters) {
    if (key !== 'all' && key !== filter && !cnt[key]) continue;
    filterRow.append(el('button', {
      class: 'chip' + (filter === key ? ' active' : ''),
      onclick: (e) => { filter = key; filterRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); e.target.closest('.chip').classList.add('active'); paint(); },
    }, label, el('span', { class: 'chip-n' }, String(cnt[key]))));
  }

  wrap.append(
    el('div', { class: 'search-row' },
      el('div', { class: 'search-wrap' }, el('span', { class: 'search-ico' }, icon('search', 19)), search),
      el('button', { class: 'round-tool', 'aria-label': t('scan.title'), onclick: () => openScanner() }, icon('qr-code', 22)),
    ),
    filterRow,
    listEl,
  );

  function paint() {
    clear(listEl);
    let items = equipment;
    if (filter === 'pmdue') items = items.filter(e => pmNeedsAction(pmState(e).state));
    else if (filter !== 'all') items = items.filter(e => e.status === filter);
    if (q) items = items.filter(e => (`${e.name} ${typeName(e.type)} ${e.model || ''} ${e.serial || ''} ${e.location || ''} ${e.assetTag || ''}`).toLowerCase().includes(q));
    if (!items.length) { listEl.append(el('p', { class: 'muted small center', style: 'padding:24px 8px' }, t('equipment.noneMatch'))); return; }
    for (const eq of items) listEl.append(equipmentCard(eq));
  }
  paint();
}

// A recognisable glyph when there is no photo yet.
const TYPE_ICON = {
  patient_monitor: 'heart-pulse', ecg: 'heart-pulse', defibrillator: 'zap', fetal_doppler: 'heart-pulse',
  pulse_oximeter: 'heart-pulse', bp_monitor: 'heart-pulse', electrosurgical: 'zap',
  oxygen_concentrator: 'gauge', ventilator: 'gauge', anaesthesia: 'gauge', cpap: 'gauge', suction_pump: 'gauge',
  autoclave: 'gauge', infusion_pump: 'activity', syringe_pump: 'activity', infant_incubator: 'shield-check',
  infant_warmer: 'shield-check', phototherapy: 'lightbulb', exam_light: 'lightbulb', vaccine_fridge: 'box',
  battery: 'battery-charging',
};
function typeIcon(type) { return TYPE_ICON[type] || 'wrench'; }

// Keep model codes such as "SP-100" whole when a long name wraps: the line
// used to break after the hyphen, leaving "SP-" and "100" on two lines.
function titleNodes(name) {
  return String(name || '').split(/(\s+)/).map(w => (/\S-\S/.test(w) ? el('span', { style: 'white-space:nowrap' }, w) : w));
}

// What to show under the name without repeating it: the demo pump is named
// "Suction pump · SP-100", which used to appear three times on one screen.
function subLine(eq) {
  const name = (eq.name || '').toLowerCase();
  const parts = [typeName(eq.type), eq.model].filter(x => x && !name.includes(String(x).toLowerCase()));
  if (!parts.length && eq.manufacturer) parts.push(eq.manufacturer);
  return parts.join(' · ');
}

function equipmentCard(eq) {
  const st = STATUS_META[eq.status] || STATUS_META.working;
  const pm = pmState(eq);
  const thumb = el('img', { class: 'eq-thumb', alt: '' });
  const icoBox = el('div', { class: 'eq-thumb eq-thumb-ico' }, icon(typeIcon(eq.type), 26));
  if (eq.photoId) setPhoto(thumb, eq.photoId);

  // Working machines carry only the green dot; everything that needs the
  // technician gets a labelled pill, so the list reads like a to-do list.
  const badges = [];
  if (eq.status !== 'working') badges.push(el('span', { class: 'badge ' + st.cls }, icon(st.icon, 12), statusName(eq.status)));
  const dd = downDays(eq);
  if (dd) badges.push(el('span', { class: 'badge st-part' }, icon('clock', 12), t('equipment.downDays', { n: dd })));
  if (pm.state === 'unknown') badges.push(el('span', { class: 'badge pm-unknown' }, icon('clock', 12), t('pm.unknownShort')));
  else if (pmNeedsAction(pm.state)) badges.push(el('span', { class: 'badge ' + (pm.state === 'overdue' ? 'st-part' : 'badge-warn') }, icon('clock', 12), t('pm.due')));
  else if (pm.state === 'soon') badges.push(el('span', { class: 'badge badge-soon' }, icon('clock', 12), t('pm.soon')));

  return el('button', { class: 'eq-card', onclick: () => navigate('#/equipment/' + eq.id) },
    el('div', { class: 'eq-thumb-wrap' },
      eq.photoId ? thumb : icoBox,
      el('span', { class: 'eq-dot ' + eq.status }, el('span', { class: 'sr-only' }, statusName(eq.status))),
    ),
    el('div', { class: 'eq-info' },
      el('div', { class: 'eq-name' }, eq.name),
      el('div', { class: 'muted small eq-sub' }, subLine(eq)),
      eq.location ? el('div', { class: 'eq-meta' }, el('span', { class: 'eq-loc small muted' }, icon('map-pin', 13), eq.location)) : null,
      badges.length ? el('div', { class: 'eq-badges' }, ...badges) : null,
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

  const pm = pmState(eq);
  const manual = eq.manualId ? await db.getManual(eq.manualId) : null;
  const logs = await db.logsForEquipment(id);

  const header = el('div', { class: 'detail-header' },
    el('button', { class: 'icon-btn', 'aria-label': t('common.back'), onclick: () => navigate('#/equipment') }, icon('chevron-left', 24)),
    el('div', { class: 'reader-title' }, eq.name),
    el('button', { class: 'icon-btn', 'aria-label': t('common.edit'), onclick: () => equipmentForm(eq, refresh) }, icon('pencil', 19)),
  );

  // hero photo
  const heroImg = el('img', { class: 'eq-hero-img', alt: '' });
  const heroBox = el('button', { class: 'eq-hero', onclick: async () => {
    try {
      const pid = await capturePhotoToDb();
      if (!pid) return;
      const old = eq.photoId;
      eq.photoId = pid;
      await db.putEquipment(eq);          // write the new reference first...
      if (old) { try { await db.deletePhoto(old); } catch (e) { /* ignore */ } } // ...then reclaim
      refresh();
    } catch (e) { toast(t(isQuotaError(e) ? 'common.storageFull' : 'common.error'), 5000); }
  } });
  if (eq.photoId) {
    setPhoto(heroImg, eq.photoId);
    heroBox.setAttribute('aria-label', t('equipment.changePhoto'));
    heroBox.append(heroImg, el('span', { class: 'eq-hero-cam' }, icon('camera', 18)));
  } else {
    heroBox.append(el('div', { class: 'eq-hero-empty' },
      el('span', { class: 'cam' }, icon('camera', 24)), el('span', { class: 'small' }, t('equipment.addPhoto'))));
  }

  // status quick-set (records when the status changed → downtime tracking)
  // Toggle buttons, not radios: every press SAVES the machine's status, so
  // arrow-key radio semantics (which select as you move) would be a trap.
  const statusRow = el('div', { class: 'status-grid', role: 'group', 'aria-label': t('equipment.setStatus') });
  for (const s of EQUIPMENT_STATUS) {
    statusRow.append(el('button', {
      class: 'status-opt' + (eq.status === s ? ' active' : ''), dataset: { s },
      'aria-pressed': eq.status === s ? 'true' : 'false',
      onclick: async () => {
        if (eq.status === s) return;
        // only reset the downtime clock when a machine BECOMES out of service,
        // so toggling down ↔ awaiting-parts doesn't zero continuous downtime
        if (isOOS(s) && !isOOS(eq.status)) eq.statusSince = todayISO();
        eq.status = s;
        await db.putEquipment(eq);
        toast(t('equipment.statusSet', { s: statusName(s) }), 2600, null, 'ok');
        refresh();
      },
    }, el('span', { class: 'so-dot' }), statusName(s)));
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
      toast(t('pm.doneToast'), 2800, null, 'ok');
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
    el('h3', { class: 'section-title' }, icon('book-open', 17), t('equipment.manual')),
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
      el('h3', { class: 'section-title', style: 'margin:0' }, icon('clipboard-list', 17), t('equipment.history')),
      el('button', { class: 'btn btn-small btn-secondary', onclick: () => openLogEntry({ equipmentId: id, __lockEquipment: true }, refresh) }, icon('plus', 14), t('logbook.newEntry')),
    ),
    historyTimeline(logs, refresh),
  );

  const notesCard = eq.notes ? el('div', { class: 'card section' },
    el('h3', { class: 'section-title' }, icon('pencil', 17), t('equipment.notes')),
    el('p', { class: 'small' }, eq.notes)) : null;

  // QR label + printable record
  const qrBox = el('div', { class: 'qr-mini' });
  qrInto(qrBox, eq.id, 3);
  const labelsCard = el('div', { class: 'card section' },
    el('h3', { class: 'section-title' }, icon('qr-code', 17), t('qr.title')),
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
      el('div', { class: 'det-card' },
        el('div', { class: 'detail-titlerow' },
          el('div', {},
            el('h2', { class: 'detail-name' }, titleNodes(eq.name)),
            el('p', { class: 'det-sub' },
              subLine(eq) ? el('span', {}, icon('tag', 14), subLine(eq)) : null,
              eq.location ? el('span', {}, icon('map-pin', 14), eq.location) : null,
            ),
          ),
        ),
        statusRow,
        downLine,
        actions,
      ),
      el('div', { class: 'view-pad', style: 'padding-top:4px' },
        pmStateChip,
        el('div', { class: 'card section' },
          el('h3', { class: 'section-title' }, icon('list', 17), t('equipment.specs')),
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
  return el('button', { class: 'action-btn', onclick }, el('span', { class: 'ab-ico' }, icon(ico, 23)), el('span', {}, t(key)));
}

function specItem(ico, key, value) {
  return el('div', { class: 'spec-item' },
    el('span', { class: 'spec-ico' }, icon(ico, 16)),
    el('div', {}, el('span', { class: 'spec-label' }, t(key)), el('span', { class: 'spec-value' }, value || '—')),
  );
}

function pmCard(eq, pm) {
  if (!pm.scheduled) {
    return el('div', { class: 'card section' },
      el('h3', { class: 'section-title' }, icon('shield-check', 17), t('pm.title')),
      el('p', { class: 'muted small', style: 'margin:0' }, t('pm.none')),
    );
  }
  const stateCls = { overdue: 'pm-overdue', due: 'pm-overdue', unknown: 'pm-unknown', soon: 'pm-soon', ok: 'pm-ok' }[pm.state] || 'pm-ok';
  const stateLabel = pm.state === 'unknown' ? t('pm.unknown')
    : pm.state === 'overdue' ? tn('pm.overdueBy', -pm.days, { n: -pm.days })
    : pm.state === 'due' ? t('pm.dueToday')
    : pm.state === 'soon' ? tn('pm.dueIn', pm.days, { n: pm.days })
    : t('pm.nextOn', { d: fmtDate(pm.nextIso) });
  // How far through the interval we are: a bar reads faster than a date.
  let frac = null;
  if (pm.state !== 'unknown' && eq.pmDays && pm.days !== null) {
    frac = pm.state === 'overdue' ? 1 : Math.max(0.04, Math.min(1, (eq.pmDays - pm.days) / eq.pmDays));
  }
  const fillCls = { overdue: 'pm-overdue', due: 'pm-overdue', soon: 'pm-soon' }[pm.state] || '';
  return el('div', { class: 'card section pm-card ' + stateCls },
    el('h3', { class: 'section-title' }, icon('shield-check', 17), t('pm.title')),
    el('div', { class: 'pm-row' },
      el('div', {}, el('span', { class: 'spec-label' }, t('pm.every')), el('span', { class: 'spec-value' }, t('pm.everyDays', { n: eq.pmDays }))),
      el('div', {}, el('span', { class: 'spec-label' }, t('pm.lastDone')), el('span', { class: 'spec-value' }, eq.lastPmDate ? fmtDate(eq.lastPmDate) : '—')),
    ),
    frac !== null ? el('div', { class: 'pm-track' }, el('div', { class: 'pm-fill ' + fillCls, style: `width:${Math.round(frac * 100)}%` })) : null,
    el('div', { class: 'pm-foot' },
      el('div', { class: 'pm-state ' + stateCls }, icon('clock', 15), stateLabel),
      el('button', { class: 'btn btn-small btn-secondary', onclick: () => exportPmCalendar([eq]) },
        icon('calendar-clock', 16), t('pm.remind')),
    ),
  );
}

function renderPartsCard(eq, refresh) {
  const card = el('div', { class: 'card section' });
  const rebuild = () => {
    clear(card);
    card.append(el('h3', { class: 'section-title' }, icon('package', 17), t('equipment.partsNeeded')));
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
  // Two defaults used to quietly corrupt every register built with this form:
  //  - type defaulted to 'suction_pump', so any record saved without scrolling
  //    back to field 2 inherited a suction pump's identity, risk class and PM
  //    interval. 'other' is the honest default.
  //  - lastPmDate defaulted to today, i.e. the app asserted "PM was done today"
  //    for a machine it had just met. Registering a real 40-machine fleet then
  //    made the dashboard read "nothing due" for the next 3-12 months, which
  //    disables the single hook that brings a technician back each week.
  //    Empty is honest: pmState() reports 'unknown' until a service is recorded.
  const eq = existing ? { ...existing } : {
    id: uuid(), name: '', type: 'other', status: 'working',
    pmDays: typeMeta('other').pm, lastPmDate: null, statusSince: todayISO(), parts: [], createdAt: Date.now(),
    ...(prefill || {}),
  };
  // Respect an interval the user chose by hand: changing the equipment type
  // must not silently revert a hospital-mandated 30-day PM to the type default.
  // Use != null, not truthiness: pmDays === 0 means "deliberately no schedule",
  // which is precisely the setting a type change must not silently undo.
  let pmCustomised = !!(existing && existing.pmDays != null && existing.pmDays !== typeMeta(existing.type).pm);

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
        onclick: () => { pmDays = d; pmCustomised = true; buildPm(); },
      }, d === 0 ? t('pm.noneShort') : t('pm.everyDays', { n: d })));
    }
  };
  buildPm();
  const lastPm = el('input', {
    type: 'date', class: 'input', value: eq.lastPmDate || '',
    'aria-label': t('pm.lastDone'),
  });

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
    } catch (e) { toast(t(isQuotaError(e) ? 'common.storageFull' : 'common.error'), 5000); }
    finally { photoBtn.disabled = false; }
  } }, icon('camera', 18), t('equipment.addPhoto'));

  // when type changes, refresh PM default + risk hint (only if user hasn't customised pm)
  typeSel.addEventListener('change', () => {
    const def = typeMeta(typeSel.value);
    if (!pmCustomised) { pmDays = def.pm; buildPm(); }
    riskHint.textContent = t('equipment.riskAuto', { r: riskName(def.risk) });
  });
  const riskHint = el('p', { class: 'muted tiny', style: 'margin:4px 0 0' }, t('equipment.riskAuto', { r: riskName(typeMeta(eq.type).risk) }));

  // The documented #1 reason technicians abandon a CMMS is data-entry burden
  // (56% report being overloaded with documentation). Fifteen fields in one
  // wall — with Save at the bottom of ~2.3 screens — is exactly that. The
  // express path is now name + type + photo + make/model + location + status +
  // PM interval; the rest of the WHO inventory fields are still all here, one
  // tap away, and open automatically when editing a record that already uses
  // them so nothing ever looks lost.
  const usesExtra = !!(eq.serial || eq.assetTag || eq.power || eq.acquiredDate || eq.notes || eq.lastPmDate || eq.manualId);
  const extra = el('div', { class: 'form-extra', style: usesExtra ? '' : 'display:none' },
    el('div', { class: 'form-2col' },
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.serial')), serial),
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.assetTag')), assetTag),
    ),
    el('label', { class: 'lbl' }, t('equipment.power')), power,
    el('label', { class: 'lbl' }, t('pm.lastDone')), lastPm,
    el('label', { class: 'lbl' }, t('equipment.acquired') + ' (' + t('common.optional') + ')'), acquired,
    manuals.length ? el('label', { class: 'lbl' }, t('equipment.manual')) : null,
    manuals.length ? manualSel : null,
    el('label', { class: 'lbl' }, t('equipment.notes')), notes,
  );
  const moreBtn = el('button', {
    type: 'button', class: 'form-more', 'aria-expanded': usesExtra ? 'true' : 'false',
    onclick: () => {
      const open = extra.style.display !== 'none';
      extra.style.display = open ? 'none' : '';
      moreBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      clear(moreBtn).append(icon(open ? 'chevron-down' : 'chevron-up', 17), t(open ? 'equipment.moreFields' : 'equipment.fewerFields'));
    },
  }, icon(usesExtra ? 'chevron-up' : 'chevron-down', 17), t(usesExtra ? 'equipment.fewerFields' : 'equipment.moreFields'));

  const body = el('div', { class: 'form' },
    dl,
    el('label', { class: 'lbl' }, t('equipment.name') + ' *'), nameInput,
    el('label', { class: 'lbl' }, t('equipment.type')), typeSel, riskHint,
    photoWrap, photoBtn,
    el('div', { class: 'form-2col' },
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.manufacturer')), mfr),
      el('div', {}, el('label', { class: 'lbl' }, t('equipment.model')), model),
    ),
    el('label', { class: 'lbl' }, t('equipment.location')), location,
    el('label', { class: 'lbl' }, t('equipment.statusLabel')), statusRow,
    el('label', { class: 'lbl' }, t('pm.title')), pmRow,
    moreBtn,
    extra,
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
      manualId: manualSel.value || null,
      // Keep a remembered manual NAME when nothing is linked: after a restore
      // the id is intentionally null and the name is the only thing that lets
      // library.js re-attach the PDF when it is imported again. Blanking it on
      // a routine save killed that path — on the new-phone flow, permanently.
      manualName: chosen ? chosen.name : (manualSel.value ? null : (eq.manualName || null)),
      notes: notes.value.trim(), photoId,
    });
    await db.putEquipment(eq);
    // Reclaim the replaced blob only AFTER the new reference is on disk.
    if (!isNew && originalPhoto && originalPhoto !== photoId) { try { await db.deletePhoto(originalPhoto); } catch (e) { /* ignore */ } }
    if (isNew) await db.counterBump('equipmentAdded');
    requestPersist();
    toast(t('equipment.saved'), 2600, null, 'ok');
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
