import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, '.cloudflare-pages');
const source = resolve(root, 'index2.html');
const assets = ['honkytonk.png', 'honkytonk_mini.png', 'honkytonk.ico'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

let html = await readFile(source, 'utf8');
html = html.replace(
  /<head>/i,
  '<head>\n<meta name="robots" content="noindex,nofollow,noarchive">'
);
await writeFile(resolve(output, 'index.html'), html, 'utf8');
await Promise.all(assets.map(asset => cp(resolve(root, asset), resolve(output, asset))));
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
await writeFile(resolve(output, '_headers'), `/*
  Cache-Control: no-store, max-age=0
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Robots-Tag: noindex, nofollow, noarchive
`, 'utf8');

console.log(`Cloudflare Pages build complete: ${output}`);
