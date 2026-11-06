// «Умная норма»: окно расчёта по данным из «Мониторинга» и предложение пересчёта при изменении веса.
// Если модуля «Мониторинг» нет или профиль не заполнен, окно объясняет, что делать; дневник при этом работает с нормой, заданной вручную.

import { dayKey, listLog, saveSettings, fill, num, inRange, LIMITS } from './data.js';
import { numField } from './foods.js';
import { readBody, calcNorm, normFor, adaptive, ACTIVITY, GOALS, PACES } from './norm.js';

const GOAL_NAME = { lose: 'Похудение', keep: 'Поддержание веса', gain: 'Набор массы' };

/** Предложение новой нормы для баннера на главной (только при включённом автопересчёте); null, если предлагать нечего. */
export async function normSuggestion(ctx, settings) {
  if (!settings.norm.auto) return null;
  const info = await readBody(ctx, settings);
  if (!info.ok) return null;
  const n = calcNorm(info.body, info.kg);
  const a = settings.norm.applied;
  const g = settings.goals;
  const changed = !a || Math.abs(info.kg - a.kg) >= 1 || Math.abs(n.kcal - g.kcal) >= 100;
  if (!changed || settings.norm.dismissed === dayKey()) return null;
  return { ...n, kg: info.kg };
}

/** Применяет норму: цели, запоминает вес, при необходимости включает автопересчёт. */
export async function applyNorm(ctx, settings, n, kg) {
  settings.goals = { kcal: n.kcal, p: n.p, f: n.f, cb: n.cb };
  settings.norm.applied = { kg, kcal: n.kcal, date: dayKey() };
  settings.norm.dismissed = null;
  await saveSettings(ctx, settings);
}

