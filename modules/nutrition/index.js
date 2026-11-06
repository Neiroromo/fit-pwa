// Модуль «Дневник питания»: сводка КБЖУ, приёмы пищи с блюдами (и планом на будущие дни), вода, таблетки по расписанию, голодание, заметки, история.
// Состав и порядок разделов настраиваются. Показатели тела здесь не хранятся: для расчёта нормы они читаются из «Мониторинга» и профиля (см. norm.js),
// добавка к норме за тренировку — из «Тренировок» (общее хранилище). Напоминания включаются в «Профиль → Напоминания» (см. reminders ниже).

import {
  fill, LIMITS, SECTION_NAMES, EXTRAS, FAST_PROTOCOLS, dayKey, parseDay, shiftDay, num, inRange, round1, DAY,
  getSettings, saveSettings, seedFoods, listLog, putLog, removeWithUndo, eaten, sumNutrients, copyEntries,
  getWater, addWater, removeWaterAt, restoreWater, listPills, listPillLog, getNote, putNote, pillDay,
  listFasts, putFast, activeFast, fmtDuration, putTemplate, templateFrom, trainingBonus,
} from './data.js';
import { numField, openAmount, openQuickAdd, openPicker, openFoodsManager, fmt, extrasText } from './foods.js';
import { pillsCard, logsOfDay } from './pills.js';
import { renderHistory } from './history.js';
import { openNorm, normSuggestion, applyNorm } from './normui.js';

const MACROS = [
  { id: 'p', name: 'Белки', short: 'Б', color: '#3987e5' },
  { id: 'f', name: 'Жиры', short: 'Ж', color: '#d95926' },
  { id: 'cb', name: 'Углеводы', short: 'У', color: '#199e70' },
];
const WATER_UNITS = { ml: 'мл', l: 'л', cup: 'кружки' };
const WATER_STEPS = { ml: [100, 250, 500], l: [0.25, 0.5, 1], cup: [1, 2] };
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const pad = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Вода: мл → строка в выбранных единицах. */
function fmtWater(ctx, ml, settings) {
  const { unit, cup } = settings.water;
  if (unit === 'l') return `${fmt(ctx, ml / 1000)} ${ctx.t('л')}`;
  if (unit === 'cup') return `${fmt(ctx, ml / cup)} ${ctx.t('кр.')}`;
  return `${Math.round(ml)} ${ctx.t('мл')}`;
}

/** Активность по тренировкам из общего хранилища (публикует модуль «Тренировки»); null, если модуля нет. */
const readActivity = ctx => (ctx.registry.isInstalled('workouts') ? ctx.shared.kv.get('activity', null) : Promise.resolve(null));

