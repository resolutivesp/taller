// Taller — built-in validation feedback (the 4 kill questions + scanned-manuals probe).
// Sends via email (mailto) or copy-paste. No tracking, no backend.

import { CONFIG } from './config.js';
import { db } from './db.js';
import { el, clear, t, toast, copyText, getLang, shareText } from './ui.js';
import { icon } from './icons.js';

const QS = [
  { id: 'q1', opts: ['a', 'b', 'c'], enKey: 'Manuals/pages hard to find' },
  { id: 'q2', opts: ['a', 'b', 'c'], enKey: 'Workshop internet' },
  { id: 'q3', opts: ['a', 'b', 'c'], enKey: 'ChatGPT+PDFs already enough' },
  { id: 'q4', opts: ['a', 'b', 'c'], enKey: 'Would use <1min log' },
  { id: 'q5', opts: ['a', 'b', 'c'], enKey: 'Scanned manuals share' },
];

export async function renderFeedback(container) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  const saved = (await db.kvGet('feedback')) || {};

  wrap.append(
    el('h2', { class: 'view-title row' }, icon('target', 22), t('feedback.title')),
    el('p', { class: 'muted small' }, t('feedback.intro')),
  );

  const answers = { ...saved };

  for (const q of QS) {
    wrap.append(el('p', { class: 'fb-q' }, t('feedback.' + q.id)));
    const row = el('div', { class: 'chip-row wrap' });
    for (const o of q.opts) {
      const chip = el('button', {
        class: 'chip' + (answers[q.id] === o ? ' active' : ''),
        onclick: () => {
          row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          answers[q.id] = o;
          db.kvSet('feedback', answers);
        },
      }, t(`feedback.${q.id}${o}`));
      row.append(chip);
    }
    wrap.append(row);
  }

  const comments = el('textarea', { class: 'input', rows: 3, placeholder: t('feedback.commentsPh') });
  comments.value = saved.comments || '';
  comments.addEventListener('input', () => { answers.comments = comments.value; db.kvSet('feedback', answers); });

  const country = el('input', { class: 'input', placeholder: t('feedback.countryPh') });
  country.value = saved.country || '';
  country.addEventListener('input', () => { answers.country = country.value; db.kvSet('feedback', answers); });

  const statsCheck = el('input', { type: 'checkbox', checked: saved.includeStats !== false });

  wrap.append(
    el('p', { class: 'fb-q' }, t('feedback.comments')), comments,
    el('p', { class: 'fb-q' }, t('feedback.country') + ' (' + t('common.optional') + ')'), country,
    el('label', { class: 'check-row small' }, statsCheck, ' ' + t('feedback.includeStats')),
  );

  const send = async (how) => {
    const hasAny = QS.some(q => answers[q.id]) || (answers.comments || '').trim();
    if (!hasAny) { toast(t('feedback.answerFirst')); return; }
    answers.includeStats = statsCheck.checked;
    await db.kvSet('feedback', answers);
    const body = await buildBody(answers);
    if (how === 'email') {
      const url = 'mailto:' + CONFIG.feedbackEmail +
        '?subject=' + encodeURIComponent('Taller beta feedback') +
        '&body=' + encodeURIComponent(body);
      window.location.href = url;
      toast(t('feedback.thanks'), 4000, null, 'ok');
    } else if (how === 'share') {
      const shared = await shareText(body + '\n\n→ ' + CONFIG.feedbackEmail, 'Taller beta feedback');
      if (shared) toast(t('feedback.thanks'), 4000, null, 'ok');
      else if (await copyText(body)) toast(t('feedback.thanks') + ' — ' + t('common.copied'), 4000);
    } else {
      if (await copyText(body)) toast(t('feedback.thanks') + ' — ' + t('common.copied'), 4000);
    }
  };

  const actions = el('div', { class: 'fb-actions' },
    el('button', { class: 'btn btn-primary btn-block', onclick: () => send('email') }, icon('mail', 18), t('feedback.sendEmail')),
  );
  if (navigator.share) {
    actions.append(el('button', { class: 'btn btn-accent btn-block', onclick: () => send('share') }, icon('share-2', 18), t('feedback.sendShare')));
  }
  actions.append(el('button', { class: 'btn btn-secondary btn-block', onclick: () => send('copy') }, icon('copy', 18), t('feedback.copyAll')));
  wrap.append(actions);
}

async function buildBody(answers) {
  const lines = ['TALLER BETA FEEDBACK', '===================='];
  for (const q of QS) {
    const o = answers[q.id];
    lines.push(`${q.id.toUpperCase()} (${q.enKey}): ` + (o ? `${o} — ${t(`feedback.${q.id}${o}`)}` : '-'));
  }
  if ((answers.comments || '').trim()) lines.push('', 'COMMENTS: ' + answers.comments.trim().slice(0, 800));
  if ((answers.country || '').trim()) lines.push('COUNTRY/ROLE: ' + answers.country.trim().slice(0, 120));
  if (answers.includeStats !== false) {
    const c = await db.counters();
    lines.push('', `USAGE: manuals=${c.manualsImported || 0} searches=${c.searches || 0} questions=${c.questions || 0} log=${c.logEntries || 0}`);
  }
  lines.push(`APP: v${CONFIG.version} · lang=${getLang()}`);
  return lines.join('\n');
}