export function openNorm(env) {
  const { ctx, settings, render } = env;
  const { h, icon, modal, toast, raw } = ctx.ui;
  const body = h('div', { class: 'form nut-norm' });
  const m = modal({ title: 'Норма калорий', wide: true, body });
  const persist = () => saveSettings(ctx, settings);
  const row = (label, value, hint) => h('div', { class: 'nut-step' }, h('span', { class: 'grow' }, label, hint ? h('span', { class: 'muted small block' }, hint) : null), h('strong', null, raw(value)));

  const chips = (items, current, onPick) => h('div', { class: 'size-chips' }, items.map(([id, label]) =>
    h('button', { type: 'button', class: 'chip-btn' + (id === current ? ' on' : ''), onClick: () => onPick(id) }, label)));
  const set = async patch => { Object.assign(settings.norm, patch); await persist(); render(); draw(); };

  async function draw() {
    const info = await readBody(ctx, settings);
    const n0 = settings.norm;
    const children = [];

    // 1) то, что задаётся здесь, в питании: активность и цель
    children.push(
      h('div', { class: 'nut-sub' }, 'Активность'),
      h('div', { class: 'nut-act' }, ACTIVITY.map(a => h('button', { type: 'button', class: 'nut-act-item' + (n0.activity === a.id ? ' on' : ''), onClick: () => set({ activity: a.id }) },
        h('strong', null, a.name), h('span', { class: 'muted small' }, a.hint)))),
      h('div', { class: 'nut-sub' }, 'Цель по весу'),
      chips(GOALS.map(g => [g.id, g.name]), n0.goal ?? 'keep', id => set({ goal: id })),
      n0.goal && n0.goal !== 'keep' ? h('div', { class: 'nut-sub' }, 'Темп') : null,
      n0.goal && n0.goal !== 'keep' ? chips(PACES.map(x => [x.id, x.name]), n0.pace ?? 15, id => set({ pace: id })) : null,
      n0.goal && n0.goal !== 'keep' ? h('p', { class: 'muted small' }, 'Темп — насколько калорийность отличается от расхода: плавно около 10 %, умеренно 15 %, быстро 20 %.') : null);

    // 1б) тренировки: в дни с тренировкой (данные модуля «Тренировки») норма калорий растёт
    const bonus = settings.norm.bonus;
    const setBonus = async patch => { Object.assign(settings.norm.bonus, patch); await persist(); render(); draw(); };
    children.push(h('div', { class: 'nut-sub' }, 'Тренировки'));
    if (ctx.registry.isInstalled('workouts')) {
      children.push(
        chips([['off', 'Не учитывать'], ['fixed', 'Добавлять к норме']], bonus.mode, id => setBonus({ mode: id })),
        bonus.mode === 'fixed' ? h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Добавка в день с тренировкой, ккал'),
          numField(ctx, { value: String(bonus.kcal), range: LIMITS.bonus, int: true, onInput: v => { const x = num(v); if (inRange(x, LIMITS.bonus)) { settings.norm.bonus.kcal = Math.round(x); persist(); render(); } } })) : null,
        h('p', { class: 'muted small' }, 'Добавка идёт в углеводы. Тренировка учитывается, если она завершена и сохранена в модуле «Тренировки».'));
    } else {
      children.push(h('p', { class: 'muted small' }, 'Установите модуль «Тренировки»: в дни с выполненной тренировкой норма калорий может расти.'));
    }

    // 2) откуда берутся остальные данные и чего не хватает
    const miss = info.missing.filter(x => x.where !== 'nutrition');
    if (miss.length) {
      const user = miss.filter(x => x.where === 'user'), mon = miss.filter(x => x.where === 'monitoring'), nomod = miss.some(x => x.where === 'module');
      children.push(h('div', { class: 'nut-sub' }, 'Не хватает данных'));
      if (user.length) children.push(h('p', null, ctx.t('В профиле пользователя не заполнено: {list}.', { list: user.map(x => ctx.t(x.text)).join(', ') })),
        h('button', { class: 'btn', onClick: () => { m.close(); ctx.openProfile(); } }, 'Открыть личные данные'));
      if (nomod) children.push(h('p', null, 'Рост и вес ведёт модуль «Мониторинг», он сейчас не установлен.'),
        h('button', { class: 'btn', onClick: () => { m.close(); ctx.openStore(); } }, icon('plus', 16), 'Открыть «Модули»'));
      if (mon.length) children.push(h('p', null, ctx.t('В «Мониторинге» не заполнено: {list}.', { list: mon.map(x => ctx.t(x.text)).join(', ') })),
        h('button', { class: 'btn', onClick: () => { m.close(); ctx.router.go('monitoring'); } }, 'Открыть «Мониторинг»'));
      children.push(h('p', { class: 'muted small' }, 'Пока данных нет, дневник работает как обычно: норму можно задать вручную в настройках дневника.'));
    }
    if (info.missing.some(x => x.where === 'nutrition') && !miss.length) children.push(h('p', { class: 'muted small' }, 'Выберите активность, чтобы рассчитать норму.'));
    if (!info.ok) { fill(body, ...children); return; }

    const { body: b, kg, weights } = info;
    const n = calcNorm(b, kg);
    const act = b.activity;
    children.push(
      h('p', { class: 'muted small' }, ctx.t('Данные: {sex}, {age} лет (профиль), {h} см, вес {kg} кг («Мониторинг»), цель — {goal}.', { sex: ctx.t(b.sex === 'm' ? 'мужчина' : 'женщина'), age: b.age, h: b.heightCm, kg, goal: ctx.t(GOALS.find(g => g.id === b.goal)?.name ?? '').toLowerCase() })),
      h('div', { class: 'nut-sub' }, 'Расчёт по формуле'),
      row('Базовый обмен', `${n.bmr} ${ctx.t('ккал')}`, 'Формула Миффлина — Сан Жеора: энергия в покое'),
      row('Суточный расход', `${n.tdee} ${ctx.t('ккал')}`, ctx.t('Базовый обмен × {a} (активность)', { a: act })),
      b.goal === 'keep' ? row('Цель', 'без изменений') : row('Цель', `${b.goal === 'lose' ? '−' : '+'}${b.goal === 'lose' ? n.pct : n.pct / 2} %`, b.goal === 'lose' ? 'Дефицит калорий' : 'Профицит калорий'),
      h('div', { class: 'nut-step total' }, h('span', { class: 'grow' }, 'Норма на день'), h('strong', null, raw(`${n.kcal} ${ctx.t('ккал')}`))),
      h('div', { class: 'nut-step' }, h('span', { class: 'grow muted small' }, 'Белки · Жиры · Углеводы'), h('strong', null, raw(`${n.p} · ${n.f} · ${n.cb} ${ctx.t('г')}`))),
      n.floored ? h('p', { class: 'warn small' }, ctx.t('Рассчитанное значение ниже безопасного минимума, поэтому взято {n} ккал. Это не медицинская рекомендация.', { n: n.kcal })) : null,
      h('button', { class: 'btn primary', onClick: async () => { await applyNorm(ctx, settings, n, kg); toast('Норма обновлена'); render(); draw(); } }, icon('check', 16), 'Применить норму'));

    // подстройка по факту: реальный расход из питания и сглаженного веса
    const intake = new Map();
    for (const x of await listLog(ctx)) if (!x.planned) intake.set(x.date, (intake.get(x.date) ?? 0) + x.kcal); // запланированное ещё не съедено
    const ad = adaptive(weights, intake);
    children.push(h('div', { class: 'nut-sub' }, 'Подстройка по факту'));
    if (!ad.enough) {
      children.push(h('p', { class: 'muted small' }, ctx.t('Нужно за последние {d} дн.: не меньше {a} дней с записями питания (есть {x}) и {b} взвешиваний (есть {y}). Тогда приложение сравнит питание с изменением веса и уточнит расход.', { d: ad.days, a: ad.need.logged, x: ad.logged, b: ad.need.weighIns, y: ad.weighIns })));
    } else {
      const fact = normFor(b, kg, ad.tdee);
      children.push(
        row('Средний приём', `${ad.avg} ${ctx.t('ккал')}`, ctx.t('за {d} дн. с записями', { d: ad.logged })),
        row('Изменение веса (тренд)', `${ad.delta > 0 ? '+' : ad.delta < 0 ? '−' : ''}${Math.abs(Math.round(ad.delta * 10) / 10)} ${ctx.t('кг')}`, ctx.t('за {d} дн.', { d: ad.span })),
        row('Реальный расход', `${ad.tdee} ${ctx.t('ккал')}`, ctx.t('по формуле было {n}', { n: n.tdee })),
        h('div', { class: 'nut-step total' }, h('span', { class: 'grow' }, 'Норма по факту'), h('strong', null, raw(`${fact.kcal} ${ctx.t('ккал')}`))),
        h('button', { class: 'btn', onClick: async () => { await applyNorm(ctx, settings, fact, kg); toast('Норма обновлена'); render(); draw(); } }, 'Применить норму по факту'));
    }

    const cb = h('input', { type: 'checkbox' });
    cb.checked = settings.norm.auto;
    cb.addEventListener('change', async () => { settings.norm.auto = cb.checked; await persist(); render(); });
    children.push(h('label', { class: 'check' }, cb, h('span', null, 'Предлагать пересчёт при изменении веса или профиля')));
    fill(body, ...children);
  }
  draw();
}
