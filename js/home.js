// Taller — Home dashboard. Orients the technician: what's down, what's due,
// what parts are needed, at a glance. The operational front page of the CMMS.

import { db } from './db.js';
import { el, clear, t, tn, fmtBytes } from './ui.js';
import { icon } from './icons.js';
import { counts, attention, partsList, statusName, typeName, STATUS_META, pmState, fmtDate, relDays } from './model.js';
import { equipmentForm } from './equipment.js';
import { openLogEntry } from './logbook.js';
import { importDemo } from './library.js';
import { needsBackup, backupReminderCard } from './backup.js';
import { openScanner } from './scan.js';
import { navigate } from './main.js';

export async function renderHome(container) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  const equipment = await db.listEquipment();
  const manuals = await db.listManuals();
  const logs = await db.listLogs();

  // fully empty → welcoming first screen
  if (!equipment.length && !manuals.length) {
    wrap.append(
      el('div', { class: 'home-hero' },
        el('h2', {}, t('home.welcomeTitle')),
        el('p', { class: 'muted' }, t('home.welcomeText')),
      ),
      el('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => equipmentForm(null, () => renderHome(container)) },
        icon('wrench', 20), t('home.addEquipment')),
      el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:10px', onclick: () => navigate('#/library') },
        icon('book-open', 19), t('home.addManual')),
      el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:10px', onclick: () => importDemo() },
        icon('rocket', 19), t('home.tryDemo')),
      el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:10px', onclick: () => navigate('#/backup') },
        icon('hard-drive', 19), t('backup.restoreBtn')),
    );
    return;
  }

  const c = counts(equipment);
  const att = attention(equipment);
  const parts = partsList(equipment);

  wrap.append(el('div', { class: 'home-head' },
    el('h2', { class: 'view-title', style: 'margin:0' }, t('home.title')),
    el('p', { class: 'muted small', style: 'margin:2px 0 0' }, t('home.subtitle')),
  ));

  // stat tiles
  const tiles = el('div', { class: 'stat-tiles' });
  tiles.append(
    statTile('wrench', c.total, t('home.tileEquipment'), 'tile-neutral', () => navigate('#/equipment')),
    statTile('gauge', c.uptime === null ? '—' : c.uptime + '%', t('home.tileUptime'), c.uptime !== null && c.uptime < 70 ? 'tile-warn' : 'tile-ok'),
    statTile('circle-alert', c.outOfService, t('home.tileDown'), c.outOfService ? 'tile-danger' : 'tile-ok', () => navigate('#/equipment')),
    statTile('clock', c.pmDue, t('home.tilePmDue'), c.pmDue ? 'tile-warn' : 'tile-ok', c.pmDue ? () => navigate('#/equipment?filter=pmdue') : null),
  );
  wrap.append(tiles);

  // backup reminder (data lives only on this phone)
  if (await needsBackup()) wrap.append(backupReminderCard(() => navigate('#/backup')));

  // parts banner
  if (parts.length) {
    wrap.append(el('button', { class: 'parts-banner', onclick: () => navigate('#/reports') },
      icon('package', 20),
      el('span', {}, t('home.partsNeeded', { n: parts.length })),
      icon('chevron-right', 18),
    ));
  }

  // needs-attention list
  if (att.length) {
    wrap.append(el('h3', { class: 'section-title' }, icon('triangle-alert', 15), t('home.needsAttention')));
    const list = el('div', {});
    for (const { eq, pm } of att.slice(0, 6)) list.append(attentionCard(eq, pm));
    wrap.append(list);
  } else if (equipment.length) {
    wrap.append(el('div', { class: 'all-good' }, icon('circle-check', 22), el('span', {}, t('home.allGood'))));
  }

  // quick actions
  wrap.append(
    el('h3', { class: 'section-title' }, icon('plus-circle', 15), t('home.quickActions')),
    el('div', { class: 'quick-grid' },
      quick('qr-code', 'scan.scan', () => openScanner()),
      quick('wrench', 'home.addEquipment', () => equipmentForm(null, () => renderHome(container))),
      quick('clipboard-list', 'logbook.logFault', () => openLogEntry({}, () => renderHome(container))),
      quick('message-circle-question', 'nav.ask', () => navigate('#/ask')),
    ),
  );

  // recent activity
  if (logs.length) {
    const eqName = (id) => { const e = equipment.find(x => x.id === id); return e ? e.name : null; };
    wrap.append(el('h3', { class: 'section-title' }, icon('activity', 15), t('home.recent')));
    const recent = el('div', {});
    for (const l of logs.slice(0, 4)) {
      recent.append(el('button', { class: 'recent-item', onclick: () => l.equipmentId ? navigate('#/equipment/' + l.equipmentId) : navigate('#/log') },
        el('div', { class: 'recent-ico ' + (l.type === 'pm' ? 'st-fixed' : 'st-pending') }, icon(l.type === 'pm' ? 'shield-check' : 'wrench', 15)),
        el('div', { class: 'recent-body' },
          el('span', { class: 'small', style: 'font-weight:700' }, eqName(l.equipmentId) || l.equipment || t('logbook.noEquip')),
          el('span', { class: 'muted tiny' }, `${fmtDate(l.date)} · ${(l.problem || '').slice(0, 60)}`),
        ),
      ));
    }
    wrap.append(recent);
  }
}

function statTile(ico, value, label, cls, onclick) {
  return el(onclick ? 'button' : 'div', { class: 'stat-tile ' + cls, onclick },
    el('div', { class: 'stat-ico' }, icon(ico, 18)),
    el('div', { class: 'stat-value' }, String(value)),
    el('div', { class: 'stat-label' }, label),
  );
}

function attentionCard(eq, pm) {
  const reasons = [];
  if (eq.status === 'down') reasons.push({ cls: 'st-part', txt: statusName('down') });
  if (eq.status === 'awaiting_parts') reasons.push({ cls: 'st-pending', txt: statusName('awaiting_parts') });
  if (pm.state === 'overdue') reasons.push({ cls: 'st-part', txt: tn('pm.overdueBy', -pm.days) });
  else if (pm.state === 'due') reasons.push({ cls: 'st-pending', txt: t('pm.dueToday') });
  else if (pm.state === 'soon') reasons.push({ cls: 'st-pending', txt: tn('pm.dueIn', pm.days) });

  // dot reflects the most urgent reason, not the raw status
  let dot = { icon: 'circle-alert', cls: 'st-pending' };
  if (eq.status === 'down' || pm.state === 'overdue') dot = { icon: 'circle-alert', cls: 'st-part' };
  else if (eq.status === 'awaiting_parts') dot = { icon: 'clock', cls: 'st-pending' };
  else if (pm.state === 'due' || pm.state === 'soon') dot = { icon: 'clock', cls: 'st-pending' };

  return el('button', { class: 'att-card', onclick: () => navigate('#/equipment/' + eq.id) },
    el('div', { class: 'att-dot ' + dot.cls }, icon(dot.icon, 16)),
    el('div', { class: 'att-body' },
      el('div', { class: 'att-name' }, eq.name),
      el('div', { class: 'att-reasons' }, ...reasons.map(r => el('span', { class: 'badge ' + r.cls }, r.txt))),
    ),
    icon('chevron-right', 18),
  );
}

function quick(ico, key, onclick) {
  return el('button', { class: 'quick-btn', onclick }, icon(ico, 22), el('span', {}, t(key)));
}
