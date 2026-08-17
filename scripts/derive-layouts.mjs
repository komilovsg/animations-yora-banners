#!/usr/bin/env node
// Lay out the sizes the comp does not draw.
//
// The campaign is one design at many sizes: same artwork, same copy, same motion. What
// changes per format is the arrangement, and a size set is re-laid-out, never scaled — a
// 728x90 has 15% of the vertical room of a 300x600 and cannot hold the same stack.
//
// Four families, chosen by aspect and height:
//   strip        h < 70   logo + headline + CTA in one row, nothing else fits
//   leaderboard  w/h > 2.2   logo left, message centre, CTA right
//   stacked      everything else — the comp's own composition, centred
//
// Type is set from the comp's scale (headline 16.59 / sub 9.92 / CTA 11.06 / contacts 8.79
// at 160x600) and grown for larger canvases, then shrunk until the block actually fits.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { typeset } from './lib/typeset.mjs';

const spec = JSON.parse(readFileSync('refs/spec.json', 'utf8'));

const COPY = {
  employer: {
    ru: { headline: 'Найдите своего сотрудника!', subline: 'Размещайте вакансии на Yora.tj!', cta: 'Разместить вакансию' },
    tj: { headline: 'Корманди худро пайдо кунед!', subline: 'Ҷойи кориро дар Yora.tj эълон кунед!', cta: 'Ҷойи кориро нашр кунед' },
  },
  jobseeker: {
    ru: { headline: 'У нас вакансия!', subline: 'Ищите работу на Yora.tj!', cta: 'Зарегистрироваться' },
    tj: { headline: 'Мо ҷойи корӣ дорем!', subline: 'Ҷойи кориро дар Yora.tj эълон кунед!', cta: 'Бақайдгирӣ' },
  },
  brand: {
    ru: { headline: 'Yora.tj - вакансии по всему Таджикистану!', cta: 'Зарегистрироваться' },
    tj: { headline: 'Yora.tj — ҷойҳои корӣ дар тамоми Тоҷикистон!', cta: 'Бақайдгирӣ' },
  },
};

const TELEGRAM = '@weyora';
const PHONE = '+992 553 06 2222';

// The comp's type scale, measured at 160x600.
const BASE = {
  headline: { size: 16.59109878540039, lh: 20.90478515625, style: 'Extended Black' },
  subline: { size: 9.924454689025879, lh: 12.504813194274902, style: 'Wide Regular' },
  cta: { size: 11.061077117919922, lh: 13.936957359313965, style: 'Wide Medium' },
  contacts: { size: 8.786357879638672, lh: 11.07081127166748, style: 'Wide Regular' },
};
const LOGO = { w: 75, h: 24.8 };
const CTA_PAD_X = 9, CTA_PAD_Y = 4.5;   // the comp's pill padding at base scale

// Every size the client asked for. Those the comp already covers are skipped below.
const TARGETS = [
  '300x600', '320x50', '320x100', '320x480', '336x280', '480x320', '728x90', '970x250',
  '1000x120', '480x32', '468x60', '768x1024', '1024x768', '1440x1440', '1440x1800',
  '1080x1920', '1920x1080', '1080x1350',
];

