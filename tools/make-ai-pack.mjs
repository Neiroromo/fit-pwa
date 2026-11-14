// Собирает списки для ИИ-агентов: ai/exercises/<группа>.txt и ai/foods/<категория>.txt (+ ai/lists.txt — оглавление).
// Данные берутся из приложения (каталог упражнений и справочник продуктов), поэтому списки совпадают с тем, что знает приложение.
// Запуск из корня проекта: node tools/make-ai-pack.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const read = p => readFileSync(new URL('../' + p, import.meta.url));
const out = (p, text) => writeFileSync(new URL('../' + p, import.meta.url), text);
const fresh = dir => { rmSync(new URL('../' + dir, import.meta.url), { recursive: true, force: true }); mkdirSync(new URL('../' + dir, import.meta.url), { recursive: true }); };

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lines = [];

// ---- упражнения: файл на группу мышц (первая группа упражнения), строка: русское название | английское название | оборудование ----
const ex = JSON.parse(read('modules/workouts/exercises.json')).exercises;
const byGroup = new Map();
for (const e of ex) {
  const g = (e.g && e.g[0]) || 'other';
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push(e);
}
fresh('ai/exercises');
lines.push('# Упражнения (каталог приложения)', '', 'Формат строки: название по-русски | название по-английски | оборудование', 'Для тренировки достаточно написать название в точности как здесь (по-русски или по-английски).', '');
for (const [g, list] of [...byGroup].sort((a, b) => b[1].length - a[1].length)) {
  list.sort((a, b) => (a.ru || a.n).localeCompare(b.ru || b.n, 'ru'));
  const body = list.map(e => `${e.ru || e.n} | ${e.n} | ${(e.e || []).join(', ') || 'body only'}`).join('\n');
  out(`ai/exercises/${g}.txt`, `# Упражнения: группа «${g}» (${list.length})\n# название по-русски | название по-английски | оборудование\n${body}\n`);
  lines.push(`- exercises/${g}.txt — группа ${g}, ${list.length} шт.`);
}

// ---- продукты: файл на категорию справочника, строка: название | ккал | белки | жиры | углеводы на 100 г (или 100 мл для напитков) ----
const base = JSON.parse(gunzipSync(read('modules/nutrition/data/base.bin')));
const byCat = new Map();
for (const r of base.f) {
  const c = base.cats[r[1]];
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push(r);
}
fresh('ai/foods');
lines.push('', '# Продукты (справочник приложения)', '', 'Формат строки: название | ккал | белки г | жиры г | углеводы г — на 100 г (напитки — на 100 мл).',
  'Продукт из списка можно использовать в меню по названию без описания: приложение возьмёт значения само. Нет в списке — опишите его в разделе foods.', '');
for (const [c, list] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
  list.sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  const body = list.map(r => `${r[0]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]}`).join('\n');
  out(`ai/foods/${slug(c)}.txt`, `# Продукты: ${c} (${list.length})\n# название | ккал | белки | жиры | углеводы на 100 г\n${body}\n`);
  lines.push(`- foods/${slug(c)}.txt — ${c}, ${list.length} шт.`);
}

out('ai/lists.txt', lines.join('\n') + '\n');
console.log(`упражнений: ${ex.length} в ${byGroup.size} файлах; продуктов: ${base.f.length} в ${byCat.size} файлах`);
