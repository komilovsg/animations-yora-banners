#!/usr/bin/env node
// Split the one-line contacts strip into two stackable layers: Telegram handle, phone.
//
// The comp draws them as "@weyora | +992 553 06 2222" on a single line, and the client
// wants them stacked and larger. Rather than ask Figma to render each TEXT node on its own
// (the render endpoint rate-limits hard, and the comp must not be edited), re-wrap the
// already-exported strip twice with a cropped viewBox — the glyph outlines are the same
// vectors, just windowed. Then rewrite spec.json so the contacts layer becomes two.
//
// Run after build-spec.mjs, before build-banners.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

const nodes = JSON.parse(readFileSync('refs/nodes.json', 'utf8')).nodes;
const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));

const TO_FRAME = { 1: 'Frame 2136137191', 2: 'Frame 2136137193', 4: 'Frame 2136137199', 5: 'Frame 2136137201', 6: 'Frame 2136137203' };
const bounds = (n) => n.absoluteRenderBounds ?? n.absoluteBoundingBox;

for (const scene of spec) {
  const idx = scene.layers.findIndex((l) => l.role === 'contacts');
  if (idx === -1) continue;

  const frame = Object.values(nodes).find((v) => v.document.name === TO_FRAME[scene.id]).document;
  const strip = frame.children.find((c) => c.name === 'Frame 2136137192');
  const p = bounds(strip);
  const lines = strip.children.filter((c) => c.type === 'TEXT').map((c) => bounds(c));

  // One shared vertical band for both crops, so the two lines keep identical glyph scale
  // (the handle has a descender, the number does not).
  const top = Math.min(...lines.map((l) => l.y)) - p.y;
  const bottom = Math.max(...lines.map((l) => l.y + l.height)) - p.y;
  const bandH = bottom - top;

  const svg = readFileSync(`refs/svg/${scene.layers[idx].svg}`, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  const contacts = scene.layers[idx];
  const made = ['telegram', 'phone'].map((role, k) => {
    const b = lines[k];
    const x = b.x - p.x;
    const file = `scene${scene.id}-${role}.svg`;
    writeFileSync(
      `refs/svg/${file}`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width.toFixed(2)}" ` +
      `height="${bandH.toFixed(2)}" fill="none" ` +
      `viewBox="${x.toFixed(2)} ${top.toFixed(2)} ${b.width.toFixed(2)} ${bandH.toFixed(2)}">${inner}</svg>`
    );
    return {
      role, svg: file, text: strip.children.filter((c) => c.type === 'TEXT')[k].characters,
      x: +(contacts.x + x).toFixed(1), y: +(contacts.y + top).toFixed(1),
      w: +b.width.toFixed(1), h: +bandH.toFixed(1),
      dx: contacts.dx, dy: contacts.dy,
      svgW: +b.width.toFixed(2), svgH: +bandH.toFixed(2),
      anchorY: +(contacts.y + contacts.h / 2).toFixed(1),
    };
  });

  scene.layers.splice(idx, 1, ...made);
  console.log(`scene${scene.id}  band ${top.toFixed(1)}..${bottom.toFixed(1)}  ` +
    made.map((m) => `${m.role} ${m.svgW}x${m.svgH}`).join('  '));
}

writeFileSync('refs/spec.json', JSON.stringify(spec, null, 2));
console.log('refs/spec.json updated.');
