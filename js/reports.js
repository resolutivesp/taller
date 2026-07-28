// Taller — Reports & spare-parts request. The BMET's political capital: hand
// management a clean status report and a parts procurement list to unlock budget.
// Everything is generated on-device; nothing is uploaded.

import { db } from './db.js';
import { el, clear, t, tn, toast, shareText, escapeHtml, copyText, todayISO } from './ui.js';
import { icon } from './icons.js';
import { counts, partsList, pmState, pmLabel, statusName, typeName, riskName, typeMeta, fmtDate, downDays, normalizeParts } from './model.js';
import { printLabels } from './qr.js';

const partsStr = (eq) => normalizeParts(eq).map(p => `${p.qty || 1}× ${p.name}`).join('; ');
export function exportPmCalendar(list) {
  const scheduled = list.filter(e => pmState(e).scheduled);
  if (!scheduled.length) { toast(t('reports.pmNone')); return; }
  downloadText(buildIcs(scheduled), 'taller-maintenance.ics', 'text/calendar');
}

export async function renderReports(container) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  const equipment = await db.listEquipment();
  wrap.append(el('h2', { class: 'view-title' }, t('reports.title')));

  if (!equipment.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-art' }, icon('activity', 64)),
      el('p', { class: 'muted' }, t('reports.empty')),
      el('button', { class: 'btn btn-primary', onclick: () => { location.hash = '#/equipment'; } }, icon('plus', 18), t('equipment.add')),
    ));
    return;
  }

  const c = counts(equipment);
  const parts = partsList(equipment);

  // summary tiles
  wrap.append(el('div', { class: 'stat-tiles' },
    tile('wrench', c.total, t('reports.total')),
    tile('gauge', c.uptime + '%', t('home.tileUptime')),
    tile('circle-alert', c.outOfService, t('reports.outOfService')),
    tile('package', parts.length, t('reports.partsLines')),
  ));

  // ---- out of service (with downtime) ----
  const down = equipment.filter(e => e.status === 'down' || e.status === 'awaiting_parts')
    .map(e => ({ e, days: downDays(e) || 0 })).sort((a, b) => b.days - a.days);
  if (down.length) {
    wrap.append(el('h3', { class: 'section-title' }, icon('circle-alert', 15), t('reports.downTitle')));
    const dc = el('div', { class: 'card' });
    for (const { e, days } of down) {
      dc.append(el('button', { class: 'pm-line', onclick: () => location.hash = '#/equipment/' + e.id },
        el('span', { class: 'small', style: 'font-weight:700' }, e.name),
        el('span', { class: 'badge ' + (e.status === 'down' ? 'st-part' : 'st-pending') },
          statusName(e.status) + (days ? ' · ' + t('equipment.downDays', { n: days }) : '')),
      ));
    }
    wrap.append(dc);
  }

  // ---- spare parts request ----
  wrap.append(el('h3', { class: 'section-title' }, icon('package', 15), t('reports.partsRequest')));
  const partsCard = el('div', { class: 'card' });
  if (!parts.length) partsCard.append(el('p', { class: 'muted small', style: 'margin:0' }, t('reports.noParts')));
  else {
    const byEq = groupBy(parts, p => p.equipmentName);
    for (const [name, items] of byEq) {
      partsCard.append(el('div', { class: 'parts-group' },
        el('div', { class: 'parts-group-h' }, icon('wrench', 14), el('b', {}, name),
          items[0].location ? el('span', { class: 'muted tiny' }, ' · ' + items[0].location) : null),
        ...items.map(p => el('div', { class: 'parts-line' }, icon('package', 13),
          el('span', { class: 'part-qty' }, (p.qty || 1) + '×'), el('span', {}, p.part))),
      ));
    }
    partsCard.append(el('div', { class: 'report-actions' },
      el('button', { class: 'btn btn-small btn-secondary', onclick: () => downloadText(buildPartsCsv(parts), 'taller-parts-request.csv', 'text/csv') }, icon('download', 15), 'CSV'),
      navigator.share ? el('button', { class: 'btn btn-small btn-secondary', onclick: () => shareText(buildPartsText(parts), t('reports.partsRequest')) }, icon('share-2', 15), t('common.share')) : el('button', { class: 'btn btn-small btn-secondary', onclick: async () => { if (await copyText(buildPartsText(parts))) toast(t('common.copied')); } }, icon('copy', 15), t('common.copy')),
      el('button', { class: 'btn btn-small btn-primary', onclick: () => openPrintable(buildPartsHtml(parts)) }, icon('printer', 15), t('reports.print')),
    ));
  }
  wrap.append(partsCard);

  // ---- preventive maintenance ----
  const pmGroups = { overdue: [], due: [], soon: [] };
  for (const eq of equipment) {
    const pm = pmState(eq);
    if (pm.state === 'overdue') pmGroups.overdue.push({ eq, pm });
    else if (pm.state === 'due' || pm.state === 'unknown') pmGroups.due.push({ eq, pm });
    else if (pm.state === 'soon') pmGroups.soon.push({ eq, pm });
  }
  const pmTotal = pmGroups.overdue.length + pmGroups.due.length + pmGroups.soon.length;
  const scheduled = equipment.filter(e => pmState(e).scheduled);
  wrap.append(el('h3', { class: 'section-title' }, icon('shield-check', 15), t('reports.pmTitle')));
  const pmCard = el('div', { class: 'card' });
  if (!pmTotal) pmCard.append(el('p', { class: 'muted small', style: 'margin:0' }, t('reports.pmNone')));
  else {
    const rows = [...pmGroups.overdue, ...pmGroups.due, ...pmGroups.soon];
    for (const { eq, pm } of rows) {
      const cls = pm.state === 'soon' ? 'st-pending' : 'st-part';
      const label = pmLabel(pm);
      pmCard.append(el('button', { class: 'pm-line', onclick: () => location.hash = '#/equipment/' + eq.id },
        el('span', { class: 'small', style: 'font-weight:700' }, eq.name),
        el('span', { class: 'badge ' + cls }, label),
      ));
    }
  }
  if (scheduled.length) {
    pmCard.append(el('div', { class: 'report-actions' },
      el('button', { class: 'btn btn-small btn-primary', onclick: () => exportPmCalendar(scheduled) },
        icon('calendar', 15), t('reports.addToCalendar')),
    ));
  }
  wrap.append(pmCard);

  // ---- inventory ----
  wrap.append(el('h3', { class: 'section-title' }, icon('list', 15), t('reports.inventory')));
  wrap.append(el('div', { class: 'card' },
    el('p', { class: 'muted small', style: 'margin-top:0' }, tn('reports.inventoryText', c.total)),
    el('div', { class: 'report-actions' },
      el('button', { class: 'btn btn-small btn-secondary', onclick: () => downloadText(buildInventoryCsv(equipment), 'taller-inventory.csv', 'text/csv') }, icon('download', 15), 'CSV'),
      el('button', { class: 'btn btn-small btn-secondary', onclick: () => printLabels(equipment) }, icon('qr-code', 15), t('qr.printAll')),
      el('button', { class: 'btn btn-small btn-primary', onclick: () => openPrintable(buildStatusHtml(equipment, c)) }, icon('printer', 15), t('reports.statusReport')),
    ),
  ));
}

