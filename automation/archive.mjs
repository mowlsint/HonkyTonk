import { mkdir, readFile, writeFile, rename, readdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from './core.mjs';
import { ConflictError } from './records.mjs';
import { safePath } from './archive-path.mjs';
import { GitHubArchive } from './archive-github.mjs';
export { GitHubArchive } from './archive-github.mjs';
export * from './records.mjs';

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
export function archiveFromEnv(env = process.env) {
  if (env.HONKYTONK_DATA_REPOSITORY) return new GitHubArchive({ repository: env.HONKYTONK_DATA_REPOSITORY, token: env.HONKYTONK_GITHUB_TOKEN, branch: env.HONKYTONK_DATA_BRANCH || 'main' });
  return new LocalArchive(env.HONKYTONK_LOCAL_ARCHIVE || '.honkytonk-data');
}
