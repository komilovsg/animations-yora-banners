#!/usr/bin/env node
// Generate the review gallery from what is actually on disk, grouped by size.
//
// Hand-maintaining the list stopped working once the set outgrew six creatives; this way
// a rebuild can never disagree with the page.
import { readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';

const MESSAGE = {
  employer: ['Работодателю', 'Найдите своего сотрудника'],
  jobseeker: ['Соискателю', 'У нас вакансия'],
  brand: ['Имиджевый', 'Вакансии по всему Таджикистану'],
};
const ORDER = ['employer', 'jobseeker', 'brand'];

const found = [];
for (const dir of existsSync('out') ? readdirSync('out') : []) {
  const m = dir.match(/^(employer|jobseeker|brand)-(ru|tj)$/);
  if (!m) continue;
  for (const size of readdirSync(`out/${dir}`)) {
    if (!existsSync(`out/${dir}/${size}/index.html`)) continue;
    const [w, h] = size.split('x').map(Number);
    found.push({ message: m[1], lang: m[2], size, w, h, path: `out/${dir}/${size}/index.html` });
  }
}

// Tall formats first, then by area — puts the skyscrapers together and the strips last.
const sizes = [...new Set(found.map((f) => f.size))].sort((a, b) => {
  const [aw, ah] = a.split('x').map(Number), [bw, bh] = b.split('x').map(Number);
  return (bh / bw) - (ah / aw) || (bw * bh) - (aw * ah);
});

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const groups = sizes.map((size) => {
  const items = found.filter((f) => f.size === size)
    .sort((a, b) => ORDER.indexOf(a.message) - ORDER.indexOf(b.message) || a.lang.localeCompare(b.lang));
  const { w, h } = items[0];
  const cards = items.map((f) => {
    const [group, line] = MESSAGE[f.message];
    return `      <figure>
        <div class="stage" style="width:${w}px;height:${h}px">
          <iframe src="${f.path}" width="${w}" height="${h}" title="${esc(line)}" loading="lazy"></iframe>
        </div>
        <figcaption>
          <b>${esc(group)} · ${f.lang.toUpperCase()}</b>
          <a href="${f.path}" target="_blank">${f.path.replace('out/', '')}</a>
        </figcaption>
      </figure>`;
  }).join('\n');

  return `    <section>
      <h2>${size}<span>${items.length} из 6</span></h2>
      <div class="row">
${cards}
      </div>
    </section>`;
}).join('\n');

writeFileSync('index.html', `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Yora.tj — баннеры</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:28px;background:#0e0e12;color:#e8e6f0;
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  header{display:flex;align-items:baseline;gap:16px;margin-bottom:8px;flex-wrap:wrap}
  h1{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em}
  .hint{color:#8b8798}
  button{font:inherit;padding:6px 14px;border-radius:999px;cursor:pointer;
    border:1px solid #3a3550;background:#1b1826;color:#e8e6f0}
  button:hover{background:#252036}
  section{margin-top:34px}
  h2{margin:0 0 14px;font-size:13px;font-weight:650;letter-spacing:.06em;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9c3dd;
    display:flex;align-items:baseline;gap:10px;
    border-bottom:1px solid #262133;padding-bottom:8px}
  h2 span{color:#7a7392;font-weight:400;letter-spacing:0}
  .row{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start}
  figure{margin:0}
  /* The stage is sized in CSS so a lazy iframe still reserves its slot. */
  .stage{background:#7b3ff2;overflow:hidden}
  iframe{border:0;display:block}
  figcaption{margin-top:8px;font-size:12px;color:#8b8798;max-width:340px}
  figcaption b{display:block;color:#e8e6f0;font-weight:600}
  figcaption a{color:#9d7bff;text-decoration:none;
    font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
  figcaption a:hover{text-decoration:underline}
</style>
</head>
<body>
<header>
  <h1>Yora.tj — ${found.length} креативов, ${sizes.length} ${sizes.length === 1 ? 'размер' : 'размеров'}</h1>
  <span class="hint">анимация 5 с × 3 прохода, дальше стоп на CTA-кадре</span>
  <button id="replay">Проиграть заново</button>
</header>
${groups}
<script>
  document.getElementById('replay').addEventListener('click', () => {
    for (const f of document.querySelectorAll('iframe')) f.src = f.src;
  });
</script>
</body>
</html>
`);

console.log(`index.html — ${found.length} creatives across ${sizes.length} sizes: ${sizes.join(', ')}`);
