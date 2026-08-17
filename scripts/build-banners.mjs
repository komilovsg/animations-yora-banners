#!/usr/bin/env node
// Generate one 160x600 banner per scene from refs/spec.json.
//
// No GSAP: every layer does a single translate along a straight line, which CSS
// @keyframes covers natively and ~25 KB lighter. Each layer gets its own keyframes block
// because animation-delay fires once, not per iteration — with iteration-count the whole
// stagger has to live inside one shared cycle as percentages.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

// Landing page per message, not per language: both the RU and TJ cut of a message go to
// the same URL, which is what the client specified.
const CLICK = {
  employer: 'https://yora.tj/ru',                                  // "ищу сотрудников"
  jobseeker: 'https://yora.tj/ru/vacancies?currency_id=2&page=1',  // список вакансий
  brand: 'https://yora.tj/',
};

// Contacts are re-laid-out rather than copied from the comp: the client wants the Telegram
// handle and the phone on their own lines and bigger, and the CTA block sitting higher.
const CONTACTS_SCALE = 1.35;
const CONTACTS_GAP = 4;                 // px between the two lines
const LIFT = 16;                        // px the CTA and the contacts move up

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

  const layers = scene.layers.map((l) => ({ ...l }));

  // "У нас вакансия" is the one comp drawn without a contacts strip, but the client wants
  // the handle and the number on every creative. Borrow the lines from scene 1 — same
  // handle, same number — and bring them in from whichever side this scene uses.
  if (!layers.some((l) => l.role === 'telegram')) {
    const donor = spec.find((s) => s.layers.some((l) => l.role === 'telegram'));
    const inbound = layers.find((l) => l.role === 'cta')?.dx ?? -160;
    for (const role of ['telegram', 'phone']) {
      layers.push({ ...donor.layers.find((l) => l.role === role), dx: Math.sign(inbound) * 160 });
    }
  }

  // Stack the two contact lines centred, scaled up, keeping the block centred on the
  // strip's original eye-line before the whole thing is lifted.
  const tg = layers.find((l) => l.role === 'telegram');
  const phone = layers.find((l) => l.role === 'phone');
  if (tg && phone) {
    for (const l of [tg, phone]) { l.svgW *= CONTACTS_SCALE; l.svgH *= CONTACTS_SCALE; }
    const blockH = tg.svgH + CONTACTS_GAP + phone.svgH;
    const top = tg.anchorY - blockH / 2 - LIFT;
    tg.x = (160 - tg.svgW) / 2;
    tg.y = top;
    phone.x = (160 - phone.svgW) / 2;
    phone.y = top + tg.svgH + CONTACTS_GAP;
    // Re-derive the travel: the lines moved, so the comp's offsets no longer park them
    // cleanly outside the frame.
    for (const l of [tg, phone]) l.dx = l.dx > 0 ? 160 - l.x : -(l.x + l.svgW);
  }

  const cta = layers.find((l) => l.role === 'cta');
  if (cta) cta.y -= LIFT;

  layers.sort((p, q) => p.y - q.y);   // stagger follows the reading order

  copyFileSync(`refs/bg/scene${scene.id}.jpg`, `${dir}/assets/bg.jpg`);
  for (const l of layers) copyFileSync(`refs/svg/${l.svg}`, `${dir}/assets/${l.role}.svg`);

  // Background slice is cut wider than the frame only when the scene pans it.
  const bgW = 160 + Math.abs(scene.bgPan);

  const rules = [], frames = [], imgs = [];

  if (scene.bgPan !== 0) {
    rules.push(`.bg{--pan:${px(scene.bgPan)};animation:k-bg var(--cycle) var(--plays) both cubic-bezier(.25,.46,.45,.94)}`);
    frames.push(`@keyframes k-bg{0%{transform:translate3d(0,0,0)}44%,100%{transform:translate3d(var(--pan),0,0)}}`);
  }

  layers.forEach((l, i) => {
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
  /* Lifting the contacts put them over the bright diagonal on the jobseeker backgrounds:
     mean luminance 182-204 of 255 there, peaking at pure white, so plain white text has
     nothing to sit against. A tight dark halo restores the edge, a softer one underneath
     gives it weight. Static filter, not animated. */
  .l-telegram,.l-phone{filter:drop-shadow(0 0 1px rgba(0,0,0,.9))
    drop-shadow(0 0 2px rgba(0,0,0,.65)) drop-shadow(0 1px 3px rgba(0,0,0,.45))}
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
  var clickTag = "${CLICK[slug.split('-')[0]]}";
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
  console.log(`${dir.padEnd(28)} ${layers.length} layers  bgPan=${scene.bgPan}  "${headline.slice(0, 34)}"`);
}