const logoSvg = readFileSync('refs/svg/160x600-employer-ru-logo.svg', 'utf8');
const logoViewBox = logoSvg.match(/viewBox="([^"]+)"/)[1];
const scaledLogo = (w, h) => logoSvg.replace(/^<svg[^>]*>/,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" fill="none" viewBox="${logoViewBox}">`);

// The CTA pill, rebuilt at any scale with the comp's gradient.
const ctaGradient = (() => {
  const src = readFileSync('refs/svg/160x600-employer-ru-cta.svg', 'utf8');
  return src.match(/<linearGradient[\s\S]*?<\/linearGradient>/)[0];
})();

function pill(label, k) {
  const t = typeset({
    text: label, fontStyle: BASE.cta.style,
    fontSize: BASE.cta.size * k, lineHeight: BASE.cta.lh * k, align: 'CENTER',
  });
  const w = Math.round(t.width + CTA_PAD_X * 2 * k);
  const h = Math.round(t.height + CTA_PAD_Y * 2 * k + 4 * k);
  const inner = t.svg.replace(/^<svg[^>]*>/, `<svg width="${t.width}" height="${t.height}" viewBox="${t.svg.match(/viewBox="([^"]+)"/)[1]}">`);
  return {
    w, h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" fill="none" viewBox="0 0 ${w} ${h}">` +
      `<defs>${ctaGradient}</defs><rect width="${w}" height="${h}" rx="${(h / 2).toFixed(2)}" fill="url(#a)"/>` +
      `<g transform="translate(${((w - t.width) / 2).toFixed(2)},${((h - t.height) / 2).toFixed(2)})">${inner}</g></svg>`,
  };
}

// Horizontal formats draw the contacts as one line: handle, hairline, number.
function contactsLine(k) {
  const a = typeset({ text: TELEGRAM, fontStyle: BASE.contacts.style, fontSize: BASE.contacts.size * k, lineHeight: BASE.contacts.lh * k, align: 'LEFT' });
  const b = typeset({ text: PHONE, fontStyle: BASE.contacts.style, fontSize: BASE.contacts.size * k, lineHeight: BASE.contacts.lh * k, align: 'LEFT' });
  const gap = 6 * k, rule = Math.max(1, 0.7 * k);
  const w = Math.ceil(a.width + gap * 2 + rule + b.width);
  const h = Math.ceil(Math.max(a.height, b.height));
  const put = (t, x) => `<g transform="translate(${x.toFixed(2)},${((h - t.height) / 2).toFixed(2)})">` +
    t.svg.replace(/^<svg[^>]*>/, `<svg width="${t.width}" height="${t.height}" viewBox="${t.svg.match(/viewBox="([^"]+)"/)[1]}">`) + '</g>';
  return {
    width: w, height: h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" fill="none" viewBox="0 0 ${w} ${h}">` +
      put(a, 0) +
      `<rect x="${(a.width + gap).toFixed(2)}" y="${(h * 0.15).toFixed(2)}" width="${rule.toFixed(2)}" height="${(h * 0.7).toFixed(2)}" fill="#fff" opacity=".7"/>` +
      put(b, a.width + gap * 2 + rule) + '</svg>',
  };
}

const text = (kind, s, k, maxWidth) => typeset({
  text: s, fontStyle: BASE[kind].style,
  fontSize: BASE[kind].size * k, lineHeight: BASE[kind].lh * k,
  align: 'CENTER', maxWidth,
});

// Compose one creative. Returns the layer list, or null when nothing legible fits.
function compose(w, h, message, lang) {
  const copy = COPY[message][lang];
  const strip = h < 70;
  const leaderboard = !strip && w / h > 2.2;
  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.05));

  // Start from a scale suggested by the canvas, then shrink until everything fits.
  const suggested = Math.max(1, Math.sqrt((w * h) / (160 * 600)) ** 0.72);

  // A 320x50 carrying "Найдите своего сотрудника!" plus a "Разместить вакансию" pill has
  // no room for both. The comp drops the pill on those strips and lets the whole banner be
  // the click target, so try with it and fall back to without.
  for (const withCta of [true, false]) {
  for (let k = suggested; k >= 0.55; k -= 0.02) {
    const logo = { w: LOGO.w * k, h: LOGO.h * k };
    const cta = withCta ? pill(copy.cta, k) : { w: 0, h: 0, svg: null };
    const gap = Math.max(6, 10 * k);

    if (strip || leaderboard) {
      // One row: logo, message, CTA. The strip drops the subline entirely.
      const colW = w - pad * 2 - logo.w - (withCta ? cta.w + gap : 0) - gap;
      if (colW < 60) continue;
      const head = text('headline', copy.headline, k, colW);
      // A wrapped word can still overrun the column; that is what pushed the 320x100
      // headline on top of the logo. Reject the scale instead of overlapping.
      if (head.width > colW) continue;
      // Short formats get one line — two lines at 90px tall leaves no breathing room.
      const maxLines = h >= 150 ? 2 : withCta ? 1 : 2;
      if (head.lines > maxLines) continue;

      const sub = !strip && h >= 110 && copy.subline ? text('subline', copy.subline, k, colW) : null;
      if (sub && (sub.width > colW || sub.lines > 1)) continue;
      const con = h >= 80 ? contactsLine(k * 0.82) : null;
      if (con && con.width > colW) continue;

      const blockH = head.height + (sub ? gap * 0.5 + sub.height : 0) + (con ? gap * 0.6 + con.height : 0);
      if (blockH > h - pad * 2 || logo.h > h - pad || cta.h > h - pad) continue;

      const midY = h / 2, colX = pad + logo.w + gap;
      let y = midY - blockH / 2;
      const layers = [
        { role: 'logo', data: scaledLogo(logo.w, logo.h), x: pad, y: midY - logo.h / 2, svgW: Math.round(logo.w), svgH: Math.round(logo.h), dx: -1, dy: 0 },
        { role: 'headline', data: head.svg, x: colX + (colW - head.width) / 2, y, svgW: head.width, svgH: head.height, dx: -1, dy: 0 },
      ];
      y += head.height;
      if (sub) { y += gap * 0.5; layers.push({ role: 'subline', data: sub.svg, x: colX + (colW - sub.width) / 2, y, svgW: sub.width, svgH: sub.height, dx: -1, dy: 0 }); y += sub.height; }
      if (con) { y += gap * 0.6; layers.push({ role: 'contactline', data: con.svg, x: colX + (colW - con.width) / 2, y, svgW: con.width, svgH: con.height, dx: 1, dy: 0 }); }
      if (withCta) layers.push({ role: 'cta', data: cta.svg, x: w - pad - cta.w, y: midY - cta.h / 2, svgW: cta.w, svgH: cta.h, dx: 1, dy: 0 });
      return { layers, k, family: strip ? 'strip' : 'leaderboard' };
    }

    if (!withCta) continue;   // the stacked family always has room for the pill

    // Stacked: the comp's own composition — logo, headline, subline, CTA, contacts.
    const colW = w - pad * 2;
    const head = text('headline', copy.headline, k, colW * 0.94);
    if (head.width > colW) continue;
    const sub = copy.subline ? text('subline', copy.subline, k, colW * 0.86) : null;
    if (sub && sub.width > colW) continue;
    const tg = text('contacts', TELEGRAM, k, Infinity);
    const ph = text('contacts', PHONE, k, Infinity);

    const contactsH = tg.height + 4 * k + ph.height;
    const total = logo.h + gap * 1.6 + head.height + (sub ? gap + sub.height : 0)
      + gap * 1.8 + cta.h + gap * 1.6 + contactsH;
    if (total > h - pad * 2) continue;

    // Distribute the slack: a little above the logo, the rest below the contacts.
    const slack = (h - pad * 2 - total);
    let y = pad + slack * 0.34;
    const centred = (el) => (w - el) / 2;
    const layers = [];

    layers.push({ role: 'logo', data: scaledLogo(logo.w, logo.h), x: centred(logo.w), y, svgW: Math.round(logo.w), svgH: Math.round(logo.h), dx: w, dy: 0 });
    y += logo.h + gap * 1.6;
    layers.push({ role: 'headline', data: head.svg, x: centred(head.width), y, svgW: head.width, svgH: head.height, dx: -w, dy: 0 });
    y += head.height + (sub ? gap : 0);
    if (sub) { layers.push({ role: 'subline', data: sub.svg, x: centred(sub.width), y, svgW: sub.width, svgH: sub.height, dx: -w, dy: 0 }); y += sub.height; }
    y += gap * 1.8;
    layers.push({ role: 'cta', data: cta.svg, x: centred(cta.w), y, svgW: cta.w, svgH: cta.h, dx: -w, dy: 0 });
    y += cta.h + gap * 1.6;
    layers.push({ role: 'telegram', data: tg.svg, x: centred(tg.width), y, svgW: tg.width, svgH: tg.height, dx: w, dy: 0, anchorY: y + contactsH / 2 });
    layers.push({ role: 'phone', data: ph.svg, x: centred(ph.width), y: y + tg.height + 4 * k, svgW: ph.width, svgH: ph.height, dx: w, dy: 0, anchorY: y + contactsH / 2 });

    return { layers, k, family: 'stacked' };
  }
  }
  return null;
}

