import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalArchive } from '../automation/archive.mjs';
import { loadRecord, loadConfig, saveConfig, saveRecord, readArchive } from '../automation/records.mjs';
import { defaultConfig, hash, scheduledEnd, runId } from '../automation/core.mjs';
import { HonkyTonkRunner, runPath, reportPath } from '../automation/runner.mjs';
import { createWorkerAPI } from '../automation/cloudflare/api.mjs';
import { durableStages, enqueueJob, scheduleDue, runJob } from '../automation/cloudflare/jobs.mjs';
import { CloudflareRenderer } from '../automation/cloudflare/render.mjs';
import { fixtureSource, fixtureReport, fixtureArtifacts } from './automation-fixtures.mjs';

const now = new Date('2026-10-04T06:00:00Z');
const token = 'synthetic-cloudflare-test-token-long-enough';
class Steps {
  constructor() { this.cache = new Map(); this.calls = []; this.interrupt = false; }
  async do(name, options, action) {
    this.calls.push({ name, options });
    assert.equal(options.retries.limit, 0);
    if (this.interrupt && ['render-artifacts', 'status-failed'].includes(name)) throw new Error('Synthetic process interruption');
    if (!this.cache.has(name)) this.cache.set(name, structuredClone(await action()));
    return structuredClone(this.cache.get(name));
  }
}
function binding() {
  const jobs = new Map();
  return { jobs,
    async create({ id, params }) { assert.ok(id.length <= 100); if (jobs.has(id)) throw new Error('Duplicate ID'); const job = { id, params, status: async () => ({ status: 'queued' }) }; jobs.set(id, job); return job; },
    async get(id) { if (!jobs.has(id)) throw new Error('Missing job'); return jobs.get(id); }
  };
}
async function harness(t, mode = 'manual') {
  const root = await mkdtemp(join(tmpdir(), 'honkytonk-cloudflare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = new LocalArchive(root); await archive.init();
  const config = defaultConfig(now); config.mode = mode;
  config.profiles.forEach(p => { p.enabled = true; p.schedule.anchorDate = '2026-09-01'; p.topics = ['safety']; p.recipients = ['analyst@example.org']; });
  const calls = { search: 0, synthesis: 0, render: 0, send: 0 };
  const researcher = { checkConfigured() {},
    async research(_profile, job) { calls.search++; const event = new Date(Date.parse(job.start) + 36e5).toISOString(); return { sources: [fixtureSource({ id: hash(job.start + job.end).slice(0, 16), scope: job.scope, topics: job.topics, event_at: event, published_at: event })], checks: job.topics.map(topic => ({ topic, checked: true, finding: 'findings', note_de: 'Geprüft.', note_en: 'Checked.' })), limitations_de: [], limitations_en: [], response_id: 'synthetic-search' }; },
    async synthesise(profile, plan, sources) { calls.synthesis++; return { payload: fixtureReport(profile, plan.window, sources), response_id: 'synthetic-synthesis' }; }
  };
  const renderer = { checkConfigured() {}, async render(_payload, profile) { calls.render++; return fixtureArtifacts(profile); } };
  const mailer = { checkConfigured() {}, async send() { calls.send++; return 'synthetic-provider-id'; } };
  await saveConfig(archive, config, null);
  const runner = new HonkyTonkRunner({ archive, researcher, renderer, mailer, now: () => now });
  return { archive, runner, config, calls };
}
function apiFor(runtime, jobs = binding()) {
  const env = { HONKYTONK_ADMIN_TOKEN: token, HONKYTONK_ALLOWED_ORIGINS: 'https://honkytonk.pages.dev', HONKYTONK_JOBS: jobs };
  const api = createWorkerAPI(async () => runtime);
  return { env, jobs, request: (path, method = 'GET', body, extra = {}) => api(new Request('https://controller.example/api/' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env) };
}
const paramsFor = (profile, draft = true) => ({ kind: 'generate', profile_id: profile.id, end: scheduledEnd(profile, now), draft });

test('scheduled manual mode queues no jobs; three profiles keep expanded windows and anchored cutoffs', async t => {
  const h = await harness(t), jobs = binding();
  assert.deepEqual(await scheduleDue(h.archive, jobs, now), { status: 'paused', jobs: [] });
  const stored = await loadConfig(h.archive); h.config.mode = 'review'; await saveConfig(h.archive, h.config, stored.revision);
  await scheduleDue(h.archive, jobs, new Date(now.getTime() + 9 * 60000));
  assert.equal(jobs.jobs.size, 3); assert.equal(h.calls.search, 0);
  for (const p of h.config.profiles) { const job = [...jobs.jobs.values()].find(j => j.params.profile_id === p.id); assert.equal(job.params.end, scheduledEnd(p, now)); assert.equal(job.params.draft, false); }
  await scheduleDue(h.archive, jobs, now); assert.equal(jobs.jobs.size, 3);
});
test('scheduled profiles isolate enqueue failures and skip uncertain deliveries', async t => {
  const h = await harness(t, 'automatic'), jobs = binding(), create = jobs.create;
  jobs.create = async input => { if (input.params.profile_id === h.config.profiles[0].id) throw new Error('Synthetic enqueue failure'); return create(input); };
  const result = await scheduleDue(h.archive, jobs, now); assert.equal(result.held.length, 1); assert.equal(result.jobs.length, 2);
  const p = h.config.profiles[1], id = runId(p, scheduledEnd(p, now)); await saveRecord(h.archive, runPath(id), { kind: 'run', id, status: 'delivery_held' });
  const next = binding(); await scheduleDue(h.archive, next, now); assert.equal(next.jobs.size, 2); assert.ok(!next.jobs.has('generate-' + id));
});
test('enqueue returns only a verified existing instance and does not hide unrelated failures', async () => {
  const jobs = binding(); await enqueueJob(jobs, { kind: 'generate' }, 'stable');
  assert.equal((await enqueueJob(jobs, {}, 'stable')).status, 'existing');
  await assert.rejects(enqueueJob({ create: async () => { throw new Error('Creation unavailable'); }, get: async () => { throw new Error('Missing'); } }, {}, 'new'), /Creation unavailable/);
});
test('large step values stay in private Markdown and replay survives a missing engine acknowledgement', async t => {
  const { archive } = await harness(t); let actions = 0;
  const stage = durableStages(archive, new Steps(), 'large-job');
  const value = { text: 'x'.repeat(1100000) };
  assert.deepEqual(await stage('large', async () => { actions++; return value; }), value);
  const fresh = new Steps(), replay = durableStages(archive, fresh, 'large-job');
  assert.deepEqual(await replay('large', () => { actions++; throw new Error('Must not rerun'); }), value);
  assert.equal(actions, 1); assert.ok(JSON.stringify(fresh.cache.get('large')).length < 200);
});
test('failed actions are not recorded as successful coverage or checkpoints', async t => {
  const { archive } = await harness(t), step = new Steps(), stage = durableStages(archive, step, 'failed-job');
  await assert.rejects(stage('research', async () => { throw new Error('Search unavailable'); }), /Search unavailable/);
  assert.equal(step.cache.size, 0); assert.equal((await archive.list('state/')).filter(p => p.includes('checkpoints/')).length, 0);
});
test('Workflow replay finishes an interrupted render without repeating completed research or synthesis', async t => {
  const h = await harness(t), step = new Steps(), p = h.config.profiles[0], params = paramsFor(p);
  step.interrupt = true;
  await assert.rejects(runJob(h, params, step, 'draft-interruption'), /process interruption/);
  const id = runId(p, params.end), pending = await loadRecord(h.archive, runPath(id));
  assert.equal(pending.data.status, 'generating'); assert.equal(pending.data.phase, 'render');
  assert.equal(h.calls.search, 1); assert.equal(h.calls.synthesis, 1); assert.equal(h.calls.render, 0);
  step.interrupt = false;
  const result = await runJob(h, params, step, 'draft-interruption');
  assert.equal(result.status, 'awaiting_review'); assert.deepEqual(h.calls, { search: 1, synthesis: 1, render: 1, send: 0 });
  await runJob(h, params, new Steps(), 'draft-interruption');
  assert.deepEqual(h.calls, { search: 1, synthesis: 1, render: 1, send: 0 });
});
test('automatic Workflow dispatch and replay send once; manual drafts never dispatch automatically', async t => {
  const h = await harness(t, 'automatic'), p = h.config.profiles[0], params = paramsFor(p, false), step = new Steps();
  const result = await runJob(h, params, step, 'automatic-test'); assert.equal(result.status, 'sent');
  assert.deepEqual(step.cache.get('dispatch'), { run_id: result.run_id, status: 'sent' });
  await runJob(h, params, new Steps(), 'automatic-test'); assert.equal(h.calls.send, 1); assert.equal(h.calls.search, 1);
  const draft = await runJob(h, paramsFor(h.config.profiles[1]), new Steps(), 'explicit-draft');
  assert.equal(draft.status, 'awaiting_review'); assert.equal(h.calls.send, 1);
});
test('ambiguous provider result holds the run and replay cannot resend or claim success', async t => {
  const h = await harness(t, 'automatic'), params = paramsFor(h.config.profiles[0], false);
  h.runner.mailer.send = async () => { h.calls.send++; throw new Error('Provider timeout'); };
  await assert.rejects(runJob(h, params, new Steps(), 'uncertain-test'), /Provider timeout/);
  await assert.rejects(runJob(h, params, new Steps(), 'uncertain-test'), /uncertain/);
  assert.equal(h.calls.send, 1); assert.equal((await loadRecord(h.archive, runPath(runId(h.config.profiles[0], params.end)))).data.status, 'delivery_held');
});
test('Cloudflare API rejects origin and auth before touching archive or launching browsers', async () => {
  let reads = 0; const api = createWorkerAPI(async () => { reads++; throw new Error('Unexpected archive access'); });
  const env = { HONKYTONK_ADMIN_TOKEN: token, HONKYTONK_ALLOWED_ORIGINS: 'https://honkytonk.pages.dev' };
  assert.equal((await api(new Request('https://controller.example/api/config'), env)).status, 401);
  assert.equal((await api(new Request('https://controller.example/api/config', { headers: { Origin: 'https://other.example', Authorization: 'Bearer ' + token } }), env)).status, 403);
  const preflight = await api(new Request('https://controller.example/api/config', { method: 'OPTIONS', headers: { Origin: 'https://honkytonk.pages.dev' } }), env);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://honkytonk.pages.dev'); assert.equal(reads, 0);
});
test('Cloudflare API queues drafts without inline research and uses distinct scheduled/draft IDs', async t => {
  const h = await harness(t), { request, jobs } = apiFor(h);
  const response = await request('run', 'POST', { profile_id: h.config.profiles[0].id }); assert.equal(response.status, 202);
  const result = await response.json(); assert.match(result.workflow_id, /^draft-/); assert.equal(h.calls.search, 0);
  assert.equal(jobs.jobs.get(result.workflow_id).params.draft, true);
  assert.equal((await (await request('jobs/' + result.workflow_id)).json()).status, 'queued');
});
test('draft changes render in a Workflow; stale release cannot be queued', async t => {
  const h = await harness(t, 'review'), p = h.config.profiles[0];
  const result = await runJob(h, paramsFor(p), new Steps(), 'original-draft'), report = await loadRecord(h.archive, reportPath(result.run_id));
  const edited = structuredClone(report.data.payload); edited.meta.report_summary_en += ' Reviewed.';
  const { request, jobs } = apiFor(h);
  const response = await request('reports/' + result.run_id, 'PUT', { revision: report.revision, payload: edited }); assert.equal(response.status, 202);
  const job = jobs.jobs.get((await response.json()).workflow_id); assert.deepEqual(Object.keys(job.params).sort(), ['kind', 'request_id']);
  assert.equal(h.calls.render, 1); await runJob(h, job.params, new Steps(), job.id); assert.equal(h.calls.render, 2);
  assert.equal((await request('release', 'POST', { run_id: result.run_id, revision: report.revision })).status, 409); assert.equal(h.calls.send, 0);
  const latest = await loadRecord(h.archive, reportPath(result.run_id)), release = await request('release', 'POST', { run_id: result.run_id, revision: latest.revision }); assert.equal(release.status, 202);
  const releaseJob = jobs.jobs.get((await release.json()).workflow_id); await runJob(h, releaseJob.params, new Steps(), releaseJob.id); assert.equal(h.calls.send, 1);
});
test('pausing saved mode blocks queued release and edits remain drafts', async t => {
  const h = await harness(t, 'review'), generated = await runJob(h, paramsFor(h.config.profiles[0]), new Steps(), 'pause-draft');
  const report = await loadRecord(h.archive, reportPath(generated.run_id)), saved = await loadConfig(h.archive); h.config.mode = 'manual'; await saveConfig(h.archive, h.config, saved.revision);
  await assert.rejects(runJob(h, { kind: 'release', run_id: generated.run_id, revision: report.revision, human: true }, new Steps(), 'paused-release'), /paused/); assert.equal(h.calls.send, 0);
});
test('research planner skips Workflow checkpoints, requests and outbox files', async t => {
  const h = await harness(t);
  await h.archive.write('state/checkpoints/opaque.md', 'not a source document'); await h.archive.write('state/requests/opaque.md', 'not a source document'); await h.archive.write('state/outbox/opaque.md', 'not a source document');
  assert.deepEqual((await readArchive(h.archive)).coverage, []);
});
test('API optimistic config, body limit and missing rendering bindings hold safely', async t => {
  const h = await harness(t), { request } = apiFor(h), loaded = await loadConfig(h.archive);
  assert.equal((await request('config', 'PUT', { config: h.config, revision: 'stale' })).status, 409);
  assert.equal((await request('sources', 'POST', { items: ['x'.repeat(2100000)] })).status, 400);
  h.runner.renderer = new CloudflareRenderer({}); h.config.mode = 'review';
  assert.equal((await request('config', 'PUT', { config: h.config, revision: loaded.revision })).status, 400);
  assert.equal((await loadConfig(h.archive)).config.mode, 'manual');
});
