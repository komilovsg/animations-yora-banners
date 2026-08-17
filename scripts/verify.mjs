#!/usr/bin/env node
// Render each banner's end frame at the reference resolution and compare it to Figma.
//
// backup.jpg is 160x600, the Figma render is 320x1200; scaling either one to meet the other
// blurs every glyph edge and buries a real misalignment in resampling noise. So shoot the
// page at device scale 2 and diff natively.
//
// Also sweeps a +/-3px shift per scene: if the best alignment is 0,0 the layout is right and
// whatever error remains is antialiasing and JPEG, not geometry.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const W = 320, H = 1200, R = 3;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAIRS = [
  ['employer-ru', 'Frame_2136137191'],
  ['employer-tg', 'Frame_2136137193'],
  ['jobseeker-ru', 'Frame_2136137198'],
  ['jobseeker-tg', 'Frame_2136137199'],
  ['brand-ru', 'Frame_2136137201'],
  ['brand-tg', 'Frame_2136137203'],
];

mkdirSync('refs/shot', { recursive: true });
mkdirSync('refs/diff', { recursive: true });

const gray = (f) => sharp(f).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();

console.log('scene           best shift   mean  >16    verdict');
console.log('---------------------------------------------------------');
let worst = 0;

for (const [slug, figma] of PAIRS) {
  const shot = `refs/shot/${slug}.png`;
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=2', '--window-size=160,600',
    '--virtual-time-budget=6000', `--screenshot=${shot}`,
    `file://${process.cwd()}/out/${slug}/160x600/index.html?frame=end`,
  ], { stdio: 'ignore' });

  const [a, b] = await Promise.all([gray(shot), gray(`refs/${figma}.png`)]);

  // Sweep integer shifts of the render against the reference, scoring the overlap only.
  let best = null;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let sum = 0, over = 0, n = 0;
      for (let y = R; y < H - R; y++) {
        const ra = (y + dy) * W, rb = y * W;
        for (let x = R; x < W - R; x++) {
          const d = Math.abs(a[ra + x + dx] - b[rb + x]);
          sum += d; if (d > 16) over++; n++;
        }
      }
      const score = sum / n;
      if (!best || score < best.score) best = { dx, dy, score, pct: (over / n) * 100 };
    }
  }

  await sharp(
    Buffer.from((await gray(shot)).map((v, i) => Math.min(255, Math.abs(v - b[i]) * 6))),
    { raw: { width: W, height: H, channels: 1 } }
  ).png().toFile(`refs/diff/${slug}.png`);

  const verdict = best.pct < 3 ? 'match' : best.pct < 8 ? 'close' : 'MISMATCH';
  worst = Math.max(worst, best.pct);
  console.log(
    `${slug.padEnd(14)} ${String(best.dx).padStart(3)},${String(best.dy).padStart(3)}   ` +
    `${best.score.toFixed(2).padStart(5)} ${best.pct.toFixed(2).padStart(5)}%  ${verdict}`
  );
}
console.log(`---------------------------------------------------------\nworst ${worst.toFixed(2)}%`);
