// Real Chromium executes the Cloudflare adapter with local Assets and a map stub.
// Workflow/API integration uses synthetic providers; no external API or mail.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { LocalArchive } from '../automation/archive.mjs';
import { saveConfig, loadRecord } from '../automation/records.mjs';
import { defaultConfig, scopeKey, hash } from '../automation/core.mjs';
import { HonkyTonkRunner, reportPath } from '../automation/runner.mjs';
import { CloudflareRenderer } from '../automation/cloudflare/render.mjs';
import { createWorkerAPI } from '../automation/cloudflare/api.mjs';
import { runJob } from '../automation/cloudflare/jobs.mjs';
import { fixtureSource, fixtureReport } from './automation-fixtures.mjs';

const root = await mkdtemp(join(tmpdir(), 'honkytonk-cloudflare-browser-'));
const output = process.env.HONKYTONK_QA_OUTPUT || join(tmpdir(), 'honkytonk-automation-qa'); await mkdir(output, { recursive: true });
const archive = new LocalArchive(root); await archive.init();
const now = new Date('2026-10-04T06:00:00Z'), config = defaultConfig(now), profile = config.profiles[0];
profile.schedule.anchorDate = '2026-09-01'; profile.topics = ['safety']; profile.enabled = true; profile.recipients = ['synthetic@example.org'];
await saveConfig(archive, config, null);
const source = fixtureSource({ scope: scopeKey(profile) });
const files = new Map([['/index2.html', ['index2.html', 'text/html']], ['/automation-client.js', ['automation-client.js', 'text/javascript']], ['/honkytonk.png', ['honkytonk.png', 'image/png']], ['/honkytonk_mini.png', ['honkytonk_mini.png', 'image/png']]]);
const assetReads = [], env = { BROWSER: {}, ASSETS: { async fetch(request) {
  const path = new URL(request.url).pathname, file = files.get(path); assetReads.push(path);
  return file ? new Response(await readFile(resolve(file[0])), { headers: { 'Content-Type': file[1] } }) : new Response('', { status: 404 });
} }, HONKYTONK_ADMIN_TOKEN: 'synthetic-cloudflare-browser-token-long-enough' };
const mapImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD5sAAAAASUVORK5CYII=', 'base64');
const launchOptions = { headless: true, ...(process.env.HONKYTONK_CHROMIUM_PATH ? { executablePath: process.env.HONKYTONK_CHROMIUM_PATH } : {}) };
const renderer = new CloudflareRenderer(env, { launchBrowser: () => chromium.launch(launchOptions), configureContext: async context => {
  await context.route('https://services.arcgisonline.com/**', route => route.fulfill({ body: mapImage, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }));
} });
const mail = [], runner = new HonkyTonkRunner({ archive, renderer, now: () => now,
  researcher: { checkConfigured() {}, research: async (_profile, job) => ({ sources: [source], checks: job.topics.map(topic => ({ topic, checked: true, finding: 'findings', note_de: 'Test.', note_en: 'Test.' })), limitations_de: [], limitations_en: [], response_id: 'synthetic-search' }), synthesise: async (p, plan, sources) => ({ payload: fixtureReport(p, plan.window, sources), response_id: 'synthetic-report' }) },
  mailer: { checkConfigured() {}, send: async data => { mail.push(data); return 'synthetic-provider'; } }
});
const jobs = new Map(); env.HONKYTONK_JOBS = { async create({ id, params }) { if (jobs.has(id)) throw new Error('Duplicate workflow'); const instance = { id, params, state: 'queued', async status() { return { status: this.state }; } }; jobs.set(id, instance); return instance; }, async get(id) { if (!jobs.has(id)) throw new Error('Missing workflow'); return jobs.get(id); } };
async function finishJob(job) {
  job.state = 'running'; const cache = new Map();
  try { job.result = await runJob({ archive, runner }, job.params, { async do(name, options, action) { assert.equal(options.retries.limit, 0); if (!cache.has(name)) cache.set(name, await action()); return structuredClone(cache.get(name)); } }, job.id); job.state = 'complete'; }
  catch (error) { job.state = 'errored'; throw error; }
}
const api = createWorkerAPI(async () => ({ archive, runner }));
const server = createServer(async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${server.address().port}`, url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await api(new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = files.get(url.pathname === '/' ? '/index2.html' : url.pathname);
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file[1] }); res.end(await readFile(resolve(file[0])));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch(launchOptions); const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.route('https://services.arcgisonline.com/**', route => route.fulfill({ body: mapImage, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.locator('#automationDetails > summary').click(); await page.locator('#automationAdminToken').fill(env.HONKYTONK_ADMIN_TOKEN); await page.locator('#automationConnect').click();
  await page.waitForFunction(() => document.getElementById('automationStatus').textContent.startsWith('Verbunden.'));
  assert.equal(await page.locator('#automationMode').inputValue(), 'manual');
  await page.locator('#automationRun').click(); await page.waitForFunction(() => document.getElementById('automationStatus').textContent.includes('Hintergrund gestartet'));
  assert.equal(jobs.size, 1); assert.equal(mail.length, 0); await page.close();
  const job = [...jobs.values()][0]; await finishJob(job); assert.equal(job.result.status, 'awaiting_review');
  assert.ok(assetReads.includes('/index2.html')); assert.ok(assetReads.includes('/honkytonk.png'));
  const report = (await loadRecord(archive, reportPath(job.result.run_id))).data;
  for (const [language, path] of Object.entries(report.artifacts)) {
    const artifact = (await loadRecord(archive, path)).data, pdf = Buffer.from(artifact.pdf_base64, 'base64');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.equal(hash(pdf), artifact.pdf_hash);
    assert.match(artifact.html, /Courier/); assert.match(artifact.html, /data:image\/png;base64,/); assert.doesNotMatch(artifact.html, /honkytonk-render\.invalid|services\.arcgisonline\.com|automation-client/);
    if (language === 'en') { for (const text of [artifact.html, artifact.markdown, artifact.text]) { assert.match(text, /Last 24 hours/); assert.doesNotMatch(text, /letzte 24 Stunden/); } }
    await writeFile(join(output, `cloudflare-${language}.pdf`), pdf); await writeFile(join(output, `cloudflare-${language}.html`), artifact.html);
  }
  const review = await context.newPage(); review.on('pageerror', error => errors.push(error.message)); await review.goto(origin); await review.locator('#automationDetails > summary').click(); await review.locator('#automationAdminToken').fill(env.HONKYTONK_ADMIN_TOKEN); await review.locator('#automationConnect').click();
  await review.waitForFunction(() => document.getElementById('automationStatus').textContent.startsWith('Verbunden.'));
  await review.locator('#automationMode').selectOption('review'); await review.locator('#automationSave').click(); await review.waitForFunction(() => document.getElementById('automationStatus').textContent.includes('Controller gespeichert'));
  await review.getByRole('button', { name: 'Bericht prüfen', exact: true }).click(); await review.waitForFunction(() => document.getElementById('automationDraftJson').value.includes('Synthetic harbour'));
  await review.getByText('Geladenen Automatikentwurf bearbeiten', { exact: true }).click();
  const edited = JSON.parse(await review.locator('#automationDraftJson').inputValue()); edited.meta.report_summary_en += ' Reviewed by operator.';
  await review.locator('#automationDraftJson').fill(JSON.stringify(edited, null, 2)); assert.equal(await review.locator('#automationRelease').isDisabled(), true);
  await review.locator('#automationDraftSave').click(); await review.waitForFunction(() => document.getElementById('automationStatus').textContent.includes('Änderung im Hintergrund'));
  assert.equal(await review.locator('#automationRelease').isDisabled(), true);
  const editJob = [...jobs.values()].find(j => j.params.kind === 'edit'); assert.ok(editJob); await finishJob(editJob);
  await review.locator('#automationRefresh').click(); await review.getByRole('button', { name: 'Bericht prüfen', exact: true }).click(); await review.waitForFunction(() => !document.getElementById('automationRelease').disabled);
  await review.locator('#automationRelease').click(); await review.waitForFunction(() => document.getElementById('automationStatus').textContent.includes('Freigabe im Hintergrund'));
  assert.equal(mail.length, 0); const releaseJob = [...jobs.values()].find(j => j.params.kind === 'release'); await finishJob(releaseJob); assert.equal(mail.length, 1);
  await review.locator('#automationRefresh').click(); await review.waitForFunction(() => document.getElementById('automationRuns').textContent.includes('sent'));
  assert.deepEqual(errors, []);
  console.log('PASS: Cloudflare Assets/Browser adapter, DE/EN PDF/HTML/MD/TXT, tab-close background draft, asynchronous edit/review/release, and dispatch status. QA output: ' + output);
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
