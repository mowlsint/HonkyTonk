import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { hash } from './core.mjs';

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
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(origin + '/index2.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.HonkyTonkAutomation);
      const languages = profile.language === 'both' ? ['de', 'en'] : [profile.language], artifacts = {};
      for (const language of languages) {
        await page.evaluate(({ payload, profile, language }) => window.HonkyTonkAutomation.applyPayload(payload, profile, language), { payload, profile, language });
        await page.waitForFunction(() => [...document.querySelectorAll('#reportView img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 45000 });
        const output = await page.evaluate(language => {
          let html;
          const originalDownload = download;
          download = (_name, content) => { html = content; };
          try { downloadHTMLReport(); } finally { download = originalDownload; }
          return { print: buildCleanPrintHTML(), html, markdown: markdown(language), text: textReport(language), filename: reportFileBaseName(language), images: [...document.querySelectorAll('#reportView img')].map(i => i.src) };
        }, language);
        // Embed exactly the existing logo/map assets, so mail exports remain
        // complete when opened away from the app or after an archive restart.
        const embedded = await page.evaluate(async () => {
          const images = [];
          for (const img of document.querySelectorAll('#reportView img')) {
            await img.decode();
            const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            images.push({ url: img.src, data: canvas.toDataURL('image/png') });
          }
          return images;
        });
        for (const { url, data } of embedded) {
          output.print = output.print.split(url.replaceAll('&', '&amp;')).join(data).split(url).join(data);
          output.html = output.html.split(url.replaceAll('&', '&amp;')).join(data).split(url).join(data);
          // Logos in the existing template use a relative URL.
          if (url.startsWith(origin + '/')) {
            const relative = url.slice(origin.length + 1);
            output.print = output.print.replaceAll('src="' + relative + '"', 'src="' + data + '"');
            output.html = output.html.replaceAll('src="' + relative + '"', 'src="' + data + '"');
          }
        }
        const printPage = await context.newPage();
        await printPage.setContent(output.print.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { waitUntil: 'load' });
        await printPage.evaluate(() => document.fonts.ready);
        await printPage.emulateMedia({ media: 'print' });
        const pdf = await printPage.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
        if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length < 1000) throw new Error('PDF generation failed; dispatch held');
        artifacts[language] = { ...output, print: undefined, images: undefined, pdf_base64: pdf.toString('base64'), pdf_hash: hash(pdf), language };
        await printPage.close();
      }
      if (failures.length) throw new Error('App rendering failed: ' + failures.join('; '));
      return artifacts;
    } finally {
      if (browser) await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
