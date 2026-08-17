#!/usr/bin/env node
// Locate frames in the Figma file by name fragment. Caches the document tree to
// refs/tree.json — the file is large and the API rate-limits, so fetch it once.
//
// Usage: node scripts/find-frames.mjs [pattern] [depth]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = 'IBXDFTKO9J4ouoT2gvk5go';
const TOKEN = readFileSync('.figma-token', 'utf8').trim();
const pattern = (process.argv[2] ?? 'Прототип').toLowerCase();
const depth = process.argv[3] ?? '4';
const cache = `refs/tree-d${depth}.json`;

let tree;
if (existsSync(cache)) {
  tree = JSON.parse(readFileSync(cache, 'utf8'));
  console.log(`(cached ${cache})`);
} else {
  const res = await fetch(`https://api.figma.com/v1/files/${KEY}?depth=${depth}`, {
    headers: { 'X-Figma-Token': TOKEN },
  });
  if (!res.ok) throw new Error(`files -> ${res.status} ${await res.text()}`);
  tree = await res.json();
  writeFileSync(cache, JSON.stringify(tree));
  console.log(`fetched, cached to ${cache}`);
}

const hits = [];
(function walk(node, path) {
  const here = [...path, node.name];
  if (node.name.toLowerCase().includes(pattern)) {
    const b = node.absoluteBoundingBox;
    hits.push({
      id: node.id, name: node.name, type: node.type,
      size: b ? `${Math.round(b.width)}x${Math.round(b.height)}` : '-',
      kids: (node.children ?? []).length,
      path: path.slice(1).join(' / '),
    });
  }
  for (const c of node.children ?? []) walk(c, here);
})(tree.document, []);

console.log(`\n${hits.length} match "${process.argv[2] ?? 'Прототип'}"\n`);
for (const h of hits) {
  console.log(`${h.id.padEnd(14)} ${h.type.padEnd(9)} ${h.size.padEnd(10)} kids=${String(h.kids).padStart(3)}  ${h.name}`);
  if (h.path) console.log(`${' '.repeat(14)} in: ${h.path}`);
}

// Pages are the top level; list them so a follow-up fetch can target one.
console.log('\npages:');
for (const p of tree.document.children ?? []) {
  console.log(`  ${p.id.padEnd(12)} ${String((p.children ?? []).length).padStart(4)} children  ${p.name}`);
}
