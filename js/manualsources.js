// Taller — "Find a manual" helper.
//
// The most-cited pain for a BMET is access to service information: often the
// technician simply does NOT have the PDF for the machine in front of them
// (in low-resource hospitals 50%+ of manuals are missing entirely). Taller is
// great once you HAVE the manual; this closes the gap one step earlier by
// pointing the technician at the free, public manual libraries so they can go
// get one, then import it here.
//
// Clean-room: we only LINK to independent third-party libraries — Taller hosts
// no manuals and copies nothing. Getting a NEW manual inherently needs internet;
// the dialog still opens offline and just says so, so it is never a dead end.

import { el, t, modal } from './ui.js';
import { icon } from './icons.js';

// Free, public, well-known sources. url(q) builds the destination for a text
// query. Brand names are literal; short descriptions come from the string table.
function sources() {
  return [
    {
      name: 'iFixit — Biomedical',
      desc: t('find.srcIfixit'),
      url: (q) => q
        ? 'https://www.ifixit.com/Search?query=' + encodeURIComponent(q)
        : 'https://www.ifixit.com/biomed',
    },
    {
      name: "Frank's Hospital Workshop",
      desc: t('find.srcFranks'),
      url: () => 'http://www.frankshospitalworkshop.com/',
    },
    {
      name: 'MedWrench',
      desc: t('find.srcMedwrench'),
      url: () => 'https://www.medwrench.com/equipment-list',
    },
    {
      name: t('find.srcWebName'),
      desc: t('find.srcWeb'),
      url: (q) => 'https://www.google.com/search?q=' +
        encodeURIComponent(((q || '') + ' service manual pdf').trim()),
    },
  ];
}

// Open the helper. prefill: { manufacturer, model } to seed the query from a
// specific machine's record.
export function findManual(prefill = {}) {
  const initial = [prefill.manufacturer, prefill.model].filter(Boolean).join(' ').trim();

  const input = el('input', {
    class: 'input', type: 'search', value: initial,
    placeholder: t('find.queryPlaceholder'), autocomplete: 'off',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    'aria-label': t('find.forDevice'),
  });

  const list = el('div', { class: 'source-list' });
  for (const src of sources()) {
    // real <a> so long-press / open-in-new-tab work and it is keyboard-focusable;
    // href is refreshed from the current query at click time.
    const link = el('a', {
      class: 'source-row', target: '_blank', rel: 'noopener noreferrer',
      href: src.url(initial),
      'aria-label': t('find.open', { name: src.name }),
      onclick: () => { link.href = src.url(input.value.trim()); },
    },
      el('div', { class: 'source-txt' },
        el('div', { class: 'source-name' }, src.name),
        el('div', { class: 'muted small' }, src.desc),
      ),
      icon('external-link', 18, 'source-ext'),
    );
    list.append(link);
  }

  const offlineNote = !navigator.onLine
    ? el('p', { class: 'find-offline small' }, icon('wifi-off', 15), t('find.offline'))
    : null;

  const body = el('div', {},
    el('p', { class: 'muted small', style: 'margin-top:0' }, t('find.intro')),
    el('label', { class: 'lbl' }, t('find.forDevice')),
    input,
    offlineNote,
    list,
    el('p', { class: 'muted small', style: 'margin-bottom:0' }, t('find.note')),
  );

  modal({
    title: t('find.title'),
    body,
    actions: [{ label: t('common.close'), kind: 'btn-secondary' }],
  });
}
