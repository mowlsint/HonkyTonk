import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

// Tests use the code actually embedded in index2, not a second adapter copy.
const html = readFileSync(new URL('../index2.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
for (const js of scripts) new Script(js);
const addon = scripts.find(s=>s.includes('isolated, deterministic Magic Paws adapter'));
assert.ok(addon);
function harness() {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id,{value:id==='mpHours'?'24':id==='mpEnd'?'2026-09-16T04:00':'',innerHTML:'',textContent:'',style:{},checked:false,disabled:false});
    return elements.get(id);
  };
  const clean = v=>String(v??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const ctx={console,URL,Blob,structuredClone,crypto:webcrypto,Date,Map,Set,clearTimeout,setTimeout,
    document:{getElementById:node},clean,esc:clean,
    shouldPlotPlace:p=>p.lat!==null&&p.lon!==null&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180&&p.precision!=='unknown'&&p.role!=='context',
    CATS:Object.fromEntries(['hybrid','shadow','drugs','iuu','cyber','safety','environment','other'].map(k=>[k,{label:k}])),
    reports:[],uniq:a=>[...new Set(a)],sortReports(){},generateReportJsonBox(){},updatePrompt(){},
    renderReport(){},renderEditor(){},collectPlaces(){},fromAiObj(){},reportItemToJson(){},jsonPayloadFromReports(){},markdown(){},updateReport(){},boundsFor(){}};
  // Pure parsing / staging / application functions, before the UI wrappers.
  const prefix=addon.slice(0,addon.indexOf('  // Keep provenance'));
  runInNewContext(prefix+'globalThis.api={parseInput,makeReport,category,places,canonical,dateUTC,stageInputs,apply,state};})();',ctx);
  return {ctx,api:ctx.api,node};
}
const event=(overrides={})=>({title:'Container terminal opens',text:'A routine port update.',ts:'2026-09-16T03:00:00Z',url:'https://example.org/news/Ship?utm_source=rss',severity:'SEV:2',confidence:'CONF:LOW',region:'REG:NORTH_SEA',...overrides});
const batch={name:'synthetic.json',generated:'2026-09-16T04:00:00Z'};
const feed=events=>JSON.stringify({schema:'magicpaws-honkytonk-feed-1',generated_at:batch.generated,events});
const file=text=>({name:'synthetic.json',text:async()=>text,size:Buffer.byteLength(text)});

test('all inline scripts have valid syntax and old interface remains present',()=>{
  for(const id of ['fileInput','reportEditor','archiveMarkdownInput','outputLanguage','mapMode','mpPanel','mpPreview','mpToken','mpFetchLatest']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/function printReport\(/);assert.match(html,/function downloadHTMLReport\(/);assert.match(html,/async function fetchLatestFeed\(/);assert.doesNotMatch(html,/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/);
});
test('routine containers, tankers, fishing and pipelines are not crime or hybrid proof',()=>{
  const {api}=harness();for(const title of ['Container ship arrives','Oil tanker delivers cargo','Trawler visits port','Pipeline project tender'])assert.equal(api.category(event({title,text:''})).value,'other');
});
test('specific accident wording wins over a broad upstream infrastructure label',()=>{
  assert.equal(harness().api.category(event({title:'Grounding of fishing vessel',domain:'D:INFRA_CI'})).value,'safety');
});
test('known labels and supported positive keywords map to proposed categories',()=>{
  const {api}=harness();assert.equal(api.category(event({domain:'D:RF_SIGNAL'})).value,'cyber');
  for(const [title,cat] of [['Cocaine seized','drugs'],['Illegal fishing','iuu'],['Shadow fleet sanctions','shadow'],['Oil spill','environment'],['Ransomware outage','cyber']])assert.equal(api.category(event({title})).value,cat);
});
test('raw text and source confidence preserved, no invented analysis or translation',()=>{
  const {report}=harness().api.makeReport(event(),batch);
  assert.equal(report.note,'');assert.equal(report.summary,'A routine port update.');assert.equal(report.summary_en,undefined);
  assert.equal(report.mp.raw_text,report.summary);assert.match(report.evidence,/keine A\/B\/C/);
});
test('unknown severity is not silently promoted to medium',()=>assert.equal(harness().api.makeReport(event({severity:''}),batch).report.severity,'unbekannt'));
test('missing date/source and unsafe URLs are rejected',()=>{
  const {api}=harness();for(const patch of [{ts:''},{url:''},{url:'javascript:alert(1)'},{url:'https://user:secret@example.org/'}])assert.ok(api.makeReport(event(patch),batch).error);
});
test('UTC parsing, time offsets and invalid dates',()=>{
  const {api}=harness();assert.equal(api.dateUTC('2026-09-16 03:41 UTC').toISOString(),'2026-09-16T03:41:00.000Z');
  assert.equal(api.dateUTC('2026-09-16T05:41:00+02:00').toISOString(),'2026-09-16T03:41:00.000Z');
  assert.equal(api.dateUTC('2026-09-16T00:41:00+02:00').toISOString(),'2026-09-15T22:41:00.000Z');
  assert.equal(api.dateUTC('2026-02-30'),null);assert.equal(api.dateUTC(''),null);
});
test('URL dedupe removes tracking but preserves case-sensitive paths and meaningful queries',()=>{
  const {api}=harness();assert.equal(api.canonical('https://example.org/Ship?utm_source=x#top'),'https://example.org/Ship');
  assert.notEqual(api.canonical('https://example.org/Ship'),api.canonical('https://example.org/ship'));
  assert.notEqual(api.canonical('https://example.org/?id=1'),api.canonical('https://example.org/?id=2'));
});
test('regional centroid is a regional corridor, never exact',()=>{
  const p=harness().api.places(event({geo:{lat:57,lon:18,method:'controlled_region_centroid'}}))[0];
  assert.equal(p.precision,'regional');assert.equal(p.role,'corridor');assert.equal(p.source_method,'controlled_region_centroid');
});
test('source coordinates remain approximate; unknown method is unplottable',()=>{
  const {api,ctx}=harness();let p=api.places(event({geo:{lat:53,lon:8,method:'text_coordinate'}}))[0];
  assert.equal(p.precision,'approximate');assert.ok(ctx.shouldPlotPlace(p));
  p=api.places(event({geo:{lat:53,lon:8,method:'unknown'}}))[0];assert.equal(ctx.shouldPlotPlace(p),false);
});
test('null, empty, impossible, swapped and non-numeric coordinates cannot create false points',()=>{
  const {api}=harness();for(const geo of [{lat:null,lon:null},{lat:'',lon:8},{lat:181,lon:8},{lat:'53nonsense',lon:8}])assert.equal(api.places(event({geo})).length,0);
});
test('metadata-only JSON is rejected; empty valid feed remains a valid zero result',()=>{
  const {api}=harness();assert.throws(()=>api.parseInput('{"events_count":33}','metadata.json'),/events\[\]/);
  assert.equal(api.parseInput(feed([]),'empty.json').events.length,0);
  assert.throws(()=>api.parseInput('{"events":[]}','undated.json'),/Exportzeitpunkt/);
});
test('array elements and size are validated',()=>{
  const {api}=harness();assert.throws(()=>api.parseInput(feed([null]),'invalid.json'),/Ereignis/);
  assert.throws(()=>api.parseInput(feed(Array(2001).fill(event())),'large.json'),/2000/);
});
test('duplicate reports staged once, including DE/EN copies and tracking variants',async()=>{
  const {api}=harness();await api.stageInputs([file(feed([event(),event({url:'https://example.org/news/Ship'})]))]);
  assert.equal(api.state.audit.eligible,1);assert.equal(api.state.audit.duplicates,1);
});
test('strict half-open window excludes future records and cutoff, retains newest',async()=>{
  const {api}=harness();await api.stageInputs([file(feed([event(),event({ts:'2026-09-15T04:00:00Z',url:'https://example.org/old'}),event({ts:'2026-09-16T05:00:00Z',url:'https://example.org/future'})]))]);
  assert.equal(api.state.audit.eligible,1);assert.equal(api.state.audit.out_of_scope,2);
});
test('repeated application does not duplicate or overwrite edited reports',async()=>{
  const {api,ctx}=harness();await api.stageInputs([file(feed([event()]))]);api.apply();
  assert.equal(ctx.reports.length,1);ctx.reports[0].headline='Editor correction';api.apply();
  assert.equal(ctx.reports.length,1);assert.equal(ctx.reports[0].headline,'Editor correction');
});
test('failed mixed batch is atomic and leaves report and earlier staged rows intact',async()=>{
  const {api,ctx,node}=harness();await api.stageInputs([file(feed([event()]))]);api.apply();
  await api.stageInputs([file(feed([event({url:'https://example.org/second'})])),file('broken')]);
  assert.equal(ctx.reports.length,1);assert.equal(api.state.rows.length,1);assert.match(node('mpStatus').textContent,/abgebrochen/);
});
test('zero results are not turned into a synthetic news item',async()=>{
  const {api,ctx}=harness();await api.stageInputs([file(feed([]))]);api.apply();assert.equal(ctx.reports.length,0);
});
