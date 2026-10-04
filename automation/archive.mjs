import { mkdir, readFile, writeFile, rename, readdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, parseDocument, markdownDocument, defaultConfig, validateConfig, readSource } from './core.mjs';

export class ConflictError extends Error {}
function safePath(path) {
  if (!/^(config|state|sources\/(imports|web)|reports)\/[a-zA-Z0-9_./-]+\.md$/.test(path) || path.split('/').includes('..')) throw new Error('Archive accepts Markdown in HonkyTonk directories only');
  return path;
}
export class LocalArchive {
  constructor(root) { this.root = resolve(root); this.kind = 'local'; }
  async init() { await mkdir(this.root, { recursive: true }); }
  path(path) { return resolve(this.root, safePath(path)); }
  async read(path) {
    try { const text = await readFile(this.path(path), 'utf8'); return { text, revision: hash(text) }; }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async write(path, text, revision = null) {
    const file = this.path(path);
    await mkdir(dirname(file), { recursive: true });
    if (revision === null) {
      try { await writeFile(file, text, { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code === 'EEXIST') throw new ConflictError('Archive entry already exists'); throw e; }
    } else {
      let lock;
      try { lock = await open(file + '.lock', 'wx', 0o600); }
      catch (e) { if (e.code === 'EEXIST') throw new ConflictError('Archive entry is being updated'); throw e; }
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        const current = await this.read(path);
        if (!current || current.revision !== revision) throw new ConflictError('Archive changed; reload before saving');
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await lock.close(); await unlink(file + '.lock');
        await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
    }
    return hash(text);
  }
  async list(prefix) {
    if (!/^(config|state|sources\/(imports|web)|reports)\/$/.test(prefix)) throw new Error('Invalid archive prefix');
    const out = [];
    const walk = async dir => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
      for (const entry of entries) {
        const file = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(file.slice(this.root.length + 1).split(sep).join('/'));
      }
    };
    await walk(resolve(this.root, prefix));
    return out.sort();
  }
}
export class GitHubArchive {
  constructor({ repository, token, branch = 'main', fetchImpl = fetch }) {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '') || /magic[-_]?paws/i.test(repository)) throw new Error('Configure an independent HonkyTonk data repository; MagicPaws is forbidden');
    if (repository.toLowerCase() === 'mowlsint/honkytonk') throw new Error('Use a separate private data repository, not the public code repository');
    if (!token) throw new Error('HONKYTONK_GITHUB_TOKEN is required');
    this.repository = repository; this.token = token; this.branch = branch; this.fetch = fetchImpl; this.kind = 'github'; this.ready = false;
    this.cachedEntries = new Map(); this.knownRevisions = new Map(); this.cachedBytes = 0;
  }
  async request(path, method = 'GET', body) {
    const response = await this.fetch(`https://api.github.com/repos/${this.repository}${path}`, {
      method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)
    });
    if (response.status === 404) return null;
    if (response.status === 409 || response.status === 422) throw new ConflictError('GitHub archive changed; reload before retrying');
    if (!response.ok) throw new Error(`GitHub archive HTTP ${response.status}`);
    return response.json();
  }
  async init() {
    const repo = await this.request('');
    if (!repo?.private) throw new Error('HonkyTonk data repository must exist and be private');
    this.ready = true;
  }
  assertReady() { if (!this.ready) throw new Error('Verify private archive before access'); }
  remember(path, entry) {
    // Only read-only research/history benefits from caching. Never retain PDF
    // artifacts, recipient outboxes or configuration, and bound long-lived RAM.
    if (!/^(sources\/(imports|web)\/|state\/(coverage|runs)\/|reports\/.+-report\.md$)/.test(path)) return;
    const previous = this.cachedEntries.get(path);
    if (previous) { this.cachedBytes -= Buffer.byteLength(previous.text); this.cachedEntries.delete(path); }
    const bytes = Buffer.byteLength(entry.text), limit = 64 * 1024 * 1024;
    if (bytes > limit) return;
    while (this.cachedBytes + bytes > limit || this.cachedEntries.size >= 2048) {
      const oldest = this.cachedEntries.keys().next().value;
      this.cachedBytes -= Buffer.byteLength(this.cachedEntries.get(oldest).text); this.cachedEntries.delete(oldest);
    }
    this.cachedEntries.set(path, entry); this.cachedBytes += bytes;
  }
  async read(path, { cached = false } = {}) {
    this.assertReady();
    const saved = this.cachedEntries.get(path);
    if (cached && saved && this.knownRevisions.get(path) === saved.revision) {
      this.cachedEntries.delete(path); this.cachedEntries.set(path, saved); return saved;
    }
    const entry = await this.request(`/contents/${safePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (entry === null) return null;
    if (entry.type !== 'file') throw new Error('Unsupported GitHub Markdown entry');
    const blob = entry.encoding === 'base64' ? entry : await this.request('/git/blobs/' + entry.sha);
    if (blob?.encoding !== 'base64') throw new Error('Cannot read complete GitHub Markdown entry');
    const result = { text: Buffer.from(blob.content, 'base64').toString('utf8'), revision: entry.sha };
    this.remember(path, result);
    return result;
  }
  async write(path, text, revision = null) {
    this.assertReady();
    const result = await this.request(`/contents/${safePath(path)}`, 'PUT', {
      message: `HonkyTonk: update ${path}`, branch: this.branch, content: Buffer.from(text).toString('base64'), ...(revision ? { sha: revision } : {})
    });
    if (!result?.content?.sha) throw new Error('GitHub archive write failed');
    this.remember(path, { text, revision: result.content.sha });
    this.knownRevisions.set(path, result.content.sha);
    return result.content.sha;
  }
  async list(prefix) {
    this.assertReady();
    if (!/^(config|state|sources\/(imports|web)|reports)\/$/.test(prefix)) throw new Error('Invalid archive prefix');
    const tree = await this.request(`/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
    if (!tree || tree.truncated) throw new Error('Cannot read complete Markdown archive tree');
    this.knownRevisions = new Map(tree.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
    return tree.tree.filter(e => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.md')).map(e => safePath(e.path)).sort();
  }
}
export function archiveFromEnv(env = process.env) {
  if (env.HONKYTONK_DATA_REPOSITORY) return new GitHubArchive({ repository: env.HONKYTONK_DATA_REPOSITORY, token: env.HONKYTONK_GITHUB_TOKEN, branch: env.HONKYTONK_DATA_BRANCH || 'main' });
  return new LocalArchive(env.HONKYTONK_LOCAL_ARCHIVE || '.honkytonk-data');
}
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
  const statePaths = await archive.list('state/'), reportPaths = await archive.list('reports/');
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
