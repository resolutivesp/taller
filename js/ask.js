// Taller — "Ask your manuals": grounded assistant.
// Offline: exact excerpts (extractive, always). Online (optional): AI answer via
// the project's worker — grounded ONLY in the retrieved excerpts, citing pages.

import { CONFIG, DEMO_SUGGESTIONS } from './config.js';
import { db } from './db.js';
import { el, clear, t, toast, copyText, escapeHtml, highlight, isOnline } from './ui.js';
import { icon } from './icons.js';
import { retrieveExcerpts, makeSnippet } from './search.js';
import { navigate } from './main.js';

let last = null; // { question, manualId, excerpts, terms, answer, mode }

export function aiEndpoint() {
  const o = localStorage.getItem('taller-ai-endpoint');
  return (o !== null ? o : CONFIG.aiEndpoint || '').trim();
}

export async function renderAsk(container, params = {}) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  container.append(wrap);

  const manuals = await db.listManuals();
  const preManual = (params.manual && manuals.some(m => m.id === params.manual)) ? params.manual : null;
  if (preManual) last = null; // fresh ask scoped to this equipment's manual

  wrap.append(
    el('h2', { class: 'view-title' }, t('ask.title')),
    el('p', { class: 'muted small' }, t('ask.hint')),
  );

  if (!manuals.length) {
    wrap.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-art' }, icon('message-circle-question', 64)),
        el('p', { class: 'muted' }, t('ask.needManuals')),
        el('button', { class: 'btn btn-primary', onclick: () => navigate('#/library') }, icon('plus', 18), t('ask.goAdd')),
      ),
    );
    return;
  }

  const select = el('select', { class: 'select' },
    el('option', { value: '' }, t('ask.allManuals')),
    ...manuals.map(m => el('option', { value: m.id }, m.name)),
  );
  if (preManual) select.value = preManual;
  else if (last && last.manualId) select.value = last.manualId;

  const ta = el('textarea', { class: 'ask-input', rows: 3, placeholder: t('ask.placeholder') });
  if (last) ta.value = last.question;

  const askBtn = el('button', { class: 'btn btn-primary btn-block' }, icon('sparkles', 19), t('ask.askBtn'));
  const results = el('div', { class: 'ask-results' });

  askBtn.addEventListener('click', () => doAsk());
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doAsk();
  });

  wrap.append(el('div', { class: 'ask-form' }, select, ta, askBtn));

  // guided suggestions while empty (demo manual present)
  const demoMan = manuals.find(mn => mn.demoLang);
  if (demoMan && !last) {
    const sugg = DEMO_SUGGESTIONS[demoMan.demoLang] || DEMO_SUGGESTIONS.en;
    wrap.append(
      el('h3', { class: 'section-title' }, icon('lightbulb', 15), t('ask.suggestTitle')),
      el('div', { class: 'suggest-row' },
        ...sugg.ask.map(q => el('button', {
          class: 'suggest-chip',
          onclick: () => { ta.value = q; doAsk(); },
        }, icon('message-circle-question', 14), q)),
      ),
    );
  }

  wrap.append(
    el('div', { class: 'safety-banner' }, icon('triangle-alert', 18), el('span', {}, t('ask.safety'))),
    results,
  );

  if (last) renderResults(results, last);

  async function doAsk() {
    const question = ta.value.trim();
    if (!question) { ta.focus(); return; }
    const manualId = select.value || null;

    clear(results);
    const spinner = el('div', { class: 'thinking' }, el('span', { class: 'spin' }), ' ' + t('ask.thinking'));
    results.append(spinner);
    askBtn.disabled = true;

    try {
      const { terms, excerpts } = await retrieveExcerpts(question, { manualId });
      db.counterBump('questions');

      const state = { question, manualId, excerpts, terms, answer: null, mode: 'offline' };

      const endpoint = aiEndpoint();
      if (excerpts.length && endpoint && isOnline()) {
        try {
          const answer = await callAi(endpoint, question, excerpts);
          if (answer) { state.answer = answer; state.mode = 'ai'; }
        } catch (e) {
          console.warn('AI call failed', e);
          toast(t('ask.aiError'), 3500);
        }
      }
      last = state;
      renderResults(results, state);
    } catch (e) {
      console.error(e);
      clear(results);
      results.append(el('p', { class: 'muted' }, t('common.error')));
    } finally {
      askBtn.disabled = false;
    }
  }
}

