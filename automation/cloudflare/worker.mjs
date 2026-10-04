import { WorkflowEntrypoint } from 'cloudflare:workers';
import { createWorkerAPI } from './api.mjs';
import { cloudflareRuntime } from './runtime.mjs';
import { scheduleDue, runJob } from './jobs.mjs';

export class HonkyTonkWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const runtime = await cloudflareRuntime(this.env);
    return runJob(runtime, event.payload, step, event.instanceId);
  }
}
export default {
  fetch: createWorkerAPI(cloudflareRuntime),
  async scheduled(event, env) {
    const { archive } = await cloudflareRuntime(env);
    const result = await scheduleDue(archive, env.HONKYTONK_JOBS, new Date(event.scheduledTime));
    if (result.held?.length) console.error('HonkyTonk held profiles:', result.held.map(item => item.profile_id).join(', '));
    if (result.jobs.length) console.log('HonkyTonk scheduled jobs:', result.jobs.map(job => job.workflow_id).join(', '));
  }
};
