import { MODEL_PROFILES, windowFor, scheduledEnd, localDate, runId, planResearch, dedupeSources, sourceDocument, hash, markdownDocument, iso } from './core.mjs';
import { ConflictError, loadConfig, loadRecord, saveRecord, readArchive } from './archive.mjs';
import { validateReport } from './openai.mjs';

export const runPath = id => `state/runs/${id}.md`;
export const reportPath = id => `reports/${id}-report.md`;
const guardId = id => { if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid run ID'); return id; };
const sameProfile = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class HonkyTonkRunner {
  constructor({ archive, researcher, renderer, mailer, now = () => new Date() }) {
    this.archive = archive; this.researcher = researcher; this.renderer = renderer; this.mailer = mailer; this.now = now;
  }
  async preview(profile, end = scheduledEnd(profile, this.now())) {
    if (!end) throw new Error('First scheduled output is still in the future');
    const window = { ...windowFor(profile, end), report_date: localDate(end, profile.schedule.timezone) };
    const data = await readArchive(this.archive);
    return planResearch(profile, window, data.coverage, data.sources, data.reports);
  }
  async checkActive(profile, draft = false) {
    if (draft) return;
    const { config } = await loadConfig(this.archive);
    const current = config.profiles.find(p => p.id === profile.id);
    if (config.mode === 'manual' || !current?.enabled || !sameProfile(profile, current)) throw new Error('Automation paused or profile changed');
  }
  async createArtifacts(id, payload, profile) {
    const artifacts = await this.renderer.render(payload, profile), paths = {};
    const expected = profile.language === 'both' ? ['de', 'en'] : [profile.language];
    for (const language of expected) {
      const artifact = artifacts[language];
      const pdf = Buffer.from(artifact?.pdf_base64 || '', 'base64');
      if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length < 1000 || hash(pdf) !== artifact.pdf_hash || !artifact.html || !artifact.markdown || !artifact.text) throw new Error('Incomplete rendered output; dispatch held');
      const path = `reports/${id}-${language}-artifact.md`, previous = await loadRecord(this.archive, path);
      await saveRecord(this.archive, path, { kind: 'artifact', id, status: 'complete', ...artifact }, previous?.revision || null);
      paths[language] = path;
    }
    return paths;
  }
  async generate(profile, { end = scheduledEnd(profile, this.now()), draft = false, retry = false } = {}) {
    await this.checkActive(profile, draft);
    if (!end) throw new Error('First scheduled output is still in the future');
    const id = runId(profile, end), path = runPath(id), previous = await loadRecord(this.archive, path);
    if (previous && !(retry && previous.data.status === 'failed')) return previous.data;
    let run = { kind: 'run', id, profile: structuredClone(profile), window: { ...windowFor(profile, end), report_date: localDate(end, profile.schedule.timezone) }, status: 'generating', started_at: iso(this.now()), phase: 'archive', forced_draft: draft };
    let revision;
    try { revision = await saveRecord(this.archive, path, run, previous?.revision || null); }
    catch (e) { if (e instanceof ConflictError) return { id, status: 'busy' }; throw e; }
    const update = async change => { run = { ...run, ...change }; revision = await saveRecord(this.archive, path, run, revision); };
    try {
      await this.researcher.checkConfigured?.(); await this.renderer.checkConfigured?.();
      const plan = await this.preview(profile, end), collected = [...plan.sources], checks = [];
      for (const job of plan.jobs) {
        await this.checkActive(profile, draft);
        await update({ phase: 'research' });
        const result = await this.researcher.research(profile, job, plan.candidates);
        for (const source of result.sources) {
          const sourcePath = `sources/web/${source.id}.md`;
          if (!await this.archive.read(sourcePath)) {
            try { await this.archive.write(sourcePath, sourceDocument(source)); }
            catch (e) { if (!(e instanceof ConflictError)) throw e; }
          }
        }
        const coverageId = hash(JSON.stringify(job)).slice(0, 32), coveragePath = `state/coverage/${coverageId}.md`;
        if (!await this.archive.read(coveragePath)) {
          try { await saveRecord(this.archive, coveragePath, { kind: 'coverage', id: coverageId, ...job, status: 'complete', checks: result.checks, limitations_de: result.limitations_de, limitations_en: result.limitations_en, source_ids: result.sources.map(s => s.id), response_id: result.response_id, searched_at: iso(this.now()) }); }
          catch (e) { if (!(e instanceof ConflictError)) throw e; }
        }
        collected.push(...result.sources); checks.push(...result.checks);
      }
      const archiveData = await readArchive(this.archive), sources = dedupeSources([...collected, ...planResearch(profile, run.window, archiveData.coverage, archiveData.sources).sources]);
      // Include genuine old checks (including zero findings) in the synthesis.
      plan.checks = archiveData.coverage.filter(c => c.scope === plan.scope && c.status === 'complete' && Date.parse(c.end) >= Date.parse(plan.window.start) && Date.parse(c.start) <= Date.parse(plan.window.end)).flatMap(c => c.checks.filter(check => profile.topics.includes(check.topic)).map(check => ({ ...check, start: c.start, end: c.end, reused: !plan.jobs.some(j => j.start === c.start && j.end === c.end) })));
      await this.checkActive(profile, draft);
      await update({ phase: 'synthesis' });
      const result = await this.researcher.synthesise(profile, plan, sources);
      validateReport(result.payload, sources, run.window);
      await update({ phase: 'render' });
      const artifacts = await this.createArtifacts(id, result.payload, profile);
      const report = { kind: 'report', id, status: 'complete', profile: run.profile, window: run.window, scope: plan.scope, source_ids: sources.map(s => s.id),
        reused_report_ids: plan.previous_reports.map(r => r.id), payload: result.payload, artifacts, model: profile.model,
        prompt_version: result.prompt_version || MODEL_PROFILES[profile.model].version, response_id: result.response_id, created_at: iso(this.now()) };
      const reportFile = reportPath(id), oldReport = await loadRecord(this.archive, reportFile);
      const firstArtifact = await loadRecord(this.archive, Object.values(artifacts)[0]);
      const reportRevision = await this.archive.write(reportFile, markdownDocument({ kind: 'report', id, window_start: run.window.start, window_end: run.window.end, period: run.window.label, model: profile.model }, firstArtifact.data.markdown, report), oldReport?.revision || null);
      const { config } = await loadConfig(this.archive);
      const ready = !draft && config.mode === 'automatic';
      await update({ status: ready ? 'ready' : 'awaiting_review', phase: 'complete', report_path: reportFile, report_revision: reportRevision, completed_at: iso(this.now()), source_count: sources.length, search_jobs: plan.jobs.length, reused_sources: plan.sources.length });
      if (ready) await this.dispatch(id, reportRevision);
      return (await loadRecord(this.archive, path)).data;
    } catch (error) {
      // Dispatch failures have an outbox record of their own; don't label a
      // complete research report as a failed/empty search.
      if (run.status === 'ready') {
        const current = await loadRecord(this.archive, path);
        if (current.data.status === 'ready') await saveRecord(this.archive, path, { ...current.data, error: error.message }, current.revision);
      } else await update({ status: 'failed', error: error.message, failed_at: iso(this.now()) });
      throw error;
    }
  }
  async editDraft(id, payload, expectedRevision) {
    guardId(id);
    const entry = await loadRecord(this.archive, reportPath(id)), runEntry = await loadRecord(this.archive, runPath(id));
    if (!entry || !runEntry || !['awaiting_review', 'ready'].includes(runEntry.data.status)) throw new Error('Draft cannot be edited');
    if (entry.revision !== expectedRevision) throw new ConflictError('Draft changed; reload before editing');
    if ((await this.archive.list('state/')).some(p => p.startsWith(`state/outbox/${id}-`))) throw new Error('Dispatch already started; draft is immutable');
    const data = await readArchive(this.archive), report = entry.data, sources = data.sources.filter(s => report.source_ids.includes(s.id));
    validateReport(payload, sources, report.window);
    // Claim the report before rewriting artifacts; concurrent edit/release sees
    // editing status and cannot send a mixture of versions.
    const locked = { ...runEntry.data, status: 'editing' };
    const lockRevision = await saveRecord(this.archive, runPath(id), locked, runEntry.revision);
    try {
      const artifacts = await this.createArtifacts(id, payload, report.profile);
      const primary = await loadRecord(this.archive, Object.values(artifacts)[0]);
      const updated = { ...report, payload, artifacts, reviewed_at: iso(this.now()) };
      const revision = await this.archive.write(reportPath(id), markdownDocument({ kind: 'report', id, window_start: report.window.start, window_end: report.window.end, period: report.window.label, model: report.model }, primary.data.markdown, updated), expectedRevision);
      await saveRecord(this.archive, runPath(id), { ...locked, status: 'awaiting_review', report_revision: revision }, lockRevision);
      return { report: updated, revision };
    } catch (error) {
      // An interrupted render cannot accidentally release partially new exports.
      await saveRecord(this.archive, runPath(id), { ...locked, status: 'failed', error: 'Draft edit failed: ' + error.message }, lockRevision);
      throw error;
    }
  }
  async dispatch(id, expectedRevision, humanRelease = false) {
    guardId(id);
    const entry = await loadRecord(this.archive, runPath(id)), reportEntry = await loadRecord(this.archive, reportPath(id));
    if (!entry || !reportEntry || !['ready', 'awaiting_review', 'sent'].includes(entry.data.status)) throw new Error('Complete report required before dispatch');
    if (entry.data.status === 'sent') return entry.data;
    if (expectedRevision !== reportEntry.revision || entry.data.report_revision !== expectedRevision) throw new ConflictError('Report changed; review again before dispatch');
    const run = entry.data, { config } = await loadConfig(this.archive), current = config.profiles.find(p => p.id === run.profile.id);
    if (config.mode === 'manual' || (!humanRelease && (config.mode !== 'automatic' || run.forced_draft)) || !current?.enabled || !sameProfile(current, run.profile)) throw new Error('Dispatch paused or profile changed; keep the draft for review');
    if (!run.profile.recipients.length) throw new Error('This output profile has no distribution list');
    this.mailer.checkConfigured?.();
    // CAS on the run serialises edits, human releases and scheduler dispatches.
    const claimed = { ...run, status: 'dispatching', dispatch_started_at: iso(this.now()) };
    const claimRevision = await saveRecord(this.archive, runPath(id), claimed, entry.revision);
    try {
    const artifacts = {};
    for (const [language, path] of Object.entries(reportEntry.data.artifacts)) artifacts[language] = (await loadRecord(this.archive, path))?.data;
    const sources = (await readArchive(this.archive)).sources.filter(s => reportEntry.data.source_ids.includes(s.id));
    validateReport(reportEntry.data.payload, sources, run.window);
    for (const recipient of run.profile.recipients) {
      // Re-read the global switch immediately before each person-directed action.
      await this.checkActive(run.profile);
      const latest = await loadConfig(this.archive);
      if (!humanRelease && latest.config.mode !== 'automatic') throw new Error('Automatic dispatch paused');
      const key = 'honkytonk-' + hash(id + ':' + recipient.toLowerCase()), path = `state/outbox/${id}-${hash(recipient.toLowerCase()).slice(0, 24)}.md`;
      const previous = await loadRecord(this.archive, path);
      if (previous?.data.status === 'sent') continue;
      if (previous) throw new Error('Delivery pending/uncertain; reconcile provider status before any resend');
      const pending = { kind: 'delivery', id: key, run_id: id, recipient, status: 'pending', report_revision: expectedRevision, attempted_at: iso(this.now()) };
      let revision;
      try { revision = await saveRecord(this.archive, path, pending); }
      catch (e) { if (e instanceof ConflictError) throw new Error('Another worker claimed this delivery'); throw e; }
      try {
        const providerId = await this.mailer.send({ run, recipient, artifacts, key });
        await saveRecord(this.archive, path, { ...pending, status: 'sent', provider_id: providerId, sent_at: iso(this.now()) }, revision);
      } catch (error) {
        await saveRecord(this.archive, path, { ...pending, status: 'uncertain', error: error.message }, revision).catch(() => {});
        throw error;
      }
    }
    const latestRun = await loadRecord(this.archive, runPath(id));
    const sent = { ...latestRun.data, status: 'sent', sent_at: iso(this.now()) };
    await saveRecord(this.archive, runPath(id), sent, latestRun.revision);
    return sent;
    } catch (error) {
      await saveRecord(this.archive, runPath(id), { ...claimed, status: 'delivery_held', error: error.message }, claimRevision).catch(() => {});
      throw error;
    }
  }
  async tick() {
    const { config } = await loadConfig(this.archive);
    if (config.mode === 'manual') return { status: 'paused', runs: [] };
    const runs = [];
    // One latest due slot per profile. No uncontrolled historical mail flood
    // after downtime; coverage still uses its anchored, expanded window.
    for (const profile of config.profiles.filter(p => p.enabled)) {
      const end = scheduledEnd(profile, this.now());
      if (!end) continue;
      try {
        const existing = await loadRecord(this.archive, runPath(runId(profile, end)));
        if (existing?.data.status === 'ready' && config.mode === 'automatic') runs.push(await this.dispatch(existing.data.id, existing.data.report_revision));
        else runs.push(await this.generate(profile, { end }));
      } catch (error) { runs.push({ profile_id: profile.id, status: 'held', error: error.message }); }
    }
    return { status: 'complete', runs };
  }
}
