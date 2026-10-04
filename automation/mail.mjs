import { hash } from './core.mjs';

export class ResendMailer {
  constructor({ apiKey, from, fetchImpl = fetch } = {}) { this.apiKey = apiKey; this.from = from; this.fetch = fetchImpl; }
  checkConfigured() {
    if (!this.apiKey || !this.from || /[\r\n]/.test(this.from)) throw new Error('RESEND_API_KEY and HONKYTONK_MAIL_FROM are required before dispatch');
  }
  async send({ run, recipient, artifacts, key }) {
    this.checkConfigured();
    const variants = Object.values(artifacts);
    if (!variants.length || variants.some(a => !a.pdf_base64 || hash(Buffer.from(a.pdf_base64, 'base64')) !== a.pdf_hash)) throw new Error('Incomplete or changed PDF attachment');
    const english = run.profile.language === 'en';
    const subject = `HonkyTonk · ${english ? run.window.label_en : run.window.label} · ${run.window.report_date}`;
    const attachments = variants.flatMap(a => [
      { filename: a.filename + '.pdf', content: a.pdf_base64 },
      { filename: a.filename + '.html', content: Buffer.from(a.html).toString('base64') },
      { filename: a.filename + '.md', content: Buffer.from(a.markdown).toString('base64') },
      { filename: a.filename + '.txt', content: Buffer.from(a.text).toString('base64') }
    ]);
    if (attachments.reduce((n, a) => n + a.content.length, 0) > 38 * 1024 * 1024) throw new Error('Report attachments exceed mail provider limit');
    const response = await this.fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ from: this.from, to: [recipient], subject, text: variants.map(a => a.text).join('\n\n'), attachments }), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Mail provider HTTP ' + response.status + '; check delivery status before retry');
    const result = await response.json();
    if (!result.id) throw new Error('Mail provider returned no delivery ID');
    return result.id;
  }
}
