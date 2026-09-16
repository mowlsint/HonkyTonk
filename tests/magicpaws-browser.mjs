// Optional real-browser integration test. Requires npm install playwright and
// npx playwright install chromium. No external network requests during testing.
// Run: node tests/magicpaws-browser.mjs
// Optional private real sample: HONKYTONK_SAMPLE=/path/to/rawdata.html
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright;
try { playwright=require('playwright'); } catch { playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'); }
const html=readFileSync(new URL('../index2.html',import.meta.url),'utf8');
const original=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const browser=await playwright.chromium.launch({headless:true});
try {
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    if(route.request().url()==='http://honkytonk.test/index2.html')return route.fulfill({body:html,contentType:'text/html'});
    if(route.request().url()==='http://honkytonk.test/index.html')return route.fulfill({body:original,contentType:'text/html'});
    return route.abort();
  });
  await page.goto('http://honkytonk.test/index2.html');
  const sample=`<!doctype html><html><body><h1>MAGIC PAWS // SITREP</h1><section class="metaGrid"><div class="metaCard"><div class="k">Erstellt</div><div class="v">2026-09-16 04:00 UTC</div></div></section><section class="brief">DO NOT IMPORT AI BRIEF<script>window.pwned=true;<\/script></section><section class="rawList"><article class="event"><div class="eventMetaTop"><span>2026-09-16 03:00 UTC</span><span class="severity">SEV 2</span></div><h3>Example port fire</h3><p class="excerpt">Synthetic source text only.</p><dl class="eventFacts"><div><dt>Source</dt><dd>Example</dd></div><div><dt>Geo</dt><dd>20.0000, 38.0000 · controlled_region_centroid</dd></div><div><dt>Region</dt><dd>RED SEA</dd></div><div><dt>Link</dt><dd><a href="https://example.org/news">source</a></dd></div></dl></article></section></body></html>`;
  await page.locator('#mpFiles').setInputFiles({name:'synthetic.html',mimeType:'text/html',buffer:Buffer.from(sample)});
  await page.locator('#mpApply').click();
  assert.equal(await page.evaluate(()=>reports.length),1);
  assert.equal(await page.evaluate(()=>window.pwned),undefined);
  assert.equal(await page.evaluate(()=>reports[0].places[0].precision),'regional');
  assert.equal(await page.locator('#reportView .meldung').count(),1);
  assert.equal(await page.locator('#reportView .marker').count(),1);
  assert.doesNotMatch(await page.locator('#reportView').innerText(),/DO NOT IMPORT/);
  await page.evaluate(()=>updateReport(reports[0].id,'headline','Operator edit'));
  await page.locator('#mpApply').click();
  assert.equal(await page.evaluate(()=>reports.length),1);
  assert.equal(await page.evaluate(()=>reports[0].headline),'Operator edit');
  const before=await page.evaluate(()=>MagicPawsImport.draft());
  await page.evaluate(d=>{reports=[];MagicPawsImport.restoreText(JSON.stringify(d));},before);
  assert.equal(await page.evaluate(()=>reports[0].mp.raw_text),'Synthetic source text only.');
  assert.equal(await page.evaluate(()=>reports[0].summary_en),'');
  const downloads=['downloadMarkdown','downloadText','downloadHTMLReport'];
  for(const name of downloads){const wait=page.waitForEvent('download');await page.evaluate(n=>window[n](),name);assert.ok((await wait).suggestedFilename());}
  const md=await page.evaluate(()=>markdown());
  assert.match(md,/Operator edit/);
  const archive=await page.evaluate(txt=>parseArchivedMarkdown(txt,'archive.md'),md);
  assert.equal(archive.items.length,1);
  const print=await page.evaluate(()=>buildCleanPrintHTML());assert.match(print,/Operator edit/);assert.doesNotMatch(print,/id="mpPanel"/);
  await page.locator('#mpAutosave').check();await page.waitForTimeout(450);
  assert.ok(await page.evaluate(()=>localStorage.getItem('mowlsint.honkytonk.index2.draft.v1')));
  await page.goto('http://honkytonk.test/index.html');assert.equal(await page.evaluate(()=>reports.length),0);
  await page.goto('http://honkytonk.test/index2.html');await page.locator('#mpRestore').click();assert.equal(await page.evaluate(()=>reports.length),1);
  if(process.env.HONKYTONK_SAMPLE){
    await page.evaluate(()=>{reports=[];});
    await page.locator('#mpFiles').setInputFiles(process.env.HONKYTONK_SAMPLE);
    await page.locator('#mpApply').click();
    console.log('Real sample:',await page.evaluate(()=>({reports:reports.length,geo:collectPlaces().filter(shouldPlotPlace).length,audit:MagicPawsImport.state.audit})));
  }
  await page.screenshot({path:'/tmp/honkytonk-index2-test.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: inert HTML, append/dedupe, map, draft roundtrip, MD/TXT/HTML, archive, print and isolated storage');
} finally {await browser.close();}
