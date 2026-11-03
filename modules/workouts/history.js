// История тренировок: список выполненных, подробности по упражнениям и график максимального веса.

import { fmtClock, makeFmt } from './data.js';

const PERIODS = [
  { days: 30, label: '1 мес' },
  { days: 90, label: '3 мес' },
  { days: 182, label: '6 мес' },
  { days: 365, label: 'Год' },
];
const DAY = 86_400_000;
const keyOf = name => name.trim().toLowerCase();

/** Экран истории: список тренировок (новые сверху), по нажатию раскрывается состав. */
export async function openHistory(page, ctx, { onBack }) {
  const { h, icon, iconBtn } = ctx.ui;
  const { plural } = ctx;
  const fmt = makeFmt(ctx);
  const sessions = (await ctx.db.collection('sessions').list()).sort((a, b) => b.startedAt - a.startedAt);
  const all = sessions;
  let openId = null;

  const list = h('div', { class: 'wk-list' });

  function draw() {
    list.replaceChildren(...(sessions.length ? sessions.map(item) : [h('p', { class: 'muted empty' }, 'Нет выполненных тренировок')]));
  }

  function item(s) {
    const open = openId === s.id;
    const year = new Date(s.startedAt).getFullYear() !== new Date().getFullYear() ? ' ' + new Date(s.startedAt).getFullYear() : '';
    return h('div', { class: 'sess' + (open ? ' open' : '') },
      h('button', { class: 'sess-head', onClick: () => { openId = open ? null : s.id; draw(); } },
        h('span', { class: 'sess-date' }, h('strong', null, fmt.date(s.startedAt) + year), h('span', { class: 'muted small' }, fmt.weekday(s.startedAt))),
        h('span', { class: 'grow' }, h('span', null, ctx.ui.raw(s.name)),
          h('span', { class: 'muted small block' }, `${s.exercises.length} ${plural(s.exercises.length, 'упражнение', 'упражнения', 'упражнений')} · ${fmt.human(s.durationSec ?? 0)}`)),
        icon(open ? 'chevU' : 'chevD', 16)),
      open ? h('div', { class: 'sess-body' }, s.exercises.map(ex =>
        h('div', { class: 'sess-ex' },
          h('div', { class: 'sess-ex-head' },
            h('strong', { class: 'grow' }, ctx.ui.raw(ex.name)),
            iconBtn('chart', 'Динамика максимального веса', () => openChart(ctx, all, ex.name))),
          ex.comment ? h('span', { class: 'muted small block' }, ctx.ui.raw(ex.comment)) : null,
          h('div', { class: 'sess-sets' }, ex.sets.map((x, i) =>
            h('div', { class: 'sess-set' },
              h('span', { class: 'muted' }, x.kind === 'warmup' ? 'Разминка' : ctx.t('Сет {n}', { n: ex.sets.slice(0, i + 1).filter(y => y.kind === 'work').length })),
              h('span', null, fmt.set(x)),
              h('span', { class: 'muted small' }, x.restSec != null ? ctx.t('отдых {time}', { time: fmtClock(x.restSec) }) : '')))))))
        : null);
  }

  draw();
  page.replaceChildren(
    h('header', { class: 'page-head' }, h('div', { class: 'row-gap' }, iconBtn('chevL', 'Назад', onBack), h('h1', null, 'История'))),
    list);
}

/** Окно с графиком максимального рабочего веса в упражнении по выбранному периоду. */
function openChart(ctx, sessions, name) {
  const { h, modal, raw } = ctx.ui;
  const fmt = makeFmt(ctx);
  const key = keyOf(name);
  const points = [];
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (keyOf(ex.name) !== key) continue;
      const kgs = ex.sets.filter(x => x.kind === 'work').map(x => Number(x.kg) || 0);
      if (kgs.length) points.push({ t: s.startedAt, kg: Math.max(...kgs) });
    }
  }
  points.sort((a, b) => a.t - b.t);

  let period = PERIODS[1];
  const chips = h('div', { class: 'size-chips' });
  const box = h('div', { class: 'chart-box' });

  function draw() {
    chips.replaceChildren(...PERIODS.map(p => h('button', { class: 'chip-btn' + (p === period ? ' on' : ''), onClick: () => { period = p; draw(); } }, p.label)));
    const to = Date.now(), from = to - period.days * DAY;
    const pts = points.filter(p => p.t >= from);
    if (!pts.length) {
      box.replaceChildren(h('p', { class: 'muted empty' }, 'Нет данных за этот период'));
      return;
    }
    const best = Math.max(...pts.map(p => p.kg));
    box.replaceChildren(
      h('p', { class: 'muted small' }, ctx.t('Рекорд: {kg} кг', { kg: best })),
      lineChart(pts, from, to, fmt));
  }

  draw();
  modal({ title: 'Динамика максимального веса', body: h('div', { class: 'share' }, h('strong', null, raw(name)), chips, box) });
}

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function lineChart(pts, from, to, fmt) {
  const W = 320, H = 190, L = 40, R = 12, T = 12, B = 26;
  let lo = Math.min(...pts.map(p => p.kg)), hi = Math.max(...pts.map(p => p.kg));
  if (hi === lo) { lo = Math.max(0, lo - 5); hi = hi + 5; }
  else { const pad = (hi - lo) * 0.1; lo = Math.max(0, lo - pad); hi += pad; }
  const x = t => L + ((t - from) / (to - from)) * (W - L - R);
  const y = kg => T + (1 - (kg - lo) / (hi - lo)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  for (let i = 0; i < 4; i++) { // горизонтальные линии и подписи веса
    const v = lo + ((hi - lo) * i) / 3, yy = y(v);
    root.append(svg('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'grid' }), svg('text', { x: L - 6, y: yy + 4, class: 'lbl', 'text-anchor': 'end' }, String(Math.round(v * 10) / 10)));
  }
  root.append(svg('text', { x: L, y: H - 6, class: 'lbl' }, fmt.date(from)), svg('text', { x: W - R, y: H - 6, class: 'lbl', 'text-anchor': 'end' }, fmt.date(to)));
  root.append(svg('polyline', { points: pts.map(p => `${x(p.t).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' '), class: 'line' }));
  for (const p of pts) {
    const c = svg('circle', { cx: x(p.t).toFixed(1), cy: y(p.kg).toFixed(1), r: 4, class: 'dot' });
    c.append(svg('title', {}, `${fmt.date(p.t)}: ${p.kg} kg`));
    root.append(c);
  }
  return root;
}
