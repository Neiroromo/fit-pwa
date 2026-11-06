// Шаг 3 сборки базы продуктов: российские товары из выгрузки Open Food Facts (CSV, gzip, ~1,5 ГБ).
// Запуск: node tools/food-db/off.mjs <en.openfoodfacts.org.products.csv.gz> <out.json> [--top 15000]
// Читает файл потоком (в память целиком не загружается), оставляет товары России с названием и КБЖУ, отбрасывает явно ошибочные значения
// и берёт самые популярные (по числу сканирований). Данные Open Food Facts: лицензия ODbL, содержимое — DbCL (нужна ссылка на источник).
// Выход: [[штрихкод, название, бренд, ккал, белки, жиры, углеводы, клетчатка|null, сахар|null, масса упаковки/порции|null]] на 100 г / 100 мл.

import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';

const [inFile, outFile] = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
const top = Number((process.argv.indexOf('--top') > 0 && process.argv[process.argv.indexOf('--top') + 1]) || 15000);
if (!outFile) { console.error('Использование: off.mjs <csv.gz> <out.json> [--top N]'); process.exit(1); }

const rl = readline.createInterface({ input: fs.createReadStream(inFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });
let col = null, total = 0, russian = 0;
const rows = [];
const n = v => { if (v == null || v === '') return null; const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const r1 = v => Math.round(v * 10) / 10;

for await (const line of rl) {
  const f = line.split('\t');
  if (!col) { col = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
  total++;
  if (!f[col.countries_tags]?.includes('en:russia')) continue;
  russian++;
  const code = f[col.code];
  if (!/^\d{8,14}$/.test(code)) continue;
  const name = (f[col.product_name] ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 3) continue;
  const kcal = n(f[col['energy-kcal_100g']]), p = n(f[col.proteins_100g]), fat = n(f[col.fat_100g]), cb = n(f[col.carbohydrates_100g]);
  if ([kcal, p, fat, cb].includes(null)) continue;
  if (kcal < 0 || kcal > 900 || p < 0 || fat < 0 || cb < 0 || p + fat + cb > 100.5) continue;
  // калории должны сходиться с БЖУ (4/9/4 ккал на грамм) с запасом на спирт, клетчатку и округление
  if (Math.abs(kcal - (4 * p + 9 * fat + 4 * cb)) > 0.4 * Math.max(kcal, 50) + 40) continue;
  const fib = n(f[col.fiber_100g]), sug = n(f[col.sugars_100g]);
  const brand = (f[col.brands] ?? '').split(',')[0].trim();
  const scans = n(f[col.unique_scans_n]) ?? 0;
  const cyr = /[А-Яа-яЁё]/.test(name) ? 1 : 0;
  rows.push({ score: scans * 10 + cyr * 5 + (brand ? 1 : 0) + (fib != null ? 0.5 : 0), rec: [code, name.slice(0, 80), brand.slice(0, 30), Math.round(kcal), r1(p), r1(fat), r1(cb), fib != null ? r1(fib) : null, sug != null ? r1(sug) : null] });
}
rows.sort((a, b) => b.score - a.score);
const keep = rows.slice(0, top).map(r => r.rec).sort((a, b) => (a[0] < b[0] ? -1 : 1));
fs.writeFileSync(outFile, JSON.stringify(keep));
const cyrN = keep.filter(r => /[А-Яа-яЁё]/.test(r[1])).length;
console.log(`Строк в выгрузке: ${total}; с пометкой «Россия»: ${russian}; подошло по данным: ${rows.length}; оставлено: ${keep.length} (с русским названием: ${cyrN})`);
