import { dayKey, makeFmt } from './data.js';

/**
 * Сетка месяца с отметками тренировок.
 * marks: Map<'YYYY-MM-DD', number> — сколько тренировок в день.
 * nav: {onPrev, onNext} — показать стрелки переключения месяца (необязательно).
 */
export function monthGrid(ctx, { year, month, marks, nav, onDay, compact = false }) {
  const { h, icon } = ctx.ui;
  const fmt = makeFmt(ctx);
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const today = dayKey(Date.now());

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-cell empty' }));
  for (let d = 1; d <= days; d++) {
    const key = dayKey(new Date(year, month, d));
    const n = marks.get(key) ?? 0;
    cells.push(h('button', {
      class: 'cal-cell' + (n ? ' marked' : '') + (key === today ? ' today' : ''),
      title: n ? ctx.t('Тренировок: {n}', { n }) : '',
      onClick: e => { if (onDay) { e.stopPropagation(); onDay(key, n); } },
    }, String(d)));
  }

  const head = h('div', { class: 'cal-head' },
    h('strong', null, `${fmt.month(month)} ${year}`),
    nav ? h('div', { class: 'row-gap' },
      h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onClick: e => { e.stopPropagation(); nav.onPrev(); } }, icon('chevL')),
      h('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onClick: e => { e.stopPropagation(); nav.onNext(); } }, icon('chevR'))) : null);

  return h('div', { class: 'cal' + (compact ? ' compact' : '') },
    head,
    h('div', { class: 'cal-grid' }, fmt.dayNames().map(d => h('span', { class: 'cal-dow' }, d)), cells));
}
