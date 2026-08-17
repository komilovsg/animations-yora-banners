#!/usr/bin/env node
// Render the outlined-SVG layers that build-spec.mjs asked for but are not on disk yet.
//
// Deliberately the only script that touches Figma's render endpoint, and deliberately the
// only one that never writes refs/spec.json — this runs long (the render quota is hourly,
// so a full set can sit in backoff for a while) and must not clobber spec edits made by
// split-contacts.mjs in the meantime.
//
// Safe to interrupt and rerun: finished files are skipped.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { KEY, api } from './lib/figma.mjs';

const CHUNK = 25;
const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));
mkdirSync('refs/svg', { recursive: true });

// telegram/phone are cut locally from the contacts strip, never rendered.
const wanted = new Map();
for (const s of spec) {
  for (const l of s.layers) {
    if (l.role === 'telegram' || l.role === 'phone') continue;
    if (l.nodeId && !existsSync(`refs/svg/${l.svg}`)) wanted.set(l.nodeId, l.svg);
  }
}

if (!wanted.size) {
  console.log('nothing to render — every layer is on disk');
  process.exit(0);
}

const todo = [...wanted];
console.log(`${todo.length} layers to render`);
let done = 0;

for (let i = 0; i < todo.length; i += CHUNK) {
  const slice = todo.slice(i, i + CHUNK);
  const { images } = await api(
    `images/${KEY}?ids=${slice.map(([id]) => id).join(',')}&format=svg&svg_outline_text=true`
  );
  for (const [id, file] of slice) {
    if (!images[id]) { console.warn(`  no svg for ${file}`); continue; }
    writeFileSync(`refs/svg/${file}`, await (await fetch(images[id])).text());
    done++;
  }
  console.log(`  ${done}/${todo.length}`);
}

console.log(`rendered ${done} layers — run: npx svgo -f refs/svg -o refs/svg --multipass -p 2 -q`);
