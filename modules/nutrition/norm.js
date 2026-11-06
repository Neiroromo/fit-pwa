// Расчёт суточной нормы по данным тела. Сами данные (пол, возраст, рост, вес, цель) принадлежат модулю «Мониторинг»:
// он публикует их в общее хранилище ctx.shared под ключом 'body'. Если модуля нет или профиль не заполнен, расчёт недоступен, а норма вводится вручную.

import { dayKey, parseDay, DAY } from './data.js';

export const SAFE_MIN = { m: 1500, f: 1200 };
const MIN_FULL_DAY = 800; // меньше этого за день — считаем день неполным

export const ACTIVITY = [
  { id: 1.2, name: 'Сидячий образ жизни', hint: 'Почти нет движения, работа за столом' },
  { id: 1.375, name: 'Лёгкая активность', hint: 'Тренировки 1–3 раза в неделю или прогулки' },
  { id: 1.55, name: 'Умеренная активность', hint: 'Тренировки 3–5 раз в неделю' },
  { id: 1.725, name: 'Высокая активность', hint: 'Интенсивные тренировки 6–7 раз в неделю' },
  { id: 1.9, name: 'Очень высокая', hint: 'Физический труд и ежедневные тренировки' },
];
export const GOALS = [
  { id: 'lose', name: 'Похудение' },
  { id: 'keep', name: 'Поддержание веса' },
  { id: 'gain', name: 'Набор массы' },
];
export const PACES = [
  { id: 10, name: 'Плавно' },
  { id: 15, name: 'Умеренно' },
  { id: 20, name: 'Быстро' },
];

/**
 * Собирает всё для расчёта из трёх источников. Каждый принадлежит своему владельцу:
 *   • профиль пользователя (ядро, ctx.user()): пол, возраст;
 *   • «Мониторинг» (ctx.shared, ключ 'body'): рост и вес;
 *   • дневник питания (settings.norm): активность, цель, темп.
 * Возвращает {ok, missing: [{id, text, where: 'user'|'monitoring'|'module'|'nutrition'}], body, kg, weights}. Если чего-то нет, ok = false и missing говорит, что и где заполнить.
 */
export async function readBody(ctx, settings) {
  const user = ctx.user();
  const hasMon = ctx.registry.isInstalled('monitoring');
  const shared = hasMon ? await ctx.shared.kv.get('body', null) : null;
  const weights = shared?.weights ?? [];
  const kg = weights.at(-1)?.[1] ?? null;
  const n = settings.norm;
  const missing = [];
  if (!user.sex) missing.push({ id: 'sex', text: 'пол', where: 'user' });
  if (user.age == null) missing.push({ id: 'birth', text: 'дата рождения', where: 'user' });
  if (!hasMon) missing.push({ id: 'height', text: 'рост и вес', where: 'module' });
  else {
    if (!shared?.heightCm) missing.push({ id: 'height', text: 'рост', where: 'monitoring' });
    if (kg == null) missing.push({ id: 'weight', text: 'вес', where: 'monitoring' });
  }
  if (!n.activity) missing.push({ id: 'activity', text: 'активность', where: 'nutrition' });
  const body = { sex: user.sex, age: user.age, heightCm: shared?.heightCm ?? null, activity: n.activity, goal: n.goal ?? 'keep', pace: n.pace ?? 15 };
  return { ok: missing.length === 0, missing, body, kg, weights, hasMon, user };
}

/** Базовый обмен по формуле Миффлина — Сан Жеора. */
export const bmr = ({ sex, kg, cm, age }) => 10 * kg + 6.25 * cm - 5 * age + (sex === 'm' ? 5 : -161);

/** Норма калорий и БЖУ при заданном расходе (tdee) с учётом цели; floored — сработал нижний предел. */
export function normFor(body, kg, tdee) {
  const pct = body.pace ?? 15;
  let kcal = body.goal === 'lose' ? tdee * (1 - pct / 100) : body.goal === 'gain' ? tdee * (1 + pct / 200) : tdee;
  const min = SAFE_MIN[body.sex] ?? 1200;
  const floored = kcal < min;
  if (floored) kcal = min;
  kcal = Math.round(kcal / 10) * 10;
  const p = Math.round(kg * (body.goal === 'lose' ? 2 : body.goal === 'gain' ? 1.8 : 1.6));
  const f = Math.round(kg * 0.8);
  const cb = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, f, cb, floored, pct };
}

/** Расчёт по формуле: все шаги для показа пользователю. */
export function calcNorm(body, kg) {
  const b = bmr({ sex: body.sex, kg, cm: body.heightCm, age: body.age });
  const tdee = b * body.activity;
  return { bmr: Math.round(b), tdee: Math.round(tdee), ...normFor(body, kg, tdee) };
}

/** Сглаженный вес (экспоненциальное среднее с учётом дат): [[день, кг]] → [{t, v}]. */
export function weightTrend(weights, tau = 7) {
  const out = [];
  let prev = null;
  for (const [day, kg] of weights) {
    const t = parseDay(day).getTime();
    if (prev == null) prev = { t, v: kg };
    else {
      const a = 1 - Math.exp(-((t - prev.t) / DAY) / tau);
      prev = { t, v: prev.v + a * (kg - prev.v) };
    }
    out.push({ t, v: prev.v });
  }
  return out;
}

/**
 * Реальный расход по факту: средний приём калорий минус энергия изменения сглаженного веса (7700 ккал на кг) за последние `days` дней.
 * intake — Map день → ккал. Нужно минимум 10 дней с записями питания и 5 взвешиваний за период, иначе данных мало.
 */
export function adaptive(weights, intake, days = 14, now = new Date()) {
  const end = parseDay(dayKey(now)).getTime();
  const start = end - (days - 1) * DAY;
  // сегодняшний день ещё не закончен, а дни с очень малым числом калорий почти наверняка внесены не полностью: их не берём
  const today = dayKey(now);
  const logged = [...intake].filter(([d, k]) => k >= MIN_FULL_DAY && d !== today && parseDay(d).getTime() >= start && parseDay(d).getTime() <= end);
  const inWindow = weights.filter(([d]) => parseDay(d).getTime() >= start - 7 * DAY && parseDay(d).getTime() <= end);
  const recent = inWindow.filter(([d]) => parseDay(d).getTime() >= start);
  const need = { logged: 10, weighIns: 5 };
  const enough = logged.length >= need.logged && recent.length >= need.weighIns;
  if (!enough) return { enough: false, logged: logged.length, weighIns: recent.length, need, days };
  const trend = weightTrend(inWindow);
  const first = trend.find(p => p.t >= start) ?? trend[0];
  const last = trend.at(-1);
  const span = Math.max(1, (last.t - first.t) / DAY);
  const avg = logged.reduce((s, [, k]) => s + k, 0) / logged.length;
  const delta = last.v - first.v;
  const tdee = avg - (delta * 7700) / span;
  return { enough: true, logged: logged.length, weighIns: recent.length, days, span: Math.round(span), avg: Math.round(avg), delta, tdee: Math.round(tdee) };
}