export default {
  async mount(page, ctx) {
    const { h, icon, iconBtn, confirmDialog, toast, raw, modal } = ctx.ui;
    let settings = await getSettings(ctx);
    if (await seedFoods(ctx, settings)) toast('Добавлено 7 примеров блюд: их можно менять и удалять в «Мои блюда»');
    const state = { date: dayKey(), tab: 'day', period: 30, hview: 'chart' };
    const view = h('div', { class: 'nut-view' });
    let allLog = [];

    const persist = async () => { await saveSettings(ctx, settings); };
    const mealsAll = () => settings.meals.map(m => ({ id: m.id, name: m.name }));

    // ---------- каркас ----------
    /** Полоска недели с выбранным днём: переход на любой день недели одним нажатием, в том числе вперёд (для плана). */
    function weekStrip() {
      const monday = shiftDay(state.date, -((parseDay(state.date).getDay() + 6) % 7));
      return h('div', { class: 'nut-week' }, [0, 1, 2, 3, 4, 5, 6].map(i => {
        const k = shiftDay(monday, i), d = parseDay(k);
        return h('button', { type: 'button', class: 'nut-wd' + (k === state.date ? ' on' : '') + (k === dayKey() ? ' today' : '') + (k > dayKey() ? ' future' : '') + (k < dayKey() ? ' past' : ''), title: k > dayKey() ? ctx.t('Будущий день: можно запланировать блюда') : null, onClick: () => { state.date = k; render(); } },
          h('span', { class: 'muted small' }, raw(d.toLocaleDateString(ctx.locale, { weekday: 'short' }))), h('strong', null, raw(String(d.getDate()))));
      }));
    }

    /** Период недели выбранного дня: «2 – 8 нояб.». */
    function weekLabel() {
      const monday = shiftDay(state.date, -((parseDay(state.date).getDay() + 6) % 7));
      const f = k => parseDay(k).toLocaleDateString(ctx.locale, { day: 'numeric', month: 'short' });
      return `${f(monday)} – ${f(shiftDay(monday, 6))}`;
    }

    async function render() {
      const tab = (id, label) => h('button', { class: 'chip-btn' + (state.tab === id ? ' on' : ''), onClick: () => { state.tab = id; render(); } }, label);
      fill(page,
        h('header', { class: 'page-head' }, h('h1', null, 'Дневник питания'),
          h('div', { class: 'row-gap' },
            iconBtn('book', 'Мои блюда', () => openFoodsManager(ctx)),
            iconBtn('target', 'Норма калорий', () => openNorm({ ctx, settings, render })),
            iconBtn('sliders', 'Настройки дневника', openSettings))),
        h('div', { class: 'size-chips' }, tab('day', 'День'), tab('history', 'История')),
        state.tab === 'day' ? [
          // навигация по неделям: «Назад», «Сегодня», «Вперёд» листают недельную полоску; справа период недели и копирование дня
          h('div', { class: 'nut-daybar' },
            iconBtn('chevL', 'Предыдущая неделя', () => { state.date = shiftDay(state.date, -7); render(); }),
            h('button', { class: 'btn sm', onClick: () => { state.date = dayKey(); render(); } }, 'Сегодня'),
            iconBtn('chevR', 'Следующая неделя', () => { state.date = shiftDay(state.date, 7); render(); }),
            h('span', { class: 'muted small nut-weeklabel' }, raw(weekLabel())),
            h('span', { class: 'grow' }),
            iconBtn('copy', 'Копировать день', () => copyDay())),
          weekStrip(),
        ] : null,
        view);
      await renderView();
    }

    async function renderView() {
      if (state.tab === 'history') {
        view.replaceChildren(await renderHistory({ ctx, settings, state, redraw: render }));
        return;
      }
      const [log, water, pills, pillLog, note, suggestion, fasts, activity] = await Promise.all([
        listLog(ctx), getWater(ctx, state.date), listPills(ctx), listPillLog(ctx), getNote(ctx, state.date), normSuggestion(ctx, settings), listFasts(ctx), readActivity(ctx),
      ]);
      allLog = log;
      const day = log.filter(x => x.date === state.date);
      const blocks = [];
      for (const s of settings.sections) {
        if (!s.on) continue;
        if (s.id === 'summary') blocks.push(summaryCard(day, suggestion, activity));
        else if (s.id === 'meals') blocks.push(mealsBlock(day, note));
        else if (s.id === 'water') blocks.push(waterCard(water));
        else if (s.id === 'pills') blocks.push(pillsCard({ ctx, date: state.date, render }, pills, pillLog));
        else if (s.id === 'fast') blocks.push(fastCard(fasts));
        else if (s.id === 'note') blocks.push(noteCard(note));
      }
      fill(view, blocks.length ? blocks : [h('p', { class: 'muted' }, 'Все разделы отключены в настройках.')]);
    }

    // ---------- сводка КБЖУ ----------
    function ring(frac, over) {
      const R = 44, C = 2 * Math.PI * R;
      const el = svg('svg', { viewBox: '0 0 110 110', class: 'nut-ring-svg', 'aria-hidden': 'true' });
      el.append(svg('circle', { cx: 55, cy: 55, r: R, class: 'ring-bg' }), svg('circle', { cx: 55, cy: 55, r: R, class: 'ring-fg' + (over ? ' over' : ''), 'stroke-dasharray': `${Math.min(1, frac) * C} ${C}`, transform: 'rotate(-90 55 55)' }));
      return el;
    }

    function summaryCard(day, suggestion, activity) {
      const t = sumNutrients(eaten(day));
      const plan = sumNutrients(day.filter(x => x.planned));
      const bonus = trainingBonus(settings, activity, state.date);
      const g = { ...settings.goals, kcal: settings.goals.kcal + bonus, cb: settings.goals.cb + Math.round(bonus / 4) }; // добавка за тренировку идёт в углеводы
      const left = g.kcal - t.kcal;
      const extra = extrasText(ctx, t);
      return h('section', { class: 'card nut-sum' },
        suggestion ? h('div', { class: 'nut-banner' },
          h('span', { class: 'grow' }, raw(ctx.t('Новая норма по данным тела: {n} ккал (сейчас {old}).', { n: suggestion.kcal, old: settings.goals.kcal }))),
          h('button', { class: 'btn sm primary', onClick: async () => { await applyNorm(ctx, settings, suggestion, suggestion.kg); render(); } }, 'Принять'),
          h('button', { class: 'btn sm', onClick: async () => { settings.norm.dismissed = dayKey(); await persist(); render(); } }, 'Позже')) : null,
        h('div', { class: 'nut-sum-top' },
          h('div', { class: 'nut-ring' }, ring(g.kcal ? t.kcal / g.kcal : 0, left < 0),
            h('div', { class: 'nut-ring-text' }, h('strong', null, raw(String(Math.abs(Math.round(left))))), h('span', { class: 'muted small' }, raw(ctx.t(left >= 0 ? 'осталось' : 'сверх нормы'))))),
          h('div', { class: 'nut-sum-info' },
            h('div', { class: 'nut-kcal-val' }, raw(String(Math.round(t.kcal))), h('span', { class: 'muted' }, raw(` / ${g.kcal} ${ctx.t('ккал')}`))),
            bonus ? h('span', { class: 'tag ok' }, raw(ctx.t('+{n} ккал за тренировку', { n: bonus }))) : null,
            plan.kcal > 0 ? h('span', { class: 'muted small' }, raw(ctx.t('В плане ещё {n} ккал', { n: Math.round(plan.kcal) }))) : null)),
        h('div', { class: 'nut-macros' }, MACROS.map(m => {
          const v = t[m.id], goal = g[m.id], mp = Math.min(100, goal ? (v / goal) * 100 : 0), rest = goal - v;
          return h('div', { class: 'nut-macro' },
            h('div', { class: 'nut-macro-head' }, h('span', null, m.name), h('strong', null, raw(`${fmt(ctx, v)}`), h('span', { class: 'muted' }, raw(` / ${goal} ${ctx.t('г')}`)))),
            h('div', { class: 'bar thin' }, h('i', { style: `width:${mp}%;background:${m.color}` })),
            h('span', { class: 'muted small' + (rest < 0 ? ' over' : '') }, raw(rest >= 0 ? ctx.t('ещё {n} г', { n: fmt(ctx, rest) }) : ctx.t('сверх на {n} г', { n: fmt(ctx, -rest) }))));
        })),
        extra ? h('span', { class: 'muted small' }, raw(extra)) : null);
    }

    // ---------- приёмы пищи ----------
    const baseOf = x => x.base ?? { name: x.name, unit: x.unit, kcal: x.kcal / x.amount * 100, p: x.p / x.amount * 100, f: x.f / x.amount * 100, cb: x.cb / x.amount * 100 };
    const macroText = x => `${ctx.t('Б')} ${fmt(ctx, x.p)} · ${ctx.t('Ж')} ${fmt(ctx, x.f)} · ${ctx.t('У')} ${fmt(ctx, x.cb)}`;
    /** Три цветные «таблетки» Б / Ж / У: у каждого макронутриента один цвет во всём модуле. */
    const macroPills = x => h('span', { class: 'mp-row' }, MACROS.map(m => h('span', { class: 'mp mp-' + m.id, title: ctx.t(m.name) }, raw(`${ctx.t(m.short)} ${fmt(ctx, x[m.id] ?? 0)}`))));

    function mealsBlock(day, note) {
      const shown = settings.meals.filter(m => m.on || day.some(x => x.meal === m.id));
      const hidden = settings.meals.filter(m => !shown.includes(m));
      const known = new Set(settings.meals.map(m => m.id));
      const orphan = [...new Set(day.filter(x => !known.has(x.meal)).map(x => x.meal))]; // приём удалён, а записи остались
      return h('section', { class: 'nut-meals' },
        h('h2', { class: 'nut-h' }, 'Приёмы пищи'),
        ...shown.map(m => mealCard(m, day.filter(x => x.meal === m.id), note)),
        ...orphan.map(id => mealCard({ id, name: 'Другое', on: true, orphan: true }, day.filter(x => x.meal === id), note)),
        h('div', { class: 'row-gap wrap' },
          ...hidden.map(m => h('button', { class: 'chip-btn', onClick: async () => { m.on = true; await persist(); render(); } }, raw('+ ' + ctx.t(m.name)))),
          h('button', { class: 'chip-btn', onClick: addCustomMeal }, icon('plus', 14), 'Свой приём')));
    }

    /** Правка блюда по нажатию на строку: количество, перенос в другой приём, удаление. */
    function editItem(x, after) {
      if (x.quick) openQuickAdd(ctx, { rec: x, meals: mealsAll(), onDone: after });
      else openAmount(ctx, baseOf(x), { rec: x, meals: mealsAll(), onDone: after });
    }

    /** Блюдо внутри приёма — отдельная карточка: название, количество, цветные Б / Ж / У и калории справа. Нажатие — правка, галочка у запланированного — «съел», корзина (при наведении) — удалить с отменой. */
    function itemRow(x, after) {
      const extra = extrasText(ctx, x, ['fib', 'sug', 'na']);
      const info = x.quick ? ctx.t('быстрое добавление') : `${fmt(ctx, x.amount)} ${ctx.t(x.unit === 'ml' ? 'мл' : 'г')}`;
      return h('div', { class: 'nut-item' + (x.planned ? ' planned' : '') },
        h('button', { type: 'button', class: 'nut-item-main grow', title: 'Изменить', onClick: () => editItem(x, after) },
          h('span', { class: 'ni-name' }, raw(x.name || ctx.t('Быстрое добавление')), x.planned ? h('span', { class: 'tag' }, 'в плане') : null),
          h('span', { class: 'ni-sub muted small' }, raw(extra ? `${info} · ${extra}` : info)),
          macroPills(x)),
        h('div', { class: 'ni-kcal' }, h('strong', null, raw(`${x.kcal}`)), h('span', { class: 'muted small' }, raw(ctx.t('ккал')))),
        x.planned ? iconBtn('check', 'Отметить съеденным', async () => { const { planned, ...rest } = x; await putLog(ctx, rest); after(); }, 'ok') : null,
        iconBtn('trash', 'Удалить', () => removeWithUndo(ctx, 'log', x, 'Блюдо удалено', after), 'danger row-del'));
    }

    function mealCard(meal, items, note) {
      const done = eaten(items), t = sumNutrients(done);
      const planned = items.filter(x => x.planned);
      const folded = settings.collapsed.includes(meal.id) && items.length > 0;
      const toggle = async () => {
        settings.collapsed = folded ? settings.collapsed.filter(id => id !== meal.id) : [...settings.collapsed, meal.id];
        await persist();
        render();
      };
      const share = settings.goals.kcal ? Math.round((t.kcal / settings.goals.kcal) * 100) : 0;
      const yesterday = !items.length ? allLog.filter(x => x.date === shiftDay(state.date, -1) && x.meal === meal.id && !x.planned) : [];
      const text = note?.meals?.[meal.id];
      const markAll = async () => { for (const x of planned) { const { planned: _p, ...rest } = x; await putLog(ctx, rest); } render(); };
      return h('div', { class: 'card nut-meal' },
        h('div', { class: 'nut-meal-head' },
          items.length ? iconBtn(folded ? 'chevR' : 'chevD', folded ? 'Развернуть' : 'Свернуть', toggle) : h('span', { class: 'nut-chev-gap' }),
          h('button', { class: 'nut-meal-title grow', title: 'Открыть приём', onClick: () => openMealDetail(meal) },
            h('strong', null, raw(ctx.t(meal.name))),
            items.length
              ? h('span', { class: 'nut-meal-sub' },
                h('strong', { class: 'nm-kcal' }, raw(String(Math.round(t.kcal))), h('span', { class: 'muted small' }, raw(' ' + ctx.t('ккал')))),
                macroPills(t),
                h('span', { class: 'muted small' }, raw(`${ctx.t('Блюд: {n}', { n: items.length })}${done.length ? ` · ${share} % ${ctx.t('нормы')}` : ''}${planned.length ? ` · ${ctx.t('в плане: {n}', { n: planned.length })}` : ''}`)))
              : h('span', { class: 'muted small block' }, ctx.t('Пока пусто')),
            text ? h('span', { class: 'nut-notetext small block' }, raw(text)) : null),
          meal.orphan ? null : iconBtn('edit', 'Изменить приём', () => editMeal(meal)),
          iconBtn('plus', 'Добавить блюдо', () => openPicker(ctx, { date: state.date, meal: meal.id, mealName: meal.name, meals: mealsAll(), onDone: render }))),
        yesterday.length || planned.length ? h('div', { class: 'row-gap wrap' },
          yesterday.length ? h('button', { class: 'chip-btn', onClick: async () => { await copyEntries(ctx, yesterday, state.date); toast(ctx.t('Скопировано блюд: {n}', { n: yesterday.length })); render(); } }, icon('copy', 12), ctx.t('Как вчера ({n})', { n: yesterday.length })) : null,
          planned.length ? h('button', { class: 'chip-btn', onClick: markAll }, icon('check', 12), ctx.t('Всё съедено ({n})', { n: planned.length })) : null) : null,
        items.length && !folded ? h('div', { class: 'nut-items' }, items.slice().sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).map(x => itemRow(x, render))) : null);
    }

    /** Отдельное окно приёма: итоги, все блюда, заметка, добавление, шаблон, копирование. */
    function openMealDetail(meal) {
      const body = h('div', { class: 'form nut-detail' });
      const refresh = async () => { await render(); draw(); };
      const draw = async () => {
        const [log, note] = await Promise.all([listLog(ctx), getNote(ctx, state.date)]);
        const items = log.filter(x => x.date === state.date && x.meal === meal.id).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        const t = sumNutrients(eaten(items));
        const g = settings.goals;
        const ta = h('textarea', { class: 'input', rows: '2', placeholder: 'Заметка к приёму: самочувствие, где ели, что чувствовали…', maxlength: '500' }, raw(note.meals?.[meal.id] ?? ''));
        ta.addEventListener('change', async () => {
          const n = await getNote(ctx, state.date);
          n.meals = { ...(n.meals ?? {}), [meal.id]: ta.value.trim() };
          if (!n.meals[meal.id]) delete n.meals[meal.id];
          await putNote(ctx, n);
          render();
        });
        const share = g.kcal ? Math.round((t.kcal / g.kcal) * 100) : 0;
        const add = () => openPicker(ctx, { date: state.date, meal: meal.id, mealName: meal.name, meals: mealsAll(), onDone: refresh });
        fill(body,
          // 1) итог приёма: главное число и доля дневной нормы
          h('div', { class: 'nut-hero' },
            h('span', { class: 'muted small' }, raw(parseDay(state.date).toLocaleDateString(ctx.locale, { weekday: 'long', day: 'numeric', month: 'long' }))),
            h('div', { class: 'nut-hero-row' },
              h('div', { class: 'nut-hero-kcal' }, raw(String(Math.round(t.kcal))), h('span', { class: 'muted' }, raw(' ' + ctx.t('ккал')))),
              h('span', { class: 'tag' }, raw(`${share} % ${ctx.t('дневной нормы')}`))),
            h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, share)}%` }))),
          // 2) белки, жиры, углеводы — три цветных плитки
          h('div', { class: 'nut-mtiles' }, MACROS.map(m => {
            const v = t[m.id], goal = g[m.id], pct = goal ? Math.round((v / goal) * 100) : 0;
            return h('div', { class: 'nut-mtile mt-' + m.id },
              h('span', { class: 'mt-name' }, h('i', { class: 'mt-dot' }), raw(ctx.t(m.name))),
              h('strong', { class: 'mt-val' }, raw(fmt(ctx, v)), h('span', { class: 'mt-unit' }, raw(' ' + ctx.t('г')))),
              h('div', { class: 'bar thin' }, h('i', { style: `width:${Math.min(100, pct)}%;background:${m.color}` })),
              h('span', { class: 'muted small' }, raw(`${pct} % ${ctx.t('нормы')}`)));
          })),
          // 3) блюда: каждое — отдельная карточка
          h('div', { class: 'nut-secthead' }, h('h3', null, raw(ctx.t('Блюда: {n}', { n: items.length }))),
            h('button', { class: 'btn sm primary', onClick: add }, icon('plus', 14), 'Добавить блюдо')),
          items.length ? h('div', { class: 'nut-items flat' }, items.map(x => itemRow(x, refresh))) : h('div', { class: 'nut-empty' }, 'В этом приёме пока нет блюд.'),
          h('div', { class: 'row-gap wrap nut-tools' },
            items.length ? h('button', { class: 'btn sm', onClick: () => saveTemplate(meal, items) }, icon('bookmark', 14), 'Сохранить как шаблон') : null,
            items.length ? h('button', { class: 'btn sm', onClick: () => openCopy({ items, mealId: meal.id, title: ctx.t('Копировать «{meal}»', { meal: ctx.t(meal.name) }) }) }, icon('copy', 14), 'Копировать…') : null,
            meal.orphan ? null : h('button', { class: 'btn sm', onClick: () => { m.close(); editMeal(meal); } }, icon('edit', 14), 'Изменить приём')),
          // 4) заметка
          h('div', { class: 'nut-secthead' }, h('h3', null, 'Заметка')), ta);
      };
      const m = modal({ title: ctx.t(meal.name), wide: true, body });
      draw();
    }

    // ---------- шаблоны приёмов ----------
    function saveTemplate(meal, items) {
      const input = h('input', { class: 'input', value: ctx.t(meal.name), maxlength: '60' });
      const m = modal({
        title: 'Сохранить как шаблон',
        body: h('div', { class: 'form' }, h('p', { class: 'muted small' }, ctx.t('Все блюда приёма ({n}) сохранятся как шаблон: потом их можно добавить в любой приём одним нажатием.', { n: items.length })), input),
        actions: [h('button', { class: 'btn primary', onClick: async () => {
          const name = input.value.trim();
          if (!name) return toast('Введите название');
          await putTemplate(ctx, templateFrom(name, items.filter(x => !x.planned)));
          m.close();
          toast('Шаблон сохранён');
        } }, 'Сохранить')],
      });
      input.focus();
      input.select();
    }

    // ---------- копирование ----------
    /** Копирование блюд на другую дату (и в другой приём, если задан mealId). На будущие даты блюда попадают в план. */
    function openCopy({ items, mealId, title }) {
      const today = dayKey();
      let date = state.date === today ? shiftDay(today, 1) : today;
      let meal = mealId;
      const input = h('input', { class: 'input', type: 'date', value: date });
      input.addEventListener('change', () => { if (input.value) { date = input.value; drawChips(); } });
      const quick = h('div', { class: 'size-chips' });
      const mealsBox = h('div', { class: 'size-chips' });
      const drawChips = () => {
        fill(quick, [[0, 'Сегодня'], [1, 'Завтра'], [-1, 'Вчера']].map(([n, label]) => h('button', { type: 'button', class: 'chip-btn' + (date === shiftDay(today, n) ? ' on' : ''), onClick: () => { date = shiftDay(today, n); input.value = date; drawChips(); } }, label)));
        if (mealId) fill(mealsBox, settings.meals.map(mm => h('button', { type: 'button', class: 'chip-btn' + (meal === mm.id ? ' on' : ''), onClick: () => { meal = mm.id; drawChips(); } }, raw(ctx.t(mm.name)))));
      };
      const go = async () => {
        if (!date) return toast('Укажите дату');
        if (date === state.date && (!mealId || meal === mealId)) {
          if (!(await confirmDialog(ctx.t('Блюда будут добавлены в тот же приём этого дня. Продолжить?'), { okText: 'Копировать' }))) return;
        }
        const n = await copyEntries(ctx, items.filter(x => !x.planned || date !== state.date), date, mealId ? meal : undefined);
        m.close();
        toast(date > today ? ctx.t('Добавлено в план: {n}', { n }) : ctx.t('Скопировано блюд: {n}', { n }));
        render();
      };
      const m = modal({
        title,
        body: h('div', { class: 'form' },
          h('span', { class: 'nf-sub' }, 'Дата'), quick, input,
          mealId ? h('span', { class: 'nf-sub' }, 'В приём') : null, mealId ? mealsBox : null,
          h('p', { class: 'muted small' }, 'Копирование на будущую дату добавляет блюда в план: в итоги они попадут, когда вы отметите их съеденными.')),
        actions: [h('button', { class: 'btn primary', onClick: go }, icon('copy', 16), 'Копировать')],
      });
      drawChips();
    }

    function copyDay() {
      const items = allLog.filter(x => x.date === state.date && !x.planned);
      if (!items.length) return toast('В этом дне нет блюд');
      openCopy({ items, title: ctx.t('Копировать день ({n})', { n: items.length }) });
    }

    function addCustomMeal() {
      const input = h('input', { class: 'input', placeholder: 'Название приёма', maxlength: '30' });
      const m = modal({
        title: 'Свой приём пищи',
        body: h('div', { class: 'form' }, input),
        actions: [h('button', { class: 'btn primary', onClick: add }, 'Добавить')],
      });
      input.focus();
      input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
      async function add() {
        const name = input.value.trim();
        if (!name) return toast('Введите название');
        settings.meals.push({ id: 'c' + Date.now().toString(36), name, on: true, custom: true });
        await persist();
        m.close();
        render();
      }
    }

    function editMeal(meal) {
      const input = h('input', { class: 'input', value: ctx.t(meal.name), maxlength: '30' });
      const m = modal({
        title: 'Приём пищи',
        body: h('div', { class: 'form' }, input,
          h('p', { class: 'muted small' }, 'Скрытый приём можно вернуть кнопкой под списком. Записи в нём сохраняются.')),
        actions: [
          meal.custom ? h('button', { class: 'btn danger', onClick: async () => {
            const was = settings.meals.slice();
            settings.meals = settings.meals.filter(x => x.id !== meal.id);
            await persist(); m.close(); render();
            toast(ctx.t('Приём «{name}» удалён: записи остались в журнале', { name: ctx.t(meal.name) }), { action: 'Отменить', onAction: async () => { settings.meals = was; await persist(); render(); } });
          } }, 'Удалить') : h('button', { class: 'btn', onClick: async () => { meal.on = false; await persist(); m.close(); render(); } }, 'Скрыть'),
          h('button', { class: 'btn primary', onClick: async () => {
            const name = input.value.trim();
            if (!name) return toast('Введите название');
            if (name !== ctx.t(meal.name)) meal.name = name;
            await persist(); m.close(); render();
          } }, 'Сохранить'),
        ],
      });
      input.focus();
      input.select();
    }

    // ---------- заметка дня ----------
    function noteCard(note) {
      const ta = h('textarea', { class: 'input', rows: '3', placeholder: 'Как прошёл день: самочувствие, голод, что хочется запомнить…', maxlength: '1000' }, raw(note.text ?? ''));
      let timer = 0;
      const save = async () => {
        clearTimeout(timer);
        const n = await getNote(ctx, state.date);
        if ((n.text ?? '') === ta.value.trim()) return;
        n.text = ta.value.trim();
        await putNote(ctx, n);
      };
      ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 600); });
      ta.addEventListener('blur', save);
      return h('section', { class: 'card nut-note' }, h('strong', null, 'Заметка дня'), ta);
    }

    // ---------- вода ----------
    function waterCard(water) {
      const { goal, unit } = settings.water;
      const pct = Math.min(100, goal ? (water.ml / goal) * 100 : 0);
      const add = async ml => { await addWater(ctx, state.date, ml); render(); };
      const toMl = v => (unit === 'ml' ? v : unit === 'l' ? v * 1000 : v * settings.water.cup);
      const stepLabel = s => `+${fmt(ctx, s)} ${ctx.t(unit === 'cup' ? (s === 1 ? 'кружка' : 'кружки') : WATER_UNITS[unit])}`;
      const removeAt = async i => {
        const prev = await removeWaterAt(ctx, state.date, i);
        render();
        toast('Порция удалена', { action: 'Отменить', onAction: async () => { await restoreWater(ctx, prev); render(); } });
      };
      let custom = '';
      const input = numField(ctx, { value: '', ph: '0', onInput: v => { custom = v; } });
      const addCustom = () => {
        const v = num(custom);
        if (v == null || v <= 0 || toMl(v) > 5000) return toast('Укажите количество');
        add(Math.round(toMl(v)));
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') addCustom(); });
      const timeOf = ts => new Date(ts).toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' });
      return h('section', { class: 'card nut-water' },
        h('div', { class: 'nut-sec-head' }, icon('drop', 20), h('strong', { class: 'grow' }, 'Вода'),
          iconBtn('undo', 'Отменить последнюю порцию', () => removeAt(water.items.length - 1), water.items.length ? '' : 'off')),
        h('div', { class: 'nut-kcal-val' }, raw(fmtWater(ctx, water.ml, settings)), h('span', { class: 'muted' }, raw(` / ${fmtWater(ctx, goal, settings)}`))),
        h('div', { class: 'bar' + (water.ml >= goal ? ' done' : '') }, h('i', { style: `width:${pct}%` })),
        h('div', { class: 'row-gap wrap' },
          WATER_STEPS[unit].map(s => h('button', { class: 'btn sm', onClick: () => add(Math.round(toMl(s))) }, stepLabel(s))),
          h('span', { class: 'nut-water-custom' }, input, h('span', { class: 'muted small' }, WATER_UNITS[unit]),
            iconBtn('plus', 'Добавить', addCustom))),
        water.items.length ? h('div', { class: 'row-gap wrap nut-portions' }, water.items.map((it, i) =>
          h('button', { type: 'button', class: 'chip-btn', title: 'Убрать порцию', onClick: () => removeAt(i) }, raw(`${timeOf(it.ts)} · ${fmtWater(ctx, it.ml, settings)}`)))) : null);
    }

    // ---------- голодание ----------
    function fastCard(fasts) {
      const act = activeFast(fasts);
      const goal = act?.goal ?? settings.fasting.goal;
      const fmtDt = ms => new Date(ms).toLocaleString(ctx.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const head = h('div', { class: 'nut-sec-head' }, icon('timer', 20), h('strong', { class: 'grow' }, 'Голодание'));
      if (act) {
        const elapsed = Date.now() - act.start;
        return h('section', { class: 'card nut-fast' }, head,
          h('div', { class: 'nut-kcal-val nut-fast-live', 'data-start': String(act.start), 'data-goal': String(goal) },
            h('span', { class: 'nut-fast-time' }, raw(fmtDuration(elapsed, ctx.t))), h('span', { class: 'muted' }, raw(` / ${goal} ${ctx.t('ч')}`))),
          h('div', { class: 'bar nut-fast-bar' + (elapsed >= goal * 3_600_000 ? ' done' : '') }, h('i', { style: `width:${Math.min(100, (elapsed / (goal * 3_600_000)) * 100)}%` })),
          h('span', { class: 'muted small' }, raw(ctx.t('Начало: {t}', { t: fmtDt(act.start) }))),
          h('div', { class: 'row-gap wrap' },
            h('button', { class: 'btn primary', onClick: async () => { await putFast(ctx, { ...act, end: Date.now() }); render(); } }, icon('check', 16), 'Завершить'),
            h('button', { class: 'btn', onClick: () => editFastStart(act) }, icon('edit', 16), 'Изменить начало'),
            h('button', { class: 'btn', onClick: () => removeWithUndo(ctx, 'fasts', act, 'Голодание отменено', render) }, 'Отменить')));
      }
      const last = fasts.filter(f => f.end);
      return h('section', { class: 'card nut-fast' }, head,
        h('span', { class: 'muted small' }, 'Выберите протокол и начните: приложение покажет, сколько прошло, и напомнит о цели.'),
        h('div', { class: 'size-chips' }, FAST_PROTOCOLS.map(p => h('button', { type: 'button', class: 'chip-btn' + (settings.fasting.goal === p ? ' on' : ''), onClick: async () => { settings.fasting.goal = p; await persist(); render(); } }, raw(`${p} ${ctx.t('ч')}`)))),
        h('button', { class: 'btn primary', onClick: async () => { await putFast(ctx, { start: Date.now(), end: null, goal: settings.fasting.goal }); render(); } }, icon('timer', 16), ctx.t('Начать голодание на {n} ч', { n: settings.fasting.goal })),
        last.length ? h('div', { class: 'nut-fast-list' }, last.slice(0, 4).map(f => {
          const dur = f.end - f.start, ok = dur >= f.goal * 3_600_000;
          return h('div', { class: 'nut-fast-row' },
            h('span', { class: 'grow' }, h('strong', null, raw(fmtDuration(dur, ctx.t))), h('span', { class: 'muted small block' }, raw(`${fmtDt(f.start)} · ${ctx.t('цель')} ${f.goal} ${ctx.t('ч')}`))),
            icon(ok ? 'check' : 'flag', 16),
            iconBtn('trash', 'Удалить', () => removeWithUndo(ctx, 'fasts', f, 'Запись удалена', render), 'danger'));
        })) : null);
    }

    function editFastStart(act) {
      const input = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(act.start), max: toLocalInput(Date.now()) });
      const m = modal({
        title: 'Начало голодания',
        body: h('div', { class: 'form' }, input),
        actions: [h('button', { class: 'btn primary', onClick: async () => {
          const ts = new Date(input.value).getTime();
          if (!Number.isFinite(ts) || ts > Date.now()) return toast('Укажите дату и время');
          await putFast(ctx, { ...act, start: ts });
          m.close();
          render();
        } }, 'Сохранить')],
      });
    }

    // ---------- настройки ----------
    function openSettings() {
      const check = (checked, label, onChange) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = checked;
        cb.addEventListener('change', () => onChange(cb.checked));
        return h('label', { class: 'check' }, cb, h('span', null, label));
      };
      const col = h('div', { class: 'nut-set' });
      const draw = () => {
        const sections = settings.sections;
        const move = (i, d) => { const j = i + d; if (j < 0 || j >= sections.length) return; [sections[i], sections[j]] = [sections[j], sections[i]]; persist(); draw(); render(); };
        const goal = (key, label, range) => h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, label),
          numField(ctx, { value: String(settings.goals[key]), range, int: true, onInput: v => { const n = num(v); if (inRange(n, range)) { settings.goals[key] = Math.round(n); persist(); render(); } } }));
        const w = settings.water;
        const toUnit = ml => (w.unit === 'l' ? ml / 1000 : w.unit === 'cup' ? ml / w.cup : ml);
        const fromUnit = v => (w.unit === 'l' ? v * 1000 : w.unit === 'cup' ? v * w.cup : v);
        const time = (key, label) => {
          const i = h('input', { class: 'input time', type: 'time', value: w[key] });
          i.addEventListener('change', () => { if (i.value) { w[key] = i.value; persist(); } });
          return h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, label), i);
        };
        fill(col,
          h('div', { class: 'nut-col' },
            h('div', { class: 'nut-colhead' }, 'Разделы главной'),
            h('p', { class: 'muted small' }, 'Включайте нужные разделы и меняйте их порядок стрелками.'),
            ...sections.map((s, i) => h('div', { class: 'nut-sec-row' },
              check(s.on, SECTION_NAMES[s.id], on => { s.on = on; persist(); render(); }),
              h('span', { class: 'grow' }),
              iconBtn('chevU', 'Выше', () => move(i, -1), i === 0 ? 'off' : ''),
              iconBtn('chevD', 'Ниже', () => move(i, 1), i === sections.length - 1 ? 'off' : ''))),
            h('div', { class: 'nut-colhead' }, 'Приёмы пищи'),
            h('p', { class: 'muted small' }, 'Выбранные приёмы показываются в списке всегда. Остальные можно добавить на день кнопкой под списком.'),
            ...settings.meals.map(m => check(m.on, ctx.t(m.name), on => { m.on = on; persist(); render(); }))),
          h('div', { class: 'nut-col' },
            h('div', { class: 'nut-colhead' }, 'Дневная норма'),
            h('div', { class: 'nf-grid' }, goal('kcal', 'Калории, ккал', LIMITS.goalKcal), goal('p', 'Белки, г', LIMITS.goalMacro), goal('f', 'Жиры, г', LIMITS.goalMacro), goal('cb', 'Углеводы, г', LIMITS.goalMacro)),
            h('button', { class: 'btn', onClick: () => openNorm({ ctx, settings, render: () => { render(); draw(); } }) }, icon('target', 16), 'Рассчитать по данным тела'),
            h('p', { class: 'muted small' }, 'Расчёт использует пол и возраст из профиля, рост и вес из «Мониторинга», активность и цель из этого окна. Без них норма вводится вручную.')),
          h('div', { class: 'nut-col' },
            h('div', { class: 'nut-colhead' }, 'Вода'),
            h('span', { class: 'muted small' }, 'Единицы'),
            h('div', { class: 'size-chips' }, Object.keys(WATER_UNITS).map(u => h('button', { class: 'chip-btn' + (w.unit === u ? ' on' : ''), onClick: () => { w.unit = u; persist(); draw(); render(); } }, u === 'ml' ? 'Миллилитры' : u === 'l' ? 'Литры' : 'Кружки'))),
            h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, ctx.t('Норма на день, {u}', { u: ctx.t(WATER_UNITS[w.unit]) })),
              numField(ctx, { value: String(round1(toUnit(w.goal))).replace('.', ','), onInput: v => { const n = num(v); const ml = n == null ? null : fromUnit(n); if (inRange(ml, LIMITS.waterGoal)) { w.goal = Math.round(ml); persist(); render(); } } })),
            h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Объём кружки, мл'),
              numField(ctx, { value: String(w.cup), range: LIMITS.cup, int: true, onInput: v => { const n = num(v); if (inRange(n, LIMITS.cup)) { w.cup = Math.round(n); persist(); render(); } } })),
            h('div', { class: 'nut-colhead' }, 'Напоминания'),
            h('p', { class: 'muted small' }, 'Параметры напоминания о воде. Включить и выключить напоминания (вода, таблетки, голодание) можно в «Профиль → Напоминания».'),
            h('div', { class: 'nf-grid' },
              h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Каждые, мин'), numField(ctx, { value: String(w.every), range: LIMITS.every, int: true, onInput: v => { const n = num(v); if (inRange(n, LIMITS.every)) { w.every = Math.round(n); persist(); } } })),
              time('from', 'С'), time('to', 'До')),
            h('button', { class: 'btn', onClick: () => ctx.openProfile('reminders') }, icon('sliders', 16), 'Напоминания…')));
      };
      modal({ title: 'Настройки дневника', wide: true, body: col });
      draw();
    }

    // ---------- тик для голодания: обновляем время на карточке без перерисовки ----------
    const fastTimer = setInterval(() => {
      const el = view.querySelector('.nut-fast-live');
      if (!el) return;
      const start = Number(el.dataset.start), goal = Number(el.dataset.goal), elapsed = Date.now() - start;
      const t = el.querySelector('.nut-fast-time');
      if (t) t.textContent = fmtDuration(elapsed, ctx.t);
      const bar = view.querySelector('.nut-fast-bar');
      if (bar) { bar.classList.toggle('done', elapsed >= goal * 3_600_000); bar.firstElementChild.style.width = `${Math.min(100, (elapsed / (goal * 3_600_000)) * 100)}%`; }
    }, 30_000);

    await render();
    return () => clearInterval(fastTimer);
  },

  // ---------- напоминания (включаются в «Профиль → Напоминания»; вызывает ядро, даже если страница модуля закрыта) ----------
  reminders: {
    async check(ctx, { now, on }) {
      const out = [];
      const d = new Date(now), today = dayKey(d);
      const settings = await getSettings(ctx);
      if (on.pills) {
        const [pills, pillLog] = await Promise.all([listPills(ctx), listPillLog(ctx)]);
        for (const p of pills) {
          for (const s of pillDay(p, today, logsOfDay(pillLog, p.id, today), now).slots) {
            if (s.status === 'due' && now - s.ts < 3 * 3_600_000) out.push({ key: `pill-${p.id}-${today}-${s.time}`, text: ctx.t('Пора принять: {name} ({time})', { name: p.name, time: s.time }) });
          }
        }
      }
      if (on.water) {
        const w = settings.water;
        const mins = t => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
        const cur = d.getHours() * 60 + d.getMinutes();
        if (cur >= mins(w.from) && cur <= mins(w.to)) {
          const rec = await getWater(ctx, today);
          const last = Math.max(rec.items.at(-1)?.ts ?? 0, parseDay(today).getTime() + mins(w.from) * 60_000);
          if (rec.ml < w.goal && now - last >= w.every * 60_000) out.push({ key: `water-${Math.floor(now / (w.every * 60_000))}`, text: ctx.t('Пора выпить воды') });
        }
      }
      if (on.fasting) {
        const act = activeFast(await listFasts(ctx));
        if (act && now - act.start >= act.goal * 3_600_000) out.push({ key: `fast-${act.id}`, text: ctx.t('Голодание: цель {n} ч достигнута', { n: act.goal }) });
      }
      return out;
    },
  },

  // ---------- виджеты для Хаба ----------
  widgets: [
    {
      id: 'kcal',
      async render(body, ctx) {
        const { h } = ctx.ui;
        const settings = await getSettings(ctx);
        const activity = await readActivity(ctx);
        const t = sumNutrients(eaten((await listLog(ctx)).filter(x => x.date === dayKey())));
        const goal = settings.goals.kcal + trainingBonus(settings, activity, dayKey());
        body.onclick = () => ctx.router.go('nutrition');
        const pct = Math.min(100, goal ? (t.kcal / goal) * 100 : 0);
        fill(body,
          h('div', { class: 'big-num' }, String(Math.round(t.kcal)), h('span', { class: 'muted' }, ctx.t('из {n} ккал', { n: goal }))),
          h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
          ctx.size.w >= 2 ? h('span', { class: 'muted small' }, `${ctx.t('Б')} ${fmt(ctx, t.p)} · ${ctx.t('Ж')} ${fmt(ctx, t.f)} · ${ctx.t('У')} ${fmt(ctx, t.cb)}`) : null);
      },
    },
    {
      id: 'water',
      async render(body, ctx) {
        const { h } = ctx.ui;
        const settings = await getSettings(ctx);
        const w = await getWater(ctx, dayKey());
        body.onclick = () => ctx.router.go('nutrition');
        const pct = Math.min(100, settings.water.goal ? (w.ml / settings.water.goal) * 100 : 0);
        fill(body,
          h('div', { class: 'big-num' }, fmtWater(ctx, w.ml, settings), h('span', { class: 'muted' }, ctx.t('из {n}', { n: fmtWater(ctx, settings.water.goal, settings) }))),
          h('div', { class: 'bar' + (w.ml >= settings.water.goal ? ' done' : '') }, h('i', { style: `width:${pct}%` })));
      },
    },
    {
      id: 'pills',
      async render(body, ctx) {
        const { h, raw } = ctx.ui;
        const today = dayKey();
        const [pills, pillLog] = await Promise.all([listPills(ctx), listPillLog(ctx)]);
        body.onclick = () => ctx.router.go('nutrition');
        const slots = pills.flatMap(p => pillDay(p, today, logsOfDay(pillLog, p.id, today)).slots.map(s => ({ ...s, name: p.name })));
        if (!slots.length) { fill(body, h('p', { class: 'muted' }, 'Таблетки по расписанию не заданы')); return; }
        const next = slots.filter(s => s.status !== 'done').sort((a, b) => a.ts - b.ts)[0];
        const done = slots.filter(s => s.status === 'done').length;
        fill(body,
          next ? h('div', { class: 'big-num' }, raw(next.time), h('span', { class: 'muted' }, raw(next.name))) : h('div', { class: 'big-num' }, raw('✓'), h('span', { class: 'muted' }, ctx.t('Все приняты'))),
          h('span', { class: 'muted small' }, ctx.t('Принято {a} из {b}', { a: done, b: slots.length })));
      },
    },
  ],
};
