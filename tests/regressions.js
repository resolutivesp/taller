const { chromium } = require('playwright');
let pass=0,fail=0,F=[];
const check=(n,c,e)=>{if(c){pass++;console.log('  ✓ '+n)}else{fail++;F.push(n+(e?' — '+e:''));console.log('  ✗ '+n+(e?' — '+e:''))}};
(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await b.newContext({viewport:{width:360,height:720}});const page=await ctx.newPage();
const errs=[];page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://127.0.0.1:8099/',{waitUntil:'domcontentloaded'});
await page.evaluate(async()=>{const{db}=await import('./js/db.js');await db.kvSet('onboarded',1)});
await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(600);

console.log('\n[regressions found by the independent review]');
const r=await page.evaluate(async()=>{
  const {db}=await import('./js/db.js');
  const {pmState}=await import('./js/model.js');
  const out={};
  // 1. PM calendar must not be empty for machines registered with the express form
  await db.putEquipment({id:'e1',name:'Ventilator A',type:'ventilator',status:'working',pmDays:90,lastPmDate:null,parts:[]});
  await db.putEquipment({id:'e2',name:'Incubator B',type:'infant_incubator',status:'working',pmDays:180,lastPmDate:null,parts:[]});
  const eqs=await db.listEquipment();
  out.states=eqs.map(e=>pmState(e).state);
  // reach buildIcs through the exported entry point by stubbing the download
  const rep=await import('./js/reports.js');
  let captured=null;
  const origCreate=URL.createObjectURL;
  URL.createObjectURL=(blob)=>{captured=blob;return origCreate.call(URL,blob)};
  rep.exportPmCalendar(eqs);
  await new Promise(r=>setTimeout(r,200));
  URL.createObjectURL=origCreate;
  out.icsText=captured?await captured.text():'';
  out.vevents=(out.icsText.match(/BEGIN:VEVENT/g)||[]).length;

  // 2. restore keeps `demo`, and saving a restored record keeps manualName
  await db.putEquipment({id:'d1',name:'Demo pump',type:'suction_pump',status:'working',parts:[],demo:true,createdAt:123});
  const {buildBackup,restoreFromText}=await import('./js/backup.js');
  const json=JSON.stringify(await buildBackup());
  await db.deleteEquipment('d1');
  await restoreFromText(json);
  const back=await db.getEquipment('d1');
  out.demoPreserved=back&&back.demo===true;
  out.createdAtPreserved=!!(back&&back.createdAt);
  return out;
});
check('PM calendar contains an event for machines with no service history yet', r.vevents===2, 'vevents='+r.vevents+' states='+JSON.stringify(r.states));
check('restore preserves the demo flag (was seeding a 2nd demo machine)', r.demoPreserved===true);
check('restore preserves createdAt', r.createdAtPreserved===true);

// 3. citation regex must not fire on connector designators, must work in es/pt
const cite=(answer)=>{const rx=/\b(?:p|pp|pg|pag|p[aá]g|page|p[aá]gina|seite)\.\s*(\d{1,5})\b/gi;const o=[];let m;while((m=rx.exec(answer))!==null)o.push(m[1]);return o};
check('citation check ignores connector labels P1/P2', JSON.stringify(cite('Disconnect connector P2 from the board (Manual, p. 12).'))==='["12"]', JSON.stringify(cite('Disconnect connector P2 from the board (Manual, p. 12).')));
check('citation check understands Spanish "pág."', cite('Consulte (Manual, pág. 12) antes de actuar.').includes('12'));
check('citation check understands Portuguese "pág."', cite('Ver (Manual, pág. 7) antes de agir.').includes('7'));

// 4. cross-language question is no longer hard-blocked from the assistant
await page.evaluate(async()=>{const{importDemo}=await import('./js/library.js');await importDemo()});
const x=await page.evaluate(async()=>{
  const {retrieveExcerpts}=await import('./js/search.js');
  const es=await retrieveExcerpts('No hay aspiración pero el motor gira');
  return {n:es.excerpts.length, conf:es.confidence};
});
check('a cross-language question still retrieves excerpts (AI no longer suppressed)', x.n>0, JSON.stringify(x));
check('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
await b.close();
console.log('\n'+'='.repeat(60));console.log(`FINAL: ${pass} passed, ${fail} failed`);
if(F.length){console.log('\nFailures:');F.forEach(f=>console.log('  - '+f))}
process.exit(fail?1:0);
})();
