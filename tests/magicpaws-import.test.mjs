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
    reports:[],uniq:a=>[...new Set(a)],normalizePlaces:a=>Array.isArray(a)?a:[],sortReports(){},generateReportJsonBox(){},updatePrompt(){},
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
test('section 04 uses explicit click listeners rather than inline handlers',()=>{
  const section=html.match(/<section class="panel ki-input-panel">[\s\S]*?<\/section>/)?.[0] || '';
  const controls=['aiImportButton','jsonValidateButton','jsonCopyButton','reportJsonButton','jsonMirrorButton','manualAddButton','reportSortButton','reportClearButton'];
  for(const id of controls){assert.match(section,new RegExp('id="'+id+'"'));assert.match(html,new RegExp("bindSection04Action\\('"+id+"'"));}
  assert.doesNotMatch(section,/onclick=/);
  assert.match(html,/aiOutput\.addEventListener\('input',mirrorAiJsonOutput\)/);
});
test('harmonized report contract requires bilingual executive summaries and paired text exports',()=>{
  for(const required of ['report_summary_de','report_summary_en','priority_findings_de','priority_findings_en','downloadBilingualMarkdown','downloadBilingualText','reportExecutiveSummary']) assert.match(html,new RegExp(required));
  assert.match(html,/mindestens 300 Zeichen/);
  assert.match(html,/einschließlich zweisprachiger Gesamtlage/);
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
test('HonkyTonk AI places are preserved by the direct importer',()=>{
  const {api}=harness();const sourcePlace={name:'Strait of Hormuz',lat:26.57,lon:56.25,type:'chokepoint',role:'corridor',precision:'regional',geo_source:'IHO'};
  const {report}=api.makeReport(event({places:[sourcePlace],geo:null}),batch);
  assert.deepEqual(report.places,[sourcePlace]);
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

// Exercise the production exporters together, with only the browser DOM mocked.
function exportHarness() {
  const elements=new Map(),downloads=[];
  const style={textContent:html.match(/<style>([\s\S]*?)<\/style>/)[1],get outerHTML(){return '<style>'+this.textContent+'</style>';}};
  const node=id=>{
    if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',checked:false,style:{},addEventListener(){},
      get outerHTML(){return '<div id="'+id+'" class="report-inner">'+this.innerHTML+'</div>';}});
    return elements.get(id);
  };
  for(const id of ['period','audience']){
    const select=html.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)</select>'))[1];
    node(id).options=[...select.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map(m=>({textContent:m[1],value:m[1]}));
  }
  const document={getElementById:node,querySelectorAll:selector=>selector==='style'?[style]:[],querySelector:selector=>{
    if(selector==='style')return style;
    if(selector==='#reportView .summarybox')return {set innerHTML(value){node('reportView').innerHTML=node('reportView').innerHTML.replace(/(<div class="summarybox">)[\s\S]*?(<\/div>)/,(_,a,b)=>a+value+b);}};
    return null;
  }};
  const ctx={console,document,URL,Blob,Date,Map,Set,crypto:webcrypto,location:{href:'https://honkytonk.test/index2.html'},addEventListener(){}};
  ctx.window=ctx;
  const script=scripts[0],boot=script.lastIndexOf("['reportDate','period','region','audience'");
  assert.ok(boot>0);
  runInNewContext(script.slice(0,boot),ctx);
  ctx.download=(name,body,type)=>downloads.push({name,body,type});
  node('reportDate').value='2026-10-04';node('period').value='letzte 48 Stunden';
  node('region').value='Nordsee, Ostsee, Ärmelkanal, Atlantikzugänge, Mittelmeer, Schwarzmeerraum, globale maritime Brennpunkte';
  node('audience').value='Behördenlage / LvU-tauglich';node('mapMode').value='auto';node('outputLanguage').value='en';
  const run=code=>runInNewContext(code,ctx);
  return {ctx,node,downloads,run};
}

test('PDF print HTML, HTML, Markdown and TXT localize settings and restore language',()=>{
  const {ctx,node,downloads}=exportHarness();
  for(const text of [ctx.buildCleanPrintHTML(),ctx.markdown('en'),ctx.textReport('en')]){
    assert.match(text,/Time window: Last 48 hours/);
    assert.match(text,/North Sea, Baltic Sea, English Channel, Atlantic approaches, Mediterranean Sea, Black Sea region, Global maritime hotspots/);
    assert.match(text,/Audience \/ Mode: Authority briefing \/ LvU-compatible/);
    assert.match(text,/Executive Summary/);
    assert.doesNotMatch(text,/letzte 48 Stunden|Behördenlage|Nordsee|Lage Core/);
  }
  ctx.downloadHTMLReport();assert.match(downloads.at(-1).body,/Time window: Last 48 hours/);
  assert.match(downloads.at(-1).body,/<html lang="en">/);
  ctx.downloadBilingualMarkdown();ctx.downloadBilingualText();
  for(const output of downloads.slice(1))assert.match(output.body,output.name.includes('_EN')?/Time window: Last 48 hours/:/Zeitraum: letzte 48 Stunden/);
  assert.equal(node('period').value,'letzte 48 Stunden');assert.equal(node('outputLanguage').value,'en');
  node('outputLanguage').value='de';ctx.markdown('en');assert.equal(node('outputLanguage').value,'de');
  assert.match(ctx.buildCleanPrintHTML(),/Zeitraum: letzte 48 Stunden/);
});

test('every standard time window is localized in English exports',()=>{
  const {ctx,node}=exportHarness();
  const expected=['Last 24 hours','Last 36 hours','Last 48 hours','Weekly overview: last 8 days','Last 7 days','Custom / from import'];
  node('period').options.forEach((option,i)=>{node('period').value=option.value;assert.ok(ctx.markdown('en').includes('Time window: '+expected[i]));});
  assert.equal(ctx.settingLabel('period','2026-10-01 / 2026-10-04','en'),'2026-10-01 / 2026-10-04');
});

test('English exports translate generated warnings and map names without altering sources',()=>{
  const {report}=harness().api.makeReport(event({severity:'',region:'Nordsee'}),batch);
  report.places=[{name:'Nordsee',lat:56.2,lon:3.2,role:'corridor',precision:'regional',type:'sea'}];
  const {ctx,run}=exportHarness();ctx.fixture=report;run('reports=[fixture]');
  for(const text of [ctx.buildCleanPrintHTML(),ctx.markdown('en'),ctx.textReport('en')]){
    assert.match(text,/Unverified Magic Paws raw import/);assert.match(text,/Severity unknown; manual review required/);
    assert.match(text,/No reliable location to map/);assert.match(text,/North Sea/);
    assert.doesNotMatch(text,/Ungeprüfter|Nicht belastbar|Gewichtung unbekannt|Evidenzeinstufung/);
    assert.match(text,/A routine port update\./);
  }
  assert.match(report.evidence,/Ungeprüfter/);assert.equal(report.region,'Nordsee');
  assert.equal(ctx.geoLabel('Port of Nordsee Logistics / Hamburg','en'),'Port of Nordsee Logistics / Hamburg');
  assert.equal(ctx.geoLabel('Nordsee, Hamburg | Ostsee','en'),'North Sea, Hamburg | Baltic Sea');
});

test('English archived settings round-trip back into the German form options',()=>{
  const {ctx,node}=exportHarness();
  const settings=ctx.parseArchivedMarkdownSettings(ctx.markdown('en'));
  node('period').value='letzte 24 Stunden';node('audience').value='OSINT-Analyst';
  ctx.applyArchivedMarkdownSettings(settings);
  assert.equal(node('period').value,'letzte 48 Stunden');assert.equal(node('audience').value,'Behördenlage / LvU-tauglich');
  const legacy=ctx.parseArchivedMarkdownSettings('# Report (04.10.2026)\nPeriod: letzte 36 Stunden\nRegion/Fokus: Nordsee\nAdressat/Modus: OSINT-Analyst');
  ctx.applyArchivedMarkdownSettings(legacy);assert.equal(node('period').value,'letzte 36 Stunden');assert.equal(node('region').value,'Nordsee');
});
