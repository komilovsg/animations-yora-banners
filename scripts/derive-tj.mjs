#!/usr/bin/env node
// Derive the Tajik cut of every size the comp only draws in Russian.
//
// The client ships both languages always, but only the 160x600 section has Tajik frames.
// Everything needed to set the rest is already here: the same artwork, the same layout, the
// real LoosVar, and the Tajik copy from the 160x600 comp. So clone the Russian creative and
// re-typeset its text, keeping each block on its own centre so the composition holds.
//
// Tajik runs longer than Russian, so a headline can gain a line and the CTA pill has to
// grow to fit its label — neither is a text swap.
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { typeset } from './lib/typeset.mjs';

const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));

// Index the comp so the Russian layer's own styling can be reused verbatim.
const byId = new Map();
for (const f of ['refs/nodes.json', ...readdirSync('refs').filter((x) => /^nodes-\d+x\d+\.json$/.test(x)).map((x) => `refs/${x}`)]) {
  if (!existsSync(f)) continue;
  const walk = (n) => { byId.set(n.id, n); for (const c of n.children ?? []) walk(c); };
  for (const v of Object.values(JSON.parse(readFileSync(f, 'utf8')).nodes)) walk(v.document);
}

// Tajik copy, lifted from the 160x600 section rather than invented.
const TJ = {
  employer: {
    headline: 'Корманди худро пайдо кунед!',
    subline: 'Ҷойи кориро дар Yora.tj эълон кунед!',
    cta: 'Ҷойи кориро нашр кунед',
  },
  jobseeker: {
    headline: 'Мо ҷойи корӣ дорем!',
    subline: 'Ҷойи кориро дар Yora.tj эълон кунед!',
    cta: 'Бақайдгирӣ',
  },
  brand: {
    headline: 'Yora.tj — ҷойҳои корӣ дар тамоми Тоҷикистон!',
    cta: 'Бақайдгирӣ',
  },
};

const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const svgSize = (file) => {
  const head = readFileSync(`refs/svg/${file}`, 'utf8').slice(0, 400);
  return { w: +head.match(/width="([\d.]+)"/)[1], h: +head.match(/height="([\d.]+)"/)[1] };
};

const styleOf = (node, text, maxWidth) => ({
  text,
  fontStyle: node.style.fontStyle,
  fontSize: node.style.fontSize,
  lineHeight: node.style.lineHeightPx,
  align: node.style.textAlignHorizontal,
  letterSpacing: node.style.letterSpacing ?? 0,
  maxWidth,
  color: hex((node.fills ?? []).find((f) => f.type === 'SOLID')?.color ?? { r: 1, g: 1, b: 1 }),
});

const have = new Set(spec.map((s) => `${s.size}-${s.message}-${s.lang}`));
const added = [];

for (const ru of spec) {
  if (ru.lang !== 'ru') continue;
  if (have.has(`${ru.size}-${ru.message}-tj`)) continue;

  const copy = TJ[ru.message];
  const stem = `${ru.size}-${ru.message}-tj`;
  const layers = [];

  for (const l of ru.layers) {
    const out = { ...l, svg: `${stem}-${l.role}.svg` };
    const { w: rw, h: rh } = svgSize(l.svg);
    const cx = l.x + rw / 2, cy = l.y + rh / 2;     // keep the block on its own centre
    const node = byId.get(l.nodeId);

    if ((l.role === 'headline' || l.role === 'subline') && copy[l.role] && node?.style) {
      // Wrap to the box the comp gives the Russian text, so the column stays put.
      const boxW = node.style.textAutoResize === 'WIDTH_AND_HEIGHT'
        ? Infinity : node.absoluteBoundingBox.width;
      const t = typeset(styleOf(node, copy[l.role], boxW));
      writeFileSync(`refs/svg/${out.svg}`, t.svg);
      out.x = +(cx - t.width / 2).toFixed(1);
      out.y = +(cy - t.height / 2).toFixed(1);
      out.text = copy[l.role];
    } else if (l.role === 'cta' && copy.cta && node) {
      const label = (function find(n) {
        if (n.type === 'TEXT') return n;
        for (const c of n.children ?? []) { const r = find(c); if (r) return r; }
        return null;
      })(node);
      const t = typeset(styleOf(label, copy.cta, Infinity));
      // Grow the pill by the same side padding the Russian one has.
      const o = node.absoluteBoundingBox;
      const lb = label.absoluteRenderBounds ?? label.absoluteBoundingBox;
      const padX = (lb.x - o.x), padY = (lb.y - o.y);
      const pw = Math.round(t.width + padX * 2), ph = Math.round(Math.max(o.height, t.height + padY * 2));

      const fill = (node.fills ?? []).filter((f) => f.visible !== false).find((f) => f.type === 'GRADIENT_LINEAR');
      const [p0, p1] = fill.gradientHandlePositions;
      const stops = fill.gradientStops
        .map((s) => `<stop offset="${(s.position * 100).toFixed(2)}%" stop-color="${hex(s.color)}"/>`).join('');
      const r = Math.min(node.cornerRadius ?? ph / 2, ph / 2);
      const inner = t.svg.replace(/^<svg[^>]*>/, `<svg width="${t.width}" height="${t.height}" viewBox="${t.svg.match(/viewBox="([^"]+)"/)[1]}">`);

      writeFileSync(`refs/svg/${out.svg}`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" fill="none" viewBox="0 0 ${pw} ${ph}">` +
        `<defs><linearGradient id="g" x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}">${stops}</linearGradient></defs>` +
        `<rect width="${pw}" height="${ph}" rx="${r.toFixed(2)}" fill="url(#g)"/>` +
        `<g transform="translate(${((pw - t.width) / 2).toFixed(2)},${((ph - t.height) / 2).toFixed(2)})">${inner}</g></svg>`);
      out.x = +(cx - pw / 2).toFixed(1);
      out.y = +(cy - ph / 2).toFixed(1);
      out.text = copy.cta;
    } else {
      // Logo and contacts carry no language.
      copyFileSync(`refs/svg/${l.svg}`, `refs/svg/${out.svg}`);
    }

    const { w: nw } = svgSize(out.svg);
    // Re-park it off-canvas on the side it entered from.
    out.dx = l.dx > 0 ? ru.w - out.x : -(out.x + nw);
    layers.push(out);
  }

  layers.sort((p, q) => p.y - q.y);
  copyFileSync(`refs/bg/${ru.stem}.jpg`, `refs/bg/${stem}.jpg`);
  added.push({ ...ru, lang: 'tj', stem, layers });
  console.log(`  ${stem}`);
}

writeFileSync('refs/spec.json', JSON.stringify([...spec, ...added], null, 2));
console.log(`${added.length} Tajik creatives derived`);
