// История тренировок: три колонки-ступени. Слева — выполненные тренировки (коротко),
// по нажатию справа открываются упражнения с подходами, по нажатию на упражнение ещё правее — график максимального веса.
// На узких экранах показывается только последняя ступень, назад — стрелкой в её заголовке.

import { fmtClock, makeFmt } from './data.js';

const PERIODS = [
  { days: 30, label: '1 мес' },
  { days: 90, label: '3 мес' },
  { days: 182, label: '6 мес' },
  { days: 365, label: 'Год' },
];
const DAY = 86_400_000;
const keyOf = name => name.trim().toLowerCase();

export async function openHistory(page, ctx, { onBack }) {
  const { h, iconBtn, raw, confirmDialog, toast } = ctx.ui;
  const fmt = makeFmt(ctx);
  // от самой новой тренировки к самой старой
  const sessions = (await ctx.db.collection('sessions').list()).sort((a, b) => (b.startedAt - a.startedAt) || ((b.endedAt ?? 0) - (a.endedAt ?? 0)));
  let sel = null; // выбранная тренировка
  let exKey = null; // выбранное упражнение (по названию)
  let period = PERIODS[1];

  const root = h('div', { class: 'hist' });

  let shown = { sel: null, exKey: null }; // что было выбрано при прошлой отрисовке

  function draw() {
    const tops = [...root.children].map(c => c.scrollTop); // колонки пересоздаются, поэтому запоминаем, где они были прокручены
    const session = sessions.find(s => s.id === sel) ?? null;
    const exercise = session?.exercises.find(e => keyOf(e.name) === exKey) ?? null;
    // Три колонки есть всегда и не меняют размер; пока ничего не выбрано, правые показывают подсказку
    const cols = [colSessions(), session ? colExercises(session) : holder('Выберите тренировку'), exercise ? colChart(exercise) : holder('Выберите упражнение')];
    const deepest = exercise ? 2 : session ? 1 : 0; // на узких экранах виден только самый глубокий открытый уровень
    cols.forEach((c, i) => c.classList.toggle('last', i === deepest));
    root.replaceChildren(...cols);
    // позиция прокрутки сохраняется, пока колонка показывает то же содержимое (список тренировок — всегда; упражнения — для той же тренировки; график — для того же упражнения)
    const same = [true, sel === shown.sel, sel === shown.sel && exKey === shown.exKey];
    cols.forEach((c, i) => { if (same[i]) c.scrollTop = tops[i] ?? 0; });
    shown = { sel, exKey };
  }

  /** Только для узких экранов, где видна одна ступень: стрелка назад на предыдущую. На широких не показывается. */
  const backBar = back => h('div', { class: 'hback' }, iconBtn('chevL', 'Назад', back));

  const holder = text => h('section', { class: 'hcol card holder' }, h('p', { class: 'muted' }, text));

  async function removeSession(s) {
    const ok = await confirmDialog(ctx.t('Удалить из истории тренировку «{name}» от {date}? Это действие нельзя отменить.', { name: s.name, date: fmt.date(s.startedAt) }), { okText: 'Удалить', danger: true });
    if (!ok) return;
    await ctx.db.collection('sessions').remove(s.id);
    sessions.splice(sessions.indexOf(s), 1);
    if (sel === s.id) { sel = null; exKey = null; }
    toast('Тренировка удалена из истории');
    draw();
  }

  // ---------- 1: тренировки ----------
  function colSessions() {
    const year = new Date().getFullYear();
    return h('section', { class: 'hcol card' },
      sessions.length ? h('div', { class: 'hlist' }, sessions.map(s => {
        const y = new Date(s.startedAt).getFullYear();
        const open = () => { sel = s.id; exKey = null; draw(); };
        return h('div', { class: 'hrow' + (s.id === sel ? ' on' : ''), role: 'button', tabindex: '0', onClick: open,
          onKeydown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } } },
          h('span', { class: 'hrow-top' },
            h('strong', null, fmt.date(s.startedAt) + (y !== year ? ' ' + y : '')), h('span', { class: 'muted small' }, fmt.weekday(s.startedAt)),
            h('span', { class: 'grow' }), h('span', { class: 'muted small' }, fmt.human(s.durationSec ?? 0)),
            iconBtn('trash', 'Удалить из истории', e => { e.stopPropagation(); removeSession(s); }, 'danger hist-del')),
          h('span', { class: 'hrow-name' }, raw(s.name)));
      })) : h('p', { class: 'muted empty' }, 'Нет выполненных тренировок'));
  }

  // ---------- 2: упражнения тренировки ----------
  function colExercises(s) {
    return h('section', { class: 'hcol card' },
      backBar(() => { sel = null; exKey = null; draw(); }),
      h('div', { class: 'hlist' }, s.exercises.map(ex =>
        h('button', { class: 'hex' + (keyOf(ex.name) === exKey ? ' on' : ''), onClick: () => { exKey = keyOf(ex.name); draw(); } },
          h('strong', null, raw(ex.name)),
          ex.comment ? h('span', { class: 'muted small block pre' }, raw(ex.comment)) : null,
          h('div', { class: 'sess-sets' }, ex.sets.map((x, i) =>
            h('div', { class: 'sess-set' },
              h('span', { class: 'muted' }, x.kind === 'warmup' ? 'Разминка' : ctx.t('Сет {n}', { n: ex.sets.slice(0, i + 1).filter(y => y.kind === 'work').length })),
              h('span', null, fmt.set(x)),
              h('span', { class: 'muted small' }, x.restSec != null ? ctx.t('отдых {time}', { time: fmtClock(x.restSec) }) : '')))))))
    );
  }

  // ---------- 3: график ----------
  function colChart(ex) {
    const points = [];
    for (const s of sessions) {
      for (const e of s.exercises) {
        if (keyOf(e.name) !== keyOf(ex.name)) continue;
        const kgs = e.sets.filter(x => x.kind === 'work').map(x => Number(x.kg) || 0);
        if (kgs.length) points.push({ t: s.startedAt, kg: Math.max(...kgs) });
      }
    }
    points.sort((a, b) => a.t - b.t);
    const to = Date.now(), from = to - period.days * DAY;
    const pts = points.filter(p => p.t >= from);
    const chips = h('div', { class: 'size-chips' }, PERIODS.map(p =>
      h('button', { class: 'chip-btn' + (p === period ? ' on' : ''), onClick: () => { period = p; draw(); } }, p.label)));
    return h('section', { class: 'hcol card' },
      backBar(() => { exKey = null; draw(); }),
      h('div', { class: 'hchart' },
        chips,
        pts.length
          ? [h('p', { class: 'muted small' }, ctx.t('Рекорд: {kg} кг', { kg: Math.max(...pts.map(p => p.kg)) })), lineChart(pts, from, to, fmt)]
          : h('p', { class: 'muted empty' }, 'Нет данных за этот период')));
  }

  draw();
  page.replaceChildren(
    h('header', { class: 'page-head' }, h('div', { class: 'row-gap' }, iconBtn('chevL', 'Назад', onBack), h('h1', null, 'История'))),
    root);
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
