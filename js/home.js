// Taller — Home dashboard. Orients the technician: what's down, what's due,
// what parts are needed, at a glance. The operational front page of the CMMS.

import { db } from './db.js';
import { el, clear, t, tn, getLang, toast, confirmAsync } from './ui.js';
import { icon } from './icons.js';
import { art } from './art.js';
import { counts, attention, partsList, statusName, typeName, fmtDate } from './model.js';
import { equipmentForm } from './equipment.js';
import { openLogEntry } from './logbook.js';
import { importDemo } from './library.js';
import { needsBackup, backupReminder } from './backup.js';
import { openScanner } from './scan.js';
import { unindexManual } from './search.js';
import { navigate } from './main.js';

export async function renderHome(container) {
  clear(container);

  const equipment = await db.listEquipment();
  const manuals = await db.listManuals();
  const logs = await db.listLogs();

  // ---- fully empty → a welcoming first screen with four clear ways in ----
  if (!equipment.length && !manuals.length) {
    const wrap = el('div', { class: 'view-pad' });
    container.append(wrap);
    wrap.append(
      el('div', { class: 'home-hero' },
        art('workshop'),
        el('h2', {}, t('home.welcomeTitle')),
        el('p', { class: 'muted' }, t('home.welcomeText')),
      ),
      el('div', { class: 'opt-grid' },
        optCard('wrench', 'home.addEquipment', 'home.optEquipment', () => equipmentForm(null, () => renderHome(container)), 'main'),
        optCard('file-plus-2', 'home.addManual', 'home.optManual', () => navigate('#/library')),
        optCard('rocket', 'home.tryDemo', 'home.optDemo', () => importDemo(), 'warm'),
        optCard('hard-drive', 'onboarding.restore', 'home.optRestore', () => navigate('#/backup')),
      ),
    );
    return;
  }

  // ---- manuals imported but no machines yet (the "add my first manual"
  // path). It used to render four zero tiles and nothing to do.
  if (!equipment.length) {
    const wrap = el('div', { class: 'view-pad' });
    container.append(wrap);
    wrap.append(
      el('div', { class: 'home-hero' },
        art('equipment'),
        el('h2', {}, t('home.noEquipmentTitle')),
        el('p', { class: 'muted' }, t('home.noEquipmentText')),
      ),
      el('div', { class: 'opt-grid' },
        optCard('wrench', 'home.addEquipment', 'home.optEquipment', () => equipmentForm(null, () => renderHome(container)), 'main wide'),
        optCard('message-circle-question', 'ask.title', 'home.optAsk', () => navigate('#/ask')),
        optCard('book-open', 'library.title', 'home.optSearch', () => navigate('#/library')),
      ),
    );
    return;
  }

  const c = counts(equipment);
  const att = attention(equipment);
  const parts = partsList(equipment);
  const live = c.total - c.retired;

  // ---- header: the workshop's health in one glance ----
  const pills = el('div', { class: 'health-pills' });
  // One pill per list it opens, so the number on the pill is the number of
  // machines the technician finds after tapping it.
  if (c.down) pills.append(hpill('hp-danger', t('home.pillDown', { n: c.down }), () => navigate('#/equipment?filter=down')));
  if (c.awaiting_parts) pills.append(hpill('hp-warn', t('home.pillAwaiting', { n: c.awaiting_parts }), () => navigate('#/equipment?filter=awaiting_parts')));
  if (c.pmDue) pills.append(hpill('hp-warn', tn('home.pillPm', c.pmDue, { n: c.pmDue }), () => navigate('#/equipment?filter=pmdue')));
  if (parts.length) pills.append(hpill('hp-parts', tn('home.pillParts', parts.length, { n: parts.length }), () => navigate('#/reports')));
  if (!pills.childNodes.length) pills.append(hpill('hp-ok', t('home.pillClear'), () => navigate('#/equipment')));

  container.append(el('div', { class: 'home-top' },
    el('div', { class: 'home-top-inner' },
      el('p', { class: 'home-date' }, todayLine()),
      el('h2', { class: 'home-greet' }, t('home.title')),
      el('div', { class: 'health' },
        ring(c.uptime),
        el('div', { class: 'health-body' },
          el('p', { class: 'health-line' }, live ? tn('home.healthLine', live, { w: c.working, n: live }) : t('home.allRetired')),
        ),
        pills,
      ),
    ),
  ));

  const wrap = el('div', { class: 'view-pad home-pad' });
  container.append(wrap);

  // Demo guide: says what to try next, and gives an obvious way out of the
  // sample data. Without it a technician who explored the demo had to find
  // "Delete ALL app data" or delete the pump and the manual one by one.
  const demoEq = equipment.find(e => e.demo);
  if (demoEq && equipment.every(e => e.demo) && !(await db.kvGet('demoTipOff'))) {
    const tip = el('div', { class: 'demo-tip' },
      el('div', { class: 'demo-tip-head' },
        el('span', { class: 'demo-tip-ico' }, icon('sparkles', 19)),
        el('b', {}, t('home.demoTitle')),
        el('button', { class: 'icon-btn', 'aria-label': t('common.dismiss'), onclick: async () => { await db.kvSet('demoTipOff', 1); tip.remove(); } }, icon('x', 18)),
      ),
      el('p', {}, t('home.demoText', { name: demoEq.name })),
      el('div', { class: 'demo-tip-actions' },
        el('button', { class: 'btn btn-primary btn-small', onclick: () => navigate('#/equipment/' + demoEq.id) }, icon('arrow-right', 16), t('home.demoOpen')),
        el('button', { class: 'btn btn-secondary btn-small', onclick: async () => {
          if (!(await confirmAsync(t('home.demoRemoveConfirm'), t('home.demoRemove')))) return;
          await removeDemo();
          toast(t('home.demoRemoved'), 3200, null, 'ok');
          renderHome(container);
        } }, icon('trash-2', 16), t('home.demoRemove')),
      ),
    );
    wrap.append(tip);
  }

  // backup reminder (data lives only on this phone)
  if (await needsBackup()) wrap.append(backupReminder(() => navigate('#/backup')));

  // ---- needs attention ----
  if (att.length) {
    wrap.append(el('h3', { class: 'section-title' },
      icon('triangle-alert', 17), t('home.needsAttention'),
      el('span', { class: 'sec-count' + (att.some(a => a.eq.status === 'down' || a.pm.state === 'overdue') ? ' hot' : '') }, String(att.length)),
    ));
    const list = el('div', {});
    for (const { eq, pm } of att.slice(0, 5)) list.append(attentionCard(eq, pm));
    wrap.append(list);
  } else {
    wrap.append(el('div', { class: 'all-good' }, icon('circle-check', 24), el('span', {}, t('home.allGood'))));
  }

  // ---- quick actions ----
  wrap.append(
    el('h3', { class: 'section-title' }, icon('zap', 17), t('home.quickActions')),
    el('div', { class: 'qa-row' },
      qa('plus', 'home.addEquipment', () => equipmentForm(null, () => renderHome(container))),
      qa('qr-code', 'scan.scan', () => openScanner()),
      qa('clipboard-plus', 'logbook.logFault', () => openLogEntry({}, () => renderHome(container))),
      qa('message-circle-question', 'nav.ask', () => navigate('#/ask')),
    ),
  );

  // ---- recent activity ----
  if (logs.length) {
    const eqName = (id) => { const e = equipment.find(x => x.id === id); return e ? e.name : null; };
    wrap.append(el('div', { class: 'sec-row' },
      el('h3', { class: 'section-title' }, icon('history', 17), t('home.recent')),
      el('button', { class: 'sec-link', onclick: () => navigate('#/log') }, t('logbook.title'), icon('chevron-right', 16)),
    ));
    const recent = el('div', { class: 'recent-list' });
    for (const l of logs.slice(0, 4)) {
      recent.append(el('button', { class: 'recent-item', onclick: () => l.equipmentId ? navigate('#/equipment/' + l.equipmentId) : navigate('#/log') },
        el('div', { class: 'recent-ico ' + (l.type === 'pm' ? 'st-fixed' : 'st-pending') }, icon(l.type === 'pm' ? 'shield-check' : 'wrench', 17)),
        el('div', { class: 'recent-body' },
          el('span', { class: 'small', style: 'font-weight:800' }, eqName(l.equipmentId) || l.equipment || t('logbook.noEquip')),
          el('span', { class: 'muted tiny' }, `${fmtDate(l.date)} · ${(l.problem || '').slice(0, 70)}`),
        ),
        icon('chevron-right', 16),
      ));
    }
    wrap.append(recent);
  }
}

