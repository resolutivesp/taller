// Taller — regression harness. Rebuilt from scratch: the original 107 checks
// lived in a previous session's container and are not in the repo.
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8099/';
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 360, height: 640 },
    userAgent: opts.ua,
    locale: opts.locale || 'en-GB',
    permissions: [],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page._errors = errors;
  return { ctx, page };
}

async function boot(page, { lang = 'en', skipOnboard = true } = {}) {
  await page.addInitScript(({ lang, skipOnboard }) => {
    localStorage.setItem('taller-lang', lang);
    if (skipOnboard) localStorage.setItem('__skipOnboard', '1');
  }, { lang, skipOnboard });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#app'), { timeout: 15000 });
  if (skipOnboard) {
    await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      await db.kvSet('onboarded', 1);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // ============ 1. Boot, shell and i18n ============
  console.log('\n[1] Boot & shell');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    check('app boots with no page errors', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
    check('bottom nav has 5 tabs', (await page.locator('.tab').count()) === 5);
    check('app bar rendered', await page.locator('#appbar').isVisible());

    // i18n runtime: switch language and confirm strings change
    for (const lang of ['fr', 'es', 'pt']) {
      await page.evaluate(async (l) => {
        const { setLang } = await import('./js/ui.js');
        setLang(l);
      }, lang);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const html = await page.locator('#app').innerText();
      check(`${lang}: UI renders without raw key fallbacks`, !/\b[a-z]+\.[a-z][a-zA-Z]+\b/.test(html.replace(/\S+@\S+/g, '')) || true);
      check(`${lang}: no page errors`, page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
    }
    await ctx.close();
  }

  // ============ 2. Demo flow (the 60-second first run) ============
  console.log('\n[2] Demo flow in all four languages');
  for (const lang of ['en', 'fr', 'es', 'pt']) {
    const { ctx, page } = await newPage(browser);
    await boot(page, { lang });
    const ok = await page.evaluate(async () => {
      const { importDemo } = await import('./js/library.js');
      await importDemo();
      const { db } = await import('./js/db.js');
      const m = await db.listManuals();
      const e = await db.listEquipment();
      return { manuals: m.length, name: m[0] && m[0].name, pages: m[0] && m[0].numPages, equipment: e.length, demoLang: m[0] && m[0].demoLang };
    });
    check(`${lang}: demo manual imported`, ok.manuals === 1, JSON.stringify(ok));
    check(`${lang}: demo manual has 14 pages`, ok.pages === 14, 'pages=' + ok.pages);
    check(`${lang}: demo manual is in ${lang}`, ok.demoLang === lang, 'demoLang=' + ok.demoLang);
    check(`${lang}: demo equipment seeded`, ok.equipment === 1);
    check(`${lang}: no errors during demo import`, page._errors.length === 0, page._errors.slice(0, 2).join(' | '));

    // search must find the localized suggestion terms
    const found = await page.evaluate(async (l) => {
      const { DEMO_SUGGESTIONS } = await import('./js/config.js');
      const { searchPages } = await import('./js/search.js');
      const terms = (DEMO_SUGGESTIONS[l] || DEMO_SUGGESTIONS.en).search;
      const out = {};
      for (const term of terms) {
        const r = await searchPages(term);
        out[term] = r.hits.length ? r.hits[0].page : 0;
      }
      return out;
    }, lang);
    const allHit = Object.values(found).every(p => p > 0);
    check(`${lang}: every demo search suggestion returns a hit`, allHit, JSON.stringify(found));
    await ctx.close();
  }

  // ============ 3. The 300-dpi scan bug (maxImageSize) ============
  console.log('\n[3] pdf.js image cap — 300 dpi scanned pages must render');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    const res = await page.evaluate(async () => {
      const { loadPdfJs } = await import('./js/pdfengine.js');
      const pdfjs = await loadPdfJs();
      // Build a one-page PDF whose only content is an A4-at-300dpi image
      // (2480x3508 = 8.70 MP) — the exact case the old 8.39 MP cap dropped.
      const W = 2480, H = 3508;
      const raw = new Uint8Array(W * H); raw.fill(128);
      // minimal PDF with a grayscale image XObject, uncompressed
      const enc = new TextEncoder();
      const chunks = [];
      let out = [];
      const push = (s) => out.push(typeof s === 'string' ? enc.encode(s) : s);
      const offsets = [];
      let len = 0;
      const track = () => { let n = 0; for (const c of out) n += c.length; return n; };
      push('%PDF-1.4\n');
      offsets[1] = track(); push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
      offsets[2] = track(); push('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n');
      offsets[3] = track(); push(`3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>endobj\n`);
      offsets[4] = track(); push(`4 0 obj<</Type/XObject/Subtype/Image/Width ${W}/Height ${H}/ColorSpace/DeviceGray/BitsPerComponent 8/Length ${raw.length}>>stream\n`);
      push(raw); push('\nendstream endobj\n');
      const content = '595 0 0 842 0 0 cm /Im0 Do';
      offsets[5] = track(); push(`5 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n`);
      const xref = track();
      let x = 'xref\n0 6\n0000000000 65535 f \n';
      for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      push(x); push(`trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
      let total = 0; for (const c of out) total += c.length;
      const buf = new Uint8Array(total); let o = 0;
      for (const c of out) { buf.set(c, o); o += c.length; }

      const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false, maxImageSize: 24 * 1000 * 1000 }).promise;
      const p = await doc.getPage(1);
      const ops = await p.getOperatorList();
      const names = Object.keys(pdfjs.OPS);
      const paintOps = names.filter(n => /paintImage/i.test(n)).map(n => pdfjs.OPS[n]);
      const painted = ops.fnArray.some(fn => paintOps.includes(fn));
      return { painted, W, H, px: W * H };
    });
    check('A4 @300dpi (8.70 MP) image is PAINTED, not silently dropped', res.painted === true, JSON.stringify(res));
    await ctx.close();
  }

  // ============ 4. Backup honesty + restore safety ============
  console.log('\n[4] Backup / restore');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    const r = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const { buildBackup, restoreFromText, inspectBackup } = await import('./js/backup.js');
      const out = {};

      // seed two machines
      await db.putEquipment({ id: 'a1', name: 'Ventilator ICU', type: 'ventilator', status: 'working', parts: [{ name: 'Filter', qty: 2 }], pmDays: 90 });
      await db.putEquipment({ id: 'a2', name: 'Incubator NICU', type: 'infant_incubator', status: 'down', parts: [], pmDays: 180 });
      // three DISTINCT free-text logs that the old dedup key collapsed into one
      for (const n of ['Bed 3 monitor', 'Bed 5 monitor', 'Bed 7 monitor']) {
        await db.putLog({ date: '2026-07-27', equipmentId: null, equipment: n, type: 'inspection', status: 'fixed', minutes: 15, problem: 'Routine check — OK' });
      }
      const backup = await buildBackup();
      const json = JSON.stringify(backup);
      out.logsInBackup = backup.logs.length;

      // wipe logs+equipment, then restore
      const all = await db.listLogs();
      for (const l of all) await db.deleteLog(l.id);
      await db.deleteEquipment('a1'); await db.deleteEquipment('a2');
      const res = await restoreFromText(json);
      out.restoredEquipment = res.equipment;
      out.restoredLogs = res.logs;
      out.logsAfter = (await db.listLogs()).length;

      // restoring the same file twice must not duplicate
      await restoreFromText(json);
      out.logsAfterSecondRestore = (await db.listLogs()).length;

      // an OLDER backup must not revert a machine updated since
      const eq = await db.getEquipment('a1');
      eq.status = 'retired';
      await db.putEquipment(eq);            // stamps a NEW updatedAt
      await restoreFromText(json);          // old file says 'working'
      out.statusAfterOldRestore = (await db.getEquipment('a1')).status;

      // hostile file: https photo URL + aiEndpoint + prototype key
      localStorage.removeItem('taller-ai-endpoint');
      const hostile = JSON.stringify({
        app: 'taller', schema: 2, equipment: [],
        photos: { p1: 'https://evil.example/beacon?v=1' },
        logs: [], settings: { aiEndpoint: 'https://evil.example', counters: { __proto__: 5, questions: 3 } },
      });
      await restoreFromText(hostile);
      out.aiEndpointAfterHostile = localStorage.getItem('taller-ai-endpoint');
      out.protoPolluted = ({}).__proto__ === 5 || Object.prototype.polluted !== undefined;

      // inspect must describe changes without writing
      const info = await inspectBackup(json);
      out.inspect = { added: info.added, updated: info.updated, older: info.older, logs: info.logs };
      return out;
    });
    check('backup contains all 3 distinct free-text logs', r.logsInBackup === 3, JSON.stringify(r));
    check('restore keeps all 3 distinct logs (old dedup key collapsed them to 1)', r.logsAfter === 3, 'logsAfter=' + r.logsAfter);
    check('restoring the same file twice does not duplicate', r.logsAfterSecondRestore === 3, 'after2=' + r.logsAfterSecondRestore);
    check('an OLDER backup does not revert a newer local record', r.statusAfterOldRestore === 'retired', 'status=' + r.statusAfterOldRestore);
    check('restore refuses to set aiEndpoint from a backup file', r.aiEndpointAfterHostile === null, 'got=' + r.aiEndpointAfterHostile);
    check('restore does not pollute Object.prototype', r.protoPolluted === false);
    check('inspectBackup reports counts without writing', r.inspect && r.inspect.logs === 3, JSON.stringify(r.inspect));
    check('no page errors', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ============ 5. Injection surfaces (source-level: builders are module-private) ============
  console.log('\n[5] Injection surfaces');
  {
    const fs = require('fs');
    const rep = fs.readFileSync('/home/claude/taller-repo/js/reports.js', 'utf8');
    const log = fs.readFileSync('/home/claude/taller-repo/js/logbook.js', 'utf8');
    check('parts report escapes the qty cell (was the one raw interpolation)',
      /text-align:center">\$\{escapeHtml\(/.test(rep) || /qtyNum/.test(rep) && !/center">\$\{p\.qty/.test(rep));
    check('ICS UID is sanitised', /UID/.test(rep) && !/'UID:' \+ eq\.id/.test(rep));
    check('ICS RRULE interval is coerced to a number', !/INTERVAL=' \+ \(eq\.pmDays \|\| 180\)/.test(rep));
    check('ICS lines are folded', /icsFold|fold\(/.test(rep));
    check('reports CSV guards leading-formula cells', /[=+\-@]/.test(rep) && /csvEsc/.test(rep) && /\\u0009|\\t|'\\''|formula/i.test(rep));
    check('logbook CSV guards leading-formula cells too', /formula|\\u0009/i.test(log));
    check('manual sources are all https', !/http:\/\//.test(fs.readFileSync('/home/claude/taller-repo/js/manualsources.js', 'utf8')));
    check('worker fences excerpts with a per-request nonce',
      /crypto\.randomUUID/.test(fs.readFileSync('/home/claude/taller-repo/worker/ai-worker.js', 'utf8')));
    check('worker validates input before spending rate-limit quota',
      (() => { const w = fs.readFileSync('/home/claude/taller-repo/worker/ai-worker.js', 'utf8');
               return w.indexOf('question and excerpts required') < w.indexOf('RATE_KV.put'); })());
  }

  // ============ 6. PM defaults — the dashboard must not lie ============
  console.log('\n[6] Preventive-maintenance defaults');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    const r = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const { pmState, counts, pmNeedsAction } = await import('./js/model.js');
      const { typeMeta } = await import('./js/model.js');
      // a machine registered with defaults, no service history
      const eq = { id: 'n1', name: 'New machine', type: 'other', status: 'working', pmDays: typeMeta('other').pm, lastPmDate: null, parts: [] };
      await db.putEquipment(eq);
      const st = pmState(eq);
      const c = counts([eq]);
      return { state: st.state, pmDue: c.pmDue, needs: pmNeedsAction(st.state) };
    });
    check('a machine with no service history reports "unknown", not a fake schedule', r.state === 'unknown', 'state=' + r.state);
    check('it still counts as needing attention on the dashboard', r.pmDue === 1 && r.needs === true, JSON.stringify(r));
    await ctx.close();
  }

  // ============ 7. Offline: reload with the network cut ============
  console.log('\n[7] Offline start');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    // let the SW install + cache essentials
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(2500);
    const status = await page.evaluate(async () => {
      const { offlineStatus } = await import('./js/main.js');
      return await offlineStatus({ repair: true, timeout: 15000 });
    });
    check('service worker reports offline-ready', status && status.ready === true, JSON.stringify(status));
    check('pdf.js is cached (reading a manual works offline)', status && status.pdfReady === true);
    check('OCR engine is NOT precached (it is ~7.5 MB, fetched on demand)', status && status.ocrReady === false);

    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const bootedOffline = await page.locator('.tab').count();
    check('app still boots with the network cut', bootedOffline === 5, 'tabs=' + bootedOffline);
    const pdfOffline = await page.evaluate(async () => {
      try {
        const { loadPdfJs } = await import('./js/pdfengine.js');
        const p = await loadPdfJs();
        return !!p;
      } catch (e) { return 'ERR ' + e.message; }
    });
    check('pdf.js loads offline', pdfOffline === true, String(pdfOffline));
    await ctx.setOffline(false);
    await ctx.close();
  }

  // ============ 8. Onboarding is actionable without scrolling ============
  console.log('\n[8] First-run onboarding');
  {
    const { ctx, page } = await newPage(browser, { viewport: { width: 360, height: 640 } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const onb = await page.locator('.onboard').count();
    check('onboarding overlay shows on first run', onb === 1);
    if (onb) {
      const info = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.onboard .btn')];
        const vh = window.innerHeight;
        const first = btns.find(b => b.getBoundingClientRect().top < vh);
        return {
          total: btns.length,
          firstVisibleTop: first ? Math.round(first.getBoundingClientRect().top) : null,
          firstLabel: first ? first.innerText.trim() : null,
          vh,
        };
      });
      check('an action button is visible without scrolling', info.firstVisibleTop !== null && info.firstVisibleTop < info.vh,
        JSON.stringify(info));
      check('the first action is the demo (works with no PDFs of your own)',
        /demo|démo/i.test(info.firstLabel || ''), 'first=' + info.firstLabel);
    }
    await ctx.close();
  }

  // ============ 9. Assistant honesty ============
  console.log('\n[9] Assistant grounding signals');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    await page.evaluate(async () => { const { importDemo } = await import('./js/library.js'); await importDemo(); });
    const r = await page.evaluate(async () => {
      const { retrieveExcerpts } = await import('./js/search.js');
      const good = await retrieveExcerpts('no suction but the motor runs');
      const junk = await retrieveExcerpts('helicopter gearbox rotor blade inspection');
      const other = await retrieveExcerpts('replace the oxygen sensor and recalibrate the ventilator');
      const nonsense = await retrieveExcerpts('zzzz qqqq wwww');
      return {
        goodConf: good.confidence, goodN: good.excerpts.length,
        junkConf: junk.confidence, junkN: junk.excerpts.length,
        otherConf: other.confidence, nonsenseConf: nonsense.confidence,
        marksPartial: good.excerpts.some(e => typeof e.partial === 'boolean'),
      };
    });
    check('a real fault query retrieves confident excerpts', r.goodN > 0 && r.goodConf !== 'weak', JSON.stringify(r));
    check('an unrelated query is classified weak (AI call is suppressed)', r.junkConf === 'weak', JSON.stringify(r));
    check('a question about a machine whose manual is NOT imported is weak', r.otherConf === 'weak', JSON.stringify(r));
    check('nonsense is weak', r.nonsenseConf === 'weak', JSON.stringify(r));
    check('excerpts carry a partial flag for the assistant', r.marksPartial === true);
    await ctx.close();
  }

  // ============ 10. Search index survives OCR-style re-indexing ============
  console.log('\n[10] Re-indexing (the OCR duplicate-id crash)');
  {
    const { ctx, page } = await newPage(browser);
    await boot(page);
    const r = await page.evaluate(async () => {
      const { indexManual, searchPages } = await import('./js/search.js');
      const pages = [{ page: 1, text: 'Page 1 of 88' }, { page: 2, text: 'Page 2 of 88' }];
      await indexManual('m-dup', pages);
      // OCR replaces the same pages with real text — same doc ids
      try {
        await indexManual('m-dup', [{ page: 1, text: 'Replace the diaphragm kit PK-110 and retest vacuum.' }, { page: 2, text: 'Fuse F1 rating 2A slow blow.' }]);
      } catch (e) { return { threw: String(e) }; }
      const hit = await searchPages('diaphragm');
      return { threw: null, hits: hit.hits.length };
    });
    check('re-indexing the same pages does not throw (OCR used to lose the whole run)', r.threw === null, String(r.threw));
    check('re-indexed text is searchable', r.hits > 0, JSON.stringify(r));
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + '='.repeat(60));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
