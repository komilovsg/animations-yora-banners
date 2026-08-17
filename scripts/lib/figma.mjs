// Shared Figma helpers for the whole size set.
//
// The 160x600 section could be driven off hardcoded frame names. The eight later sections
// cannot: the CTA is "Frame 2136137234" in one and "Frame 2136137179" in another, and the
// contacts strip changes id per message. So roles are detected structurally instead.
import { readFileSync } from 'node:fs';

export const KEY = 'IBXDFTKO9J4ouoT2gvk5go';
export const TOKEN = readFileSync('.figma-token', 'utf8').trim();

// The render endpoint rate-limits hard and stays limited for minutes. Batch everything
// into as few calls as possible and back off when it still bites.
export async function api(path, { tries = 12 } = {}) {
  let res;
  for (let i = 0; i < tries; i++) {
    res = await fetch(`https://api.figma.com/v1/${path}`, { headers: { 'X-Figma-Token': TOKEN } });
    if (res.status !== 429) break;
    // The render quota is hourly, not per-minute: once it is spent, short retries just
    // burn the window. Climb to a five-minute poll and wait it out.
    const wait = Math.min(300_000, 30_000 * 2 ** i);
    console.log(`  rate limited, retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`${path.slice(0, 60)} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export const textsOf = (node, acc = []) => {
  if (node.characters) acc.push(node.characters.replace(/\s+/g, ' ').trim());
  for (const c of node.children ?? []) textsOf(c, acc);
  return acc;
};

export const textOf = (node) => textsOf(node).join(' ');

// Identity of a frame's copy, used to find its opposite keyframe. Deduplicated and sorted
// because a couple of comps carry the whole layer stack twice — Frame 2136137198 does —
// which would otherwise give a frame a different key from its own partner.
export const copyKey = (node) => [...new Set(textsOf(node))].sort().join(' | ');

export const isBg = (n) => n.name.startsWith('youra_logo');

// Ink bounds — what Figma's SVG export actually crops to.
export const rel = (node, origin) => {
  const b = node.absoluteRenderBounds ?? node.absoluteBoundingBox;
  return { x: b.x - origin.x, y: b.y - origin.y, w: b.width, h: b.height };
};

// Layout bounds — reliable even for layers parked outside the artboard, where Figma
// clips or drops absoluteRenderBounds.
export const box = (node, origin) => ({
  x: node.absoluteBoundingBox.x - origin.x,
  y: node.absoluteBoundingBox.y - origin.y,
  w: node.absoluteBoundingBox.width,
  h: node.absoluteBoundingBox.height,
});

export function roleOf(node) {
  if (isBg(node)) return 'bg';
  if (node.name === 'logo' || node.type === 'INSTANCE') return 'logo';
  if (/@weyora|\+992/.test(textOf(node))) return 'contacts';
  if ((node.fills ?? []).some((f) => f.type?.startsWith('GRADIENT'))) return 'cta';
  return null;                       // a bare TEXT — headline or subline, resolved by order
}

// Frames come in pairs: the same artwork parked off-canvas, then at rest. Match them on
// the headline copy, then tell the two apart by whether the content sits outside the frame.
export function pairFrames(frames) {
  const groups = new Map();
  for (const f of frames) {
    const key = copyKey(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const pairs = [];
  for (const [key, group] of groups) {
    if (group.length !== 2) {
      console.warn(`  ! "${key.slice(0, 40)}" has ${group.length} frame(s), expected 2 — skipped`);
      continue;
    }
    const outside = (f) => {
      const o = f.absoluteBoundingBox;
      return (f.children ?? []).filter((c) => !isBg(c)).filter((c) => {
        const b = box(c, o);
        return b.x + b.w < 1 || b.x > o.width - 1;
      }).length;
    };
    const [a, b] = group;
    const [from, to] = outside(a) >= outside(b) ? [a, b] : [b, a];
    if (outside(from) === 0) console.warn(`  ! "${key.slice(0, 40)}" has no off-canvas frame`);
    pairs.push({ from, to, key });
  }
  return pairs;
}

// Which of the three messages a pair carries — drives the slug and the landing page.
export function messageOf(text) {
  if (/сотрудник|Корманди/i.test(text)) return 'employer';
  if (/вакансия!|ҷойи корӣ дорем|Мо ҷойи/i.test(text)) return 'jobseeker';
  return 'brand';
}

export const langOf = (text) => (/[ҷҳӣӯқғҶҲӢӮҚҒ]/.test(text) ? 'tj' : 'ru');
