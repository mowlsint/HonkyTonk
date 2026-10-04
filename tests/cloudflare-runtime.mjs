// Smoke-test the bundled Worker in workerd, without credentials or outbound APIs.
// Run after npm run check:cloudflare-worker.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const token = 'synthetic-workerd-test-token-long-enough';
const mf = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [{ name: 'honkytonk-controller', modules: true, scriptPath: resolve('.wrangler/dry-run/worker.js'), compatibilityDate: '2026-10-04', compatibilityFlags: ['nodejs_compat'],
  bindings: { HONKYTONK_ADMIN_TOKEN: token, HONKYTONK_ALLOWED_ORIGINS: 'https://honkytonk.pages.dev' },
  workflows: { HONKYTONK_JOBS: { name: 'honkytonk-jobs', className: 'HonkyTonkWorkflow' } }
}] }));
try {
  for (const [path, options, status] of [
    ['/api/config', {}, 401],
    ['/api/config', { headers: { Origin: 'https://other.example', Authorization: 'Bearer ' + token } }, 403],
    ['/index2.html', {}, 404],
    ['/api/config', { headers: { Authorization: 'Bearer ' + token } }, 400],
    ['/api/jobs/missing', { headers: { Authorization: 'Bearer ' + token } }, 400],
    ['/api/config', { method: 'OPTIONS', headers: { Origin: 'https://honkytonk.pages.dev' } }, 204]
  ]) {
    const response = await mf.dispatchFetch('https://honkytonk-worker.example' + path, options);
    assert.equal(response.status, status);
    if (status !== 204) assert.ok((await response.json()).error);
  }
  console.log('PASS: bundled Worker starts in workerd; crypto auth, exact-origin CORS, private assets, absent archive settings and Workflow binding hold safely.');
} finally { await mf.dispose(); }
