import { Buffer } from 'node:buffer';
import { renderFromContext } from '../render-shared.mjs';

const appOrigin = 'https://honkytonk-render.invalid';
const assets = new Set(['/index2.html', '/automation-client.js', '/honkytonk.png', '/honkytonk_mini.png']);
export class CloudflareRenderer {
  constructor(env, { launchBrowser, configureContext } = {}) { this.env = env; this.launchBrowser = launchBrowser; this.configureContext = configureContext; }
  checkConfigured() {
    if (!this.env.BROWSER || !this.env.ASSETS?.fetch) throw new Error('Cloudflare BROWSER and ASSETS bindings are required');
  }
  async render(payload, profile) {
    this.checkConfigured();
    const launch = this.launchBrowser || (await import('@cloudflare/playwright')).launch;
    const browser = await launch(this.env.BROWSER);
    try {
      const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === appOrigin && assets.has(url.pathname)) {
          try {
            const response = await this.env.ASSETS.fetch(new Request(appOrigin + url.pathname));
            if (!response.ok) return route.abort();
            return route.fulfill({ body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('Content-Type') || 'application/octet-stream' });
          } catch { return route.abort(); }
        }
        if ((url.origin === 'https://services.arcgisonline.com' && url.pathname === '/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/export') || url.protocol === 'data:') return route.continue();
        return route.abort();
      });
      if (this.configureContext) await this.configureContext(context);
      const output = await renderFromContext(context, payload, profile, appOrigin + '/index2.html');
      if (Buffer.byteLength(JSON.stringify(output)) > 16 * 1024 * 1024) throw new Error('Cloudflare export exceeds 16 MB; dispatch held');
      return output;
    } finally { await browser.close(); }
  }
}
