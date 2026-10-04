import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { renderFromContext } from './render-shared.mjs';

// One source of truth: headless automation calls the same app renderer and
// buildCleanPrintHTML() used by the manual PDF button. No second PDF template.
export class ExistingLayoutRenderer {
  constructor(root = resolve(new URL('..', import.meta.url).pathname), configureContext) { this.root = root; this.configureContext = configureContext; }
  launchOptions() { return { headless: true, ...(process.env.HONKYTONK_CHROMIUM_PATH ? { executablePath: process.env.HONKYTONK_CHROMIUM_PATH } : {}) }; }
  async checkConfigured() {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const browser = await chromium.launch(this.launchOptions());
    await browser.close();
  }
  async render(payload, profile) {
    const require = createRequire(import.meta.url);
    const { chromium } = require('playwright');
    const assets = new Map([['/index2.html', ['index2.html', 'text/html']], ['/automation-client.js', ['automation-client.js', 'text/javascript']], ['/honkytonk.png', ['honkytonk.png', 'image/png']], ['/honkytonk_mini.png', ['honkytonk_mini.png', 'image/png']]]);
    const server = createServer(async (req, res) => {
      const asset = assets.get(new URL(req.url, 'http://localhost').pathname);
      if (!asset) { res.writeHead(404); res.end(); return; }
      try { res.writeHead(200, { 'Content-Type': asset[1] }); res.end(await readFile(resolve(this.root, asset[0]))); }
      catch { res.writeHead(500); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch(this.launchOptions());
      const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      const origin = `http://127.0.0.1:${server.address().port}`;
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin === origin || (u.origin === 'https://services.arcgisonline.com' && u.pathname === '/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/export') || u.protocol === 'data:') return route.continue();
        return route.abort();
      });
      if (this.configureContext) await this.configureContext(context);
      return await renderFromContext(context, payload, profile, origin + '/index2.html');
    } finally {
      if (browser) await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
