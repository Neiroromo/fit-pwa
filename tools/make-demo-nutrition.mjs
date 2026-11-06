// Демо-данные для модуля «Дневник питания»: 4 недели питания, воды и таблеток; блюда, рецепт, заметки.
// Запуск: node tools/make-demo-nutrition.mjs  →  demo/nutrition-4-weeks.json
// Загрузка в приложении: Профиль → «Данные на устройстве» → «Демо-данные», либо ссылка ?demo=nutrition-4-weeks.
// Набор также кладёт в «Мониторинг» рост (180 см) и вес за эти 28 дней, а в настройки питания активность и цель «похудение».
// Пол и дату рождения нужно указать в профиле пользователя (они общие для всех модулей): без них норма не считается.
// Период — последние 28 дней до дня запуска; детерминированный (одинаковый результат при одной дате).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 20261108;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = a => a[Math.floor(rnd() * a.length)];
const r1 = v => Math.round(v * 10) / 10;
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = Date.now();
const rec = (c, id, data, ts = now) => ({ c, id, ...data, createdAt: ts, updatedAt: ts, deleted: false });

// ---------- блюда (на 100 г / мл) ----------
const F = {
  chicken: { name: 'Куриная грудка варёная', unit: 'g', kcal: 137, p: 29.8, f: 1.8, cb: 0 },
  buckwheat: { name: 'Гречка варёная', unit: 'g', kcal: 110, p: 4.2, f: 1.1, cb: 21.3, fib: 2.7 },
  egg: { name: 'Яйцо куриное', unit: 'g', kcal: 157, p: 12.7, f: 11.5, cb: 0.7, portion: { size: 55, name: 'шт' } },
  oats: { name: 'Овсяные хлопья на воде', unit: 'g', kcal: 88, p: 3, f: 1.7, cb: 15, fib: 1.7, portion: { size: 250, name: 'порция' } },
  banana: { name: 'Банан', unit: 'g', kcal: 96, p: 1.5, f: 0.5, cb: 21, fib: 1.7, sug: 15, portion: { size: 120, name: 'шт' } },
  milk: { name: 'Молоко 2,5 %', unit: 'ml', kcal: 52, p: 2.8, f: 2.5, cb: 4.7, sug: 4.7, portion: { size: 200, name: 'стакан' } },
  curd: { name: 'Творог 5 %', unit: 'g', kcal: 121, p: 17, f: 5, cb: 1.8, portion: { size: 180, name: 'пачка' } },
  rice: { name: 'Рис варёный', unit: 'g', kcal: 130, p: 2.7, f: 0.3, cb: 28, fib: 0.4 },
  salmon: { name: 'Лосось запечённый', unit: 'g', kcal: 206, p: 22, f: 13, cb: 0 },
  apple: { name: 'Яблоко', unit: 'g', kcal: 52, p: 0.3, f: 0.2, cb: 14, fib: 2.4, sug: 10, portion: { size: 150, name: 'шт' } },
  bread: { name: 'Хлеб цельнозерновой', unit: 'g', kcal: 247, p: 13, f: 3.4, cb: 41, fib: 7, portion: { size: 30, name: 'ломтик' } },
  oil: { name: 'Оливковое масло', unit: 'ml', kcal: 884, p: 0, f: 100, cb: 0, portion: { size: 10, name: 'ст. л.' } },
  shake: { name: 'Протеиновый коктейль', unit: 'ml', kcal: 70, p: 12, f: 1, cb: 3.5, portion: { size: 300, name: 'порция' } },
  salad: { name: 'Овощной салат', unit: 'g', kcal: 55, p: 1.4, f: 3.6, cb: 4.5, fib: 1.6 },
};
const ids = {};
const records = [];
let order = 0;
for (const [k, v] of Object.entries(F)) {
  ids[k] = `demo-food-${k}`;
  records.push(rec('nutrition/foods', ids[k], { ...v, ...(['chicken', 'oats', 'curd'].includes(k) ? { fav: true } : {}) }));
}
// составное блюдо: омлет (рецепт). Считается так же, как в приложении: сумма по составу на 100 г готового.
const omelet = [['egg', 165], ['milk', 80], ['oil', 5]].map(([k, amount]) => ({ name: F[k].name, unit: F[k].unit, amount, base: { kcal: F[k].kcal, p: F[k].p, f: F[k].f, cb: F[k].cb, ...(F[k].fib != null ? { fib: F[k].fib } : {}), ...(F[k].sug != null ? { sug: F[k].sug } : {}) } }));
const sum = { kcal: 0, p: 0, f: 0, cb: 0, sug: 0 };
for (const x of omelet) { const k = x.amount / 100; sum.kcal += x.base.kcal * k; sum.p += x.base.p * k; sum.f += x.base.f * k; sum.cb += x.base.cb * k; sum.sug += (x.base.sug ?? 0) * k; }
const yieldG = 230, kk = 100 / yieldG;
F.omelet = { name: 'Омлет с молоком', unit: 'g', kcal: Math.round(sum.kcal * kk), p: r1(sum.p * kk), f: r1(sum.f * kk), cb: r1(sum.cb * kk), sug: r1(sum.sug * kk), portion: { size: 230, name: 'порция' }, recipe: { yield: yieldG, items: omelet } };
ids.omelet = 'demo-food-omelet';
records.push(rec('nutrition/foods', ids.omelet, F.omelet));

