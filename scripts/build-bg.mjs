#!/usr/bin/env node
// Cut every creative's background out of the single 1920x1080 Figma source.
//
// One image, but placed differently in almost every frame, and absoluteBoundingBox lies
// for two of the cases:
//
//   FILL     cover-fit, aspect preserved, centred inside the node box.
//   STRETCH  node filled edge to edge, then imageTransform slides the image inside it.
//   rotated  some nodes sit at 14.1deg. Their bounding box is the box of the rotated
//            rect, not the rect — sizing the image to the box shears the whole background
//            and drags the diagonal light streaks out of place. Use size + rotation.
//
// Two extra jobs on top of the straight crop:
//   * A frame that pans its background during the animation gets a wider slice, and the
//     extra width is travelled with a transform at runtime.
//   * The three sections drawn 20px narrower than the size they are named after are cut
//     20px wider here, split evenly, so the rebuild gains margin instead of scaling.
import { readFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

// @2x is right for the small formats a phone shows at device-pixel-ratio 2. Past ~600px
// the creative is already large on screen and doubling it only spends the weight budget —
// a 1920x1080 background at @2x is a 3840px JPEG nobody sees the detail of.
const scaleFor = (w, h) => (Math.max(w, h) <= 600 ? 2 : 1);
const SRC = 'refs/bg-source.png';
const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));

// Figma does not document which way imageTransform's translation points. Measured against
// the reference render: -1 lands the 160x600 brand frames at 6% residual, +1 at 16%.
const SHIFT_SIGN = -1;

const nodeCache = new Map();
const framesOf = (file) => {
  if (!nodeCache.has(file)) {
    const byId = new Map();
    for (const v of Object.values(JSON.parse(readFileSync(file, 'utf8')).nodes)) byId.set(v.document.id, v.document);
    nodeCache.set(file, byId);
  }
  return nodeCache.get(file);
};

const bgOf = (frame) => {
  const n = frame.children.find((c) => c.name.startsWith('youra_logo'));
  const o = frame.absoluteBoundingBox, b = n.absoluteBoundingBox;
  return {
    bboxX: b.x - o.x, bboxY: b.y - o.y,
    w: n.size.x, h: n.size.y,
    deg: (n.rotation ?? 0) * 180 / Math.PI,
    fill: (n.fills ?? []).find((x) => x.imageRef),
  };
};

const meta = await sharp(SRC).metadata();

// Paint the source into the node box the way Figma does, then rotate the box.
async function placed(bg, SCALE) {
  const nodeW = Math.round(bg.w * SCALE), nodeH = Math.round(bg.h * SCALE);
  const t = bg.fill.imageTransform;

  let buf;
  if (bg.fill.scaleMode === 'FILL' || !t) {
    buf = await sharp(SRC).resize(nodeW, nodeH, { fit: 'cover', position: 'centre' }).png().toBuffer();
  } else {
    const drawW = Math.round(nodeW / t[0][0]), drawH = Math.round(nodeH / t[1][1]);
    buf = await sharp({ create: { width: nodeW, height: nodeH, channels: 3, background: '#000' } })
      .composite([{
        input: await sharp(SRC).resize(drawW, drawH, { fit: 'fill' }).png().toBuffer(),
        left: Math.round(SHIFT_SIGN * t[0][2] * drawW),
        top: Math.round(SHIFT_SIGN * t[1][2] * drawH),
      }])
      .png().toBuffer();
  }

  if (Math.abs(bg.deg) < 0.01) return { buf, w: nodeW, h: nodeH };
  const rot = await sharp(buf).rotate(bg.deg, { background: '#000' }).png().toBuffer();
  const m = await sharp(rot).metadata();
  return { buf: rot, w: m.width, h: m.height };
}

mkdirSync('refs/bg', { recursive: true });
console.log(`source ${meta.width}x${meta.height}`);

