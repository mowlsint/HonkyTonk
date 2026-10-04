import { runtimeFromEnv, createAppServer } from '../automation/server.mjs';
import { loadConfig, saveConfig } from '../automation/archive.mjs';

const command = process.argv[2] || 'plan', args = process.argv.slice(3);
const value = flag => args[args.indexOf(flag) + 1];
const { archive, runner } = runtimeFromEnv();
await archive.init();
if (command === 'init') {
  const { config, revision } = await loadConfig(archive);
  if (revision) throw new Error('Configuration already exists; use the UI to update it');
  await saveConfig(archive, config, null);
  console.log('HonkyTonk Markdown configuration created; manual mode, all schedules disabled.');
} else if (command === 'serve') {
  const server = createAppServer({ archive, runner, adminToken: process.env.HONKYTONK_ADMIN_TOKEN, allowedOrigins: (process.env.HONKYTONK_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean) });
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('HonkyTonk controller listening on port ' + server.address().port));
  server.startScheduler();
} else if (command === 'tick') {
  const result = await runner.tick();
  console.log(JSON.stringify(result, null, 2));
  if (result.runs.some(r => r.status === 'held' || r.status === 'failed' || r.status === 'delivery_held')) process.exitCode = 1;
} else if (command === 'plan' || command === 'draft') {
  const { config } = await loadConfig(archive);
  const selected = args.includes('--profile') ? config.profiles.filter(p => p.id === value('--profile')) : config.profiles;
  if (!selected.length) throw new Error('Profile not found');
  if (command === 'draft' && selected.length !== 1) throw new Error('Draft requires --profile ID');
  for (const profile of selected) {
    if (command === 'draft') console.log(JSON.stringify(await runner.generate(profile, { draft: true, retry: args.includes('--retry') }), null, 2));
    else {
      const plan = await runner.preview(profile);
      console.log(JSON.stringify({ profile: profile.id, mode: config.mode, window: plan.window, jobs: plan.jobs, reused_sources: plan.sources.length, candidate_imports: plan.candidates.length, reused_reports: plan.previous_reports.length }, null, 2));
    }
  }
} else throw new Error('Use init, serve, plan, draft --profile ID, or tick');