// Remove only what the demo created: the demo machine(s), their service
// records and photos, and the demo manual(s). Real data is never touched.
export async function removeDemo() {
  for (const e of (await db.listEquipment()).filter(x => x.demo)) {
    for (const l of await db.logsForEquipment(e.id)) { try { await db.deleteLog(l.id); } catch (err) { /* ignore */ } }
    await db.deleteEquipment(e.id);
  }
  for (const m of (await db.listManuals()).filter(x => x.demoLang)) {
    try { await unindexManual(m.id); } catch (err) { /* ignore */ }
    await db.deleteManualCascade(m.id);
  }
}

// Capitalise only the first letter: CSS "capitalize" turned French and
// Spanish dates into "Lundi 28 Septembre" / "Lunes, 28 De Septiembre".
function todayLine() {
  try {
    const s = new Date().toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toLocaleUpperCase(getLang()) + s.slice(1);
  } catch (e) { return ''; }
}

// Share of the live fleet that is working, as a ring. Animated from empty so
// the number "lands" — the one moment of delight on the front page.
function ring(pct) {
  const NS = 'http://www.w3.org/2000/svg';
  const R = 40, C = 2 * Math.PI * R;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(NS, 'circle');
  const fg = document.createElementNS(NS, 'circle');
  for (const c of [bg, fg]) {
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(R));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '10');
  }
  bg.setAttribute('class', 'ring-bg');
  fg.setAttribute('class', 'ring-fg');
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('stroke-dasharray', C.toFixed(1));
  fg.setAttribute('stroke-dashoffset', C.toFixed(1));
  svg.append(bg, fg);
  const has = pct !== null && pct !== undefined;
  const target = has ? C * (1 - Math.max(0, Math.min(100, pct)) / 100) : C;
  requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute('stroke-dashoffset', target.toFixed(1))));
  const lvl = !has ? '' : pct >= 80 ? '' : pct >= 50 ? ' warn' : ' bad';
  return el('div', { class: 'ring' + lvl, role: 'img', 'aria-label': has ? `${pct}% ${t('home.ringLabel')}` : '—' },
    svg,
    el('div', { class: 'ring-label' }, el('b', {}, has ? pct + '%' : '—'), el('span', {}, t('home.ringLabel'))),
  );
}

