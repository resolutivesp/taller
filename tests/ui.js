// UI walkthrough: visit every view, exercise the forms, verify contrast and
// touch targets against the REAL computed styles, and capture screenshots.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://127.0.0.1:8099/';
let pass = 0, fail = 0; const failures = [];
function check(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; failures.push(n + (e ? ' — ' + e : '')); console.log('  ✗ ' + n + (e ? ' — ' + e : '')); }
}

const SHOT = '/home/claude/shots';
fs.mkdirSync(SHOT, { recursive: true });

// WCAG relative luminance + contrast, computed from rgb() strings.
const CONTRAST_FN = `
function _lum(c){const s=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});
return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2];}
function _rgb(str){const m=String(str).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;
const p=m[1].split(',').map(x=>parseFloat(x));return p.slice(0,3);}
function _blend(fg,bg,a){return fg.map((v,i)=>v*a+bg[i]*(1-a));}
// Collect every candidate background an element sits on, INCLUDING gradient
// colour stops — a gradient leaves backgroundColor transparent, so measuring
// only backgroundColor silently compares the text against whatever opaque
// ancestor happens to be behind it and reports nonsense.
function _bgCandidates(el){
  const out=[];let node=el;
  while(node && node!==document.documentElement){
    const cs=getComputedStyle(node);
    const bi=cs.backgroundImage;
    if(bi && bi!=='none'){
      const stops=bi.match(/rgba?\\([^)]+\\)/g)||[];
      for(const s of stops){const c=_rgb(s);if(c)out.push(c);}
      if(stops.length) return out;           // gradient wins: text sits on it
    }
    const c=_rgb(cs.backgroundColor);
    const a=c?(String(cs.backgroundColor).match(/rgba/)?parseFloat(cs.backgroundColor.split(',')[3]):1):0;
    if(c&&a>0.9){out.push(c);return out;}
    node=node.parentElement;
  }
  out.push(_rgb(getComputedStyle(document.body).backgroundColor)||[255,255,255]);
  return out;
}
function contrastOf(el, prop){
  const fg=_rgb(getComputedStyle(el)[prop||'color']);if(!fg)return null;
  const bgs=_bgCandidates(el);
  if(!bgs.length) return null;
  let worst=99;
  for(const bg of bgs){
    const L1=_lum(fg),L2=_lum(bg);
    const r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if(r<worst)worst=r;                       // report the WORST point of a gradient
  }
  return +worst.toFixed(2);
}`;