const nutr = (food, amount) => {
  const k = amount / 100;
  return { kcal: Math.round(food.kcal * k), p: r1(food.p * k), f: r1(food.f * k), cb: r1(food.cb * k), ...(food.fib != null ? { fib: r1(food.fib * k) } : {}), ...(food.sug != null ? { sug: r1(food.sug * k) } : {}) };
};

// ---------- 28 дней ----------
const DAYS = 28;
const end = new Date(); end.setHours(0, 0, 0, 0);
const MEAL_TIME = { breakfast: [8, 0], lunch: [13, 15], dinner: [19, 30], snack: [16, 30] };
const weights = [];
const notes = [];
for (let i = 0; i < DAYS; i++) {
  const day = new Date(end); day.setDate(end.getDate() - (DAYS - 1 - i));
  const date = dayKey(day);
  const isToday = i === DAYS - 1;
  const wd = (day.getDay() + 6) % 7;
  const skipDay = !isToday && (i === 9 || i === 16); // два дня без записей
  const mk = (meal, key, amount) => {
    const [hh, mm] = MEAL_TIME[meal];
    const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm + Math.floor(rnd() * 20)).getTime();
    if (isToday && ts > now) return; // сегодня — только то, что уже могло быть съедено
    const food = F[key];
    const a = Math.round(amount * (0.9 + rnd() * 0.2));
    const base = { name: food.name, unit: food.unit, kcal: food.kcal, p: food.p, f: food.f, cb: food.cb, ...(food.fib != null ? { fib: food.fib } : {}), ...(food.sug != null ? { sug: food.sug } : {}), ...(food.portion ? { portion: food.portion } : {}) };
    records.push(rec('nutrition/log', crypto.randomUUID(), { date, meal, foodId: ids[key], name: food.name, unit: food.unit, amount: a, ...nutr(food, a), base }, ts + records.length));
  };
  if (!skipDay) {
    // завтрак
    if (rnd() < 0.5) { mk('breakfast', 'oats', 250); mk('breakfast', 'banana', 120); mk('breakfast', 'milk', 200); }
    else if (rnd() < 0.6) { mk('breakfast', 'omelet', 230); mk('breakfast', 'bread', 60); }
    else { mk('breakfast', 'curd', 180); mk('breakfast', 'banana', 120); }
    // обед
    mk('lunch', 'chicken', 200); mk('lunch', pick(['buckwheat', 'rice']), 280); mk('lunch', 'salad', 150); mk('lunch', 'oil', 10); mk('lunch', 'bread', 60);
    // перекус
    mk('snack', pick(['apple', 'shake']), pick([150, 300])); if (rnd() < 0.5) mk('snack', 'curd', 180);
    // ужин
    if (rnd() < 0.6) { mk('dinner', 'salmon', 180); mk('dinner', 'rice', 220); mk('dinner', 'salad', 150); }
    else { mk('dinner', 'chicken', 200); mk('dinner', 'buckwheat', 250); mk('dinner', 'salad', 150); mk('dinner', 'oil', 8); }
  }

  // вода: 5–8 порций в светлое время
  if (!skipDay || rnd() < 0.5) {
    const items = [];
    const n = 5 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8 + Math.floor((k * 13) / n), Math.floor(rnd() * 60)).getTime();
      if (isToday && ts > now) continue;
      items.push({ ts, ml: pick([250, 250, 300, 500]) });
    }
    if (items.length) records.push(rec('nutrition/water', date, { date, ml: items.reduce((s, x) => s + x.ml, 0), items }));
  }

  // вес: каждые 2 дня, медленный спад 84 → 82,6 кг
  if (i % 2 === 0 || isToday) weights.push([date, r1(84 - (1.4 * i) / (DAYS - 1) + (rnd() - 0.5) * 0.7)]);

  // заметки
  if (i % 7 === 3) notes.push([date, 'Хорошо выспался, голода днём почти не было.', null]);
  if (i === 12) notes.push([date, 'Были гости, поел позже обычного.', ['dinner', 'Праздничный ужин, переел.']]);
  if (i === 20) notes.push([date, '', ['breakfast', 'Тяжело проснуться, завтрак без аппетита.']]);
}
for (const [date, text, meal] of notes) {
  records.push(rec('nutrition/notes', date, { date, text, meals: meal ? { [meal[0]]: meal[1] } : {} }));
}