function hpill(cls, label, onclick) {
  return el('button', { class: 'hpill ' + cls, onclick }, el('span', { class: 'hp-dot' }), label);
}

function attentionCard(eq, pm) {
  const reasons = [];
  if (eq.status === 'down') reasons.push({ cls: 'st-part', txt: statusName('down') });
  if (eq.status === 'awaiting_parts') reasons.push({ cls: 'st-pending', txt: statusName('awaiting_parts') });
  if (pm.state === 'overdue') reasons.push({ cls: 'st-part', txt: tn('pm.overdueBy', -pm.days, { n: -pm.days }) });
  else if (pm.state === 'due') reasons.push({ cls: 'st-pending', txt: t('pm.dueToday') });
  else if (pm.state === 'unknown') reasons.push({ cls: 'st-pending', txt: t('pm.unknown') });
  else if (pm.state === 'soon') reasons.push({ cls: 'st-pending', txt: tn('pm.dueIn', pm.days, { n: pm.days }) });

  // the dot reflects the most urgent reason, not the raw status
  const danger = eq.status === 'down' || pm.state === 'overdue';
  let dot = { icon: 'clock', cls: 'st-pending' };
  if (danger) dot = { icon: 'circle-alert', cls: 'st-part' };
  else if (eq.status === 'awaiting_parts') dot = { icon: 'package', cls: 'st-pending' };

  const sub = [typeName(eq.type), eq.location].filter(x => x && !eq.name.includes(x)).join(' · ') || eq.location || '';
  return el('button', { class: 'att-card' + (danger ? ' lvl-danger' : ''), onclick: () => navigate('#/equipment/' + eq.id) },
    el('div', { class: 'att-dot ' + dot.cls }, icon(dot.icon, 19)),
    el('div', { class: 'att-body' },
      el('div', { class: 'att-name' }, eq.name),
      sub ? el('div', { class: 'att-sub' }, sub) : null,
      el('div', { class: 'att-reasons' }, ...reasons.map(r => el('span', { class: 'badge ' + r.cls }, r.txt))),
    ),
    icon('chevron-right', 18),
  );
}

function qa(ico, key, onclick) {
  return el('button', { class: 'qa-btn', onclick }, el('span', { class: 'qa-ico' }, icon(ico, 24)), el('span', {}, t(key)));
}

function optCard(ico, titleKey, subKey, onclick, variant) {
  return el('button', { class: 'opt-card' + (variant ? ' ' + variant : ''), onclick },
    el('span', { class: 'opt-ico' }, icon(ico, 21)),
    el('span', { class: 'opt-txt' }, el('b', {}, t(titleKey)), el('span', {}, t(subKey))),
  );
}
