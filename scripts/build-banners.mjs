#!/usr/bin/env node
// Generate one 160x600 banner per scene from refs/spec.json.
//
// No GSAP: every layer does a single translate along a straight line, which CSS
// @keyframes covers natively and ~25 KB lighter. Each layer gets its own keyframes block
// because animation-delay fires once, not per iteration — with iteration-count the whole
// stagger has to live inside one shared cycle as percentages.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const CLICK_URL = 'https://yora.tj/';   // assumption: no per-scene landing page was given
const CYCLE = 5;                        // seconds per play
const PLAYS = 3;                        // IAB LEAN: 15s of motion total
const EASE = 'cubic-bezier(.16,.84,.44,1)';        // power3.out
const EASE_CTA = 'cubic-bezier(.34,1.56,.64,1)';   // back.out(1.6)

// "tj" throughout, by the client's house convention — folders, labels and the lang
// attribute alike. Note for anyone running an HTML validator over these: Tajik's BCP-47
// subtag is "tg", so lang="tj" will be flagged. Deliberate, not a typo.
const SLUGS = {
  1: { slug: 'employer-ru', lang: 'ru' },
  2: { slug: 'employer-tj', lang: 'tj' },
  3: { slug: 'jobseeker-ru', lang: 'ru' },
  4: { slug: 'jobseeker-tj', lang: 'tj' },
  5: { slug: 'brand-ru', lang: 'ru' },
  6: { slug: 'brand-tj', lang: 'tj' },
};

const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const px = (n) => `${+n.toFixed(2)}px`;

for (const scene of spec) {
  const { slug, lang } = SLUGS[scene.id];
  const dir = `out/${slug}/160x600`;
  mkdirSync(`${dir}/assets`, { recursive: true });

  copyFileSync(`refs/bg/scene${scene.id}.jpg`, `${dir}/assets/bg.jpg`);
  for (const l of scene.layers) copyFileSync(`refs/svg/${l.svg}`, `${dir}/assets/${l.role}.svg`);

  // Background slice is cut wider than the frame only when the scene pans it.
  const bgW = 160 + Math.abs(scene.bgPan);

  const rules = [], frames = [], imgs = [];

  if (scene.bgPan !== 0) {
    rules.push(`.bg{--pan:${px(scene.bgPan)};animation:k-bg var(--cycle) var(--plays) both cubic-bezier(.25,.46,.45,.94)}`);
    frames.push(`@keyframes k-bg{0%{transform:translate3d(0,0,0)}44%,100%{transform:translate3d(var(--pan),0,0)}}`);
  }

  scene.layers.forEach((l, i) => {
    const isCta = l.role === 'cta';
    const start = 3 + i * 4;
    const end = start + 17 + (isCta ? 3 : 0); // the overshoot needs room to settle
    rules.push(
      `.l-${l.role}{left:${px(l.x)};top:${px(l.y)};width:${px(l.svgW)};height:${px(l.svgH)};` +
      `--dx:${px(l.dx)};--dy:${px(l.dy)};` +
      `animation:k-${l.role} var(--cycle) var(--plays) both ${isCta ? EASE_CTA : EASE}}`
    );
    frames.push(
      `@keyframes k-${l.role}{0%,${start}%{transform:translate3d(var(--dx),var(--dy),0)}` +
      `${end}%,100%{transform:translate3d(0,0,0)}}`
    );
    imgs.push(`  <img class="l l-${l.role}" src="assets/${l.role}.svg" alt="">`);
  });

  const headline = (scene.layers.find((l) => l.role === 'headline')?.text ?? 'Yora.tj')
    .replace(/\s*\/\s*|\n/g, ' ').trim();

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=160,height=600">
<title>Yora.tj 160x600 — ${esc(slug)}</title>
<!--
  Scene ${scene.id} of the Figma set, rebuilt from the two keyframes:
  layers park off-canvas, then slide to rest, staggered top to bottom.
  Text ships as outlined SVG — the comp uses Loos Var, which is not licensed to us.
  Clock: entrances 0.15-1.8s, end frame held ~3.2s, ${PLAYS} plays = ${CYCLE * PLAYS}s.
-->
<style>
  :root{--w:160px;--h:600px;--cycle:${CYCLE}s;--plays:${PLAYS}}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:var(--w);height:var(--h);overflow:hidden;background:#7b3ff2}
  #banner{position:relative;width:var(--w);height:var(--h);overflow:hidden;
    cursor:pointer;user-select:none;background:#7b3ff2}
  /* Google wants a visible edge, but a border on #banner shifts every absolutely
     positioned layer 1px in from the Figma coordinates. Draw it over the top instead. */
  #banner::after{content:"";position:absolute;inset:0;pointer-events:none;
    border:1px solid rgba(0,0,0,.15)}
  .bg{position:absolute;left:0;top:0;width:${bgW}px;height:600px;will-change:transform}
  .l{position:absolute;will-change:transform;transform:translateZ(0)}
${rules.map((r) => '  ' + r).join('\n')}
${frames.map((f) => '  ' + f).join('\n')}
  /* backup.sh loads ?frame=end to screenshot the resting frame. */
  .end .bg,.end .l{animation:none!important}
  .end .bg{transform:translate3d(var(--pan,0),0,0)}
  .end .l{transform:translate3d(0,0,0)}
  @media (prefers-reduced-motion:reduce){
    .bg,.l{animation:none!important}
    .bg{transform:translate3d(var(--pan,0),0,0)}
    .l{transform:translate3d(0,0,0)}
  }
</style>
<script>
  // Applied before paint so the end-frame screenshot never catches scene 1.
  if (location.search.indexOf("frame=end") > -1) document.documentElement.className = "end";
</script>
</head>
<body>
<div id="banner" role="link" aria-label="${esc(headline)} — Yora.tj">
  <img class="bg" src="assets/bg.jpg" alt="">
${imgs.join('\n')}
</div>
<script>
  // Ad servers rewrite this exact literal. Global var, first script, one string.
  var clickTag = "${CLICK_URL}";
</script>
<script>
  document.getElementById("banner").addEventListener("click", function () {
    window.open(clickTag, "_blank");
  });
</script>
</body>
</html>
`;

  writeFileSync(`${dir}/index.html`, html);
  console.log(`${dir.padEnd(28)} ${scene.layers.length} layers  bgPan=${scene.bgPan}  "${headline.slice(0, 34)}"`);
}
