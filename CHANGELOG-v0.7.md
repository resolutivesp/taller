# Taller v0.7 — "que entre por los ojos"

A visual and usability release. Same data, same offline engine, same privacy
rules; everything a technician sees and touches was redesigned, and one bug
that was live in production is fixed.

## Fixed (was live in v0.6.1)
- **Tapping the Equipment tab hid the app bar and the tab bar** and froze the
  list in an unscrollable, overflowing column. `classList.toggle(token,
  undefined)` is a plain toggle, so the list route flipped "reader mode" on.
  Pinned by a regression test.

## New look
- New design tokens: calmer surfaces, larger radii, soft shadows, a seamless
  brand header, stronger type scale, consistent status colours
  (working / out of service / awaiting parts / retired) everywhere.
- **Onboarding**: illustration, "Your workshop in your pocket", three benefits,
  compact language picker; the demo is still the first, always-visible action.
- **Home**: health ring (% of the live fleet working), one tappable pill per
  problem (out of service, awaiting parts, PM due, parts to order) that opens
  exactly that list, attention cards with a severity bar, round quick actions,
  recent activity in one card.
- **Demo guide** on Home: what to try next, and **Remove demo** (also in More)
  which deletes only the demo machine, its records and the demo manual.
- **Equipment**: filter chips with counts (empty filters hidden), cards with a
  status dot and pills only for what needs attention, scan button next to search.
- **Machine record**: photo header with an overlapping card, all four statuses
  visible at once (no sideways scrolling), round action buttons, a progress bar
  for preventive maintenance, model codes like "SP-100" never split across lines.
- **Ask**: one composer (question + scope + button), the question echoed above
  its answer, the view scrolls to the answer, **inline page citations are
  tappable** and open the exact page, cited pages highlighted in the sources.
  A page number shared by two manuals is only linked when the manual is named
  next to it — never to an arbitrary manual.
- **Manuals**: title with count, Add PDF / Find online side by side, PDF-style
  cards with an overflow menu (open, rename, OCR, delete).
- Bottom sheets: fixed title and actions, only the body scrolls, drag the
  handle down to dismiss. Snackbar-style notifications with a check for
  confirmations, never covering the reader toolbar.
- Illustrated empty states (no text inside the art, so they work in all four
  languages), More page brand card, refreshed desktop landing.
- Link previews: 1200×630 social card (`docs/img/og-card.jpg`) with absolute
  `og:image` for WhatsApp / LinkedIn / Facebook; new README / install screenshots.

## Accessibility kept (and checked)
Text ≥ 4.5:1 on every surface including the brand header (no translucent text),
control boundaries 3.3:1 for sunlight readability, every control ≥ 44 px,
white focus rings on brand surfaces, no blur effects (they stutter on cheap
GPUs), reduced-motion respected, full EN/FR/ES/PT parity (463 keys each).

## Tests
`tests/ui.js` 42 ✓ · `tests/e2e.js` 68 ✓ · `tests/regressions.js` 11 ✓ (three new:
Equipment tab keeps both bars, citation resolution, Remove demo keeps real data).
Service-worker cache key bumped to `taller-v0.7.0`.
