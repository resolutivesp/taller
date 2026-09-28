// Taller — small inline illustrations for first-run and empty screens.
// Pure vector, no text inside (they work in every language), themed through
// CSS custom properties (--art-*) so light and dark mode both look right.
// Each one is ~1 KB: nothing to download, nothing to cache separately.

import { ICONS } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox, inner, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', 'art' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = inner;
  return s;
}

const blob = '<ellipse cx="110" cy="88" rx="94" ry="66" fill="var(--art-bg)"/>';
const spark = (x, y, r, fill, op = 1) =>
  `<path d="M${x} ${y - r}l${r * 0.32} ${r * 0.68} ${r * 0.68} ${r * 0.32}-${r * 0.68} ${r * 0.32}-${r * 0.32} ${r * 0.68}-${r * 0.32}-${r * 0.68}-${r * 0.68}-${r * 0.32} ${r * 0.68}-${r * 0.32}z" fill="${fill}" opacity="${op}"/>`;
const bar = (x, y, w, h, fill, op = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''}/>`;
const shadowed = (shape) => shape.replace('/>', ' fill="var(--art-shadow)" transform="translate(3 5)"/>') + shape.replace('/>', ' fill="var(--art-paper)"/>');
const wrench = (x, y, s, stroke) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS.wrench}</g>`;

// A phone showing the dashboard, a manual page with a highlighted line and a
// page pill, a wrench and a check: "your workshop in your pocket".
function workshop(onBrand) {
  const bg = onBrand
    ? '<circle cx="160" cy="112" r="100" fill="#fff" opacity=".07"/><circle cx="160" cy="112" r="68" fill="#fff" opacity=".07"/>'
    : '<ellipse cx="160" cy="116" rx="140" ry="92" fill="var(--art-bg)"/>';
  const row = (y, dot, w1, w2) =>
    `<rect x="117" y="${y}" width="86" height="22" rx="7" fill="var(--art-paper)"/>` +
    `<circle cx="127" cy="${y + 11}" r="4" fill="${dot}"/>` +
    bar(136, y + 6, w1, 4.5, 'var(--art-ink)', 0.8) + bar(136, y + 14, w2, 3.5, 'var(--art-line-2)');
  return svg('0 0 320 212',
    bg +
    // manual page, tilted, behind the phone
    '<g transform="rotate(9 238 112)">' +
      shadowed('<rect x="192" y="44" width="92" height="120" rx="10"/>') +
      bar(204, 58, 44, 7, 'var(--art-ink)', 0.85) +
      bar(204, 74, 68, 4, 'var(--art-line-2)') + bar(204, 84, 60, 4, 'var(--art-line-2)') +
      '<rect x="201" y="92" width="72" height="11" rx="3" fill="var(--art-amber)" opacity=".55"/>' +
      bar(204, 95.5, 64, 4, 'var(--art-ink)', 0.7) +
      bar(204, 110, 66, 4, 'var(--art-line-2)') + bar(204, 120, 52, 4, 'var(--art-line-2)') +
      '<rect x="244" y="140" width="30" height="14" rx="7" fill="var(--art-main)"/>' + bar(251, 145, 16, 4, '#fff') +
    '</g>' +
    // phone
    shadowed('<rect x="104" y="18" width="112" height="186" rx="20"/>') +
    '<rect x="111" y="25" width="98" height="172" rx="14" fill="var(--art-screen)"/>' +
    '<path d="M111 39a14 14 0 0 1 14-14h70a14 14 0 0 1 14 14v7h-98z" fill="var(--art-main)"/>' +
    bar(119, 32, 30, 6, '#fff', 0.9) +
    '<circle cx="134" cy="71" r="14" fill="none" stroke="var(--art-line)" stroke-width="5"/>' +
    '<circle cx="134" cy="71" r="14" fill="none" stroke="var(--art-main)" stroke-width="5" stroke-linecap="round" stroke-dasharray="66 88" transform="rotate(-90 134 71)"/>' +
    bar(156, 63, 42, 6, 'var(--art-ink)', 0.85) + bar(156, 74, 28, 4, 'var(--art-line-2)') +
    row(96, 'var(--art-red)', 46, 30) + row(123, 'var(--art-amber)', 52, 26) + row(150, 'var(--art-green)', 40, 34) +
    // wrench badge
    '<circle cx="94" cy="160" r="24" fill="var(--art-shadow)" transform="translate(2 4)"/>' +
    '<circle cx="94" cy="160" r="24" fill="var(--art-amber)"/>' + wrench(82, 148, 1, '#3A2400') +
    // check badge
    '<circle cx="214" cy="30" r="15" fill="var(--art-green)"/>' +
    '<path d="m207 30 5 5 9-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    spark(70, 62, 9, onBrand ? '#fff' : 'var(--art-main-2)', 0.85) +
    spark(262, 190, 6, onBrand ? '#fff' : 'var(--art-amber)', 0.75),
    'art-workshop' + (onBrand ? ' art-onbrand' : ''));
}

