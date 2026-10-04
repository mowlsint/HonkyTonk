import { mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve('.cloudflare-worker-assets');
await rm(target, { recursive: true, force: true }); await mkdir(target, { recursive: true });
for (const file of ['index2.html', 'automation-client.js', 'honkytonk.png', 'honkytonk_mini.png']) await copyFile(resolve(file), resolve(target, file));
console.log('Cloudflare renderer assets prepared from the unchanged HonkyTonk app.');
