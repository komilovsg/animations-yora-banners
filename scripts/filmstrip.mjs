#!/usr/bin/env node
// Screenshot one banner at several points in its cycle and stitch a filmstrip, so the
// motion can be judged without watching it. Usage: node scripts/filmstrip.mjs [slug]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const slug = process.argv[2] ?? 'employer-ru';
const TIMES = [150, 400, 700, 1000, 1400, 1900, 3500]; // ms into the 5s cycle
const W = 160, H = 600, GAP = 8;

mkdirSync('refs/strip', { recursive: true });
const shots = [];

for (const t of TIMES) {
  const f = `refs/strip/${slug}-${t}.png`;
  execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=160,600', `--virtual-time-budget=${t}`, `--screenshot=${f}`,
    `file://${process.cwd()}/out/${slug}/160x600/index.html`,
  ], { stdio: 'ignore' });
  shots.push({ t, f });
}

const stripW = shots.length * W + (shots.length - 1) * GAP;
await sharp({ create: { width: stripW, height: H, channels: 3, background: '#111' } })
  .composite(shots.map((s, i) => ({ input: s.f, left: i * (W + GAP), top: 0 })))
  .png()
  .toFile(`refs/strip/${slug}.png`);

console.log(`refs/strip/${slug}.png  frames at ${TIMES.join(', ')} ms`);