async function callAi(endpoint, question, excerpts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(endpoint.replace(/\/$/, '') + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        question: question.slice(0, 1000),
        lang: document.documentElement.lang || 'en',
        excerpts: excerpts.slice(0, 8).map(x => ({
          manual: x.manualName.slice(0, 120),
          page: x.page,
          text: x.text.slice(0, 4000),
        })),
      }),
    });
    if (!res.ok) throw new Error('AI HTTP ' + res.status);
    const data = await res.json();
    return (data && data.answer) ? String(data.answer) : null;
  } finally {
    clearTimeout(timer);
  }
}

function renderResults(results, state) {
  clear(results);
  const { question, excerpts, terms, answer } = state;

  if (!excerpts.length) {
    results.append(
      el('div', { class: 'card' },
        el('p', { style: 'margin-top:0' }, t('ask.noMatches')),
        el('p', { class: 'muted small', style: 'margin-bottom:0' }, t('ask.noMatchesTips')),
      ),
    );
    return;
  }

  if (answer) {
    results.append(
      el('div', { class: 'card answer-card' },
        el('div', { class: 'badge badge-ai' }, icon('sparkles', 13), t('ask.aiBadge')),
        el('div', { class: 'answer-text', html: mdLite(answer) }),
        el('div', { class: 'muted small' }, t('ask.sources') + ': ' +
          excerpts.map(x => `${x.manualName} p.${x.page}`).join(' · ')),
      ),
    );
  } else {
    results.append(el('div', { class: 'badge badge-off' }, icon('wifi-off', 13), t('ask.offlineBadge')));
  }

  results.append(el('h3', { class: 'section-title' }, icon('file-search', 15), t('ask.bestPages')));
  const maxScore = Math.max(...excerpts.map(x => x.score || 0), 0.001);
  for (const x of excerpts) {
    results.append(
      el('div', { class: 'result-card static' },
        el('div', { class: 'result-head' },
          el('span', { class: 'result-manual' }, icon('book-open', 14), x.manualName),
          el('span', { class: 'badge badge-page' }, t('search.page', { n: x.page })),
        ),
        el('div', { class: 'rel-meter' },
          el('div', { class: 'rel-fill', style: `width:${Math.max(14, Math.round((x.score / maxScore) * 100))}%` })),
        el('p', { class: 'result-snippet', html: highlight(makeSnippet(x.text, terms, 320), terms) }),
        el('button', {
          class: 'btn btn-small btn-secondary',
          onclick: () => navigate(`#/reader/${x.manualId}/${x.page}?q=${encodeURIComponent(question)}`),
        }, icon('book-open', 14), t('ask.openPage', { n: x.page })),
      ),
    );
  }

  results.append(
    el('button', {
      class: 'btn btn-secondary btn-block',
      onclick: async () => {
        if (await copyText(buildPrompt(question, excerpts))) toast(t('ask.promptCopied'), 3500);
      },
    }, icon('copy', 17), t('ask.copyPrompt')),
  );
}

function buildPrompt(question, excerpts) {
  const lines = [
    'You are helping a biomedical equipment technician troubleshoot a machine.',
    'Use ONLY the service-manual excerpts below. Cite the page like (Manual, p. X) for every instruction.',
    'If the excerpts do not contain the answer, say so clearly — do not invent anything.',
    'Add safety warnings where relevant (electrical, pressure, biohazard). Reply in the language of the question.',
    '',
    'QUESTION: ' + question,
    '',
    'MANUAL EXCERPTS:',
  ];
  excerpts.forEach((x, i) => {
    lines.push(`[${i + 1}] "${x.manualName}" — page ${x.page}:`, x.text, '');
  });
  return lines.join('\n');
}

// Minimal safe markdown-ish rendering for AI answers.
function mdLite(text) {
  const esc = escapeHtml(text);
  return esc
    .split(/\n{2,}/)
    .map(par => '<p>' + par
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>') + '</p>')
    .join('');
}
