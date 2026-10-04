import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { archiveFromEnv, loadConfig, saveConfig, readRuns, loadRecord, ConflictError } from './archive.mjs';
import { canonicalURL, hash, sourceDocument, iso } from './core.mjs';
import { OpenAIResearcher } from './openai.mjs';
import { ExistingLayoutRenderer } from './render.mjs';
import { ResendMailer } from './mail.mjs';
import { HonkyTonkRunner, reportPath } from './runner.mjs';

export function runtimeFromEnv(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.HONKYTONK_DATA_REPOSITORY) throw new Error('Production requires an independent private GitHub Markdown data repository');
  const archive = archiveFromEnv(env);
  return { archive, runner: new HonkyTonkRunner({ archive, researcher: new OpenAIResearcher({ apiKey: env.OPENAI_API_KEY }), renderer: new ExistingLayoutRenderer(), mailer: new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.HONKYTONK_MAIL_FROM }) }) };
}
async function bodyJSON(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Request body exceeds 2 MB'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function createAppServer({ archive, runner, adminToken, allowedOrigins = [], root = resolve(new URL('..', import.meta.url).pathname), env = process.env }) {
  if (!adminToken || adminToken.length < 24) throw new Error('HONKYTONK_ADMIN_TOKEN must contain at least 24 characters');
  const digest = Buffer.from(hash(adminToken));
  const authorised = req => timingSafeEqual(Buffer.from(hash((req.headers.authorization || '').replace(/^Bearer /, ''))), digest);
  const staticAssets = new Map([['/', ['index2.html', 'text/html']], ['/index2.html', ['index2.html', 'text/html']], ['/automation-client.js', ['automation-client.js', 'text/javascript']], ['/honkytonk.png', ['honkytonk.png', 'image/png']], ['/honkytonk_mini.png', ['honkytonk_mini.png', 'image/png']], ['/honkytonk.ico', ['honkytonk.ico', 'image/x-icon']]]);
  let executing = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), origin = req.headers.origin;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    let sameOrigin = false;
    try { sameOrigin = !!origin && new URL(origin).host === req.headers.host; }
    catch { res.writeHead(403); res.end('Invalid origin'); return; }
    if (origin && !sameOrigin && !allowedOrigins.includes(origin)) { res.writeHead(403); res.end('Origin not allowed'); return; }
    if (origin && !sameOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!url.pathname.startsWith('/api/')) {
      const asset = staticAssets.get(url.pathname);
      if (!asset || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
      try { res.writeHead(200, { 'Content-Type': asset[1] + (asset[1].startsWith('text/') ? '; charset=utf-8' : '') }); res.end(await readFile(resolve(root, asset[0]))); }
      catch { res.writeHead(500); res.end('Static asset unavailable'); }
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const reply = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (!authorised(req)) { reply(401, { error: 'Authentication required' }); return; }
    try {
      if (url.pathname === '/api/config' && req.method === 'GET') { reply(200, await loadConfig(archive)); return; }
      if (url.pathname === '/api/config' && req.method === 'PUT') {
        const body = await bodyJSON(req);
        if (body.config?.mode !== 'manual' && body.config?.profiles?.some(p => p.enabled)) {
          await runner.researcher.checkConfigured?.(); await runner.renderer.checkConfigured?.();
          if (body.config.mode === 'automatic') runner.mailer.checkConfigured?.();
        }
        const revision = await saveConfig(archive, body.config, body.revision ?? null);
        reply(200, { config: body.config, revision }); return;
      }
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const { config } = await loadConfig(archive);
        reply(200, { mode: config.mode, archive: archive.kind, research_configured: !!env.OPENAI_API_KEY, mail_configured: !!env.RESEND_API_KEY && !!env.HONKYTONK_MAIL_FROM, busy: executing }); return;
      }
      if (url.pathname === '/api/runs' && req.method === 'GET') {
        reply(200, { runs: await readRuns(archive) }); return;
      }
      const reportMatch = url.pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]{1,120})$/);
      if (reportMatch && req.method === 'GET') {
        const entry = await loadRecord(archive, reportPath(reportMatch[1]));
        if (!entry) { reply(404, { error: 'Report not found' }); return; }
        reply(200, { report: entry.data, revision: entry.revision }); return;
      }
      if (reportMatch && req.method === 'PUT') {
        const body = await bodyJSON(req);
        reply(200, await runner.editDraft(reportMatch[1], body.payload, body.revision)); return;
      }
      if (url.pathname === '/api/preview' && req.method === 'POST') {
        const body = await bodyJSON(req), { config } = await loadConfig(archive), profile = config.profiles.find(p => p.id === body.profile_id);
        if (!profile) throw new Error('Select a saved output profile');
        const plan = await runner.preview(profile);
        reply(200, { window: plan.window, jobs: plan.jobs, reused_sources: plan.sources.length, candidate_imports: plan.candidates.length, previous_reports: plan.previous_reports }); return;
      }
      if (url.pathname === '/api/run' && req.method === 'POST') {
        if (executing) { reply(409, { error: 'Background run already active' }); return; }
        const body = await bodyJSON(req), { config } = await loadConfig(archive), profile = config.profiles.find(p => p.id === body.profile_id);
        if (!profile) throw new Error('Select a saved output profile');
        executing = true;
        // Explicit button generates a review draft in EVERY global mode.
        // Long jobs continue after the browser disconnects; poll /api/runs.
        const job = runner.generate(profile, { draft: true, retry: body.retry === true }).catch(error => console.error('HonkyTonk draft held:', error.message)).finally(() => { executing = false; });
        void job;
        reply(202, { status: 'started' }); return;
      }
      if (url.pathname === '/api/release' && req.method === 'POST') {
        const body = await bodyJSON(req);
        reply(200, await runner.dispatch(body.run_id, body.revision, true)); return;
      }
      if (url.pathname === '/api/sources' && req.method === 'POST') {
        const body = await bodyJSON(req), { config } = await loadConfig(archive), profile = config.profiles.find(p => p.id === body.profile_id);
        if (!profile || !Array.isArray(body.items) || body.items.length > 250) throw new Error('Expected saved profile and at most 250 import blocks');
        let saved = 0; const rejected = [];
        for (let i = 0; i < body.items.length; i++) {
          const item = body.items[i];
          try {
            const sourceURL = canonicalURL(item.url || item.source_url), raw = String(item.raw || item.snippet || item.body || '').trim();
            if (!raw || raw.length > 30000) throw new Error('Source body missing or too large');
            const id = 'import-' + hash(sourceURL + raw).slice(0, 32), path = `sources/imports/${id}.md`;
            const source = { id, kind: 'import', source_url: sourceURL, title: String(item.title || 'White Lightning import'), published_at: '', event_at: '', published_hint: String(item.date || ''), imported_at: iso(new Date()), language: String(item.language || 'und'), region: profile.region, topics: profile.topics, status: 'pending', body: raw };
            if (!await archive.read(path)) await archive.write(path, sourceDocument(source));
            saved++;
          } catch (error) { if (error instanceof ConflictError) saved++; else rejected.push({ item: i + 1, reason: error.message }); }
        }
        reply(200, { saved, rejected }); return;
      }
      reply(404, { error: 'Endpoint not found' });
    } catch (error) { reply(error instanceof ConflictError ? 409 : 400, { error: error.message }); }
  });
  // Server-side timer, no browser tab required. Mode is re-read from Markdown.
  server.startScheduler = (interval = 60000) => {
    const timer = setInterval(async () => {
      if (executing) return;
      executing = true;
      try { const result = await runner.tick(); if (result.runs.length) console.log('HonkyTonk scheduler:', JSON.stringify(result.runs.map(r => ({ id: r.id, profile_id: r.profile_id, status: r.status, error: r.error })))); }
      catch (error) { console.error('HonkyTonk scheduler held:', error.message); }
      finally { executing = false; }
    }, interval);
    timer.unref(); server.on('close', () => clearInterval(timer));
  };
  return server;
}
