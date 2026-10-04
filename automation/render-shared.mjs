import { Buffer } from 'node:buffer';
import { hash } from './core.mjs';

// Both Node and Browser Run execute the existing app and print builder.
export async function renderFromContext(context, payload, profile, appURL) {
  const origin = new URL(appURL).origin;
  const failures = [];
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(appURL, { waitUntil: 'domcontentloaded' });
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
    const pdf = Buffer.from(await printPage.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
    if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length < 1000) throw new Error('PDF generation failed; dispatch held');
    artifacts[language] = { ...output, print: undefined, images: undefined, pdf_base64: pdf.toString('base64'), pdf_hash: hash(pdf), language };
    await printPage.close();
  }
  if (failures.length) throw new Error('App rendering failed: ' + failures.join('; '));
  return artifacts;
}
