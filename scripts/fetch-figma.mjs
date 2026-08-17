#!/usr/bin/env node
// Pull the 12 target frames out of the vazifa_tj Figma file:
//   refs/<Frame name>.png   – 2x render, for eyeballing
//   refs/nodes.json         – full node tree (geometry, colors, text, effects)
//
// Token: .figma-token file at repo root, or FIGMA_TOKEN env var.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE_KEY = 'IBXDFTKO9J4ouoT2gvk5go';
const WANTED = [
  'Frame 2136137190', 'Frame 2136137191',
  'Frame 2136137192', 'Frame 2136137193',
  'Frame 2136137194', 'Frame 2136137198',
  'Frame 2136137197', 'Frame 2136137199',
  'Frame 2136137200', 'Frame 2136137201',
  'Frame 2136137202', 'Frame 2136137203',
];

const tokenFile = join(ROOT, '.figma-token');
const TOKEN = (process.env.FIGMA_TOKEN
  || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : '')).trim();
if (!TOKEN) {
  console.error('No token. Put it in .figma-token or set FIGMA_TOKEN.');
  process.exit(1);
}

const api = async (path) => {
  const res = await fetch(`https://api.figma.com/v1/${path}`, {
    headers: { 'X-Figma-Token': TOKEN },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

// 1. Walk the shallow file tree to map frame name -> node id.
const tree = await api(`files/${FILE_KEY}?depth=3`);
const found = new Map();
(function walk(node) {
  if (WANTED.includes(node.name) && !found.has(node.name)) found.set(node.name, node.id);
  for (const child of node.children ?? []) walk(child);
})(tree.document);

const missing = WANTED.filter((n) => !found.has(n));
if (missing.length) console.warn('Not found at depth=3:', missing.join(', '));
if (!found.size) { console.error('No target frames found.'); process.exit(1); }

const ids = [...found.values()];
console.log(`Matched ${found.size}/${WANTED.length} frames.`);

// 2. Full node payload — this is what the banner rebuild is measured against.
const nodes = await api(`files/${FILE_KEY}/nodes?ids=${ids.join(',')}&geometry=paths`);
writeFileSync(join(ROOT, 'refs/nodes.json'), JSON.stringify(nodes, null, 2));

// 3. 2x PNG renders.
const { images } = await api(`images/${FILE_KEY}?ids=${ids.join(',')}&format=png&scale=2`);
for (const [name, id] of found) {
  const url = images[id];
  if (!url) { console.warn(`No render for ${name}`); continue; }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(join(ROOT, `refs/${name.replace(/\s+/g, '_')}.png`), buf);
  console.log(`refs/${name.replace(/\s+/g, '_')}.png  ${(buf.length / 1024).toFixed(0)} KB`);
}
console.log('refs/nodes.json written.');