async function seed(page) {
  await page.evaluate(async () => {
    const { db } = await import('./js/db.js');
    await db.kvSet('onboarded', 1);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const { importDemo } = await import('./js/library.js');
    await importDemo();
  });
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const theme of ['light', 'dark']) {
    console.log(`\n[theme: ${theme}]`);
    const ctx = await browser.newContext({ viewport: { width: 360, height: 720 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.addInitScript((t) => localStorage.setItem('taller-theme', t), theme);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await seed(page);
    await page.addScriptTag({ content: CONTRAST_FN });

    const routes = [
      ['#/', 'home'], ['#/equipment', 'equipment'], ['#/library', 'library'],
      ['#/ask', 'ask'], ['#/more', 'more'], ['#/reports', 'reports'],
      ['#/logbook', 'logbook'], ['#/backup', 'backup'],
    ];
    for (const [hash, name] of routes) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForTimeout(650);
      await page.addScriptTag({ content: CONTRAST_FN }).catch(() => {});
      const visible = await page.locator('#view').isVisible();
      check(`${theme}/${name}: view renders`, visible);
      await page.screenshot({ path: `${SHOT}/${theme}-${name}.png` });
    }

    // ---- contrast on real computed styles ----
    const contrast = await page.evaluate(() => {
      const out = [];
      const sample = (sel, label, min, prop) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = contrastOf(el, prop);
        if (r !== null) out.push({ label, ratio: r, min, ok: r >= min });
      };
      location.hash = '#/';
      sample('#appbar .app-name', 'app bar title', 4.5);
      sample('.view-title', 'view title', 4.5);
      sample('.muted', 'muted text', 4.5);
      sample('.tab', 'tab label', 4.5);
      sample('.btn-primary', 'primary button label', 4.5);
      return out;
    });
    for (const c of contrast) check(`${theme}: ${c.label} contrast ${c.ratio}:1 (min ${c.min})`, c.ok, c.ratio + ':1');

    // ---- border contrast (WCAG 1.4.11 non-text: 3:1) ----
    const borders = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const strong = cs.getPropertyValue('--border-strong').trim();
      const surface = cs.getPropertyValue('--surface').trim();
      const hex = (h) => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
      const lum = (c) => { const s = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
      const L1 = lum(hex(strong)), L2 = lum(hex(surface));
      return { strong, surface, ratio: +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))).toFixed(2) };
    });
    check(`${theme}: control border ${borders.ratio}:1 on surface (WCAG 1.4.11 needs 3:1)`, borders.ratio >= 3, JSON.stringify(borders));

    // ---- touch targets ----
    await page.evaluate(() => { location.hash = '#/equipment'; });
    await page.waitForTimeout(500);
    const small = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, .chip, .tab')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 44 - 0.5) bad.push({ cls: el.className || el.tagName, h: Math.round(r.height), txt: (el.innerText || '').slice(0, 20) });
      }
      return bad;
    });
    check(`${theme}: every visible control is >=44px tall`, small.length === 0, JSON.stringify(small.slice(0, 6)));

    // ---- the equipment form: Save must be reachable without hunting ----
    await page.evaluate(() => { location.hash = '#/equipment'; });
    await page.waitForTimeout(400);
    const addBtn = page.locator('.btn-primary', { hasText: /add|añad|ajout|adicion/i }).first();
    if (await addBtn.count()) {
      await addBtn.click();
      await page.waitForTimeout(500);
      const formInfo = await page.evaluate(() => {
        const box = document.querySelector('.modal');
        const acts = document.querySelector('.modal-actions');
        if (!box || !acts) return null;
        const br = box.getBoundingClientRect(), ar = acts.getBoundingClientRect();
        return { actionsVisible: ar.top < window.innerHeight && ar.bottom > 0, sticky: getComputedStyle(acts).position === 'sticky', boxH: Math.round(br.height) };
      });
      check(`${theme}: equipment form Save row is visible without scrolling`, formInfo && formInfo.actionsVisible, JSON.stringify(formInfo));
      check(`${theme}: Save row is sticky`, formInfo && formInfo.sticky, JSON.stringify(formInfo));
      await page.screenshot({ path: `${SHOT}/${theme}-form.png` });

      // defaults must not lie
      const defaults = await page.evaluate(() => {
        const sels = [...document.querySelectorAll('.modal select')];
        const type = sels[0] ? sels[0].value : null;
        const date = [...document.querySelectorAll('.modal input[type=date]')].map(i => i.value);
        return { type, dates: date };
      });
      check(`${theme}: default equipment type is "other", not suction_pump`, defaults.type === 'other', JSON.stringify(defaults));
      check(`${theme}: "last PM" is empty by default (was silently set to today)`, defaults.dates.every(d => d === ''), JSON.stringify(defaults));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    check(`${theme}: no page errors during the whole walkthrough`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- desktop landing ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOT}/desktop-onboard.png` });
    check('desktop landing renders', await page.locator('#app').isVisible());
    await ctx.close();
  }

  // ---- onboarding, 360x640 (the cheap-phone case) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOT}/onboard-360x640.png` });
    const m = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.onboard .btn')];
      const vis = btns.filter(b => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
      return { visible: vis.length, first: vis[0] ? vis[0].innerText.trim() : null };
    });
    check('at least one CTA fully visible on a 360x640 screen', m.visible >= 1, JSON.stringify(m));
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + '='.repeat(60));
  console.log(`UI RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