// ---------- таблетки ----------
const PILLS = [
  { id: 'demo-pill-d', name: 'Витамин D', dose: '2000 МЕ после завтрака', times: ['09:00'], days: [] },
  { id: 'demo-pill-omega', name: 'Омега-3', dose: '1 капсула с обедом', times: ['14:00'], days: [] },
  { id: 'demo-pill-creatine', name: 'Креатин', dose: '3 г в тренировочные дни', times: ['09:30'], days: [0, 2, 4] },
  { id: 'demo-pill-mg', name: 'Магний', dose: '1 таблетка перед сном', times: ['22:00'], days: [] },
];
PILLS.forEach((p, k) => records.push(rec('nutrition/pills', p.id, { ...p, order: k })));
for (let i = 0; i < DAYS; i++) {
  const day = new Date(end); day.setDate(end.getDate() - (DAYS - 1 - i));
  const wd = (day.getDay() + 6) % 7;
  for (const p of PILLS) {
    if (p.days.length && !p.days.includes(wd)) continue;
    for (const t of p.times) {
      if (rnd() > 0.86) continue; // иногда пропуск
      const [hh, mm] = t.split(':').map(Number);
      const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm + Math.floor((rnd() - 0.3) * 40)).getTime();
      if (ts > now) continue;
      records.push(rec('nutrition/pilllog', crypto.randomUUID(), { pillId: p.id, ts }, ts));
    }
  }
}

