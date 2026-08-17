#!/usr/bin/env node
// Turn every "Прототип …" section of the Figma file into one animation spec.
//
// A section holds each message twice: once with the layers parked off-canvas, once with
// them at rest. The delta between the pair is the entrance animation, so a spec entry is
// just: final box + travel vector, per layer.
//
// Layers also ship as outlined SVG, which sidesteps the Loos Var font (weights
// 500/666/1000, not licensed to us) at pixel-exact fidelity. Everything already on disk is
// reused — the render endpoint rate-limits hard, so one batched call for the gaps only.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { KEY, api, isBg, rel, box, roleOf, textOf, pairFrames, messageOf, langOf } from './lib/figma.mjs';

// The Figma section names promise sizes the frames inside do not match. Where the drawn
// size is not on a platform's list, the frame is rebuilt at the promised size instead —
// see scripts/build-bg.mjs and build-banners.mjs for how the extra width is spent.
const TARGET = { '300x50': '320x50', '300x100': '320x100', '300x480': '320x480' };

const sources = [
  { file: 'refs/nodes.json', size: '160x600' },
  ...readdirSync('refs')
    .filter((f) => /^nodes-\d+x\d+\.json$/.test(f))
    .map((f) => ({ file: `refs/${f}`, size: f.replace(/^nodes-|\.json$/g, '') })),
];

const spec = [];
const exportIds = new Map();   // figma node id -> svg filename

for (const src of sources) {
  const frames = Object.values(JSON.parse(readFileSync(src.file, 'utf8')).nodes).map((v) => v.document);
  console.log(`\n${src.size}  (${frames.length} frames)`);

  for (const { from, to, key } of pairFrames(frames)) {
    const oFrom = from.absoluteBoundingBox, oTo = to.absoluteBoundingBox;
    const drawn = `${Math.round(oTo.width)}x${Math.round(oTo.height)}`;
    const size = TARGET[drawn] ?? drawn;
    const message = messageOf(key), lang = langOf(key);
    const stem = `${size}-${message}-${lang}`;

    const layers = [];
    const used = new Set();
    let textSeen = 0;

    for (const srcLayer of from.children) {
      if (isBg(srcLayer)) continue;
      // First unused same-named layer in the resting frame. This also drops the duplicated
      // layer stack that a couple of the comps carry.
      const dst = to.children.find((c) => c.name === srcLayer.name && !used.has(c.id));
      if (!dst) { console.warn(`  ! ${stem}: no match for "${srcLayer.name}"`); continue; }
      used.add(dst.id);

      let role = roleOf(dst);
      if (!role) role = ++textSeen === 1 ? 'headline' : 'subline';

      const b = rel(dst, oTo);
      const a = box(srcLayer, oFrom), c = box(dst, oTo);
      const file = `${stem}-${role}.svg`;
      exportIds.set(dst.id, file);

      layers.push({
        role, svg: file, nodeId: dst.id, text: textOf(dst).slice(0, 80),
        x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.w.toFixed(1), h: +b.h.toFixed(1),
        dx: +(a.x - c.x).toFixed(1), dy: +(a.y - c.y).toFixed(1),
      });
    }

    layers.sort((p, q) => p.y - q.y);   // stagger follows the reading order

    const bgFrom = box(from.children.find(isBg), oFrom);
    const bgTo = box(to.children.find(isBg), oTo);

    spec.push({
      size, drawn, message, lang, stem,
      w: +size.split('x')[0], h: +size.split('x')[1],
      drawnW: Math.round(oTo.width), drawnH: Math.round(oTo.height),
      fromId: from.id, toId: to.id, nodes: src.file,
      bgPan: +(bgTo.x - bgFrom.x).toFixed(1),
      layers,
    });
    console.log(`  ${stem.padEnd(26)} ${layers.length} layers` +
      (size !== drawn ? `  (drawn ${drawn}, rebuilt at ${size})` : ''));
  }
}

// Geometry only. Rendering lives in render-svg.mjs, which never writes this file — it can
// sit in rate-limit backoff for an hour, and must not clobber the layer edits that
// split-contacts.mjs makes here in the meantime.
mkdirSync('refs/svg', { recursive: true });
const missing = [...exportIds].filter(([, f]) => !existsSync(`refs/svg/${f}`));

writeFileSync('refs/spec.json', JSON.stringify(spec, null, 2));
console.log(`\nrefs/spec.json — ${spec.length} creatives across ${new Set(spec.map((s) => s.size)).size} sizes`);
console.log(`${exportIds.size} layers, ${missing.length} not yet rendered` +
  (missing.length ? ' — run scripts/render-svg.mjs' : ''));
