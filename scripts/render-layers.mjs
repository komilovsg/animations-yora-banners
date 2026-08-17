#!/usr/bin/env node
// Produce every layer SVG locally — no Figma render calls.
//
// The comp gives us geometry and styling for free in nodes-*.json; only the glyph outlines
// used to require Figma's exporter, and LoosVar reproduces those exactly (validated against
// the Figma exports: same line breaks, same widths to within a pixel). That matters twice
// over, because the render endpoint's hourly quota cannot carry a set this size, and
// because the Tajik cuts of the later sizes are not drawn in the comp at all.
//
// Three kinds of layer:
//   text   typeset with the node's own fontStyle/size/lineHeight, wrapped to its box
//   cta    gradient pill rebuilt from the node's fills + corner radius, text centred on it
//   logo   pure vector already; reuse an exported one and restate its size
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { typeset } from './lib/typeset.mjs';

const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));

// Index every node of every cached section by id.
const byId = new Map();
for (const f of ['refs/nodes.json', ...readdirSync('refs').filter((x) => /^nodes-\d+x\d+\.json$/.test(x)).map((x) => `refs/${x}`)]) {
  if (!existsSync(f)) continue;
  const walk = (n) => { byId.set(n.id, n); for (const c of n.children ?? []) walk(c); };
  for (const v of Object.values(JSON.parse(readFileSync(f, 'utf8')).nodes)) walk(v.document);
}

const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');

const textStyle = (node) => ({
  text: node.characters,
  fontStyle: node.style.fontStyle,
  fontSize: node.style.fontSize,
  lineHeight: node.style.lineHeightPx,
  align: node.style.textAlignHorizontal,
  letterSpacing: node.style.letterSpacing ?? 0,
  // textAutoResize WIDTH_AND_HEIGHT means the box hugs the text — no wrapping.
  maxWidth: node.style.textAutoResize === 'WIDTH_AND_HEIGHT' ? Infinity : node.absoluteBoundingBox.width,
  color: hex((node.fills ?? []).find((f) => f.type === 'SOLID')?.color ?? { r: 1, g: 1, b: 1 }),
});

// A gradient pill: rounded rect painted with the node's own linear gradient, label on top.
function renderCta(node) {
  const { width: w, height: h } = node.absoluteBoundingBox;
  const fill = (node.fills ?? []).filter((f) => f.visible !== false).find((f) => f.type === 'GRADIENT_LINEAR');
  const label = (function find(n) {
    if (n.type === 'TEXT') return n;
    for (const c of n.children ?? []) { const r = find(c); if (r) return r; }
    return null;
  })(node);

  const [p0, p1] = fill.gradientHandlePositions;
  const stops = fill.gradientStops
    .map((s) => `<stop offset="${(s.position * 100).toFixed(2)}%" stop-color="${hex(s.color)}"/>`).join('');
  const r = Math.min(node.cornerRadius ?? h / 2, h / 2);

  let inner = '';
  if (label) {
    const t = typeset(textStyle(label));
    const lb = label.absoluteRenderBounds ?? label.absoluteBoundingBox;
    const o = node.absoluteBoundingBox;
    // Place the label where the comp puts it inside the pill.
    inner = `<g transform="translate(${(lb.x - o.x).toFixed(2)},${(lb.y - o.y).toFixed(2)})">` +
      t.svg.replace(/^<svg[^>]*>/, `<svg width="${t.width}" height="${t.height}" viewBox="${t.svg.match(/viewBox="([^"]+)"/)[1]}">`) +
      '</g>';
  }

  return {
    width: Math.round(w), height: Math.round(h),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" fill="none" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}">` +
      `<defs><linearGradient id="g" x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}">${stops}</linearGradient></defs>` +
      `<rect width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${r.toFixed(2)}" fill="url(#g)"/>${inner}</svg>`,
  };
}

// The contacts strip: handle, hairline divider, phone — each child kept at the offset the
// comp gives it, so split-contacts.mjs can slice the result back into two stacked lines.
function renderContacts(node) {
  const o = node.absoluteRenderBounds ?? node.absoluteBoundingBox;
  const w = Math.ceil(o.width), h = Math.ceil(o.height);
  const parts = [];

  for (const child of node.children ?? []) {
    const b = child.absoluteRenderBounds ?? child.absoluteBoundingBox;
    const dx = (b.x - o.x).toFixed(2), dy = (b.y - o.y).toFixed(2);
    if (child.type === 'TEXT') {
      const t = typeset(textStyle(child));
      parts.push(`<g transform="translate(${dx},${dy})">${t.svg.replace(/^<svg[^>]*>/, `<svg width="${t.width}" height="${t.height}" viewBox="${t.svg.match(/viewBox="([^"]+)"/)[1]}">`)}</g>`);
    } else {
      const c = (child.fills ?? []).find((f) => f.type === 'SOLID');
      parts.push(`<rect x="${dx}" y="${dy}" width="${b.width.toFixed(2)}" height="${b.height.toFixed(2)}" fill="${c ? hex(c.color) : '#fff'}"/>`);
    }
  }

  return {
    width: w, height: h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" fill="none" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`,
  };
}

// The logo is vector in the comp and identical everywhere; take an exported one and
// restate its box. Scaling a path set is lossless, so this needs no Figma call.
const logoSource = readdirSync('refs/svg').find((f) => /-logo\.svg$/.test(f));
function renderLogo(node) {
  if (!logoSource) throw new Error('no logo SVG on disk to scale from');
  const src = readFileSync(`refs/svg/${logoSource}`, 'utf8');
  const vb = src.match(/viewBox="([^"]+)"/)[1];
  const { width: w, height: h } = node.absoluteBoundingBox;
  return {
    width: Math.round(w), height: Math.round(h),
    svg: src.replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" fill="none" viewBox="${vb}">`),
  };
}

let made = 0, kept = 0, failed = 0;

for (const s of spec) {
  for (const l of s.layers) {
    if (l.role === 'telegram' || l.role === 'phone') continue;   // cut from the strip locally
    if (existsSync(`refs/svg/${l.svg}`)) { kept++; continue; }

    const node = byId.get(l.nodeId);
    if (!node) { console.warn(`  ! ${l.svg}: node ${l.nodeId} not in any cached section`); failed++; continue; }

    try {
      // Dispatch on the role, never fall through to a default — an earlier version let
      // the contacts frame land in the logo branch and every new size shipped a giant
      // "yora" where the phone number belongs.
      const out =
        node.type === 'TEXT' ? typeset(textStyle(node))
        : l.role === 'cta' ? renderCta(node)
        : l.role === 'contacts' ? renderContacts(node)
        : l.role === 'logo' ? renderLogo(node)
        : (() => { throw new Error(`no renderer for role "${l.role}" (${node.type})`); })();
      writeFileSync(`refs/svg/${l.svg}`, out.svg);
      made++;
    } catch (err) {
      console.warn(`  ! ${l.svg}: ${err.message.slice(0, 90)}`);
      failed++;
    }
  }
}

console.log(`${made} rendered locally, ${kept} already on disk` + (failed ? `, ${failed} failed` : ''));
