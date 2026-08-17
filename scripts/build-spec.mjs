#!/usr/bin/env node
// Turn the two Figma keyframes of each scene into one animation spec.
//
// Every scene is a pair of 160x600 frames holding the same layers twice: once parked
// off-canvas (the "from" frame) and once in place (the "to" frame). The delta between
// the two is the entrance animation, so the spec is just: final box + travel vector.
//
// Each layer is also exported as an outlined SVG, which sidesteps the Loos Var font
// (weights 500/666/1000, not installed and not licensed to us) at pixel-exact fidelity.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const KEY = 'IBXDFTKO9J4ouoT2gvk5go';
const TOKEN = readFileSync('.figma-token', 'utf8').trim();
const nodes = JSON.parse(readFileSync('refs/nodes.json', 'utf8')).nodes;

const SCENES = [
  { id: 1, lang: 'ru', from: 'Frame 2136137190', to: 'Frame 2136137191' },
  { id: 2, lang: 'tg', from: 'Frame 2136137192', to: 'Frame 2136137193' },
  { id: 3, lang: 'ru', from: 'Frame 2136137194', to: 'Frame 2136137198' },
  { id: 4, lang: 'tg', from: 'Frame 2136137197', to: 'Frame 2136137199' },
  { id: 5, lang: 'ru', from: 'Frame 2136137200', to: 'Frame 2136137201' },
  { id: 6, lang: 'tg', from: 'Frame 2136137202', to: 'Frame 2136137203' },
];

const frame = (name) => Object.values(nodes).find((v) => v.document.name === name).document;
const isBg = (n) => n.name.startsWith('youra_logo');

// Position against absoluteRenderBounds, not absoluteBoundingBox. Figma's SVG export
// tight-crops to the rendered ink, so a text layer's box (which carries line-height
// leading) is several px larger than the file we actually place — 150x63 vs 142x59 for
// the scene 1 headline. Using the box would offset every text layer down and right.
const rel = (node, origin) => {
  const b = node.absoluteRenderBounds ?? node.absoluteBoundingBox;
  return { x: b.x - origin.x, y: b.y - origin.y, w: b.width, h: b.height };
};

// Travel has to be measured on absoluteBoundingBox: in the "from" frame every layer sits
// outside the artboard, and Figma clips absoluteRenderBounds to the frame there (or drops
// it), which would report a bogus few-px drift instead of the real 160px slide.
const box = (node, origin) => ({
  x: node.absoluteBoundingBox.x - origin.x,
  y: node.absoluteBoundingBox.y - origin.y,
  w: node.absoluteBoundingBox.width,
  h: node.absoluteBoundingBox.height,
});

// Give each layer a stable role so the HTML can be written against names, not indexes.
const roleOf = (node) => {
  if (node.name === 'logo') return 'logo';
  if (node.name === 'Frame 2136137192') return 'contacts';
  if (/^Frame 21361371(79|80)$/.test(node.name)) return 'cta';
  return null; // resolved below by vertical order
};

const spec = [];
const exportIds = new Map(); // nodeId -> output svg filename

for (const s of SCENES) {
  const fFrom = frame(s.from), fTo = frame(s.to);
  const oFrom = fFrom.absoluteBoundingBox, oTo = fTo.absoluteBoundingBox;

  const layers = [];
  const used = new Set();
  const textSeen = [];

  for (const src of fFrom.children) {
    if (isBg(src)) continue;
    // First unused same-named layer in the "to" frame — this also drops the
    // duplicated layer stack that Frame 2136137198 carries.
    const dst = fTo.children.find((c) => c.name === src.name && !used.has(c.id));
    if (!dst) { console.warn(`scene${s.id}: no match for "${src.name}"`); continue; }
    used.add(dst.id);

    const b = rel(dst, oTo);                          // where it rests
    const travel = { x: box(src, oFrom).x - box(dst, oTo).x, y: box(src, oFrom).y - box(dst, oTo).y };
    let role = roleOf(dst);
    if (!role) { textSeen.push(dst); role = textSeen.length === 1 ? 'headline' : 'subline'; }

    const text = (function collect(n, acc = []) {
      if (n.characters) acc.push(n.characters);
      for (const c of n.children ?? []) collect(c, acc);
      return acc;
    })(dst).join(' / ');

    const file = `scene${s.id}-${role}.svg`;
    exportIds.set(dst.id, file);
    layers.push({
      role, svg: file, text,
      x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.w.toFixed(1), h: +b.h.toFixed(1),
      dx: +travel.x.toFixed(1), dy: +travel.y.toFixed(1),
    });
  }

  // Animate top-to-bottom, which is also how the eye reads the banner.
  layers.sort((p, q) => p.y - q.y);

  const bgFrom = box(fFrom.children.find(isBg), oFrom);
  const bgTo = box(fTo.children.find(isBg), oTo);
  spec.push({ ...s, bgPan: +(bgTo.x - bgFrom.x).toFixed(1), layers });
}

// One batched SVG render for every layer across all six scenes.
mkdirSync('refs/svg', { recursive: true });
const ids = [...exportIds.keys()];
const res = await fetch(
  `https://api.figma.com/v1/images/${KEY}?ids=${ids.join(',')}&format=svg&svg_outline_text=true`,
  { headers: { 'X-Figma-Token': TOKEN } }
);
if (!res.ok) throw new Error(`images svg -> ${res.status} ${await res.text()}`);
const { images } = await res.json();

let total = 0;
for (const [id, file] of exportIds) {
  const path = `refs/svg/${file}`;
  if (existsSync(path)) { total += readFileSync(path).length; continue; }
  if (!images[id]) { console.warn(`no svg for ${file}`); continue; }
  const svg = await (await fetch(images[id])).text();
  writeFileSync(path, svg);
  total += svg.length;
  console.log(`  ${file.padEnd(24)} ${(svg.length / 1024).toFixed(1)} KB`);
}

// Figma rounds each exported SVG up to whole pixels; carry the real file size into the
// spec so the <img> is never rescaled away from the vector's own coordinate system.
for (const s of spec) {
  for (const l of s.layers) {
    const head = readFileSync(`refs/svg/${l.svg}`, 'utf8').slice(0, 400);
    const w = head.match(/width="([\d.]+)"/), h = head.match(/height="([\d.]+)"/);
    if (w && h) { l.svgW = +w[1]; l.svgH = +h[1]; }
  }
}

writeFileSync('refs/spec.json', JSON.stringify(spec, null, 2));
console.log(`\nrefs/spec.json written. SVG total ${(total / 1024).toFixed(0)} KB raw.`);
for (const s of spec) {
  console.log(`\nscene${s.id} (${s.lang})  bgPan=${s.bgPan}`);
  for (const l of s.layers) {
    console.log(`  ${l.role.padEnd(9)} @${String(l.x).padStart(6)},${String(l.y).padStart(3)} ` +
      `${l.w}x${l.h}  travel ${l.dx > 0 ? '+' : ''}${l.dx},${l.dy}  "${l.text.slice(0, 42)}"`);
  }
}
