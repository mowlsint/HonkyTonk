// Real Chromium integration with synthetic evidence and a local map-image stub.
// No OpenAI, GitHub, MagicPaws or mail-provider requests are made.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { LocalArchive, saveConfig, loadRecord } from '../automation/archive.mjs';
import { defaultConfig, scopeKey, windowFor, hash } from '../automation/core.mjs';
import { ExistingLayoutRenderer } from '../automation/render.mjs';
import { HonkyTonkRunner, reportPath } from '../automation/runner.mjs';
import { createAppServer } from '../automation/server.mjs';
import { fixtureSource, fixtureReport } from './automation-fixtures.mjs';

const output = process.env.HONKYTONK_QA_OUTPUT || join(tmpdir(), 'honkytonk-automation-qa');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'honkytonk-browser-data-')), archive = new LocalArchive(root);
await archive.init();
const now = new Date('2026-10-04T06:00:00Z'), config = defaultConfig(now), profile = config.profiles[0];
profile.schedule.anchorDate = '2026-09-01'; profile.topics = ['safety'];
await saveConfig(archive, config, null);
const source = fixtureSource({ scope: scopeKey(profile) });
const mapStub = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD5sAAAAASUVORK5CYII=', 'base64');
const renderer = new ExistingLayoutRenderer(undefined, async context => {
  await context.route('https://services.arcgisonline.com/**', route => route.fulfill({ body: mapStub, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }));
});
const mail = [];
const runner = new HonkyTonkRunner({ archive, renderer, now: () => now,
  researcher: {
    research: async (_profile, job) => ({ sources: [source], checks: job.topics.map(topic => ({ topic, checked: true, finding: 'findings', note_de: 'Test.', note_en: 'Test.' })), limitations_de: [], limitations_en: [], response_id: 'test-search' }),
    synthesise: async (p, plan, sources) => ({ payload: fixtureReport(p, plan.window, sources), response_id: 'test-report' })
  }, mailer: { send: async data => { mail.push(data); return 'test-email'; } }
});
const token = 'synthetic-browser-controller-token-long-enough';
const server = createAppServer({ archive, runner, adminToken: token });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch(renderer.launchOptions());
  const uiContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await uiContext.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://services.arcgisonline.com/**', route => route.fulfill({ body: mapStub, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto(origin);
  await page.waitForFunction(() => !!window.HonkyTonkAutomation);
  assert.equal(await page.locator('#automationDetails').getAttribute('open'), null);
  assert.equal(await page.locator('#period').inputValue(), 'letzte 36 Stunden');
  assert.match(await page.locator('#reportView').evaluate(el => getComputedStyle(el).fontFamily), /Courier/);
  await page.locator('#automationDetails > summary').click();
  await page.locator('#automationAdminToken').fill(token);
  await page.locator('#automationConnect').click();
  await page.waitForFunction(() => document.getElementById('automationStatus').textContent.startsWith('Verbunden.'));
  assert.equal(await page.locator('#automationMode').inputValue(), 'manual');
  await page.locator('#automationPreview').click();
  await page.waitForFunction(() => document.getElementById('automationPlan').textContent.includes('30'));
  assert.equal(mail.length, 0);
  await page.locator('#automationRun').click();
  // Controller keeps working when the initiating browser tab is closed.
  await page.waitForFunction(() => document.getElementById('automationStatus').textContent.includes('Hintergrund gestartet'));
  await page.close();
  let run;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const response = await fetch(origin + '/api/runs', { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json(); run = data.runs[0];
    if (run && run.status !== 'generating') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(run?.status, 'awaiting_review', run?.error);
  assert.equal(mail.length, 0);
  const report = (await loadRecord(archive, reportPath(run.id))).data;
  for (const [language, path] of Object.entries(report.artifacts)) {
    const artifact = (await loadRecord(archive, path)).data, pdf = Buffer.from(artifact.pdf_base64, 'base64');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.equal(hash(pdf), artifact.pdf_hash);
    assert.match(artifact.html, /data:image\/png;base64,/); assert.doesNotMatch(artifact.html, /services\.arcgisonline\.com/);
    assert.doesNotMatch(artifact.html, /automationPanel|automation-client/);
    if (language === 'en') { assert.match(artifact.html, /Last 24 hours/); assert.doesNotMatch(artifact.html, /letzte 24 Stunden/); assert.match(artifact.markdown, /Executive Summary/); }
    await writeFile(join(output, `automation-${language}.pdf`), pdf);
    await writeFile(join(output, `automation-${language}.html`), artifact.html);
  }
  const reviewPage = await uiContext.newPage();
  await reviewPage.goto(origin);
  await reviewPage.locator('#automationDetails > summary').click();
  await reviewPage.locator('#automationAdminToken').fill(token);
  await reviewPage.locator('#automationConnect').click();
  await reviewPage.getByRole('button', { name: 'Bericht prüfen', exact: true }).click();
  await reviewPage.waitForFunction(() => document.getElementById('reportView').textContent.includes('Synthetischer Hafenfall'));
  assert.equal(await reviewPage.locator('#reportView .marker').count(), 1);
  assert.deepEqual(await reviewPage.evaluate(() => reports[0].places), report.payload.items[0].places);
  await reviewPage.locator('#outputLanguage').selectOption('en');
  await reviewPage.locator('#outputLanguage').dispatchEvent('input');
  assert.match(await reviewPage.locator('#reportView').innerText(), /Last 24 hours/);
  await reviewPage.screenshot({ path: join(output, 'automation-ui.png'), fullPage: true });
  // Exported HTML opens independently, with no data/archive/controller requests.
  await reviewPage.setContent(await readFile(join(output, 'automation-en.html'), 'utf8'));
  await reviewPage.screenshot({ path: join(output, 'automation-report-en.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: optional UI, manual default, plan, background draft after tab close, shared renderer, DE/EN PDF+HTML+MD+TXT, archived review and inline images. QA output: ' + output);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
