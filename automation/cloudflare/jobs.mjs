import { hash, scheduledEnd, runId } from '../core.mjs';
import { loadConfig, loadRecord, saveRecord } from '../records.mjs';
import { runPath } from '../runner.mjs';

export const STEP_OPTIONS = Object.freeze({ retries: { limit: 0, delay: '5 seconds' }, timeout: '15 minutes' });

// Cloudflare checkpoints store small path references only. Full values, even
// large bilingual reports, are durable Markdown in the user's private archive.
export function durableStages(archive, step, instanceId) {
  const prefix = hash(instanceId).slice(0, 32);
  return async (name, action) => {
    const path = `state/checkpoints/${prefix}-${hash(name).slice(0, 24)}.md`;
    const saved = await step.do(name, STEP_OPTIONS, async () => {
      // Handle the narrow window after GitHub accepted a checkpoint but before
      // the Workflow engine acknowledged it, without repeating a paid action.
      const previous = await loadRecord(archive, path);
      if (previous) {
        if (previous.data.instance_id !== instanceId || previous.data.step !== name) throw new Error('Checkpoint identity mismatch');
        return { path };
      }
      const value = await action();
      await saveRecord(archive, path, { kind: 'checkpoint', id: prefix, instance_id: instanceId, step: name, status: 'complete', value: value ?? null });
      return { path };
    });
    if (saved.path !== path) throw new Error('Checkpoint path mismatch');
    const record = await loadRecord(archive, path);
    if (!record || record.data.instance_id !== instanceId || record.data.step !== name) throw new Error('Workflow checkpoint missing or changed');
    return record.data.value;
  };
}
export async function enqueueJob(binding, params, id) {
  if (!binding?.create) throw new Error('HONKYTONK_JOBS Workflow binding is required');
  try { const instance = await binding.create({ id, params }); return { status: 'started', workflow_id: instance.id }; }
  catch (error) {
    // A stable scheduled ID might already be queued. Never interpret an
    // unrelated create failure as a successful background job.
    try { const instance = await binding.get(id); const status = await instance.status(); return { status: 'existing', workflow_id: instance.id, workflow_status: status.status }; }
    catch { throw error; }
  }
}
export async function scheduleDue(archive, binding, now) {
  const { config } = await loadConfig(archive);
  if (config.mode === 'manual') return { status: 'paused', jobs: [] };
  const jobs = [], held = [];
  for (const profile of config.profiles.filter(p => p.enabled)) {
    try {
      const end = scheduledEnd(profile, now);
      if (!end) continue;
      const id = runId(profile, end), existing = await loadRecord(archive, runPath(id));
      if (existing && existing.data.status !== 'ready') continue;
      const params = existing ? { kind: 'release', run_id: id, revision: existing.data.report_revision, human: false } : { kind: 'generate', profile_id: profile.id, end, draft: false, retry: false };
      // Review mode never dispatches an already-ready report.
      if (existing && config.mode !== 'automatic') continue;
      jobs.push(await enqueueJob(binding, params, (existing ? 'send-' : 'generate-') + id));
    } catch (error) { held.push({ profile_id: profile.id, status: 'held', error: error.message }); }
  }
  return { status: 'complete', jobs, held };
}
export async function runJob({ archive, runner }, params, step, instanceId) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(instanceId)) throw new Error('Invalid Workflow ID');
  const stage = durableStages(archive, step, instanceId);
  runner.stage = stage; runner.autoDispatch = false; runner.runtime = { runtime: 'cloudflare', workflow_id: instanceId };
  if (params.kind === 'generate') {
    const profile = await stage('selected-profile', async () => {
      const { config } = await loadConfig(archive), selected = config.profiles.find(p => p.id === params.profile_id);
      if (!selected) throw new Error('Output profile no longer exists');
      return selected;
    });
    const run = await runner.generate(profile, { end: params.end, draft: params.draft === true, retry: params.retry === true });
    if (run.status === 'ready' && !params.draft) await step.do('dispatch', STEP_OPTIONS, async () => {
      const sent = await runner.dispatch(run.id, run.report_revision);
      return { run_id: sent.id, status: sent.status };
    });
    const current = await loadRecord(archive, runPath(run.id));
    if (['dispatching', 'delivery_held'].includes(current?.data.status)) throw new Error('Delivery pending/uncertain; reconcile provider status before any resend');
    return { run_id: run.id, status: current?.data.status || run.status };
  }
  if (params.kind === 'release') {
    return step.do('dispatch', STEP_OPTIONS, async () => {
      const result = await runner.dispatch(params.run_id, params.revision, params.human === true);
      return { run_id: result.id, status: result.status };
    });
  }
  if (params.kind === 'edit') {
    const result = await stage('edit-draft', async () => {
      const request = await loadRecord(archive, `state/requests/${params.request_id}.md`);
      if (!request || request.data.kind !== 'edit-request') throw new Error('Draft edit request missing');
      const edited = await runner.editDraft(request.data.run_id, request.data.payload, request.data.revision);
      return { run_id: request.data.run_id, revision: edited.revision };
    });
    return { ...result, status: 'awaiting_review' };
  }
  throw new Error('Unknown Workflow operation');
}
