#!/usr/bin/env node
// Pull the full node payload for every banner frame in the "Прототип …" sections and
// cache it to refs/nodes-<section>.json. One request per section keeps each response
// small and lets a rate-limited run resume where it stopped.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = 'IBXDFTKO9J4ouoT2gvk5go';
const TOKEN = readFileSync('.figma-token', 'utf8').trim();
const tree = JSON.parse(readFileSync('refs/tree-d3.json', 'utf8'));

// Name the cache after the size the frames actually are, not the section title: four
// sections are titled with a size their frames are not, and two different sections are
// both called "Прототип 768х1024" while holding portrait and landscape artboards.
const sizeOf = (frames) => {
  const counts = new Map();
  for (const f of frames) {
    const k = `${Math.round(f.absoluteBoundingBox.width)}x${Math.round(f.absoluteBoundingBox.height)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

const sections = (tree.document.children[0].children ?? [])
  .filter((s) => /Прототип/.test(s.name) && !/160/.test(s.name));

for (const sec of sections) {
  const frames = (sec.children ?? []).filter((c) => c.name.startsWith('Frame '));
  if (frames.length < 2) { console.log(`skip ${sec.name} — only ${frames.length} frame(s), no pair`); continue; }

  const out = `refs/nodes-${sizeOf(frames)}.json`;
  if (existsSync(out)) { console.log(`(cached) ${out}`); continue; }

  const url = `https://api.figma.com/v1/files/${KEY}/nodes` +
    `?ids=${frames.map((f) => f.id).join(',')}&geometry=paths`;

  let res;
  for (let attempt = 0; attempt < 60; attempt++) {
    res = await fetch(url, { headers: { 'X-Figma-Token': TOKEN } });
    if (res.status !== 429) break;
    const wait = Math.min(300_000, 30_000 * 2 ** attempt);
    console.log(`  rate limited, retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`${sec.name} -> ${res.status} ${await res.text()}`);

  const body = await res.text();
  writeFileSync(out, body);
  console.log(`${sec.name.padEnd(22)} ${frames.length} frames -> ${out} (${(body.length / 1024).toFixed(0)} KB)`);
}
