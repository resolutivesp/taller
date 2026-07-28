// Taller — shared domain model: dates, equipment/PM/risk helpers, aggregates.
// Kept dependency-light (only strings/icons) so equipment, home and reports share it.

import { t, tn } from './ui.js';
import { EQUIPMENT_TYPES, PM_SOON_DAYS } from './config.js';

// ---------- dates ----------
export function todayDate() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function toISO(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromISO(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(iso, n) { const d = fromISO(iso) || todayDate(); d.setDate(d.getDate() + n); return toISO(d); }
export function daysUntil(iso) {
  if (!iso) return null;
  const d = fromISO(iso); d.setHours(0, 0, 0, 0);
  return Math.round((d - todayDate()) / 86400000);
}
export function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = fromISO(iso);
    return d.toLocaleDateString(document.documentElement.lang || 'en', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return iso; }
}
// "in 3 days" / "5 days ago" / "today"
export function relDays(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return t('time.today');
  if (days > 0) return t('time.inDays', { n: days });
  return t('time.daysAgo', { n: -days });
}

// ---------- equipment type / risk / status meta ----------
export function typeMeta(key) {
  return EQUIPMENT_TYPES.find(x => x.key === key) || EQUIPMENT_TYPES.find(x => x.key === 'other');
}
export function typeName(key) { return t('equipment.types.' + (key || 'other')); }

export const STATUS_META = {
  working: { icon: 'circle-check', cls: 'st-fixed', color: 'var(--ok)' },
  down: { icon: 'circle-alert', cls: 'st-part', color: 'var(--danger)' },
  awaiting_parts: { icon: 'clock', cls: 'st-pending', color: 'var(--warn-ink)' },
  retired: { icon: 'x', cls: 'st-retired', color: 'var(--muted)' },
};
export function statusName(s) { return t('equipment.status.' + s); }

export const RISK_META = {
  high: { cls: 'risk-high' }, medium: { cls: 'risk-medium' }, low: { cls: 'risk-low' },
};
export function riskName(r) { return t('equipment.risk.' + r); }

// ---------- preventive maintenance ----------
// Returns { scheduled, nextIso, days, state } where state ∈ overdue|due|soon|ok|none|unknown
export function pmState(eq) {
  // retired machines are never "due" — don't nag the tech to service dead kit
  if (eq.status === 'retired') return { scheduled: false, state: 'none', nextIso: null, days: null };
  const days = eq.pmDays || 0;
  if (!days) return { scheduled: false, state: 'none', nextIso: null, days: null };
  const anchor = eq.lastPmDate || eq.acquiredDate || null;
  // No anchor = we have never recorded a service for this machine. Say exactly
  // that instead of claiming it is "due today", which reads like a computed
  // schedule the tech can trust. It still needs attention, so it still counts.
  if (!anchor) return { scheduled: true, state: 'unknown', nextIso: null, days: null };
  const nextIso = addDays(anchor, days);
  const d = daysUntil(nextIso);
  let state = 'ok';
  if (d < 0) state = 'overdue';
  else if (d === 0) state = 'due';
  else if (d <= PM_SOON_DAYS) state = 'soon';
  return { scheduled: true, state, nextIso, days: d };
}

// Does this PM state demand action now? ('unknown' = never recorded — it does.)
export function pmNeedsAction(state) {
  return state === 'overdue' || state === 'due' || state === 'unknown';
}

// Single source of truth for how a PM state is worded, so the dashboard, the
// equipment card, the detail view and every report always agree.
export function pmLabel(pm) {
  if (!pm || !pm.scheduled) return '—';
  if (pm.state === 'unknown') return t('pm.unknown');
  if (pm.state === 'overdue') return tn('pm.overdueBy', -pm.days, { n: -pm.days });
  if (pm.state === 'due') return t('pm.dueToday');
  if (pm.state === 'soon') return tn('pm.dueIn', pm.days, { n: pm.days });
  return fmtDate(pm.nextIso);
}

// ---------- downtime ----------
// Days a machine has been out of service (down / awaiting parts), or null.
export function downDays(eq) {
  if (eq.status !== 'down' && eq.status !== 'awaiting_parts') return null;
  if (!eq.statusSince) return null;
  const d = daysUntil(eq.statusSince); // <=0 in the past
  return d < 0 ? -d : 0;
}

// ---------- parts (with quantities; migrates legacy string entries) ----------
export function normalizeParts(eq) {
  return (eq.parts || [])
    .map(p => (typeof p === 'string' ? { name: p, qty: 1 } : { name: p.name, qty: p.qty || 1 }))
    .filter(p => p.name && String(p.name).trim());
}

// ---------- aggregates ----------
export function counts(equipment) {
  const c = { total: equipment.length, working: 0, down: 0, awaiting_parts: 0, retired: 0, pmDue: 0, pmSoon: 0, parts: 0, maxDown: 0 };
  for (const eq of equipment) {
    if (c[eq.status] !== undefined) c[eq.status]++;
    const pm = pmState(eq);
    if (pmNeedsAction(pm.state)) c.pmDue++;
    else if (pm.state === 'soon') c.pmSoon++;
    c.parts += normalizeParts(eq).length;
    const dd = downDays(eq);
    if (dd && dd > c.maxDown) c.maxDown = dd;
  }
  c.operational = c.working;
  c.outOfService = c.down + c.awaiting_parts;
  // uptime is over the LIVE fleet (retired units don't count against you)
  const live = c.total - c.retired;
  c.uptime = live ? Math.round((c.working / live) * 100) : null;
  return c;
}

// Parts procurement list: [{equipmentId, equipmentName, location, part, qty}]
export function partsList(equipment) {
  const out = [];
  for (const eq of equipment) {
    for (const p of normalizeParts(eq)) {
      out.push({ equipmentId: eq.id, equipmentName: eq.name, location: eq.location || '', part: p.name.trim(), qty: p.qty || 1 });
    }
  }
  return out;
}

// Equipment needing attention, most urgent first (for Home alerts).
export function attention(equipment) {
  const scored = equipment.map(eq => {
    const pm = pmState(eq);
    let score = 0;
    if (eq.status === 'down') score += 100;
    if (eq.status === 'awaiting_parts') score += 80;
    if (pm.state === 'overdue') score += 60 + Math.min(30, -pm.days);
    else if (pm.state === 'due') score += 50;
    else if (pm.state === 'unknown') score += 30; // needs a first service record
    else if (pm.state === 'soon') score += 20;
    if (typeMeta(eq.type).risk === 'high') score *= 1.4;
    return { eq, pm, score };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
