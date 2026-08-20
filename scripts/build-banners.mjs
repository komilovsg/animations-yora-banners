#!/usr/bin/env node
// Generate one self-contained banner per creative in refs/spec.json.
//
// No GSAP: every layer does a single translate along a straight line, which CSS
// @keyframes covers natively and ~25 KB lighter. Each layer gets its own keyframes block
// because animation-delay fires once, not per iteration — with iteration-count the whole
// stagger has to live inside one shared cycle, expressed as percentages.
//
// Output follows the banner-builder contract: out/<message>-<lang>/<WxH>/index.html, so
// the folder name matches <meta name="ad.size"> and check.sh can verify it.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';

// Landing page per message, not per language: both cuts of a message go to one URL.
const CLICK = {
  employer: 'https://yora.tj/ru',                                  // "ищу сотрудников"
  jobseeker: 'https://yora.tj/ru/vacancies?currency_id=2&page=1',  // список вакансий
  brand: 'https://yora.tj/',
};

const CYCLE = 5;                        // seconds per play
const PLAYS = 3;                        // IAB LEAN: 15s of motion total
const EASE = 'cubic-bezier(.16,.84,.44,1)';        // power3.out
const EASE_CTA = 'cubic-bezier(.34,1.56,.64,1)';   // back.out(1.6)

// The contacts strip ships as two stacked lines, bigger than the comp draws it. Short
// formats keep the comp's single line — there is no room to stack anything under 200px.
const STACK_MIN_H = 200;
const CONTACTS_SCALE = 1.35;
const CONTACTS_GAP = 4;
// White contact text needs a dark band behind it. Rather than pick a lift by eye per
// format, measure the artwork: slide the CTA + contacts group and score each position by
// how bright the background is under the text. Ties go to the higher position, which is
// the direction the brief asks for.
const MIN_GAP = 12;          // px kept between the CTA and whatever sits above it
const EDGE_PAD = 10;         // px kept below the contacts
const TIE = 6;               // luminance points treated as "no real difference"
const SCRIM_ABOVE = 140;     // background luminance past which white text needs help

// Mean luminance of the artwork under a box, 0-255. The background raster is @2x.
function brightness({ data, info, scale }, x, y, w, h) {
  let sum = 0, n = 0;
  const r0 = Math.max(0, Math.round(y * scale)), r1 = Math.min(info.height, Math.round((y + h) * scale));
  const c0 = Math.max(0, Math.round(x * scale)), c1 = Math.min(info.width, Math.round((x + w) * scale));
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { sum += data[r * info.width + c]; n++; }
  return n ? sum / n : 255;
}

const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const px = (n) => `${+n.toFixed(2)}px`;

// Read the exported size off the file rather than trusting the spec to carry it: Figma
// rounds each export up to whole pixels, and the <img> must match the vector's own
// coordinate system or the glyphs get resampled.
function svgSize(file) {
  const head = readFileSync(`refs/svg/${file}`, 'utf8').slice(0, 400);
  const w = head.match(/width="([\d.]+)"/), h = head.match(/height="([\d.]+)"/);
  if (!w || !h) throw new Error(`${file}: no width/height on the root <svg>`);
  return { w: +w[1], h: +h[1] };
}

let built = 0, skipped = 0;

