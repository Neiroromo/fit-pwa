// Шаг 1 сборки базы продуктов: разбор наборов USDA (Foundation Foods JSON и SR Legacy CSV) в единый список кандидатов.
// Запуск: node tools/food-db/usda.mjs <папка с FoundationFoods .json> <папка SR Legacy csv> <куда писать usda.json>
// Данные USDA FoodData Central — общественное достояние (CC0).
// Выход: [{id, src: 'F'|'S', en, cat, kcal, p, f, cb, fib?, sug?, g?: масса порции (г), pn?: описание порции}] на 100 г.

import fs from 'node:fs';
import path from 'node:path';

const [foundDir, srDir, out] = process.argv.slice(2);
if (!out) { console.error('Использование: usda.mjs <foundation-dir> <sr-dir> <out.json>'); process.exit(1); }

/** Простой разбор CSV с кавычками (поля вида "a ""b"" c"). */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r1 = v => Math.round(v * 10) / 10;

// номера нутриентов (nutrient_nbr)
const NBR = { kcal: ['208', '957', '958'], p: ['203'], f: ['204'], cb: ['205'], fib: ['291'], sug: ['269', '269.3'],
  sat: ['606'], na: ['307'], chol: ['601'], ca: ['301'], fe: ['303'], k: ['306'], vc: ['401'] };
// дополнительные нутриенты: г (sat), мг (na, chol, ca, k, vc, fe) на 100 г; знаков после запятой
const EXTRA_DIGITS = { sat: 1, na: 0, chol: 0, ca: 0, fe: 1, k: 0, vc: 1 };

function pick(byNbr, key) {
  for (const n of NBR[key]) if (byNbr.has(n)) return byNbr.get(n);
  return null;
}
function make(base, byNbr, portions) {
  const kcal = pick(byNbr, 'kcal'), p = pick(byNbr, 'p'), f = pick(byNbr, 'f'), cb = pick(byNbr, 'cb');
  if (kcal == null || p == null || f == null || cb == null) return null;
  const fib = pick(byNbr, 'fib'), sug = pick(byNbr, 'sug');
  const rec = { ...base, kcal: Math.round(kcal), p: r1(p), f: r1(f), cb: r1(cb) };
  if (fib != null) rec.fib = r1(fib);
  if (sug != null) rec.sug = r1(sug);
  for (const [k, d] of Object.entries(EXTRA_DIGITS)) { const v = pick(byNbr, k); if (v != null) rec[k] = Math.round(v * 10 ** d) / 10 ** d; }
  // типичная порция: первая с понятной массой и описанием
  const por = portions.find(x => x.g > 0 && x.name) ?? null;
  if (por) { rec.g = Math.round(por.g * 10) / 10; rec.pn = por.name; }
  return rec;
}

const out0 = [];

// ---------- Foundation Foods (JSON) ----------
{
  const file = fs.readdirSync(foundDir).find(f => f.endsWith('.json'));
  const d = JSON.parse(fs.readFileSync(path.join(foundDir, file), 'utf8'));
  for (const f of d.FoundationFoods ?? []) {
    const byNbr = new Map();
    for (const fn of f.foodNutrients ?? []) if (fn.nutrient?.number != null && fn.amount != null) byNbr.set(String(fn.nutrient.number), fn.amount);
    const portions = (f.foodPortions ?? []).map(x => ({ g: x.gramWeight, name: [x.amount && x.amount !== 1 ? x.amount : '', x.modifier || x.portionDescription || x.measureUnit?.name || ''].filter(Boolean).join(' ').trim() }));
    const r = make({ id: 'F' + f.fdcId, src: 'F', en: f.description, cat: f.foodCategory?.description ?? '' }, byNbr, portions);
    if (r) out0.push(r);
  }
}

// ---------- SR Legacy (CSV) ----------
{
  const dir = fs.readdirSync(srDir).map(n => path.join(srDir, n)).find(p => fs.statSync(p).isDirectory()) ?? srDir;
  const rd = n => parseCsv(fs.readFileSync(path.join(dir, n), 'utf8'));
  const cats = new Map(rd('food_category.csv').map(c => [c.id, c.description]));
  const nutr = new Map(rd('nutrient.csv').map(n => [n.id, n.nutrient_nbr]));
  const foods = rd('food.csv');
  const fn = new Map();
  for (const r of rd('food_nutrient.csv')) {
    const nbr = nutr.get(r.nutrient_id); const a = num(r.amount);
    if (!nbr || a == null) continue;
    if (!fn.has(r.fdc_id)) fn.set(r.fdc_id, new Map());
    fn.get(r.fdc_id).set(nbr, a);
  }
  const por = new Map();
  for (const r of rd('food_portion.csv').sort((a, b) => num(a.seq_num) - num(b.seq_num))) {
    if (!por.has(r.fdc_id)) por.set(r.fdc_id, []);
    const amt = num(r.amount);
    por.get(r.fdc_id).push({ g: num(r.gram_weight), name: [amt && amt !== 1 ? amt : '', r.modifier || r.portion_description || ''].filter(Boolean).join(' ').trim() });
  }
  for (const f of foods) {
    const byNbr = fn.get(f.fdc_id);
    if (!byNbr) continue;
    const r = make({ id: 'S' + f.fdc_id, src: 'S', en: f.description, cat: cats.get(f.food_category_id) ?? '' }, byNbr, por.get(f.fdc_id) ?? []);
    if (r) out0.push(r);
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(out0));
const byCat = {};
for (const r of out0) byCat[r.cat] = (byCat[r.cat] ?? 0) + 1;
console.log(`Кандидатов: ${out0.length} (Foundation ${out0.filter(r => r.src === 'F').length}, SR ${out0.filter(r => r.src === 'S').length})`);
console.log(Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join('\n'));
