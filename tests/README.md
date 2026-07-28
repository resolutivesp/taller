# Taller — test harness

The v0.5.1 suite lived only in a build container and was never committed, so it
was lost. This is a rebuilt one. Keep it in the repo.

## Run

```bash
npm i -D playwright          # once
node tests/serve.js . 8099   # static server, in one terminal
node tests/e2e.js            # 68 functional checks
node tests/ui.js             # 42 UI / contrast / touch-target checks (writes screenshots)
node tests/regressions.js    # 8 checks pinning previously-fixed regressions
```

`tests/ui.js` and `tests/e2e.js` expect a Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; change `executablePath`
(or drop it to use Playwright's own download) for your machine.

## What is covered

- boot + all five tabs in EN/FR/ES/PT, light and dark, with zero console errors
- the demo flow end to end in all four languages, incl. that every localized
  search suggestion actually returns a hit in the localized demo PDF
- a real A4-at-300dpi scanned page renders instead of being silently dropped
- backup honesty, restore merge/dedup/older-file/hostile-file behaviour
- injection surfaces (report HTML, CSV formulas, .ics, prompt fencing)
- PM state for a machine with no service history
- cold offline start with the network cut, and that pdf.js loads offline
- onboarding is actionable without scrolling on a 360×640 screen
- assistant confidence classification (real fault vs. unrelated vs. nonsense)
- re-indexing the same pages (the OCR duplicate-id crash)
- WCAG contrast computed from real rendered styles, gradients included
- every visible control ≥44px