// ---------- план на завтра, шаблон приёма, голодания, тренировки ----------
{
  const tomorrow = new Date(end); tomorrow.setDate(end.getDate() + 1);
  const tdate = dayKey(tomorrow);
  for (const [meal, key, amount] of [['breakfast', 'oats', 250], ['breakfast', 'banana', 120], ['lunch', 'chicken', 200], ['lunch', 'rice', 250], ['lunch', 'salad', 150]]) {
    const food = F[key];
    const base = { name: food.name, unit: food.unit, kcal: food.kcal, p: food.p, f: food.f, cb: food.cb, ...(food.fib != null ? { fib: food.fib } : {}), ...(food.sug != null ? { sug: food.sug } : {}), ...(food.portion ? { portion: food.portion } : {}) };
    records.push(rec('nutrition/log', crypto.randomUUID(), { date: tdate, meal, foodId: ids[key], name: food.name, unit: food.unit, amount, ...nutr(food, amount), base, planned: true }, now + records.length));
  }
  const tplItems = [['oats', 250], ['banana', 120], ['milk', 200]].map(([key, amount]) => {
    const food = F[key];
    return { foodId: ids[key], name: food.name, unit: food.unit, amount, ...nutr(food, amount), base: { name: food.name, unit: food.unit, kcal: food.kcal, p: food.p, f: food.f, cb: food.cb, ...(food.fib != null ? { fib: food.fib } : {}), ...(food.sug != null ? { sug: food.sug } : {}), ...(food.portion ? { portion: food.portion } : {}) } };
  });
  records.push(rec('nutrition/templates', 'demo-tpl-breakfast', { name: 'Овсянка с бананом и молоком', items: tplItems }));
  // голодание 16 ч: пять последних ночей
  for (let i = 1; i <= 5; i++) {
    const d0 = new Date(end); d0.setDate(end.getDate() - i);
    const start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 20, 0).getTime();
    records.push(rec('nutrition/fasts', 'demo-fast-' + i, { start, end: start + (15.2 + rnd() * 2) * 3_600_000, goal: 16 }));
  }
  // тренировки по понедельникам, средам и пятницам (их публикует модуль «Тренировки»)
  const days = {};
  for (let i = 0; i < DAYS; i++) {
    const d0 = new Date(end); d0.setDate(end.getDate() - (DAYS - 1 - i));
    if ([0, 2, 4].includes((d0.getDay() + 6) % 7)) days[dayKey(d0)] = { n: 1, sec: 3000 + Math.floor(rnd() * 1500) };
  }
  records.push({ c: 'shared/_kv', id: 'activity', value: { v: 1, by: 'workouts', days }, createdAt: now, updatedAt: now, deleted: false });
}

// ---------- настройки модуля и профиль тела (для расчёта нормы) ----------
records.push({ c: 'nutrition/_kv', id: 'settings', value: {
  goals: { kcal: 2350, p: 144, f: 64, cb: 298 },
  water: { goal: 2500, unit: 'ml', cup: 250, every: 120, from: '09:00', to: '21:00' },
  collapsed: [], fasting: { goal: 16 }, norm: { auto: true, applied: { kg: 84, kcal: 2350, date: dayKey(new Date(end.getTime() - (DAYS - 1) * 86_400_000)) }, dismissed: null, activity: 1.55, goal: 'lose', pace: 15, bonus: { mode: 'fixed', kcal: 300 } },
  meals: [{ id: 'breakfast', name: 'Завтрак', on: true }, { id: 'lunch', name: 'Обед', on: true }, { id: 'dinner', name: 'Ужин', on: true }, { id: 'snack', name: 'Перекус', on: true }],
  sections: [{ id: 'summary', on: true }, { id: 'meals', on: true }, { id: 'water', on: true }, { id: 'pills', on: true }, { id: 'fast', on: true }, { id: 'note', on: true }],
  seeded: true,
}, createdAt: now, updatedAt: now, deleted: false });
records.push({ c: 'monitoring/_kv', id: 'settings', value: { height: 180, split: { arms: false, legs: false }, hidden: [] }, createdAt: now, updatedAt: now, deleted: false });
for (const [date, kg] of weights) records.push(rec('monitoring/entries', date, { date, weight: kg }));
// то, что публикует «Мониторинг» (рост и вес). Пол и дату рождения набор не задаёт: они в профиле пользователя.
records.push({ c: 'shared/_kv', id: 'body', value: { v: 2, by: 'monitoring', heightCm: 180, weights }, createdAt: now, updatedAt: now, deleted: false });

const out = path.join(root, 'demo', 'nutrition-4-weeks.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ app: 'fit-pwa', version: 1, exportedAt: new Date().toISOString(), records }, null, 1));
const logs = records.filter(r => r.c === 'nutrition/log');
console.log(`Записей: ${records.length} (журнал ${logs.length}, вода ${records.filter(r => r.c === 'nutrition/water').length}, таблетки ${records.filter(r => r.c === 'nutrition/pilllog').length}) → ${path.relative(root, out)}`);
