#!/usr/bin/env node
// Compare each rendered end frame against its Figma "to" frame.
// Reports mean/max channel error and writes an amplified diff image per scene.
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const W = 160, H = 600;
const PAIRS = [
  ['employer-ru', 'Frame_2136137191'],
  ['employer-tg', 'Frame_2136137193'],
  ['jobseeker-ru', 'Frame_2136137198'],
  ['jobseeker-tg', 'Frame_2136137199'],
  ['brand-ru', 'Frame_2136137201'],
  ['brand-tg', 'Frame_2136137203'],
];

mkdirSync('refs/diff', { recursive: true });
const raw = (f) => sharp(f).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();

console.log('scene            mean  max   >16  verdict');
console.log('------------------------------------------------');
for (const [slug, figma] of PAIRS) {
  const [a, b] = await Promise.all([
    raw(`out/${slug}/160x600/backup.jpg`),
    raw(`refs/${figma}.png`),
  ]);

  const diff = Buffer.allocUnsafe(a.length);
  let sum = 0, max = 0, over = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    diff[i] = Math.min(255, d * 6);           // amplified so small drift is visible
    sum += d;
    if (d > max) max = d;
    if (d > 16) over++;
  }
  const mean = sum / a.length;
  const pctOver = (over / a.length) * 100;

  await sharp(diff, { raw: { width: W, height: H, channels: 3 } })
    .png().toFile(`refs/diff/${slug}.png`);

  // JPEG on a smooth gradient drifts a few levels everywhere; misplaced text does not.
  const verdict = pctOver < 1.5 ? 'match' : pctOver < 5 ? 'check' : 'MISMATCH';
  console.log(
    `${slug.padEnd(14)} ${mean.toFixed(2).padStart(5)} ${String(max).padStart(4)} ` +
    `${pctOver.toFixed(2).padStart(5)}%  ${verdict}`
  );
}
