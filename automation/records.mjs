import { hash, parseDocument, markdownDocument, defaultConfig, validateConfig, readSource } from './core.mjs';

export class ConflictError extends Error {}

export const CONFIG_PATH = 'config/automation.md';
export async function loadConfig(archive) {
  const entry = await archive.read(CONFIG_PATH);
  return entry ? { config: validateConfig(parseDocument(entry.text).data), revision: entry.revision } : { config: defaultConfig(), revision: null };
}
export async function saveConfig(archive, config, revision) {
  validateConfig(config);
  return archive.write(CONFIG_PATH, markdownDocument({ kind: 'config', version: 1, updated_at: new Date().toISOString() }, '# HonkyTonk automation configuration\n\nManual mode pauses generation and dispatch.', config), revision);
}
export async function loadRecord(archive, path, options) {
  const entry = await archive.read(path, options);
  return entry ? { data: parseDocument(entry.text).data, revision: entry.revision } : null;
}
export async function saveRecord(archive, path, data, revision = null) {
  return archive.write(path, markdownDocument({ kind: data.kind || 'state', id: data.id || '', updated_at: new Date().toISOString() }, `# HonkyTonk ${data.kind || 'state'}\n\nStatus: ${data.status || 'recorded'}`, data), revision);
}
export async function readArchive(archive) {
  const sourcePaths = [...await archive.list('sources/imports/'), ...await archive.list('sources/web/')];
  const statePaths = (await archive.list('state/')).filter(p => /^state\/(coverage|runs)\//.test(p)), reportPaths = await archive.list('reports/');
  const sources = [], coverage = [], reports = [], runs = [];
  // Sequential reads bound API pressure. Bad Markdown is surfaced, never silently
  // counted as covered research or a successful zero-findings run.
  for (const path of sourcePaths) sources.push(readSource((await archive.read(path, { cached: true })).text));
  for (const path of statePaths) {
    const record = await loadRecord(archive, path, { cached: true });
    if (record.data.kind === 'coverage') coverage.push(record.data);
    if (record.data.kind === 'run') runs.push(record.data);
  }
  for (const path of reportPaths.filter(p => p.endsWith('-report.md'))) { const record = await loadRecord(archive, path, { cached: true }); if (record.data?.kind === 'report') reports.push(record.data); }
  return { sources, coverage, reports, runs };
}
export async function readRuns(archive, limit = 60) {
  const key = path => path.match(/(\d{8}T\d{9}Z)\.md$/)?.[1] || '';
  const paths = (await archive.list('state/')).filter(p => p.startsWith('state/runs/')).sort((a, b) => key(b).localeCompare(key(a))).slice(0, limit);
  const runs = [];
  for (const path of paths) runs.push((await loadRecord(archive, path, { cached: true })).data);
  return runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
