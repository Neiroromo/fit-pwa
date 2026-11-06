// Вкладка «История»: калории и БЖУ по дням, вода, приём таблеток за период; таблица-двойник и выгрузка CSV.

import {
  dayKey, shiftDay, round1, listLog, listWater, listPills, listPillLog, listFasts, sumNutrients, pillDay, fmtDuration, DAY,
} from './data.js';
import { barChart, dayTable, downloadCsv } from './charts.js';
import { logsOfDay } from './pills.js';
import { fmt } from './foods.js';

export const PERIODS = [
  { days: 14, label: '2 нед' },
  { days: 30, label: '1 мес' },
  { days: 90, label: '3 мес' },
];
const COLORS = { kcal: '#3987e5', water: '#199e70', p: '#3987e5', f: '#d95926', cb: '#199e70' };

/** Собирает данные за последние days дней (включая сегодня), по дням подряд. */
export async function collectDays(ctx, days) {
  const [log, water, pills, pillLog, fasts] = await Promise.all([listLog(ctx), listWater(ctx), listPills(ctx), listPillLog(ctx), listFasts(ctx)]);
  const today = dayKey();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDay(today, -i);
    const items = log.filter(x => x.date === date && !x.planned); // запланированное в историю не входит
    const w = water.find(x => x.date === date);
    let planned = 0, done = 0;
    const per = {};
    for (const p of pills) {
      const { slots } = pillDay(p, date, logsOfDay(pillLog, p.id, date));
      const dn = slots.filter(s => s.status === 'done').length;
      // сегодня считаем только прошедшее время: будущие приёмы ещё не «пропущены»
      const due = slots.filter(s => s.status !== 'upcoming').length;
      planned += due; done += dn;
      per[p.id] = { planned: (per[p.id]?.planned ?? 0) + due, done: (per[p.id]?.done ?? 0) + dn };
    }
    out.push({ date, items, n: sumNutrients(items), has: items.length > 0, ml: w?.ml ?? null, planned, done, per });
  }
  return { days: out, log, pills, fasts };
}

