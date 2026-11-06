// Данные модуля «Дневник питания». Здесь только то, что относится к питанию, воде, голоданию и таблеткам.
// Показатели тела (рост, вес) живут в «Мониторинге», пол и дата рождения — в профиле пользователя; тренировки — в «Тренировках».
// Нужное из них читается через ctx.shared / ctx.user() (см. norm.js, activity в index.js).
//
// Коллекции (с префиксом модуля):
//   foods     — блюда и продукты: {id, name, unit: 'g'|'ml', kcal, p, f, cb (на 100 г или 100 мл), + необязательные EXTRAS (fib, sug, sat, na, …),
//               portion?: {size, name}, fav?: true, barcode?, src?: 'own'|'base'|'ru'|'off',
//               recipe?: {yield, items: [{name, unit, amount, base: {kcal, p, f, cb, ...EXTRAS}}]}}
//               Поле углеводов называется cb: имя c занято коллекцией в самой записи.
//   log       — съеденное и запланированное: {id, date, meal, foodId?, name, unit, amount (г/мл), kcal, p, f, cb, ...EXTRAS (на съеденное), base,
//               planned?: true (в плане: в итоги не входит), quick?: true (быстрое добавление без продукта)}
//               Значения хранятся «снимком», поэтому правка или удаление блюда не меняет историю.
//   templates — шаблоны приёма («мой завтрак»): {id, name, items: [записи журнала без id, даты и приёма]}
//   water     — вода за день: {id: дата, date, ml, items: [{ts, ml}]}
//   fasts     — голодание: {id, start (мс), end (мс) | null, goal (часы)}
//   pills     — таблетки: {id, name, dose, order, times: ['08:00'], days: [0..6, 0 = понедельник; пусто = каждый день], from?, to? (курс, даты)}
//   pilllog   — отметки приёма: {id, pillId, ts (мс)}
//   notes     — заметки: {id: дата, date, text, meals: {id приёма: текст}}
// kv 'settings': см. DEFAULT_SETTINGS.

const pad = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
export const parseDay = key => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const shiftDay = (key, n) => { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d); };
export const DAY = 86_400_000;

/** replaceChildren без узлов null/false: иначе браузер выводит в страницу текст «null». */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));

