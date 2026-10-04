import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS, defaultConfig, validateConfig, scheduledEnd, zonedTime, windowFor, runId, scopeKey, planResearch, uncoveredIntervals, canonicalURL, markdownDocument, parseDocument, sourceDocument, readSource, hash } from '../automation/core.mjs';
import { LocalArchive, GitHubArchive, ConflictError, loadConfig, saveConfig, loadRecord, saveRecord, readArchive, readRuns } from '../automation/archive.mjs';
import { OpenAIResearcher, RESEARCH_SCHEMA, REPORT_SCHEMA, validateReport } from '../automation/openai.mjs';
import { HonkyTonkRunner, runPath, reportPath } from '../automation/runner.mjs';
import { createAppServer } from '../automation/server.mjs';
import { ResendMailer } from '../automation/mail.mjs';
import { fixtureSource, fixtureReport, fixtureArtifacts } from './automation-fixtures.mjs';

const now = new Date('2026-10-04T06:00:00Z');
function setupConfig(mode = 'manual') {
  const config = defaultConfig(now); config.mode = mode;
  config.profiles.forEach(p => { p.schedule.anchorDate = '2026-09-01'; p.enabled = mode !== 'manual'; p.topics = ['safety']; p.recipients = ['analyst@example.org']; });
  config.profiles[2].schedule.anchorDate = '2026-09-27';
  return config;
}
async function harness(t, { mode = 'manual', zero = false, researchFails = false, renderFails = false, mailFails = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'honkytonk-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const archive = new LocalArchive(root); await archive.init(); const config = setupConfig(mode); await saveConfig(archive, config, null);
  const calls = { research: [], synthesis: 0, render: 0, mail: [] };
  const researcher = {
    async research(profile, job) {
      calls.research.push(job); if (researchFails) throw new Error('Research unavailable');
      const eventAt = new Date(Math.min(Date.parse(job.end), Date.parse(job.start) + 36e5)).toISOString();
      const sources = zero ? [] : [fixtureSource({ id: hash(job.start + job.end).slice(0, 16), event_at: eventAt, published_at: eventAt, topics: job.topics, scope: job.scope })];
      return { sources, checks: job.topics.map(topic => ({ topic, checked: true, finding: zero ? 'no_findings' : 'findings', note_de: 'Geprüft.', note_en: 'Checked.' })), limitations_de: [], limitations_en: [], response_id: 'synthetic-search' };
    },
    async synthesise(profile, plan, sources) { calls.synthesis++; return { payload: fixtureReport(profile, plan.window, sources), response_id: 'synthetic-report', prompt_version: 'test-1' }; }
  };
  const renderer = { async render(payload, profile) { calls.render++; if (renderFails) throw new Error('PDF unavailable'); return fixtureArtifacts(profile); } };
  const mailer = { async send(data) { calls.mail.push(data); if (mailFails) throw new Error('Provider timeout'); return 'synthetic-provider-id'; } };
  const runner = new HonkyTonkRunner({ archive, researcher, renderer, mailer, now: () => now });
  return { archive, config, runner, calls };
}
test('manual default is off and expanded windows keep nominal DE/EN wording', () => {
  const config = defaultConfig(now); assert.equal(config.mode, 'manual'); assert.ok(config.profiles.every(p => !p.enabled && !p.recipients.length));
  for (const [preset, hours, label] of [['daily', 30, '24'], ['twoDay', 55, '48'], ['weekly', 192, '7']]) {
    const window = windowFor(config.profiles.find(p => p.preset === preset), now);
    assert.equal((Date.parse(window.end) - Date.parse(window.start)) / 36e5, hours); assert.match(window.label_en, new RegExp(label));
  }
  assert.deepEqual(Object.keys(PRESETS), ['daily', 'twoDay', 'weekly']); validateConfig(config);
});
test('daily/weekly keep Berlin local time through DST; 48h is exact across month and DST', () => {
  const config = setupConfig(); const daily = config.profiles[0], twoDay = config.profiles[1], weekly = config.profiles[2];
  daily.schedule.anchorDate = '2026-10-23'; twoDay.schedule.anchorDate = '2026-10-23'; weekly.schedule.anchorDate = '2026-10-23';
  assert.equal(scheduledEnd(daily, '2026-10-25T08:00Z'), '2026-10-25T06:00:00.000Z');
  assert.equal(scheduledEnd(twoDay, '2026-10-25T08:00Z'), '2026-10-25T05:00:00.000Z');
  assert.equal(scheduledEnd(weekly, '2026-10-30T08:00Z'), '2026-10-30T06:00:00.000Z');
  twoDay.schedule.anchorDate = '2026-09-30';
  assert.equal(scheduledEnd(twoDay, '2026-10-02T05:01Z'), '2026-10-02T05:00:00.000Z');
  assert.equal(scheduledEnd(twoDay, '2026-10-02T05:59Z'), scheduledEnd(twoDay, '2026-10-02T05:01Z'));
  assert.equal(scheduledEnd(daily, '2026-10-22T08:00Z'), null);
  assert.throws(() => zonedTime('2026-03-29', '02:30', 'Europe/Berlin'), /does not exist/);
});
test('invalid models, duplicate ids, malformed recipients and schedules are rejected', () => {
  for (const change of [c => c.profiles[0].model = 'unverified-model', c => c.profiles[1].id = c.profiles[0].id, c => c.profiles[0].recipients = ['a@example.org\nBcc:other@example.org'], c => c.profiles[0].schedule.anchorDate = '2026-02-30', c => c.profiles[0].topics = ['invented']]) { const config = setupConfig(); change(config); assert.throws(() => validateConfig(config)); }
});
test('interval subtraction preserves left, middle and new-development gaps', () => {
  const gaps = uncoveredIntervals('2026-10-01T00:00Z', '2026-10-04T00:00Z', [{ start: '2026-10-01T06:00Z', end: '2026-10-02T00:00Z' }, { start: '2026-10-02T06:00Z', end: '2026-10-03T00:00Z' }]);
  assert.equal(gaps.length, 3); assert.equal(gaps[0].start, '2026-10-01T00:00:00.000Z'); assert.equal(gaps[2].end, '2026-10-04T00:00:00.000Z');
});
test('48h and weekly reuse original daily material, searching only missing intervals/topics', () => {
  const config = setupConfig(), profile = config.profiles[1], window = windowFor(profile, '2026-10-04T05:00Z'), scope = scopeKey(profile);
  const coverage = [{ status: 'complete', scope, topics: ['safety'], start: '2026-10-01T23:00Z', end: '2026-10-03T05:00Z' }];
  const source = fixtureSource({ scope, event_at: '2026-10-02T04:00Z' });
  const previous = [{ id: 'daily-old', scope, window: coverage[0], source_ids: [source.id] }];
  const plan = planResearch(profile, window, coverage, [source], previous);
  assert.equal(plan.jobs.length, 2); assert.equal(plan.sources.length, 1); assert.deepEqual(plan.previous_reports.map(r => r.id), ['daily-old']);
  assert.equal((Date.parse(plan.jobs[0].end) - Date.parse(plan.jobs[0].start)) / 36e5, 1);
  profile.topics.push('cyber'); assert.ok(planResearch(profile, window, coverage).jobs.some(j => j.topics.includes('cyber')));
  coverage[0].status = 'failed'; assert.equal(planResearch(profile, window, coverage).jobs[0].start, window.start);
  const weekly = config.profiles[2]; assert.equal(planResearch(weekly, windowFor(weekly, '2026-10-04T05:00Z'), [{ ...coverage[0], status: 'complete' }], [source], previous).sources.length, 1);
});
test('Markdown source/report round trips retain original URLs, geo and bilingual fields', () => {
  const source = fixtureSource(), text = sourceDocument(source); assert.deepEqual(readSource(text).body, source.body);
  const config = setupConfig(), window = { ...windowFor(config.profiles[0], now), report_date: '2026-10-04' }, payload = fixtureReport(config.profiles[0], window, [source]);
  const md = markdownDocument({ kind: 'report', id: 'test' }, '# Readable report', payload);
  assert.deepEqual(parseDocument(md).data, payload); assert.equal(parseDocument(md).body, '# Readable report');
  assert.throws(() => readSource(text.replace('temporarily closed', 'permanently closed')), /hash mismatch/);
  assert.throws(() => parseDocument('---\n__proto__: {}\n---\n'), /metadata/);
});
test('canonical URLs retain meaningful queries and reject MagicPaws at the boundary', () => {
  assert.equal(canonicalURL('https://example.org/Harbour?id=1&utm_source=x#section'), 'https://example.org/Harbour?id=1');
  assert.throws(() => canonicalURL('https://api.github.com/repos/mowlsint/MagicPaws/contents/feed.md'), /disabled/);
  assert.throws(() => new GitHubArchive({ repository: 'mowlsint/MagicPaws', token: 'synthetic' }), /forbidden/);
});
test('GitHub data archive refuses public repositories before reading any data', async () => {
  const archive = new GitHubArchive({ repository: 'example/HonkyTonk-Data', token: 'synthetic', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ private: false }) }) });
  await assert.rejects(archive.init(), /private/); await assert.rejects(archive.read('config/automation.md'), /Verify/);
});
test('GitHub read cache follows fresh tree SHAs; config stays fresh and large Markdown uses blob API', async () => {
  const path = 'sources/web/example.md', configPath = 'config/automation.md', calls = [];
  const entries = new Map([[path, { sha: 'first', text: 'original source' }], [configPath, { sha: 'config-first', text: 'manual' }]]);
  const archive = new GitHubArchive({ repository: 'example/HonkyTonk-Data', token: 'synthetic', fetchImpl: async url => {
    const endpoint = new URL(url).pathname.replace('/repos/example/HonkyTonk-Data', ''); calls.push(endpoint);
    let data;
    if (!endpoint) data = { private: true };
    else if (endpoint.startsWith('/git/trees/')) data = { truncated: false, tree: [...entries].map(([path, entry]) => ({ type: 'blob', path, sha: entry.sha })) };
    else if (endpoint.startsWith('/contents/')) {
      const entry = entries.get(endpoint.slice('/contents/'.length));
      data = { type: 'file', sha: entry.sha, encoding: entry.large ? 'none' : 'base64', content: entry.large ? '' : Buffer.from(entry.text).toString('base64') };
    } else if (endpoint.startsWith('/git/blobs/')) {
      const entry = [...entries.values()].find(e => e.sha === endpoint.slice('/git/blobs/'.length)); data = { encoding: 'base64', content: Buffer.from(entry.text).toString('base64') };
    } else throw new Error('Unexpected endpoint');
    return { ok: true, status: 200, json: async () => data };
  } });
  await archive.init(); await archive.list('sources/web/');
  assert.equal((await archive.read(path, { cached: true })).text, 'original source');
  await archive.list('sources/web/'); await archive.read(path, { cached: true });
  assert.equal(calls.filter(p => p === '/contents/' + path).length, 1);
  entries.set(path, { sha: 'second', text: 'updated original', large: true });
  await archive.list('sources/web/'); assert.equal((await archive.read(path, { cached: true })).text, 'updated original');
  assert.ok(calls.includes('/git/blobs/second'));
  assert.equal((await archive.read(configPath)).text, 'manual');
  entries.set(configPath, { sha: 'config-second', text: 'review' });
  assert.equal((await archive.read(configPath)).text, 'review'); assert.equal(archive.cachedEntries.has(configPath), false);
  archive.remember('reports/example-de-artifact.md', { text: 'large PDF', revision: 'pdf' });
  assert.equal(archive.cachedEntries.has('reports/example-de-artifact.md'), false);
});
test('run polling reads only bounded recent run records, never source bodies or artifacts', async t => {
  const { archive } = await harness(t);
  for (const [id, started_at] of [['weekly-20261004T060000000Z', '2026-10-04T06:00:00Z'], ['daily-20260901T060000000Z', '2026-09-01T06:00:00Z'], ['daily-20261003T060000000Z', '2026-10-03T06:00:00Z']]) {
    await saveRecord(archive, runPath(id), { kind: 'run', id, started_at, status: 'awaiting_review' });
  }
  await archive.write('sources/imports/unparsed.md', 'raw data'); await archive.write('state/coverage/unparsed.md', 'raw data');
  const reads = [], originalRead = archive.read.bind(archive);
  archive.read = async (path, options) => { reads.push(path); return originalRead(path, options); };
  const runs = await readRuns(archive, 2);
  assert.deepEqual(runs.map(r => r.id), ['weekly-20261004T060000000Z', 'daily-20261003T060000000Z']);
  assert.equal(reads.length, 2); assert.ok(reads.every(p => p.startsWith('state/runs/')));
});
test('Markdown archive has atomic create and optimistic update guards', async t => {
  const { archive } = await harness(t), path = 'state/example.md'; const revision = await archive.write(path, 'first');
  await assert.rejects(archive.write(path, 'duplicate'), ConflictError); await assert.rejects(archive.write(path, 'stale', 'invalid-revision'), ConflictError);
  await archive.write(path, 'second', revision); assert.equal((await archive.read(path)).text, 'second');
  await assert.rejects(archive.write('../secret.md', 'bad')); await assert.rejects(archive.write('state/example.json', 'bad'));
});
test('report validator blocks out-of-window items, fabricated citations and false exact coordinates', () => {
  const config = setupConfig(), window = { ...windowFor(config.profiles[0], now), report_date: '2026-10-04' }, source = fixtureSource(), good = fixtureReport(config.profiles[0], window, [source]);
  validateReport(good, [source], window);
  for (const change of [p => p.items[0].event_at = '2026-09-01T00:00Z', p => p.items[0].sources = ['https://example.org/fabricated'], p => p.items[0].assessment_en = '', p => p.items[0].places[0].lat = 95, p => p.meta.period = '55 hours', p => p.items[0].source_ids = ['previous-report']]) { const payload = structuredClone(good); change(payload); assert.throws(() => validateReport(payload, [source], window)); }
});
test('both model profiles use Responses, required web search and strict shared JSON', async () => {
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    const requests = [], profile = setupConfig().profiles[0]; profile.model = model;
    const data = { outcome: 'complete', checks: [{ topic: 'safety', checked: true, finding: 'no_findings', note_de: 'Keine Treffer.', note_en: 'No findings.' }], sources: [], limitations_de: [], limitations_en: [] };
    const researcher = new OpenAIResearcher({ apiKey: 'synthetic-not-a-secret', fetchImpl: async (url, request) => { requests.push({ url, body: JSON.parse(request.body) }); return { ok: true, json: async () => ({ id: 'synthetic', status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { sources: [] } }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] }) }; } });
    const result = await researcher.research(profile, { start: '2026-10-03T00:00Z', end: '2026-10-04T00:00Z', topics: ['safety'], scope: scopeKey(profile) });
    assert.equal(result.sources.length, 0); assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(requests[0].body.model, model); assert.equal(requests[0].body.reasoning.effort, model.includes('astra') ? 'high' : 'medium');
    assert.equal(requests[0].body.tool_choice, 'required'); assert.equal(requests[0].body.text.format.strict, true); assert.deepEqual(requests[0].body.text.format.schema, RESEARCH_SCHEMA); assert.equal(requests[0].body.store, false);
  }
});
test('incomplete web response cannot create a successful zero finding', async () => {
  const researcher = new OpenAIResearcher({ apiKey: 'synthetic', fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) }) });
  await assert.rejects(researcher.research(setupConfig().profiles[0], { start: now.toISOString(), end: now.toISOString(), topics: ['safety'] }), /did not complete/);
});
test('manual scheduler does no research, rendering or sending', async t => {
  const { runner, calls } = await harness(t); assert.equal((await runner.tick()).status, 'paused'); assert.equal(calls.research.length + calls.synthesis + calls.render + calls.mail.length, 0);
});
test('review mode archives original evidence and exact exports, with no dispatch', async t => {
  const { runner, archive, calls } = await harness(t, { mode: 'review' }); const result = await runner.tick();
  assert.ok(result.runs.every(r => r.status === 'awaiting_review')); assert.equal(calls.mail.length, 0);
  const data = await readArchive(archive); assert.equal(data.reports.length, 3); assert.ok(data.sources.length); assert.ok(data.coverage.length);
  assert.ok((await archive.list('reports/')).every(p => p.endsWith('.md')));
  assert.ok(result.runs[1].reused_sources > 0); assert.ok(result.runs[2].reused_sources > 0);
});
test('full automatic mode sends each own distribution list once across repeat ticks', async t => {
  const { runner, archive, calls } = await harness(t, { mode: 'automatic' }); const first = await runner.tick();
  assert.ok(first.runs.every(r => r.status === 'sent')); assert.equal(calls.mail.length, 3);
  await runner.tick(); assert.equal(calls.mail.length, 3);
  const deliveries = (await archive.list('state/')).filter(p => p.startsWith('state/outbox/')); assert.equal(deliveries.length, 3);
  assert.equal(new Set(calls.mail.map(m => m.key)).size, 3);
});
test('concurrent generation claims only one research run', async t => {
  const { runner, calls, config } = await harness(t, { mode: 'review' });
  const results = await Promise.all([runner.generate(config.profiles[0]), runner.generate(config.profiles[0])]);
  assert.equal(calls.research.length, 1); assert.ok(results.some(r => r.status === 'awaiting_review'));
});
test('explicit draft never auto-sends even in fully automatic mode', async t => {
  const { runner, calls, config } = await harness(t, { mode: 'automatic' }); const draft = await runner.generate(config.profiles[0], { draft: true });
  assert.equal(draft.status, 'awaiting_review'); assert.equal(calls.mail.length, 0);
  await runner.tick(); assert.equal(calls.mail.filter(m => m.run.id === draft.id).length, 0);
});
test('successful zero findings stays a real empty report; failed research blocks all outputs', async t => {
  const good = await harness(t, { mode: 'review', zero: true }); const report = await good.runner.generate(good.config.profiles[0]);
  assert.equal(report.status, 'awaiting_review'); assert.equal((await loadRecord(good.archive, reportPath(report.id))).data.payload.items.length, 0);
  const bad = await harness(t, { mode: 'automatic', researchFails: true });
  await assert.rejects(bad.runner.generate(bad.config.profiles[0]), /unavailable/); assert.equal(bad.calls.render + bad.calls.mail.length, 0); assert.equal((await readArchive(bad.archive)).coverage.length, 0);
});
test('PDF failure holds dispatch; completed research is reused on an explicit retry', async t => {
  const { runner, calls, config, archive } = await harness(t, { mode: 'automatic', renderFails: true });
  await assert.rejects(runner.generate(config.profiles[0]), /PDF/); assert.equal(calls.mail.length, 0);
  const searchCount = calls.research.length; runner.renderer = { render: async (_payload, profile) => fixtureArtifacts(profile) };
  await runner.generate(config.profiles[0], { retry: true, draft: true }); assert.equal(calls.research.length, searchCount); assert.equal(calls.mail.length, 0);
  assert.equal((await loadRecord(archive, runPath(runId(config.profiles[0], scheduledEnd(config.profiles[0], now))))).data.status, 'awaiting_review');
});
test('uncertain mail delivery blocks retries and never falls back to duplicate send', async t => {
  const { runner, calls, config, archive } = await harness(t, { mode: 'automatic', mailFails: true });
  await assert.rejects(runner.generate(config.profiles[0]), /timeout/); assert.equal(calls.mail.length, 1);
  await runner.tick(); assert.equal(calls.mail.filter(m => m.run.profile.id === config.profiles[0].id).length, 1);
  const path = (await archive.list('state/')).find(p => p.startsWith('state/outbox/')); assert.equal((await loadRecord(archive, path)).data.status, 'uncertain');
});
test('switching to manual after generation blocks human release too', async t => {
  const { runner, config, archive, calls } = await harness(t, { mode: 'review' }); const draft = await runner.generate(config.profiles[0]);
  const current = await loadConfig(archive); current.config.mode = 'manual'; await saveConfig(archive, current.config, current.revision);
  await assert.rejects(runner.dispatch(draft.id, draft.report_revision, true), /paused/); assert.equal(calls.mail.length, 0);
});
test('changed draft revision and profile cannot release a stale reviewed report', async t => {
  const { runner, config, calls } = await harness(t, { mode: 'review' }); const draft = await runner.generate(config.profiles[0]);
  await assert.rejects(runner.dispatch(draft.id, 'stale', true), ConflictError); assert.equal(calls.mail.length, 0);
});
test('mail API uses per-recipient idempotency and DE/EN attachments; no keys in text', async () => {
  const profile = setupConfig().profiles[0], requests = [], mailer = new ResendMailer({ apiKey: 'synthetic-key', from: 'HonkyTonk <reports@example.org>', fetchImpl: async (url, request) => { requests.push({ url, request }); return { ok: true, json: async () => ({ id: 'provider-test' }) }; } });
  await mailer.send({ run: { profile, window: { ...windowFor(profile, now), report_date: '2026-10-04' } }, recipient: 'analyst@example.org', artifacts: fixtureArtifacts(profile), key: 'test-idempotency' });
  const request = requests[0].request, body = JSON.parse(request.body); assert.equal(request.headers['Idempotency-Key'], 'test-idempotency'); assert.deepEqual(body.to, ['analyst@example.org']); assert.equal(body.attachments.length, 8); assert.doesNotMatch(body.text, /synthetic-key/);
});
test('controller API requires authentication, rejects unknown origins and applies optimistic config', async t => {
  const { archive, runner } = await harness(t), token = 'synthetic-controller-token-long-enough'; const server = createAppServer({ archive, runner, adminToken: token });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve))); const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/config')).status, 401);
  assert.equal((await fetch(origin + '/api/config', { headers: { Origin: 'https://unknown.example', Authorization: 'Bearer ' + token } })).status, 403);
  const res = await fetch(origin + '/api/config', { headers: { Authorization: 'Bearer ' + token } }); assert.equal(res.status, 200);
  const loaded = await res.json(); assert.equal(loaded.config.mode, 'manual');
  const bad = await fetch(origin + '/api/config', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ config: loaded.config, revision: 'stale' }) }); assert.equal(bad.status, 409);
});
test('Courier CSS and PDF template are byte-identical to main b5ad8e6', async () => {
  const html = await readFile(new URL('../index2.html', import.meta.url), 'utf8');
  assert.equal(hash(html.match(/<style>([\s\S]*?)<\/style>/)[1]), 'ec561ce851488244857984513fb2bd25a9172633ecec50fd9caad155ec18e503');
  assert.equal(hash(html.slice(html.indexOf('function buildCleanPrintHTML(){'), html.indexOf('function showNativeFooterHint(){'))), '6239265cda8b390ebaadfda08a32acee1ef1b17cf7548a505835830e55e2ecd8');
  assert.match(html, /<details id="automationDetails">/); assert.match(html, /<option selected>letzte 36 Stunden<\/option>/);
});
