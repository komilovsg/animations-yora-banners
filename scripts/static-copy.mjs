#!/usr/bin/env node
// Write the ad copy that accompanies the 640x360 stills, and check it against the
// placement's limits: headline 40 characters, body 160. The image carries only the logo
// and one line, so everything else — the call to action, the contacts — lives here.
import { writeFileSync } from 'node:fs';

const COPY = {
  'employer-ru': {
    headline: 'Найдите своего сотрудника',
    body: 'Размещайте вакансии на Yora.tj и находите сотрудников по всему Таджикистану. Telegram @weyora, тел. +992 553 06 2222',
  },
  'employer-tj': {
    headline: 'Корманди худро пайдо кунед',
    body: 'Ҷойи кориро дар Yora.tj эълон кунед ва кормандро дар тамоми Тоҷикистон пайдо кунед. Telegram @weyora, тел. +992 553 06 2222',
  },
  'jobseeker-ru': {
    headline: 'У нас вакансия для вас',
    body: 'Ищите работу на Yora.tj: вакансии по всему Таджикистану, отклик в пару кликов. Telegram @weyora, тел. +992 553 06 2222',
  },
  'jobseeker-tj': {
    headline: 'Мо ҷойи корӣ дорем',
    body: 'Дар Yora.tj кор ҷӯед: ҷойҳои корӣ дар тамоми Тоҷикистон, дархост дар ду клик. Telegram @weyora, тел. +992 553 06 2222',
  },
  'brand-ru': {
    headline: 'Yora.tj — вакансии по Таджикистану',
    body: 'Работа и сотрудники в одном месте. Тысячи вакансий по всему Таджикистану на Yora.tj. Telegram @weyora, тел. +992 553 06 2222',
  },
  'brand-tj': {
    headline: 'Yora.tj — ҷойҳои корӣ дар Тоҷикистон',
    body: 'Кор ва корманд дар як ҷо. Ҳазорон ҷойи корӣ дар тамоми Тоҷикистон дар Yora.tj. Telegram @weyora, тел. +992 553 06 2222',
  },
};

const LINK = {
  employer: 'https://yora.tj/ru',
  jobseeker: 'https://yora.tj/ru/vacancies?currency_id=2&page=1',
  brand: 'https://yora.tj/',
};

const LIMIT = { headline: 40, body: 160 };
let bad = 0;
const rows = [];

for (const [key, c] of Object.entries(COPY)) {
  const message = key.split('-')[0];
  for (const field of ['headline', 'body']) {
    // Count characters the way a form does — code points, not UTF-16 units, so the
    // Cyrillic and the emoji a client may add both count as one each.
    const n = [...c[field]].length;
    const over = n > LIMIT[field];
    if (over) bad++;
    console.log(`${key.padEnd(14)} ${field.padEnd(8)} ${String(n).padStart(3)}/${LIMIT[field]} ${over ? 'OVER' : 'ok'}`);
  }
  rows.push(`## ${key}\n\n` +
    `**Изображение:** \`out/static/640x360/${key}.jpg\` — 640×360, JPG\n\n` +
    `**Заголовок** (${[...c.headline].length}/40)\n\n${c.headline}\n\n` +
    `**Основной текст** (${[...c.body].length}/160)\n\n${c.body}\n\n` +
    `**Ссылка**\n\n${LINK[message]}\n`);
}

writeFileSync('out/static/640x360/COPY.md',
  `# Тексты объявлений — статика 640×360\n\n` +
  `Лимиты площадки: заголовок до 40 символов, основной текст до 160. Emoji допускаются.\n` +
  `На изображении — только логотип и одна строка: площадка просит не более 20–25 %\n` +
  `площади под текст, поэтому призыв и контакты вынесены в текстовые поля.\n\n` +
  rows.join('\n---\n\n'));

console.log(bad ? `\n${bad} field(s) over the limit` : '\nout/static/640x360/COPY.md written, every field inside its limit');