export async function renderHistory(env) {
  const { ctx, settings, state, redraw } = env;
  const { h, icon, raw } = ctx.ui;
  const { days, pills, fasts } = await collectDays(ctx, state.period);
  const since = Date.now() - state.period * DAY;
  const doneFasts = fasts.filter(f => f.end && f.end >= since);
  const avgFast = doneFasts.length ? doneFasts.reduce((sum, f) => sum + (f.end - f.start), 0) / doneFasts.length : null;
  const logged = days.filter(d => d.has);
  const g = settings.goals;
  const avg = key => (logged.length ? logged.reduce((s, d) => s + d.n[key], 0) / logged.length : null);
  const waterDays = days.filter(d => d.ml != null);
  const avgWater = waterDays.length ? waterDays.reduce((s, d) => s + d.ml, 0) / waterDays.length : null;
  const planned = days.reduce((s, d) => s + d.planned, 0), done = days.reduce((s, d) => s + d.done, 0);
  const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString(ctx.locale, { day: 'numeric', month: 'long' });

  const periodBar = h('div', { class: 'nut-filters' },
    h('div', { class: 'size-chips' }, PERIODS.map(p => h('button', { class: 'chip-btn' + (state.period === p.days ? ' on' : ''), onClick: () => { state.period = p.days; redraw(); } }, p.label))),
    h('div', { class: 'row-gap' },
      h('div', { class: 'size-chips' },
        h('button', { class: 'chip-btn' + (state.hview === 'chart' ? ' on' : ''), onClick: () => { state.hview = 'chart'; redraw(); } }, 'Графики'),
        h('button', { class: 'chip-btn' + (state.hview === 'table' ? ' on' : ''), onClick: () => { state.hview = 'table'; redraw(); } }, 'Таблица')),
      h('button', { class: 'btn sm', title: 'Скачать записи за период в CSV', onClick: () => exportCsv(ctx, days, state.period) }, icon('download', 14), 'CSV')));

  if (!logged.length && !waterDays.length && !planned && avgFast == null) {
    return h('div', { class: 'nut-view' }, periodBar, h('p', { class: 'muted' }, 'За этот период данных пока нет.'));
  }

  const tile = (name, value, sub) => h('div', { class: 'nut-tile' }, h('span', { class: 'muted small' }, name), h('strong', null, raw(value)), sub ? h('span', { class: 'muted small' }, raw(sub)) : null);
  const tiles = h('div', { class: 'nut-tiles' },
    tile(ctx.t('Калории в день'), avg('kcal') != null ? `${Math.round(avg('kcal'))}` : '—', ctx.t('норма {n} ккал · дней с записями: {d}', { n: g.kcal, d: logged.length })),
    tile(ctx.t('Белки'), avg('p') != null ? `${fmt(ctx, avg('p'))} ${ctx.t('г')}` : '—', ctx.t('норма {n}', { n: g.p })),
    tile(ctx.t('Жиры'), avg('f') != null ? `${fmt(ctx, avg('f'))} ${ctx.t('г')}` : '—', ctx.t('норма {n}', { n: g.f })),
    tile(ctx.t('Углеводы'), avg('cb') != null ? `${fmt(ctx, avg('cb'))} ${ctx.t('г')}` : '—', ctx.t('норма {n}', { n: g.cb })),
    tile(ctx.t('Вода в день'), avgWater != null ? `${Math.round(avgWater)} ${ctx.t('мл')}` : '—', ctx.t('норма {n} мл', { n: settings.water.goal })),
    avgFast != null ? tile(ctx.t('Голодание'), fmtDuration(avgFast, ctx.t), ctx.t('в среднем, голоданий: {n}', { n: doneFasts.length })) : null,
    planned ? tile(ctx.t('Таблетки'), `${Math.round((done / planned) * 100)} %`, ctx.t('принято {a} из {b}', { a: done, b: planned })) : null);

  const body = [];
  if (state.hview === 'table') {
    body.push(dayTable(ctx, [...days].reverse().map(d => [fmtDay(d.date), d.has ? Math.round(d.n.kcal) : '—', d.has ? round1(d.n.p) : '—', d.has ? round1(d.n.f) : '—', d.has ? round1(d.n.cb) : '—', d.ml ?? '—', d.planned ? `${d.done}/${d.planned}` : '—']),
      [ctx.t('День'), ctx.t('Ккал'), ctx.t('Б'), ctx.t('Ж'), ctx.t('У'), ctx.t('Вода, мл'), ctx.t('Таблетки')]));
  } else {
    const kcalPts = days.map(d => ({ date: d.date, v: d.has ? Math.round(d.n.kcal) : null }));
    body.push(h('section', { class: 'card nut-hcard' }, h('strong', null, 'Калории по дням'),
      barChart(ctx, { points: kcalPts, goal: g.kcal, color: COLORS.kcal, fmt: v => `${v} ${ctx.t('ккал')}`, goalLabel: ctx.t('норма'), label: ctx.t('Калории по дням') })));

    // доля калорий от белков, жиров и углеводов (4 / 9 / 4 ккал на грамм)
    if (logged.length) {
      const e = { p: avg('p') * 4, f: avg('f') * 9, cb: avg('cb') * 4 };
      const tot = e.p + e.f + e.cb || 1;
      const parts = [['p', 'Белки'], ['f', 'Жиры'], ['cb', 'Углеводы']];
      body.push(h('section', { class: 'card nut-hcard' }, h('strong', null, 'Из чего калории'),
        h('div', { class: 'nut-share' }, parts.map(([k]) => h('i', { style: `width:${(e[k] / tot) * 100}%;background:${COLORS[k]}` }))),
        h('div', { class: 'nut-legend' }, parts.map(([k, n]) => h('span', null, h('i', { class: 'dot', style: `background:${COLORS[k]}` }), raw(`${ctx.t(n)} ${Math.round((e[k] / tot) * 100)} %`))))));
    }
    const fibAvg = logged.filter(d => d.n.fib > 0);
    const sugAvg = logged.filter(d => d.n.sug > 0);
    if (fibAvg.length || sugAvg.length) {
      body.push(h('section', { class: 'card nut-hcard' }, h('strong', null, 'Клетчатка и сахар'),
        h('span', { class: 'muted small' }, raw([
          fibAvg.length ? `${ctx.t('Клетчатка')}: ${fmt(ctx, fibAvg.reduce((s, d) => s + d.n.fib, 0) / fibAvg.length)} ${ctx.t('г в день')}` : null,
          sugAvg.length ? `${ctx.t('Сахар')}: ${fmt(ctx, sugAvg.reduce((s, d) => s + d.n.sug, 0) / sugAvg.length)} ${ctx.t('г в день')}` : null,
        ].filter(Boolean).join(' · ')))));
    }
    if (waterDays.length) {
      const wPts = days.map(d => ({ date: d.date, v: d.ml }));
      body.push(h('section', { class: 'card nut-hcard' }, h('strong', null, 'Вода по дням'),
        barChart(ctx, { points: wPts, goal: settings.water.goal, color: COLORS.water, fmt: v => `${v} ${ctx.t('мл')}`, goalLabel: ctx.t('норма'), label: ctx.t('Вода по дням') })));
    }
    if (planned) {
      body.push(h('section', { class: 'card nut-hcard' }, h('strong', null, 'Приём таблеток'),
        ...pills.map(p => {
          const a = days.reduce((s, d) => s + (d.per[p.id]?.planned ?? 0), 0), b = days.reduce((s, d) => s + (d.per[p.id]?.done ?? 0), 0);
          if (!a) return null;
          return h('div', { class: 'nut-adh' }, h('span', { class: 'grow' }, raw(p.name)), h('span', { class: 'muted small' }, raw(`${b} / ${a}`)),
            h('div', { class: 'bar thin nut-adh-bar' }, h('i', { style: `width:${(b / a) * 100}%` })), h('strong', null, raw(`${Math.round((b / a) * 100)} %`)));
        })));
    }
  }
  return h('div', { class: 'nut-view' }, periodBar, tiles, ...body);
}

function exportCsv(ctx, days, period) {
  const rows = [['date', 'meal', 'name', 'amount', 'unit', 'kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar']];
  for (const d of days) for (const x of d.items) rows.push([d.date, x.meal, x.name, x.amount, x.unit, x.kcal, x.p, x.f, x.cb, x.fib ?? '', x.sug ?? '']);
  if (rows.length === 1) return ctx.ui.toast('За этот период нет записей');
  downloadCsv(`nutrition-${dayKey()}-${period}d.csv`, rows);
}