for (const s of spec) {
  if (s.layers.some((l) => l.missing || !existsSync(`refs/svg/${l.svg}`))) {
    console.log(`  skip ${s.stem.padEnd(26)} — layers not rendered yet`);
    skipped++;
    continue;
  }

  const { w, h, message, lang, size } = s;
  const dir = `out/${message}-${lang}/${size}`;
  mkdirSync(`${dir}/assets`, { recursive: true });

  const layers = s.layers.map((l) => {
    const { w: sw, h: sh } = svgSize(l.svg);
    return { ...l, svgW: sw, svgH: sh };
  });

  // The three renamed sections are drawn 20px narrower than the size they ship as. The
  // background was cut wider to match; centre the artwork in the gained width so the
  // layout gains margin instead of being scaled (scaling would soften the type and
  // distort the pill).
  const padX = (w - s.drawnW) / 2, padY = (h - s.drawnH) / 2;
  if (padX || padY) for (const l of layers) { l.x += padX; l.y += padY; }

  const stack = h >= STACK_MIN_H;

  // Some comps are drawn without the contacts strip — "У нас вакансия" at 160x600 is one.
  // The handle and number are wanted on every creative, and they are set at the same size
  // in every format, so borrow the lines from another creative, preferring the same size.
  // The horizontal families already carry the contacts as a single line, so only borrow
  // when the creative has none at all — otherwise 970x250 ships both and prints the
  // number twice.
  if (stack && !layers.some((l) => l.role === 'telegram' || l.role === 'contactline')) {
    const donor = spec.find((d) => d.size === size && d.layers.some((l) => l.role === 'telegram'))
      ?? spec.find((d) => d.layers.some((l) => l.role === 'telegram'));
    if (!donor) {
      console.warn(`  ! ${s.stem}: no contacts anywhere to borrow`);
    } else {
      // Enter from the same side as the rest of this creative.
      const inbound = Math.sign(layers.find((l) => l.role === 'cta')?.dx ?? -1) || -1;
      for (const role of ['telegram', 'phone']) {
        const src = donor.layers.find((l) => l.role === role);
        const { w: sw, h: sh } = svgSize(src.svg);
        layers.push({ ...src, svgW: sw, svgH: sh, dx: inbound * w, dy: 0 });
      }
    }
  }

  // Split the one-line contacts strip into stacked Telegram + phone, centred and enlarged.
  const tg = layers.find((l) => l.role === 'telegram');
  const phone = layers.find((l) => l.role === 'phone');
  const cta = layers.find((l) => l.role === 'cta');
  let lift = 0, lum = null, scrim = null;

  if (stack && tg && phone) {
    for (const l of [tg, phone]) { l.svgW *= CONTACTS_SCALE; l.svgH *= CONTACTS_SCALE; }
    const blockH = tg.svgH + CONTACTS_GAP + phone.svgH;
    const baseTop = tg.anchorY + padY - blockH / 2;
    const blockX = (w - phone.svgW) / 2, blockW = phone.svgW;

    // How far the group may travel: up until the CTA meets whatever sits above it, down
    // until the contacts reach the bottom edge.
    const above = layers.filter((l) => l !== cta && l !== tg && l !== phone)
      .reduce((m, l) => Math.max(m, l.y + l.svgH), 0);
    // Upwards only. Dropping the group is what actually finds the darkest artwork on the
    // jobseeker frames, but it leaves the CTA near the bottom edge with a hole above it —
    // the composition matters more than the last few luminance points, and a scrim below
    // fixes the contrast without moving anything.
    const maxUp = cta ? Math.max(0, cta.y - above - MIN_GAP) : Math.max(0, baseTop - above - MIN_GAP);

    const bg = await sharp(`refs/bg/${s.stem}.jpg`).greyscale().raw().toBuffer({ resolveWithObject: true });
    bg.scale = bg.info.width / (w + Math.abs(s.bgPan));

    const tried = [];
    for (let shift = 0; shift <= Math.floor(maxUp); shift += 2) {
      tried.push({ shift, score: brightness(bg, blockX, baseTop - shift, blockW, blockH) });
    }
    // Compare every candidate against the global darkest, not against the running best —
    // chaining a tie rule lets it ratchet one small step at a time into the bright band.
    // Among genuinely equal positions take the highest, which is the direction asked for.
    const darkest = Math.min(...tried.map((t) => t.score));
    const best = tried.filter((t) => t.score <= darkest + TIE).sort((a, b) => b.shift - a.shift)[0];
    lift = best.shift;
    lum = best.score;

    const top = baseTop - lift;
    // A soft dark wash, only where the artwork stays too bright for white text. Sized to
    // the block with generous bleed so the edges fade out instead of drawing a rectangle.
    if (lum > SCRIM_ABOVE) {
      scrim = {
        x: blockX - blockW * 0.22, y: top - blockH * 0.55,
        w: blockW * 1.44, h: blockH * 2.1,
        strength: Math.min(0.5, 0.16 + (lum - SCRIM_ABOVE) / 300),
      };
    }
    tg.x = (w - tg.svgW) / 2;
    tg.y = top;
    phone.x = blockX;
    phone.y = top + tg.svgH + CONTACTS_GAP;
    // The lines moved, so the comp's offsets no longer park them cleanly outside.
    for (const l of [tg, phone]) l.dx = l.dx > 0 ? w - l.x : -(l.x + l.svgW);
  }

  if (cta) cta.y -= lift;

  layers.sort((p, q) => p.y - q.y);   // stagger follows the reading order

  copyFileSync(`refs/bg/${s.stem}.jpg`, `${dir}/assets/bg.jpg`);
  for (const l of layers) copyFileSync(`refs/svg/${l.svg}`, `${dir}/assets/${l.role}.svg`);

  const bgW = w + Math.abs(s.bgPan);
  const rules = [], frames = [], imgs = [];

  if (s.bgPan !== 0) {
    rules.push(`.bg{--pan:${px(s.bgPan)};animation:k-bg var(--cycle) var(--plays) both cubic-bezier(.25,.46,.45,.94)}`);
    frames.push('@keyframes k-bg{0%{transform:translate3d(0,0,0)}44%,100%{transform:translate3d(var(--pan),0,0)}}');
  }

  layers.forEach((l, i) => {
    const isCta = l.role === 'cta';
    const start = 3 + i * 4;
    const end = start + 17 + (isCta ? 3 : 0);   // the overshoot needs room to settle
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

  const headline = (layers.find((l) => l.role === 'headline')?.text ?? 'Yora.tj')
    .replace(/\s+/g, ' ').trim();

  writeFileSync(`${dir}/index.html`, `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=${w},height=${h}">
<title>Yora.tj ${size} — ${esc(message)}-${lang}</title>
<!--
  Rebuilt from the two Figma keyframes of this scene: layers park off-canvas, then slide
  to rest, staggered top to bottom.
  Text ships as outlined SVG — the comp uses Loos Var, which is not licensed to us.
  Clock: entrances 0.15-1.8s, end frame held ~3.2s, ${PLAYS} plays = ${CYCLE * PLAYS}s.${
    s.drawnW !== w ? `\n  Comp is drawn ${s.drawnW}x${s.drawnH}; rebuilt at ${size}, the extra width spent as margin.` : ''}
-->
<style>
  :root{--w:${w}px;--h:${h}px;--cycle:${CYCLE}s;--plays:${PLAYS}}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:var(--w);height:var(--h);overflow:hidden;background:#7b3ff2}
  #banner{position:relative;width:var(--w);height:var(--h);overflow:hidden;
    cursor:pointer;user-select:none;background:#7b3ff2}
  /* Google wants a visible edge, but a border on #banner shifts every absolutely
     positioned layer 1px in from the Figma coordinates. Draw it over the top instead. */
  #banner::after{content:"";position:absolute;inset:0;pointer-events:none;
    border:1px solid rgba(0,0,0,.15)}
  .bg{position:absolute;left:0;top:0;width:${bgW}px;height:${h}px;will-change:transform}
  .l{position:absolute;will-change:transform;transform:translateZ(0)}
${scrim ? `  .scrim{position:absolute;pointer-events:none;left:${px(scrim.x)};top:${px(scrim.y)};
    width:${px(scrim.w)};height:${px(scrim.h)};
    background:radial-gradient(ellipse at center,rgba(0,0,0,${scrim.strength.toFixed(2)}) 0%,rgba(0,0,0,${(scrim.strength * 0.55).toFixed(2)}) 45%,rgba(0,0,0,0) 72%)}` : ''}
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
  // Applied before paint so the end-frame screenshot never catches the entrance.
  if (location.search.indexOf("frame=end") > -1) document.documentElement.className = "end";
</script>
</head>
<body>
<div id="banner" role="link" aria-label="${esc(headline)} — Yora.tj">
  <img class="bg" src="assets/bg.jpg" alt="">
${scrim ? '  <div class="scrim"></div>\n' : ''}${imgs.join('\n')}
</div>
<script>
  // Ad servers rewrite this exact literal. Global var, first script, one string.
  var clickTag = "${CLICK[message]}";
</script>
<script>
  document.getElementById("banner").addEventListener("click", function () {
    window.open(clickTag, "_blank");
  });
</script>
</body>
</html>
`);

  built++;
  console.log(`${dir.padEnd(30)} ${layers.length} layers  lift ${String(lift).padStart(4)}px  bg lum ${lum === null ? "  -" : lum.toFixed(0).padStart(3)}`);
}

console.log(`\n${built} built, ${skipped} waiting on renders`);