mkdirSync('refs/svg', { recursive: true });
const have = new Set(spec.map((s) => s.stem));
const added = [];

for (const size of TARGETS) {
  const [w, h] = size.split('x').map(Number);
  for (const message of ['employer', 'jobseeker', 'brand']) {
    for (const lang of ['ru', 'tj']) {
      const stem = `${size}-${message}-${lang}`;
      if (have.has(stem)) continue;

      const out = compose(w, h, message, lang);
      if (!out) { console.warn(`  ! ${stem}: nothing legible fits`); continue; }

      const layers = out.layers.map((l) => {
        const file = `${stem}-${l.role}.svg`;
        writeFileSync(`refs/svg/${file}`, l.data);
        const { data, ...rest } = l;
        return {
          ...rest, svg: file, nodeId: null,
          x: +l.x.toFixed(1), y: +l.y.toFixed(1),
          // Park it fully outside on the side it enters from.
          dx: +(l.dx >= 0 ? w - l.x : -(l.x + l.svgW)).toFixed(1), dy: 0,
        };
      });

      added.push({
        size, drawn: size, message, lang, stem, w, h, drawnW: w, drawnH: h,
        derived: true, family: out.family, k: +out.k.toFixed(2),
        bgPan: 0, layers,
      });
      console.log(`  ${stem.padEnd(28)} ${out.family.padEnd(11)} k=${out.k.toFixed(2)}  ${layers.length} layers`);
    }
  }
}

writeFileSync('refs/spec.json', JSON.stringify([...spec, ...added], null, 2));
console.log(`\n${added.length} layouts derived, ${spec.length} from the comp — ${spec.length + added.length} total`);
