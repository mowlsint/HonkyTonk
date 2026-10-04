import { Buffer } from 'node:buffer';
import { ConflictError } from './records.mjs';
import { safePath } from './archive-path.mjs';

export class GitHubArchive {
  constructor({ repository, token, branch = 'main', fetchImpl = fetch, cacheLimit = 64 * 1024 * 1024 }) {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '') || /magic[-_]?paws/i.test(repository)) throw new Error('Configure an independent HonkyTonk data repository; MagicPaws is forbidden');
    if (repository.toLowerCase() === 'mowlsint/honkytonk') throw new Error('Use a separate private data repository, not the public code repository');
    if (!token) throw new Error('HONKYTONK_GITHUB_TOKEN is required');
    this.repository = repository; this.token = token; this.branch = branch; this.fetch = fetchImpl; this.kind = 'github'; this.ready = false;
    this.cachedEntries = new Map(); this.knownRevisions = new Map(); this.cachedBytes = 0; this.cacheLimit = cacheLimit;
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
    const bytes = Buffer.byteLength(entry.text), limit = this.cacheLimit;
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