function equipment() {
  return svg('0 0 220 160',
    blob +
    '<rect x="102" y="116" width="16" height="14" fill="var(--art-line-2)"/>' +
    '<rect x="78" y="128" width="64" height="9" rx="4.5" fill="var(--art-line-2)"/>' +
    shadowed('<rect x="50" y="40" width="120" height="80" rx="13"/>') +
    '<rect x="58" y="48" width="80" height="64" rx="8" fill="#0E2233"/>' +
    '<polyline points="63,86 77,86 83,73 91,100 99,63 107,92 113,86 133,86" fill="none" stroke="#3EE0C4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    bar(63, 54, 22, 4, '#3EE0C4', 0.55) +
    '<circle cx="154" cy="60" r="6" fill="var(--art-main)"/>' +
    '<circle cx="154" cy="78" r="4.5" fill="var(--art-line-2)"/><circle cx="154" cy="93" r="4.5" fill="var(--art-line-2)"/>' +
    '<circle cx="172" cy="40" r="17" fill="var(--art-amber)"/>' +
    '<path d="M172 32v16M164 40h16" stroke="#3A2400" stroke-width="3.2" stroke-linecap="round"/>' +
    spark(40, 48, 8, 'var(--art-main-2)', 0.7));
}

function manuals() {
  return svg('0 0 220 160',
    blob +
    '<rect x="68" y="32" width="76" height="98" rx="10" fill="var(--art-line)" transform="rotate(-9 106 81)"/>' +
    shadowed('<rect x="80" y="30" width="80" height="102" rx="10"/>') +
    bar(92, 44, 40, 7, 'var(--art-main)') +
    bar(92, 60, 54, 4, 'var(--art-line-2)') + bar(92, 70, 48, 4, 'var(--art-line-2)') +
    bar(92, 80, 54, 4, 'var(--art-line-2)') + bar(92, 90, 36, 4, 'var(--art-line-2)') +
    '<line x1="160" y1="113" x2="177" y2="130" stroke="var(--art-deep)" stroke-width="10" stroke-linecap="round"/>' +
    '<circle cx="146" cy="99" r="22" fill="var(--art-paper)" fill-opacity=".88" stroke="var(--art-main)" stroke-width="7"/>' +
    '<rect x="134" y="95" width="24" height="8" rx="3" fill="var(--art-amber)" opacity=".8"/>' +
    spark(52, 50, 8, 'var(--art-amber)', 0.8));
}

function ask() {
  return svg('0 0 220 160',
    blob +
    shadowed('<rect x="104" y="54" width="72" height="88" rx="9"/>') +
    bar(114, 66, 34, 6, 'var(--art-ink)', 0.8) + bar(114, 80, 48, 4, 'var(--art-line-2)') +
    '<rect x="111" y="88" width="58" height="10" rx="3" fill="var(--art-amber)" opacity=".5"/>' +
    bar(114, 91, 46, 4, 'var(--art-ink)', 0.7) + bar(114, 104, 40, 4, 'var(--art-line-2)') +
    '<rect x="142" y="122" width="26" height="12" rx="6" fill="var(--art-main)"/>' + bar(148, 126, 14, 4, '#fff') +
    '<path d="M44 32h72a14 14 0 0 1 14 14v26a14 14 0 0 1-14 14H74l-16 13V86H44a14 14 0 0 1-14-14V46a14 14 0 0 1 14-14z" fill="var(--art-main)"/>' +
    '<circle cx="62" cy="59" r="5" fill="#fff"/><circle cx="80" cy="59" r="5" fill="#fff" opacity=".8"/><circle cx="98" cy="59" r="5" fill="#fff" opacity=".6"/>' +
    spark(186, 38, 9, 'var(--art-amber)'));
}

function history() {
  const item = (y, color, w) =>
    `<circle cx="88" cy="${y}" r="7" fill="${color}"/>` +
    `<path d="m84.5 ${y}l2.5 2.5 4.5-4.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    bar(102, y - 3, w, 5, 'var(--art-ink)', 0.75) + bar(102, y + 5, w - 14, 3.5, 'var(--art-line-2)');
  return svg('0 0 220 160',
    blob +
    shadowed('<rect x="68" y="30" width="86" height="110" rx="12"/>') +
    '<rect x="92" y="22" width="38" height="16" rx="6" fill="var(--art-main)"/>' +
    item(62, 'var(--art-green)', 40) + item(88, 'var(--art-green)', 34) + item(114, 'var(--art-amber)', 38) +
    '<circle cx="160" cy="122" r="19" fill="var(--art-amber)"/>' + wrench(149, 111, 0.92, '#3A2400') +
    spark(50, 46, 8, 'var(--art-main-2)', 0.7));
}

const ART = { workshop: () => workshop(false), 'workshop-brand': () => workshop(true), equipment, manuals, ask, history };

export function art(name) {
  const f = ART[name];
  return f ? f() : svg('0 0 10 10', '');
}