// A derived size has no frame in the comp, so there is no node placement to follow. Reuse
// the placement of the same message at a comped size and re-cut the window: same artwork,
// same focal point, framed for the new canvas. Scale the placement up first when the
// target is larger than the reference node.
const reference = new Map();   // message -> { bg, windowCentre }

for (const s of spec) {
  if (s.derived) continue;
  const byId = framesOf(s.nodes);
  const a = bgOf(byId.get(s.fromId));
  if (!reference.has(s.message) || s.w * s.h > reference.get(s.message).area) {
    reference.set(s.message, {
      area: s.w * s.h,
      bg: a,
      cx: -a.bboxX + s.w / 2,
      cy: -a.bboxY + s.h / 2,
    });
  }
}

for (const s of spec) {
  const SCALE = scaleFor(s.w, s.h);

  if (s.derived) {
    const ref = reference.get(s.message);
    if (!ref) { console.warn(`  ! ${s.stem}: no reference artwork for "${s.message}"`); continue; }

    // Grow the node until the placed image can hold the requested window.
    const need = Math.max((s.w * SCALE) / (ref.bg.w * SCALE), (s.h * SCALE) / (ref.bg.h * SCALE), 1);
    const grown = { ...ref.bg, w: ref.bg.w * need, h: ref.bg.h * need };
    const img = await placed(grown, SCALE);

    const cx = ref.cx * need * SCALE * (grown.deg ? 1 : 1);
    const cy = ref.cy * need * SCALE;
    const left = Math.min(Math.max(0, Math.round(cx - (s.w * SCALE) / 2)), img.w - s.w * SCALE);
    const top = Math.min(Math.max(0, Math.round(cy - (s.h * SCALE) / 2)), img.h - s.h * SCALE);

    const info = await sharp(img.buf)
      .extract({ left, top, width: s.w * SCALE, height: s.h * SCALE })
      .jpeg({ quality: s.w * s.h > 400_000 ? 68 : 80, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(`refs/bg/${s.stem}.jpg`);
    console.log(`${s.stem.padEnd(28)} derived from ${s.message} ×${need.toFixed(2)}  ${(info.size / 1024).toFixed(0)} KB`);
    continue;
  }

  const byId = framesOf(s.nodes);
  const a = bgOf(byId.get(s.fromId)), b = bgOf(byId.get(s.toId));
  const img = await placed(b, SCALE);                // the resting frame defines the look

  const pan = Math.round(b.bboxX - a.bboxX);
  const padX = (s.w - s.drawnW) / 2;                 // widening for the renamed sections
  const padY = (s.h - s.drawnH) / 2;
  const sliceW = s.w + Math.abs(pan);

  // Start from whichever end sits further left so the whole travelled band is covered.
  let left = Math.round((-Math.max(a.bboxX, b.bboxX) - padX) * SCALE);
  let top = Math.round((-a.bboxY - padY) * SCALE);
  const wantW = sliceW * SCALE, wantH = s.h * SCALE;

  // The source is far bigger than any frame, but a widened crop can still run off an edge.
  const clamped = [Math.min(Math.max(0, left), img.w - wantW), Math.min(Math.max(0, top), img.h - wantH)];
  if (clamped[0] !== left || clamped[1] !== top) {
    console.warn(`  ${s.stem}: window clamped ${left},${top} -> ${clamped[0]},${clamped[1]}`);
    [left, top] = clamped;
  }

  const info = await sharp(img.buf)
    .extract({ left, top, width: wantW, height: wantH })
    .jpeg({ quality: 80, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(`refs/bg/${s.stem}.jpg`);

  console.log(
    `${s.stem.padEnd(26)} ${b.fill.scaleMode.padEnd(7)} rot ${b.deg.toFixed(1).padStart(5)}deg  ` +
    `slice ${sliceW}x${s.h}${pan ? ` pan ${pan}` : ''}${padX ? ` +${padX * 2}w` : ''}  ${(info.size / 1024).toFixed(0)} KB`
  );
}