// iCalendar with a recurring all-day PM reminder per scheduled machine.
function buildIcs(scheduled) {
  const pad = (n) => String(n).padStart(2, '0');
  const dt = (iso) => String(iso).replace(/-/g, '');
  const now = new Date();
  // DTSTAMP is REQUIRED on every VEVENT; without it strict calendars (and some
  // phone importers) reject the whole file rather than the one bad event.
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Taller//PM//EN', 'CALSCALE:GREGORIAN'];
  let seq = 0;
  for (const eq of scheduled) {
    const pm = pmState(eq);
    // A machine with no service history has no COMPUTED next date, but it is
    // exactly the one that needs a reminder. Anchor its first PM to today
    // instead of dropping it: skipping these made the whole export empty for
    // every machine registered through the express form, which leaves it
    // empty for essentially every new user.
    const anchorIso = pm.nextIso || (pm.state === 'unknown' ? todayISO() : null);
    if (!anchorIso) continue;
    // A corrupt anchor date from a restored backup turns into "NaNNaNNaN" here;
    // shipping that produces a calendar file the technician's phone refuses.
    const day = dt(anchorIso);
    if (!/^\d{8}$/.test(day)) continue;
    seq++;
    // The id goes into the file verbatim: a CR/LF (or any control character) in
    // a restored id closes the UID line and lets the backup inject arbitrary
    // calendar properties. Keep only id-safe characters, and fall back to a
    // sequence number so two machines can never end up sharing a UID.
    const safeId = String(eq.id == null ? '' : eq.id).replace(/[^A-Za-z0-9._-]/g, '');
    const uid = 'taller-' + (safeId || 'n' + seq) + '@local';
    // Same injection risk on INTERVAL, which additionally accepts only a
    // positive integer — a string/0/negative silently voids the recurrence.
    const interval = Math.min(3650, Math.max(1, Math.round(Number(eq.pmDays)) || 180));
    lines.push('BEGIN:VEVENT', 'UID:' + icsEsc(uid), 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + day,
      'RRULE:FREQ=DAILY;INTERVAL=' + interval,
      'SUMMARY:' + icsEsc(t('reports.pmEventTitle', { name: eq.name })),
      'DESCRIPTION:' + icsEsc(typeName(eq.type) + (eq.location ? ' — ' + eq.location : '')),
      'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(t('reports.pmEventTitle', { name: eq.name })), 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // Every content line ends CRLF, including the last one.
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
// A bare CR was left untouched before, so a name carrying one still ended the
// content line early — the same injection the escaping exists to stop.
function icsEsc(s) { return String(s == null ? '' : s).replace(/([,;\\])/g, '\\$1').replace(/\r\n|[\r\n]/g, '\\n'); }
// Content lines are capped at 75 octets; a long machine name (or a location in
// an accented language) overruns that and gets truncated or rejected. Fold on
// octet boundaries — never inside a multi-byte character — with the CRLF+space
// continuation, whose leading space counts against the limit.
function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// Printable per-machine service record (specs + PM + parts + full history).
export function printEquipmentRecord(eq, logs) {
  const pm = pmState(eq);
  const pmTxt = !pm.scheduled ? '—' : (t('pm.everyDays', { n: eq.pmDays }) + ' · ' + (pm.nextIso ? t('pm.nextOn', { d: fmtDate(pm.nextIso) }) : ''));
  const spec = (k, v) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v || '—')}</td></tr>`;
  const partsTxt = (eq.parts || []).map(p => (typeof p === 'string' ? p : `${p.qty || 1}× ${p.name}`)).join(', ') || '—';
  let hist = '';
  for (const l of logs) hist += `<tr><td>${escapeHtml(l.date)}</td><td>${escapeHtml(t('logbook.type' + (l.type === 'pm' ? 'PM' : l.type === 'inspection' ? 'Inspection' : 'Repair')))}</td><td>${escapeHtml(l.problem || '')}</td><td>${escapeHtml(l.minutes ? l.minutes + ' min' : '')}</td></tr>`;
  const html = reportHead(eq.name) +
    `<h1>${escapeHtml(eq.name)}</h1><p class="sub">${escapeHtml(typeName(eq.type))} · ${escapeHtml(statusName(eq.status))}</p>
<table>${spec(t('equipment.manufacturer'), eq.manufacturer)}${spec(t('equipment.model'), eq.model)}${spec(t('equipment.serial'), eq.serial)}${spec(t('equipment.assetTag'), eq.assetTag)}${spec(t('equipment.location'), eq.location)}${spec(t('equipment.power'), eq.power)}${spec(t('equipment.riskLabel'), riskName(typeMeta(eq.type).risk))}${spec(t('pm.title'), pmTxt)}${spec(t('equipment.partsNeeded'), partsTxt)}</table>
<h2>${escapeHtml(t('equipment.history'))}</h2>
<table><thead><tr><th>${escapeHtml(t('equipment.acquired').split(' ')[0])}</th><th>${escapeHtml(t('logbook.type'))}</th><th>${escapeHtml(t('logbook.problem'))}</th><th></th></tr></thead><tbody>${hist || '<tr><td colspan=4>—</td></tr>'}</tbody></table>` +
    reportFoot();
  openPrintable(html);
}

function tile(ico, value, label) {
  return el('div', { class: 'stat-tile tile-neutral' }, el('div', { class: 'stat-ico' }, icon(ico, 18)),
    el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label' }, label));
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

// ---------- exports ----------
// Quoting alone does not stop a spreadsheet from EXECUTING a cell that starts
// with = + - @ tab or CR: these files are made to be handed to management, so a
// part name typed as "=cmd|..." would run on the administrator's machine. Prefix
// those with an apostrophe, which the spreadsheet strips on display; plain
// numbers are left alone so a quantity column still reads as a number.
function csvEsc(s) {
  let v = String(s == null ? '' : s);
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}

// A quantity restored from a backup file can be any string. This value is
// interpolated into printable HTML that openPrintable() serves from a blob: URL,
// and blob: URLs INHERIT the app's origin — unescaped, it would run script with
// full access to the local database. Coerce to a sane count, then escape.
function qtyNum(q) {
  const n = Math.round(Number(q));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function buildInventoryCsv(equipment) {
  const header = [t('equipment.name'), t('equipment.type'), t('equipment.manufacturer'), t('equipment.model'),
    t('equipment.serial'), t('equipment.assetTag'), t('equipment.location'), t('equipment.statusLabel'),
    t('equipment.riskLabel'), t('pm.title'), t('pm.lastDone'), t('equipment.partsNeeded')];
  const rows = [header.map(csvEsc).join(',')];
  for (const e of equipment) {
    rows.push([e.name, typeName(e.type), e.manufacturer, e.model, e.serial, e.assetTag, e.location, statusName(e.status), riskName(typeMeta(e.type).risk), e.pmDays || '', e.lastPmDate || '', partsStr(e)].map(csvEsc).join(','));
  }
  return '﻿' + rows.join('\n');
}

function buildPartsCsv(parts) {
  const rows = [[t('equipment.name'), t('equipment.location'), t('equipment.qty'), t('reports.part')].map(csvEsc).join(',')];
  for (const p of parts) rows.push([p.equipmentName, p.location, p.qty || 1, p.part].map(csvEsc).join(','));
  return '﻿' + rows.join('\n');
}

function buildPartsText(parts) {
  const lines = [t('reports.partsRequest').toUpperCase(), ''];
  const g = groupBy(parts, p => p.equipmentName);
  for (const [name, items] of g) {
    lines.push(`• ${name}${items[0].location ? ' (' + items[0].location + ')' : ''}:`);
    for (const p of items) lines.push(`   - ${(p.qty || 1)}× ${p.part}`);
  }
  return lines.join('\n');
}

function reportHead(title) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0c1c2c;max-width:800px;margin:24px auto;padding:0 18px}
h1{font-size:22px;margin:0 0 2px;color:#0e7c72}.sub{color:#5d6c7b;margin:0 0 18px;font-size:13px}
table{width:100%;border-collapse:collapse;margin:10px 0 22px}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e0e8ee;font-size:13px}
th{background:#0e7c72;color:#fff}tr:nth-child(even) td{background:#f4f7f9}
h2{font-size:15px;margin:20px 0 6px;border-left:4px solid #0e7c72;padding-left:8px}
.tiles{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.t{flex:1;min-width:120px;border:1px solid #e0e8ee;border-radius:10px;padding:12px}
.t b{font-size:24px;display:block;color:#0e7c72}.t span{font-size:12px;color:#5d6c7b}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
.b-ok{background:#ddf3e6;color:#178a50}.b-warn{background:#fff3cd;color:#6b4d00}.b-bad{background:#fde7e7;color:#d93636}
@media print{body{margin:0}.noprint{display:none}}
.foot{margin-top:24px;color:#98a7b6;font-size:11px;border-top:1px solid #e0e8ee;padding-top:8px}
button{font:inherit;padding:8px 14px;border:0;border-radius:8px;background:#0e7c72;color:#fff;font-weight:700;cursor:pointer}
</style></head><body>`;
}
function reportFoot() {
  const d = new Date().toLocaleDateString(document.documentElement.lang || 'en', { year: 'numeric', month: 'long', day: 'numeric' });
  return `<p class="foot">${escapeHtml(t('reports.generated', { d }))} · Taller</p>
<p class="noprint"><button onclick="window.print()">${escapeHtml(t('reports.print'))}</button></p></body></html>`;
}

function buildStatusHtml(equipment, c) {
  const statusBadge = (s) => {
    const cls = s === 'working' ? 'b-ok' : s === 'retired' ? '' : s === 'awaiting_parts' ? 'b-warn' : 'b-bad';
    return `<span class="badge ${cls}">${escapeHtml(statusName(s))}</span>`;
  };
  let rows = '';
  for (const e of equipment) {
    const pm = pmState(e);
    const pmCls = pm.state === 'overdue' ? 'b-bad' : (pm.state === 'due' || pm.state === 'unknown' || pm.state === 'soon') ? 'b-warn' : '';
    const pmTxt = !pm.scheduled ? '—'
      : pmCls ? `<span class="badge ${pmCls}">${escapeHtml(pmLabel(pm))}</span>`
      : escapeHtml(fmtDate(pm.nextIso));
    rows += `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(typeName(e.type))}</td><td>${escapeHtml(e.location || '—')}</td><td>${escapeHtml(e.serial || '—')}</td><td>${statusBadge(e.status)}</td><td>${pmTxt}</td><td>${escapeHtml(partsStr(e) || '—')}</td></tr>`;
  }
  return reportHead(t('reports.statusReport')) +
    `<h1>${escapeHtml(t('reports.statusReport'))}</h1><p class="sub">${escapeHtml(t('reports.fleetSummary'))}</p>
<div class="tiles"><div class="t"><b>${c.total}</b><span>${escapeHtml(t('reports.total'))}</span></div><div class="t"><b>${c.uptime}%</b><span>${escapeHtml(t('home.tileUptime'))}</span></div><div class="t"><b>${c.outOfService}</b><span>${escapeHtml(t('reports.outOfService'))}</span></div><div class="t"><b>${c.pmDue}</b><span>${escapeHtml(t('home.tilePmDue'))}</span></div></div>
<h2>${escapeHtml(t('reports.inventory'))}</h2>
<table><thead><tr><th>${escapeHtml(t('equipment.name'))}</th><th>${escapeHtml(t('equipment.type'))}</th><th>${escapeHtml(t('equipment.location'))}</th><th>${escapeHtml(t('equipment.serial'))}</th><th>${escapeHtml(t('equipment.statusLabel'))}</th><th>${escapeHtml(t('pm.title'))}</th><th>${escapeHtml(t('equipment.partsNeeded'))}</th></tr></thead><tbody>${rows}</tbody></table>` +
    reportFoot();
}

function buildPartsHtml(parts) {
  const g = groupBy(parts, p => p.equipmentName);
  let rows = '';
  for (const [name, items] of g) {
    for (const p of items) rows += `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(p.location || '—')}</td><td style="text-align:center">${escapeHtml(qtyNum(p.qty))}</td><td>${escapeHtml(p.part)}</td></tr>`;
  }
  return reportHead(t('reports.partsRequest')) +
    `<h1>${escapeHtml(t('reports.partsRequest'))}</h1><p class="sub">${escapeHtml(t('reports.partsSub'))}</p>
<table><thead><tr><th>${escapeHtml(t('equipment.name'))}</th><th>${escapeHtml(t('equipment.location'))}</th><th>${escapeHtml(t('equipment.qty'))}</th><th>${escapeHtml(t('reports.part'))}</th></tr></thead><tbody>${rows}</tbody></table>` +
    reportFoot();
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  toast(t('reports.downloaded'));
}

function openPrintable(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { // popup blocked (common on mobile) → download instead
    const a = el('a', { href: url, download: 'taller-report.html', style: 'display:none' });
    document.body.append(a); a.click(); a.remove();
    toast(t('reports.downloaded'));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
