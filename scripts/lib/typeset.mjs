// Set a text layer with the real LoosVar and emit outlined SVG, the same shape Figma's
// exporter produces: glyph paths, cropped to the ink box, no font file needed at runtime.
//
// This exists for two reasons. The Figma render endpoint has an hourly quota that a set
// this size exhausts in one pass, and — the real reason — the eight later size sections
// have no Tajik frames at all, so there is nothing in the comp to export for them.
import * as fontkit from 'fontkit';

const font = fontkit.openSync('refs/fonts/LoosVar.ttf');
const UPEM = font.unitsPerEm;

// LoosVar has two axes, wght and wdth, and BOTH default to 0 — asking for a weight alone
// silently hands back the Compressed width, ~28% narrow, which changes where every line
// wraps. Figma names the exact instance in style.fontStyle ("Extended Black", "Wide
// Regular", "Wide Medium"), and those strings are the font's own named variations, so
// take the instance by name and never guess the axes.
const variations = new Map();
const instance = (styleName) => {
  if (!variations.has(styleName)) {
    if (!font.namedVariations[styleName]) {
      throw new Error(`LoosVar has no instance "${styleName}" — known: ${Object.keys(font.namedVariations).join(', ')}`);
    }
    variations.set(styleName, font.getVariation(styleName));
  }
  return variations.get(styleName);
};

// Ink box of a path, in font units.
const bboxOf = (path) => {
  const b = path.bbox;
  return { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.maxY };
};

/**
 * @param text      copy, with explicit "\n" where the comp breaks the line
 * @param fontStyle Figma's style.fontStyle, e.g. "Extended Black" — a named instance
 * @param fontSize  px, from the Figma TEXT node's style
 * @param lineHeight px between baselines
 * @param align     LEFT | CENTER | RIGHT
 * @param letterSpacing px
 */
export function typeset({ text, fontStyle, fontSize, lineHeight, align = 'CENTER', letterSpacing = 0, color = '#fff', maxWidth = Infinity }) {
  const v = instance(fontStyle);
  const scale = fontSize / UPEM;
  const measure = (s) => {
    const run = v.layout(s);
    return (run.advanceWidth + letterSpacing * Math.max(0, run.glyphs.length - 1) / scale) * scale;
  };

  // Figma text boxes here are textAutoResize:HEIGHT — fixed width, wrapping greedily on
  // spaces. Honour any explicit newline the designer typed, then wrap what is left.
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.replace(/\s+$/, '').split(/(?<=\s)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd()) > maxWidth) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    lines.push(line.trimEnd());
  }

  // Lay every line out first so the block width is known before alignment.
  const laid = lines.map((line) => {
    const run = v.layout(line);
    const extra = letterSpacing * Math.max(0, run.glyphs.length - 1) / scale;
    return { run, width: (run.advanceWidth + extra) * scale };
  });
  const blockW = Math.max(...laid.map((l) => l.width));

  const parts = [];
  let ink = null;

  laid.forEach(({ run }, i) => {
    const lineW = laid[i].width;
    const originX = align === 'LEFT' ? 0 : align === 'RIGHT' ? blockW - lineW : (blockW - lineW) / 2;
    const baseline = i * lineHeight;

    let penX = 0;
    run.glyphs.forEach((glyph, gi) => {
      const pos = run.positions[gi];
      if (glyph.path.commands.length) {
        // Font units are y-up; SVG is y-down. Flip while scaling into px.
        const p = glyph.path.transform(
          scale, 0, 0, -scale,
          originX + (penX + pos.xOffset) * scale,
          baseline - pos.yOffset * scale
        );
        parts.push(p.toSVG());
        const b = bboxOf(p);
        ink = ink
          ? { x1: Math.min(ink.x1, b.x1), y1: Math.min(ink.y1, b.y1), x2: Math.max(ink.x2, b.x2), y2: Math.max(ink.y2, b.y2) }
          : b;
      }
      penX += pos.xAdvance + letterSpacing / scale;
    });
  });

  if (!ink) throw new Error(`typeset: "${text.slice(0, 30)}" produced no ink`);

  // Crop to the ink box and round outward, exactly as Figma's SVG export does.
  const x = Math.floor(ink.x1), y = Math.floor(ink.y1);
  const w = Math.ceil(ink.x2) - x, h = Math.ceil(ink.y2) - y;

  return {
    width: w, height: h, lines: lines.length,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" fill="none" ` +
      `viewBox="${x} ${y} ${w} ${h}"><path fill="${color}" d="${parts.join('')}"/></svg>`,
  };
}

export { font };