/** «72,5» и «72.5» → 72.5; пусто или не число → null */
export const num = s => {
  const v = parseFloat(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
export const round1 = v => Math.round(v * 10) / 10;

export const LIMITS = { kcal: [0, 2000], macro: [0, 100], amount: [0.1, 5000], portion: [1, 5000], goalKcal: [500, 10000], goalMacro: [0, 1000], waterGoal: [200, 20000], cup: [50, 1000], every: [15, 480], bonus: [0, 2000], quickKcal: [1, 5000], quickMacro: [0, 500] };
export const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

export const UNITS = { g: 'г', ml: 'мл' };

/** Дополнительные нутриенты (необязательные, на 100 г / 100 мл): d — знаков после запятой, max — верхний предел при вводе. */
export const EXTRAS = [
  { id: 'fib', name: 'Клетчатка', unit: 'г', max: 100, d: 1 },
  { id: 'sug', name: 'Сахар', unit: 'г', max: 100, d: 1 },
  { id: 'sat', name: 'Насыщенные жиры', unit: 'г', max: 100, d: 1 },
  { id: 'na', name: 'Натрий', unit: 'мг', max: 40000, d: 0 },
  { id: 'chol', name: 'Холестерин', unit: 'мг', max: 5000, d: 0 },
  { id: 'ca', name: 'Кальций', unit: 'мг', max: 5000, d: 0 },
  { id: 'fe', name: 'Железо', unit: 'мг', max: 500, d: 1 },
  { id: 'k', name: 'Калий', unit: 'мг', max: 20000, d: 0 },
  { id: 'vc', name: 'Витамин C', unit: 'мг', max: 5000, d: 1 },
];
export const EXTRA_IDS = EXTRAS.map(e => e.id);

/** Приёмы пищи по умолчанию. Свои добавляются в настройки с флагом custom. */
export const DEFAULT_MEALS = [
  { id: 'breakfast', name: 'Завтрак', on: true },
  { id: 'lunch', name: 'Обед', on: true },
  { id: 'dinner', name: 'Ужин', on: true },
  { id: 'snack', name: 'Перекус', on: false },
];

/** Разделы главной страницы в порядке показа. */
export const SECTION_NAMES = {
  summary: 'Сводка КБЖУ',
  meals: 'Приёмы пищи',
  water: 'Вода',
  pills: 'Таблетки',
  fast: 'Голодание',
  note: 'Заметка дня',
};

export const DEFAULT_SETTINGS = {
  goals: { kcal: 2000, p: 100, f: 70, cb: 250 },
  meals: DEFAULT_MEALS,
  sections: [
    { id: 'summary', on: true }, { id: 'meals', on: true }, { id: 'water', on: true }, { id: 'pills', on: true }, { id: 'fast', on: false }, { id: 'note', on: true },
  ],
  // water.every/from/to — параметры напоминания о воде; включается оно в «Профиль → Напоминания»
  water: { goal: 2000, unit: 'ml', cup: 250, every: 120, from: '09:00', to: '21:00' },
  fasting: { goal: 16 },
  collapsed: [], // id свёрнутых приёмов
  // норма: активность и цель по весу задаются здесь, в питании (они нужны только для корректировки питания);
  // applied: {kg, kcal, date}; dismissed: день, когда предложение отклонили;
  // bonus: добавка к норме в дни с тренировкой (по данным модуля «Тренировки»): mode 'off' | 'fixed'
  norm: { auto: false, applied: null, dismissed: null, activity: null, goal: 'keep', pace: 15, bonus: { mode: 'off', kcal: 300 } },
  seeded: false,
};

export async function getSettings(ctx) {
  const s = (await ctx.db.kv.get('settings', null)) ?? {};
  const sections = [...(s.sections ?? [])].filter(x => SECTION_NAMES[x.id]);
  for (const d of DEFAULT_SETTINGS.sections) if (!sections.some(x => x.id === d.id)) sections.push({ ...d });
  return {
    ...DEFAULT_SETTINGS, ...s,
    goals: { ...DEFAULT_SETTINGS.goals, ...(s.goals ?? {}) },
    water: { ...DEFAULT_SETTINGS.water, ...(s.water ?? {}) },
    fasting: { ...DEFAULT_SETTINGS.fasting, ...(s.fasting ?? {}) },
    norm: { ...DEFAULT_SETTINGS.norm, ...(s.norm ?? {}), bonus: { ...DEFAULT_SETTINGS.norm.bonus, ...(s.norm?.bonus ?? {}) } },
    meals: (s.meals?.length ? s.meals : DEFAULT_MEALS).map(m => ({ ...m })),
    sections: sections.map(x => ({ ...x })),
    collapsed: [...(s.collapsed ?? [])],
  };
}
export const saveSettings = (ctx, s) => ctx.db.kv.set('settings', s);

/** Удаляет запись коллекции и показывает сообщение с кнопкой «Отменить»: нажатие возвращает запись. after() обновляет экран. */
export async function removeWithUndo(ctx, coll, rec, text, after) {
  await ctx.db.collection(coll).remove(rec.id);
  after?.();
  ctx.ui.toast(text, { action: 'Отменить', onAction: async () => { await ctx.db.collection(coll).put(rec); after?.(); } });
}

// ---------- блюда ----------
/** 7 примеров при первом запуске: значения на 100 г / 100 мл. */
export const SAMPLE_FOODS = [
  { name: 'Куриная грудка варёная', unit: 'g', kcal: 137, p: 29.8, f: 1.8, cb: 0 },
  { name: 'Гречка варёная', unit: 'g', kcal: 110, p: 4.2, f: 1.1, cb: 21.3, fib: 2.7 },
  { name: 'Яйцо куриное', unit: 'g', kcal: 157, p: 12.7, f: 11.5, cb: 0.7, portion: { size: 55, name: 'шт' } },
  { name: 'Овсяные хлопья на воде', unit: 'g', kcal: 88, p: 3, f: 1.7, cb: 15, fib: 1.7, portion: { size: 250, name: 'порция' } },
  { name: 'Банан', unit: 'g', kcal: 96, p: 1.5, f: 0.5, cb: 21, fib: 1.7, sug: 15, portion: { size: 120, name: 'шт' } },
  { name: 'Молоко 2,5 %', unit: 'ml', kcal: 52, p: 2.8, f: 2.5, cb: 4.7, sug: 4.7, portion: { size: 200, name: 'стакан' } },
  { name: 'Творог 5 %', unit: 'g', kcal: 121, p: 17, f: 5, cb: 1.8, portion: { size: 180, name: 'пачка' } },
];

export async function listFoods(ctx) {
  return (await ctx.db.collection('foods').list()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
export const putFood = (ctx, food) => ctx.db.collection('foods').put(food);
export const toggleFav = (ctx, food) => putFood(ctx, { ...food, fav: food.fav ? undefined : true });

/** Примеры добавляются один раз; потом их можно менять и удалять как обычные блюда. */
export async function seedFoods(ctx, settings) {
  if (settings.seeded) return false;
  for (const f of SAMPLE_FOODS) await putFood(ctx, { ...f });
  settings.seeded = true;
  await saveSettings(ctx, settings);
  return true;
}

const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Нутриенты на указанное количество (г или мл); дополнительные — только если заданы у блюда. */
export function nutrientsFor(food, amount) {
  const k = amount / 100;
  const out = { kcal: Math.round(food.kcal * k), p: round1(food.p * k), f: round1(food.f * k), cb: round1(food.cb * k) };
  for (const e of EXTRAS) if (food[e.id] != null) out[e.id] = roundTo(food[e.id] * k, e.d);
  return out;
}

/** Состав составного блюда → значения на 100 г готового блюда (yield — масса готового). */
export function recipeTotals(items, yieldAmount) {
  const sum = { kcal: 0, p: 0, f: 0, cb: 0 };
  const has = {};
  let mass = 0;
  for (const it of items) {
    const n = nutrientsFor(it.base, it.amount);
    mass += it.amount;
    for (const k of ['kcal', 'p', 'f', 'cb']) sum[k] += n[k];
    for (const e of EXTRAS) if (n[e.id] != null) { sum[e.id] = (sum[e.id] ?? 0) + n[e.id]; has[e.id] = true; }
  }
  const out = yieldAmount || mass;
  const k = out > 0 ? 100 / out : 0;
  const per100 = { kcal: Math.round(sum.kcal * k), p: round1(sum.p * k), f: round1(sum.f * k), cb: round1(sum.cb * k) };
  for (const e of EXTRAS) if (has[e.id]) per100[e.id] = roundTo(sum[e.id] * k, e.d);
  return { mass, yield: out, per100 };
}

// ---------- журнал ----------
export const listLog = ctx => ctx.db.collection('log').list();
export const putLog = (ctx, rec) => ctx.db.collection('log').put(rec);

/** Только съеденное (без запланированного). */
export const eaten = items => items.filter(x => !x.planned);

export function sumNutrients(items) {
  const a = { kcal: 0, p: 0, f: 0, cb: 0 };
  for (const e of EXTRAS) a[e.id] = 0;
  for (const x of items) {
    a.kcal += x.kcal ?? 0; a.p += x.p ?? 0; a.f += x.f ?? 0; a.cb += x.cb ?? 0;
    for (const e of EXTRAS) a[e.id] += x[e.id] ?? 0;
  }
  return a;
}

/** Копирует записи на другую дату (и, если задан toMeal, в другой приём). На будущую дату записи попадают в план. Возвращает число записей. */
export async function copyEntries(ctx, items, toDate, toMeal) {
  const planned = toDate > dayKey();
  for (const x of items) {
    const { id, c, createdAt, updatedAt, deleted, planned: _p, ...rest } = x;
    await putLog(ctx, { ...rest, date: toDate, meal: toMeal ?? x.meal, ...(planned ? { planned: true } : {}) });
  }
  return items.length;
}

/** Использование блюд по журналу: Map ключ → {count, last}; meal — считать только записи этого приёма. */
export function usageStats(log, meal) {
  const m = new Map();
  for (const x of log) {
    if (x.planned || x.quick || (meal && x.meal !== meal)) continue;
    const key = x.foodId ?? 'n:' + x.name.toLowerCase();
    const u = m.get(key) ?? { count: 0, last: 0 };
    u.count++;
    u.last = Math.max(u.last, x.createdAt ?? 0, x.updatedAt ?? 0);
    m.set(key, u);
  }
  return m;
}

// ---------- шаблоны приёмов ----------
export async function listTemplates(ctx) {
  return (await ctx.db.collection('templates').list()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
export const putTemplate = (ctx, t) => ctx.db.collection('templates').put(t);

/** Сохраняет записи приёма как шаблон. */
export function templateFrom(name, items) {
  return { name, items: items.map(x => { const { id, c, createdAt, updatedAt, deleted, planned, date, meal, ...rest } = x; return rest; }) };
}
/** Добавляет все блюда шаблона в приём (на будущую дату — в план). Возвращает число записей. */
export async function applyTemplate(ctx, tpl, date, meal) {
  const planned = date > dayKey();
  for (const it of tpl.items) await putLog(ctx, { ...it, date, meal, ...(planned ? { planned: true } : {}) });
  return tpl.items.length;
}

// ---------- заметки ----------
export async function getNote(ctx, date) {
  return (await ctx.db.collection('notes').get(date)) ?? { id: date, date, text: '', meals: {} };
}
export const putNote = (ctx, n) => ctx.db.collection('notes').put({ ...n, id: n.date });

// ---------- вода ----------
export async function getWater(ctx, date) {
  return (await ctx.db.collection('water').get(date)) ?? { id: date, date, ml: 0, items: [] };
}
export const listWater = ctx => ctx.db.collection('water').list();
const putWater = (ctx, w) => ctx.db.collection('water').put(w);
export async function addWater(ctx, date, ml) {
  const w = await getWater(ctx, date);
  w.items = [...w.items, { ts: Date.now(), ml }];
  w.ml = w.items.reduce((s, x) => s + x.ml, 0);
  return putWater(ctx, w);
}
/** Убирает порцию воды номер i; возвращает прежнюю запись дня (для отмены). */
export async function removeWaterAt(ctx, date, i) {
  const prev = await getWater(ctx, date);
  const w = { ...prev, items: prev.items.filter((_, k) => k !== i) };
  w.ml = w.items.reduce((s, x) => s + x.ml, 0);
  await putWater(ctx, w);
  return prev;
}
export const restoreWater = (ctx, prev) => putWater(ctx, prev);

// ---------- голодание ----------
export const listFasts = async ctx => (await ctx.db.collection('fasts').list()).sort((a, b) => b.start - a.start);
export const putFast = (ctx, f) => ctx.db.collection('fasts').put(f);
export const activeFast = fasts => fasts.find(f => !f.end) ?? null;
export const FAST_PROTOCOLS = [12, 14, 16, 18, 20, 24];

/** 14,5 ч → «14 ч 30 мин» (через переданную функцию перевода). */
export function fmtDuration(ms, t) {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h} ${t('ч')} ${pad(mm)} ${t('мин')}`;
}

// ---------- таблетки ----------
export async function listPills(ctx) {
  return (await ctx.db.collection('pills').list()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export const putPill = (ctx, p) => ctx.db.collection('pills').put(p);
export const listPillLog = ctx => ctx.db.collection('pilllog').list();
export const putPillLog = (ctx, r) => ctx.db.collection('pilllog').put(r);

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Время приёма таблетки в указанный день ('HH:MM'): пусто, если в этот день её принимать не нужно (день недели, курс). */
export function slotsOn(pill, date) {
  if (pill.from && date < pill.from) return [];
  if (pill.to && date > pill.to) return [];
  const wd = (parseDay(date).getDay() + 6) % 7;
  if (pill.days?.length && !pill.days.includes(wd)) return [];
  return [...(pill.times ?? [])].sort();
}

/**
 * Состояние приёмов таблетки за день. logs — отметки этой таблетки за день по возрастанию времени.
 * k-я отметка закрывает k-е время по расписанию; статусы: done, due (время уже пришло, сегодня), missed (прошедший день), upcoming; лишние отметки — extra.
 */
export function pillDay(pill, date, logs, now = Date.now()) {
  const slots = slotsOn(pill, date).map((time, i) => {
    const [h, m] = time.split(':').map(Number);
    const ts = parseDay(date).getTime() + (h * 60 + m) * 60_000;
    const log = logs[i];
    const status = log ? 'done' : date < dayKey(new Date(now)) ? 'missed' : ts <= now ? 'due' : 'upcoming';
    return { time, ts, log, status };
  });
  return { slots, extra: logs.slice(slots.length) };
}

// ---------- тренировки (из общего хранилища) ----------
/** Прибавка к норме калорий на день с тренировкой: данные публикует модуль «Тренировки» (ctx.shared, ключ 'activity'). */
export function trainingBonus(settings, activity, date) {
  const b = settings.norm.bonus;
  if (b?.mode !== 'fixed' || !(activity?.days?.[date]?.n > 0)) return 0;
  return Math.max(0, Math.round(b.kcal) || 0);
}
