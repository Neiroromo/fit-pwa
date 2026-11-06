// Шаг 4 сборки базы продуктов: упаковка результатов в файлы модуля (gzip) — modules/nutrition/data/base.bin и ru.bin.
// Запуск: node tools/food-db/build.mjs <base-ru.json> <off-ru.json>
// Форматы описаны в modules/nutrition/fooddb.js. После сборки обновите files в manifest.json (data/base.bin, data/ru.bin) и версию модуля.

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [baseFile, offFile] = process.argv.slice(2);
if (!baseFile || !offFile) { console.error('Использование: build.mjs <base-ru.json> <off-ru.json>'); process.exit(1); }
const outDir = path.join(root, 'modules', 'nutrition', 'data');
fs.mkdirSync(outDir, { recursive: true });
const gz = obj => zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });

// ---------- справочник базовых продуктов ----------
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8')).sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
const cats = [...new Set(base.map(x => x.cat))];
const EXTRA = ['sat', 'na', 'chol', 'ca', 'fe', 'k', 'vc']; // порядок дополнительных нутриентов (см. fooddb.js)
const f = base.map(x => [x.ru, cats.indexOf(x.cat), x.kcal, x.p, x.f, x.cb, x.fib ?? null, x.sug ?? null, x.g ?? 0, x.pr ?? '', x.en ?? '', EXTRA.some(k => x[k] != null) ? EXTRA.map(k => x[k] ?? null) : null]);
const baseBuf = gz({ v: 2, extra: EXTRA, cats, f });
fs.writeFileSync(path.join(outDir, 'base.bin'), baseBuf);

// ---------- российские товары ----------
const ru = JSON.parse(fs.readFileSync(offFile, 'utf8')).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const ruBuf = gz({ v: 1, p: ru });
fs.writeFileSync(path.join(outDir, 'ru.bin'), ruBuf);

fs.writeFileSync(path.join(outDir, 'SOURCES.md'), `Данные для офлайн-поиска продуктов (собраны скриптами tools/food-db).

- \`base.bin\` — справочник базовых продуктов (${base.length} позиций). Источник: USDA FoodData Central, наборы Foundation Foods и SR Legacy,
  общественное достояние (CC0). Названия переведены на русский, близкие позиции (сорта, срезы, соль) сведены к одной со средними значениями.
- \`ru.bin\` — популярные упаковочные товары России (${ru.length} позиций). Источник: Open Food Facts (https://world.openfoodfacts.org),
  база распространяется по лицензии ODbL 1.0, содержимое — по DbCL 1.0; производная база остаётся открытой на тех же условиях.
  Данные вносят пользователи и могут содержать ошибки; отобраны записи с названием и сходящимися КБЖУ.
- Форматы: gzip поверх JSON, описаны в fooddb.js.
`);
const kb = n => (n / 1024).toFixed(0) + ' КБ';
console.log(`base.bin: ${base.length} продуктов, ${cats.length} категорий, ${kb(baseBuf.length)}`);
console.log(`ru.bin:   ${ru.length} товаров, ${kb(ruBuf.length)}`);
