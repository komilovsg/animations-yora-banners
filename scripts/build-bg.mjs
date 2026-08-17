#!/usr/bin/env node
// Rebuild each scene's 160x600 background from the single 1920x1080 Figma source.
//
// Every background is that one image, but placed three different ways across the set, and
// absoluteBoundingBox is a trap for two of them:
//
//   scenes 1-2  axis-aligned, node 1182x665, FILL.
//   scenes 3-4  node 1782x1002 ROTATED 14.1deg. Its bounding box is 1972x1406, which is the
//               box of the rotated rect, not the rect — sizing the image to the box shears
//               the whole background and drops the diagonal light streaks out of place.
//   scenes 5-6  axis-aligned, node 1763x992, STRETCH with an imageTransform nudge.
//
// Every node's aspect is 1.777, same as the source, so FILL/cover crops nothing.
// Scene 4 also pans its background 30px during the animation, so its slice is cut wider and
// the extra width is travelled with a transform at runtime.
import { readFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const W = 160, H = 600, SCALE = 2; // @2x for retina
const SRC = 'refs/bg-source.png';
const nodes = JSON.parse(readFileSync('refs/nodes.json', 'utf8')).nodes;

const SCENES = [
  { id: 1, from: 'Frame 2136137190', to: 'Frame 2136137191' },
  { id: 2, from: 'Frame 2136137192', to: 'Frame 2136137193' },
  { id: 3, from: 'Frame 2136137194', to: 'Frame 2136137198' },
  { id: 4, from: 'Frame 2136137197', to: 'Frame 2136137199' },
  { id: 5, from: 'Frame 2136137200', to: 'Frame 2136137201' },
  { id: 6, from: 'Frame 2136137202', to: 'Frame 2136137203' },
];

const frame = (name) => Object.values(nodes).find((v) => v.document.name === name).document;
const bgOf = (name) => {
  const f = frame(name);
  const n = f.children.find((c) => c.name.startsWith('youra_logo'));
  const o = f.absoluteBoundingBox, b = n.absoluteBoundingBox;
  return {
    node: n,
    bboxX: b.x - o.x, bboxY: b.y - o.y,          // rotated box, relative to the frame
    w: n.size.x, h: n.size.y,                    // the rect's own size, pre-rotation
    deg: (n.rotation ?? 0) * 180 / Math.PI,
    fill: (n.fills ?? []).find((x) => x.imageRef),
  };
};

// Paint the image into the node box, then rotate the box the way Figma does.
async function placed(bg) {
  const nodeW = Math.round(bg.w * SCALE), nodeH = Math.round(bg.h * SCALE);
  const t = bg.fill.imageTransform;

  let buf;
  if (bg.fill.scaleMode === 'FILL' || !t) {
    buf = await sharp(SRC).resize(nodeW, nodeH, { fit: 'cover', position: 'centre' }).png().toBuffer();
  } else {
    // STRETCH + crop transform: the image is stretched over the node, then slid by tx/ty
    // (fractions of the node box). Only the sign is convention; SHIFT_SIGN pins it.
    const drawW = Math.round(nodeW / t[0][0]), drawH = Math.round(nodeH / t[1][1]);
    const dx = Math.round(SHIFT_SIGN * t[0][2] * drawW), dy = Math.round(SHIFT_SIGN * t[1][2] * drawH);
    buf = await sharp({ create: { width: nodeW, height: nodeH, channels: 3, background: '#000' } })
      .composite([{
        input: await sharp(SRC).resize(drawW, drawH, { fit: 'fill' }).png().toBuffer(),
        left: dx, top: dy,
      }])
      .png().toBuffer();
  }

  if (Math.abs(bg.deg) < 0.01) return { buf, w: nodeW, h: nodeH };
  const rot = await sharp(buf).rotate(bg.deg, { background: '#000' }).png().toBuffer();
  const m = await sharp(rot).metadata();
  return { buf: rot, w: m.width, h: m.height };
}

// Figma does not document which way imageTransform's translation points. Measured against
// the reference render: -1 lands scenes 5-6 at 6% residual, +1 at 16%, dropping it at 11%.
const SHIFT_SIGN = -1;

mkdirSync('refs/bg', { recursive: true });

for (const s of SCENES) {
  const a = bgOf(s.from), b = bgOf(s.to);
  const img = await placed(b);                     // the resting frame defines the look

  const pan = Math.round(b.bboxX - a.bboxX);       // background travel over the animation
  const sliceW = W + Math.abs(pan);
  // Start from whichever end sits further left so the whole travelled band is covered.
  const left = Math.round(-Math.max(a.bboxX, b.bboxX) * SCALE);
  const top = Math.round(-a.bboxY * SCALE);

  if (left < 0 || top < 0 || left + sliceW * SCALE > img.w || top + H * SCALE > img.h) {
    throw new Error(`scene${s.id}: window ${left},${top} ${sliceW * SCALE}x${H * SCALE} outside ${img.w}x${img.h}`);
  }

  const out = `refs/bg/scene${s.id}.jpg`;
  const info = await sharp(img.buf)
    .extract({ left, top, width: sliceW * SCALE, height: H * SCALE })
    .jpeg({ quality: 80, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(out);

  console.log(
    `scene${s.id}  ${b.fill.scaleMode.padEnd(7)} node ${Math.round(b.w)}x${Math.round(b.h)} rot ${b.deg.toFixed(1)}deg` +
    ` -> ${img.w / SCALE}x${img.h / SCALE}  window ${left / SCALE},${top / SCALE}  pan=${pan}  ${(info.size / 1024).toFixed(0)} KB`
  );
}
