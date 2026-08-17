#!/usr/bin/env node
// Split the one-line contacts strip into two stackable layers: Telegram handle, phone.
//
// The comp draws them as "@weyora | +992 553 06 2222" on a single line; the brief wants
// them stacked and larger. Rather than ask Figma to render each TEXT node on its own —
// the render endpoint rate-limits hard, and the comp must not be edited — re-wrap the
// already-exported strip twice with a cropped viewBox. Same vectors, windowed.
//
// Idempotent: rewrites spec.json in place, and does nothing to a creative already split.
// Run after build-spec.mjs, before build-banners.mjs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));
const bounds = (n) => n.absoluteRenderBounds ?? n.absoluteBoundingBox;

const cache = new Map();
const frameById = (file, id) => {
  if (!cache.has(file)) {
    const byId = new Map();
    for (const v of Object.values(JSON.parse(readFileSync(file, 'utf8')).nodes)) byId.set(v.document.id, v.document);
    cache.set(file, byId);
  }
  return cache.get(file).get(id);
};

let done = 0, waiting = 0;

for (const scene of spec) {
  const idx = scene.layers.findIndex((l) => l.role === 'contacts');
  if (idx === -1) continue;                                   // already split, or none

  const contacts = scene.layers[idx];
  if (!existsSync(`refs/svg/${contacts.svg}`)) { waiting++; continue; }

  const frame = frameById(scene.nodes, scene.toId);
  const strip = frame.children.find((c) => /@weyora|\+992/.test(
    (function t(n, a = []) { if (n.characters) a.push(n.characters); for (const k of n.children ?? []) t(k, a); return a; })(c).join(' ')
  ));
  const p = bounds(strip);
  const lines = strip.children.filter((c) => c.type === 'TEXT');
  if (lines.length !== 2) { console.warn(`  ! ${scene.stem}: ${lines.length} text lines in the strip`); continue; }

  // One shared vertical band for both crops, so the two lines keep identical glyph scale
  // (the handle has a descender, the number does not).
  const lb = lines.map(bounds);
  const top = Math.min(...lb.map((l) => l.y)) - p.y;
  const bandH = Math.max(...lb.map((l) => l.y + l.height)) - p.y - top;

  const svg = readFileSync(`refs/svg/${contacts.svg}`, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  const made = ['telegram', 'phone'].map((role, k) => {
    const b = lb[k];
    const x = b.x - p.x;
    const file = `${scene.stem}-${role}.svg`;
    writeFileSync(
      `refs/svg/${file}`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width.toFixed(2)}" ` +
      `height="${bandH.toFixed(2)}" fill="none" ` +
      `viewBox="${x.toFixed(2)} ${top.toFixed(2)} ${b.width.toFixed(2)} ${bandH.toFixed(2)}">${inner}</svg>`
    );
    return {
      role, svg: file, text: lines[k].characters,
      x: +(contacts.x + x).toFixed(1), y: +(contacts.y + top).toFixed(1),
      w: +b.width.toFixed(1), h: +bandH.toFixed(1),
      dx: contacts.dx, dy: contacts.dy,
      svgW: +b.width.toFixed(2), svgH: +bandH.toFixed(2),
      anchorY: +(contacts.y + contacts.h / 2).toFixed(1),
    };
  });

  scene.layers.splice(idx, 1, ...made);
  done++;
}

writeFileSync('refs/spec.json', JSON.stringify(spec, null, 2));
console.log(`split ${done} contact strips` + (waiting ? `, ${waiting} waiting on renders` : ''));
