import { Buffer } from 'node:buffer';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { hash, canonicalURL, sourceDocument, iso, scheduledEnd, runId } from '../core.mjs';
import { ConflictError, loadConfig, saveConfig, loadRecord, saveRecord, readRuns } from '../records.mjs';
import { reportPath, runPath } from '../runner.mjs';
import { enqueueJob } from './jobs.mjs';

async function bodyJSON(request) {
  if (!request.body) return {};
  const reader = request.body.getReader(), parts = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2 * 1024 * 1024) throw new Error('Request body exceeds 2 MB');
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
const validId = id => /^[a-zA-Z0-9_-]{1,120}$/.test(id || '');
export function createWorkerAPI(getRuntime) {
  return async (request, env) => {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const reply = (status, data) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
    const allowed = (env.HONKYTONK_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origin && origin !== url.origin && !allowed.includes(origin)) return reply(403, { error: 'Origin not allowed' });
    if (origin && origin !== url.origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' });
    if (!url.pathname.startsWith('/api/')) return reply(404, { error: 'Not found' });
    if (request.method === 'OPTIONS') return reply(204);
    if (!env.HONKYTONK_ADMIN_TOKEN || env.HONKYTONK_ADMIN_TOKEN.length < 24) return reply(503, { error: 'Configure HONKYTONK_ADMIN_TOKEN with at least 24 characters in Worker Secrets' });
    if (!timingSafeEqual(Buffer.from(hash(env.HONKYTONK_ADMIN_TOKEN)), Buffer.from(hash((request.headers.get('Authorization') || '').replace(/^Bearer /, ''))))) return reply(401, { error: 'Authentication required' });
    try {
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]{1,100})$/);
      if (jobMatch && request.method === 'GET') {
        const instance = await env.HONKYTONK_JOBS.get(jobMatch[1]), details = await instance.status();
        return reply(200, { workflow_id: instance.id, status: details.status, error: details.error?.message || (typeof details.error === 'string' ? details.error : '') });
      }
      const { archive, runner } = await getRuntime(env);
      if (url.pathname === '/api/config' && request.method === 'GET') return reply(200, await loadConfig(archive));
      if (url.pathname === '/api/config' && request.method === 'PUT') {
        const body = await bodyJSON(request);
        if (body.config?.mode !== 'manual' && body.config?.profiles?.some(p => p.enabled)) {
          await runner.researcher.checkConfigured?.(); await runner.renderer.checkConfigured?.();
          if (!env.HONKYTONK_JOBS?.create) throw new Error('HONKYTONK_JOBS Workflow binding is required');
          if (body.config.mode === 'automatic') await runner.mailer.checkConfigured?.();
        }
        const revision = await saveConfig(archive, body.config, body.revision ?? null);
        return reply(200, { config: body.config, revision });
      }
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const { config } = await loadConfig(archive);
        return reply(200, { mode: config.mode, runtime: 'cloudflare', archive: archive.kind, research_configured: !!env.OPENAI_API_KEY, mail_configured: !!env.RESEND_API_KEY && !!env.HONKYTONK_MAIL_FROM, browser_configured: !!env.BROWSER && !!env.ASSETS, workflows_configured: !!env.HONKYTONK_JOBS });
      }
      if (url.pathname === '/api/runs' && request.method === 'GET') return reply(200, { runs: await readRuns(archive) });
      const reportMatch = url.pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]{1,120})$/);
      if (reportMatch && request.method === 'GET') {
        const entry = await loadRecord(archive, reportPath(reportMatch[1]));
        return entry ? reply(200, { report: entry.data, revision: entry.revision }) : reply(404, { error: 'Report not found' });
      }
      if (reportMatch && request.method === 'PUT') {
        const body = await bodyJSON(request), id = reportMatch[1];
        const entry = await loadRecord(archive, reportPath(id)), run = await loadRecord(archive, runPath(id));
        if (!entry || !run || !['awaiting_review', 'ready'].includes(run.data.status)) throw new Error('Draft cannot be edited');
        if (entry.revision !== body.revision) throw new ConflictError('Draft changed; reload before editing');
        if (!body.payload || typeof body.payload !== 'object') throw new Error('Complete report JSON required');
        const requestId = randomUUID();
        await saveRecord(archive, `state/requests/${requestId}.md`, { kind: 'edit-request', id: requestId, run_id: id, payload: body.payload, revision: body.revision });
        return reply(202, { ...await enqueueJob(env.HONKYTONK_JOBS, { kind: 'edit', request_id: requestId }, 'edit-' + requestId), run_id: id });
      }
      if (url.pathname === '/api/preview' && request.method === 'POST') {
        const body = await bodyJSON(request), { config } = await loadConfig(archive), profile = config.profiles.find(p => p.id === body.profile_id);
        if (!profile) throw new Error('Select a saved output profile');
        const plan = await runner.preview(profile);
        return reply(200, { window: plan.window, jobs: plan.jobs, reused_sources: plan.sources.length, candidate_imports: plan.candidates.length, previous_reports: plan.previous_reports });
      }
      if (url.pathname === '/api/run' && request.method === 'POST') {
        const body = await bodyJSON(request), { config } = await loadConfig(archive), profile = config.profiles.find(p => p.id === body.profile_id);
        if (!profile) throw new Error('Select a saved output profile');
        const end = scheduledEnd(profile, new Date()); if (!end) throw new Error('First scheduled output is still in the future');
        await runner.researcher.checkConfigured?.(); await runner.renderer.checkConfigured?.();
        const id = runId(profile, end), existing = await loadRecord(archive, runPath(id));
        if (existing && !(body.retry === true && existing.data.status === 'failed')) return reply(200, { status: existing.data.status, run_id: id });
        const instanceId = body.retry === true ? 'retry-' + randomUUID() : 'draft-' + id;
        return reply(202, { ...await enqueueJob(env.HONKYTONK_JOBS, { kind: 'generate', profile_id: profile.id, end, draft: true, retry: body.retry === true }, instanceId), run_id: id });
      }
      if (url.pathname === '/api/release' && request.method === 'POST') {
        const body = await bodyJSON(request); if (!validId(body.run_id)) throw new Error('Invalid run ID');
        const run = await loadRecord(archive, runPath(body.run_id)), report = await loadRecord(archive, reportPath(body.run_id));
        if (!run || !report || !['ready', 'awaiting_review', 'sent'].includes(run.data.status)) throw new Error('Complete report required before dispatch');
        if (run.data.status === 'sent') return reply(200, { status: 'sent', run_id: body.run_id });
        if (report.revision !== body.revision || run.data.report_revision !== body.revision) throw new ConflictError('Report changed; review again before dispatch');
        await runner.checkActive(run.data.profile); await runner.mailer.checkConfigured?.();
        return reply(202, { ...await enqueueJob(env.HONKYTONK_JOBS, { kind: 'release', run_id: body.run_id, revision: body.revision, human: true }, 'release-' + randomUUID()), run_id: body.run_id });
      }
      if (url.pathname === '/api/sources' && request.method === 'POST') {
        const body = await bodyJSON(request), { config } = await loadConfig(archive), profile = config.profiles.find(p => p.id === body.profile_id);
        if (!profile || !Array.isArray(body.items) || body.items.length > 250) throw new Error('Expected saved profile and at most 250 import blocks');
        let saved = 0; const rejected = [];
        for (const [index, item] of body.items.entries()) {
          try {
            const source_url = canonicalURL(item.url || item.source_url), raw = String(item.raw || item.snippet || item.body || '').trim();
            if (!raw || raw.length > 30000) throw new Error('Source body missing or too large');
            const id = 'import-' + hash(source_url + raw).slice(0, 32), path = `sources/imports/${id}.md`;
            if (!await archive.read(path)) await archive.write(path, sourceDocument({ id, kind: 'import', source_url, title: String(item.title || 'White Lightning import'), published_at: '', event_at: '', published_hint: String(item.date || ''), imported_at: iso(new Date()), language: String(item.language || 'und'), region: profile.region, topics: profile.topics, status: 'pending', body: raw }));
            saved++;
          } catch (error) { if (error instanceof ConflictError) saved++; else rejected.push({ item: index + 1, reason: error.message }); }
        }
        return reply(200, { saved, rejected });
      }
      return reply(404, { error: 'Endpoint not found' });
    } catch (error) { return reply(error instanceof ConflictError ? 409 : 400, { error: error.message }); }
  };
}
