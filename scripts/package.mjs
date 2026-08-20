#!/usr/bin/env node
// Package the built creatives for handover, split by platform.
//
// Each platform takes its own list of sizes, and the lists overlap only partly: 728x90 is
// on both Yandex and Google, 1000x120 is Yandex-only, 480x32 is Google-only, and the five
// large formats belong to Meta. A size on two lists is packaged into both folders, so each
// archive is self-contained and can be forwarded on its own.
//
// Inside a platform archive: one ZIP per creative (that is how the upload forms take them),
// a preview JPG of every end frame so the recipient can look without unzipping anything,
// and a README listing sizes, weights and click-through URLs.
import { readdirSync, existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const STAMP = process.argv[2] ?? new Date().toISOString().slice(0, 10);

// Size lists as the platforms publish them. Google also names each format, which is worth
// carrying into the README — the person uploading picks the placement by that name.
const PLATFORMS = {
  yandex: {
    title: 'Яндекс Директ',
    cap: 512,
    note: 'Лимит архива — 512 КБ, `index.html` меньше 150 КБ, не более 20 файлов в архиве.',
    sizes: {
      '160x600': '', '240x400': '', '240x600': '', '300x250': '', '300x300': '',
      '300x500': '', '300x600': '', '320x50': '', '320x100': '', '320x480': '',
      '336x280': '', '480x320': '', '728x90': '', '970x250': '', '1000x120': '',
    },
  },
  google: {
    title: 'Google Ads',
    cap: 150,
    note: 'Лимит архива — 150 КБ. Формат площадки указан в таблице: по нему выбирается место размещения.',
    sizes: {
      '320x50': 'полноразмерный баннер для мобильных устройств',
      '480x32': 'горизонтальный баннер для мобильных устройств',
      '320x100': 'большой баннер для мобильных устройств',
      '468x60': 'баннер',
      '728x90': 'полноразмерный баннер',
      '300x250': 'встраиваемый прямоугольник',
      '320x480': 'вертикальное межстраничное объявление для смартфонов',
      '480x320': 'горизонтальное межстраничное объявление для смартфонов',
      '768x1024': 'вертикальное межстраничное объявление для планшетов',
      '1024x768': 'горизонтальное межстраничное объявление для планшетов',
    },
  },
  meta: {
    title: 'Meta',
    cap: 512,
    note: 'Крупные форматы. Лимит уточняется при загрузке — наши архивы в пределах 320 КБ.',
    sizes: { '1440x1440': '', '1440x1800': '', '1920x1080': '', '1080x1920': '', '1080x1350': '' },
  },
  // 640x360 is not on any of the three lists; it was requested for a placement booked
  // separately. Packaged on its own rather than dropped.
  extra: {
    title: 'Дополнительно',
    cap: 512,
    note: 'Размер вне списков Яндекса, Google и Meta — под отдельное размещение 16:9.',
    sizes: { '640x360': '' },
  },
};

const CLICK = {
  employer: 'https://yora.tj/ru',
  jobseeker: 'https://yora.tj/ru/vacancies?currency_id=2&page=1',
  brand: 'https://yora.tj/',
};
const LABEL = { employer: 'Работодателю', jobseeker: 'Соискателю', brand: 'Имиджевый' };
const HEADLINE = {
  employer: '«Найдите своего сотрудника»',
  jobseeker: '«У нас вакансия»',
  brand: '«Вакансии по всему Таджикистану»',
};

rmSync('dist', { recursive: true, force: true });

const found = [];
for (const dir of readdirSync('out')) {
  const m = dir.match(/^(employer|jobseeker|brand)-(ru|tj)$/);
  if (!m) continue;
  for (const size of readdirSync(`out/${dir}`)) {
    if (!existsSync(`out/${dir}/${size}/index.html`)) continue;
    found.push({ src: `out/${dir}/${size}`, size, message: m[1], lang: m[2], name: dir });
  }
}

const zipInto = (target, cwd, what) =>
  execFileSync('zip', ['-rqX', target.startsWith('/') ? target : `${process.cwd()}/${target}`,
    ...(Array.isArray(what) ? what : [what]), '-x', '.*', '-x', '__MACOSX/*'], { cwd });

const usedSizes = new Set();
const summary = [];

for (const [key, p] of Object.entries(PLATFORMS)) {
  const mine = found.filter((c) => c.size in p.sizes);
  if (!mine.length) { console.warn(`${p.title}: nothing built`); continue; }

  const root = `dist/yora-${key}-${STAMP}`;
  const rows = [];

  for (const c of mine) {
    usedSizes.add(c.size);
    mkdirSync(`${root}/${c.size}`, { recursive: true });
    const zip = `${root}/${c.size}/${c.name}.zip`;
    zipInto(zip, c.src, '.');
    const kb = Math.ceil(statSync(zip).size / 1024);

    // A flat preview folder: everything visible at a glance in a file browser.
    mkdirSync(`${root}/_превью`, { recursive: true });
    if (existsSync(`${c.src}/backup.jpg`)) {
      copyFileSync(`${c.src}/backup.jpg`, `${root}/_превью/${c.size}-${c.name}.jpg`);
    }
    rows.push({ ...c, kb, over: kb > p.cap });
  }

  rows.sort((a, b) => a.size.localeCompare(b.size, 'en', { numeric: true }) || a.name.localeCompare(b.name));
  const sizes = [...new Set(rows.map((r) => r.size))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const over = rows.filter((r) => r.over);

  writeFileSync(`${root}/README.md`, [
    `# Yora.tj — ${p.title}`,
    '',
    `${rows.length} креативов, ${sizes.length} размеров. Дата сборки: ${STAMP}.`,
    '',
    p.note,
    '',
    '## Что внутри',
    '',
    '- папки по размерам — в каждой по 6 архивов: 3 сообщения × 2 языка;',
    '- `_превью/` — финальный кадр каждого баннера картинкой, для быстрого просмотра;',
    '- один ZIP = один креатив, готов к загрузке как есть.',
    '',
    'В архиве креатива: `index.html` со встроенными стилями и анимацией, `assets/`',
    'с фоном и векторными слоями, `backup.jpg` — статичная резервная картинка того же',
    'размера. Внешних запросов нет ни одного, кроме перехода по клику.',
    '',
    'Анимация: элементы въезжают сверху вниз за ~1.8 с, дальше кадр с призывом стоит',
    '~3.2 с. Цикл 5 с, 3 прохода, затем остановка — бесконечного повтора нет.',
    '',
    '## Размеры',
    '',
    `| Размер | ${key === 'google' ? 'Формат площадки | ' : ''}Креативов | Вес |`,
    `|---|---|---|${key === 'google' ? '---|' : ''}`,
    ...sizes.map((s) => {
      const g = rows.filter((r) => r.size === s);
      const range = `${Math.min(...g.map((r) => r.kb))}–${Math.max(...g.map((r) => r.kb))} КБ`;
      return `| ${s} | ${key === 'google' ? `${p.sizes[s]} | ` : ''}${g.length} | ${range} |`;
    }),
    '',
    '## Сообщения и переходы',
    '',
    '| Креатив | Заголовок | Клик ведёт на |',
    '|---|---|---|',
    ...Object.keys(LABEL).map((m) => `| ${LABEL[m]} | ${HEADLINE[m]} | ${CLICK[m]} |`),
    '',
    'RU- и TJ-версия одного сообщения ведут на один адрес.',
    '',
    ...(over.length ? ['## Выше лимита', '',
      `${over.length} архивов превышают ${p.cap} КБ:`, '',
      ...[...new Set(over.map((r) => r.size))].map((s) => `- ${s}`), ''] : []),
  ].join('\n'));

  zipInto(`dist/yora-${key}-${STAMP}.zip`, 'dist', `yora-${key}-${STAMP}`);
  const bundle = (statSync(`dist/yora-${key}-${STAMP}.zip`).size / 1048576).toFixed(1);
  summary.push({ key, title: p.title, count: rows.length, sizes: sizes.length, bundle, over: over.length });
}

// Anything the three lists do not claim — flagged rather than silently dropped.
const spare = [...new Set(found.map((c) => c.size))].filter((s) => !usedSizes.has(s));

console.log('platform        creatives  sizes  bundle');
for (const s of summary) {
  console.log(`${s.title.padEnd(16)} ${String(s.count).padStart(6)}  ${String(s.sizes).padStart(5)}  ${s.bundle.padStart(5)} MB` +
    (s.over ? `  — ${s.over} over cap` : ''));
}
if (spare.length) console.log(`\nnot on any list, left out: ${spare.join(', ')}`);
