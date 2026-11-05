// Графики модуля «Мониторинг»: динамика показателя (точки + сглаженный тренд), таблица-двойник, мини-график для плитки и виджета.
//
// Решения (по исследованию приложений вроде MacroFactor, Withings, Happy Scale и правилам визуализации данных):
//  - сырые записи показываем точками, а читаемую динамику — линией тренда (экспоненциальное среднее): сутки «шумят» из-за воды, еды, времени дня;
//  - одна ось на график, разные величины — разные графики; тренд можно скрыть;
//  - перекрестие привязано к ближайшей дате, подсказка показывает значение (крупно) и название (мельче);
//  - у графика есть таблица с теми же данными, а подсказка дублируется на фокус с клавиатуры.

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86_400_000;
const svgEl = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

/** Цвета рядов — фиксированные слоты проверенной палитры (тёмная тема): общий / правая / левая сторона. Цвет привязан к ряду, а не к порядку. */
export const SERIES_COLORS = { main: '#3987e5', r: '#d95926', l: '#199e70' };
export const colorOfKey = key => SERIES_COLORS[key.split('.')[1] ?? 'main'];

/** Тренд — экспоненциальное среднее с учётом пропусков по времени: tau — «память» в днях. Возвращает точки с полем trend. */
export function withTrend(pts, tau = 7) {
  let tr = null, prevT = 0;
  return pts.map(p => {
    if (tr == null) tr = p.v;
    else tr += (1 - Math.exp(-(p.t - prevT) / DAY / tau)) * (p.v - tr);
    prevT = p.t;
    return { ...p, trend: tr };
  });
}

/** Красивые отметки оси: от lo до hi примерно count штук с шагом 1/2/5·10^n. */
export function niceTicks(lo, hi, count = 4) {
  if (hi === lo) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step * 0.999; v += step) out.push(Math.round(v / step * 1e6) / 1e6 * step);
  return out;
}

/**
 * Интерактивный график. series: [{key, label, color, pts: [{t, v, trend?}]}]; from/to — границы по времени (мс).
 * showTrend — рисовать тренд (только для одного ряда). Возвращает элемент; подписи вставляются через textContent.
 */
export function dynamicsChart({ h, series, from, to, fmtDate, fmtDateLong, fmtNum, unit, showTrend, trendLabel, ariaLabel }) {
  const W = 640, H = 300, L = 48, R = 50, T = 20, B = 32; // справа место под подпись последнего значения
  const single = series.length === 1;
  const trendOn = single && showTrend;
  const vals = series.flatMap(s => s.pts.flatMap(p => (trendOn ? [p.v, p.trend] : [p.v])));
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 4);
  const lo = ticks[0], hi = ticks.at(-1);
  const span = Math.max(1, to - from);
  const x = t => L + ((t - from) / span) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dyn-svg', 'aria-hidden': 'true' });
  // сетка и подписи осей: тонкая сплошная, неброская
  for (const v of ticks) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }), svgEl('text', { x: L - 8, y: y(v) + 4, class: 'lbl', 'text-anchor': 'end' }, fmtNum(v)));
  }
  const xt = Array.from({ length: 5 }, (_, i) => from + (span * i) / 4);
  xt.forEach((t, i) => svg.append(svgEl('text', { x: x(t), y: H - 8, class: 'lbl', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, fmtDate(t))));

  const lineOf = (pts, get) => pts.map(p => `${x(p.t).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');
  for (const s of series) {
    if (!s.pts.length) continue;
    const base = trendOn ? p => p.trend : p => p.v;
    if (single && s.pts.length > 1) { // мягкая заливка под линией (~10 %)
      svg.append(svgEl('polygon', { points: `${x(s.pts[0].t).toFixed(1)},${y(lo)} ${lineOf(s.pts, base)} ${x(s.pts.at(-1).t).toFixed(1)},${y(lo)}`, fill: s.color, 'fill-opacity': '0.1' }));
    }
    if (s.pts.length > 1) svg.append(svgEl('polyline', { points: lineOf(s.pts, base), class: 'dyn-line', stroke: s.color }));
    for (const p of s.pts) {
      // при тренде записи — небольшие приглушённые точки; без тренда — маркеры ≥ 8 px с кольцом цвета поверхности
      svg.append(trendOn
        ? svgEl('circle', { cx: x(p.t), cy: y(p.v), r: 3, fill: s.color, 'fill-opacity': '0.5' })
        : svgEl('circle', { cx: x(p.t), cy: y(p.v), r: 4, fill: s.color, class: 'dyn-dot' }));
    }
  }
  // прямая подпись последнего значения (только если подписи не наезжают друг на друга)
  const ends = series.filter(s => s.pts.length).map(s => ({ s, p: s.pts.at(-1) }));
  const ys = ends.map(e => y(trendOn ? e.p.trend : e.p.v)).sort((a, b) => a - b);
  if (ys.every((v, i) => i === 0 || v - ys[i - 1] > 16)) {
    for (const { s, p } of ends) {
      const v = trendOn ? p.trend : p.v, px = x(p.t);
      svg.append(svgEl('circle', { cx: px, cy: y(v), r: 5, fill: s.color, class: 'dyn-dot' }));
      svg.append(svgEl('text', { x: px + 10, y: y(v) + 4, class: 'dyn-end', 'text-anchor': 'start' }, fmtNum(v)));
    }
  }

  // ----- наведение: перекрестие привязывается к ближайшей дате -----
  const times = [...new Set(series.flatMap(s => s.pts.map(p => p.t)))].sort((a, b) => a - b);
  const cross = svgEl('line', { y1: T, y2: H - B, class: 'dyn-cross', visibility: 'hidden' });
  const rings = series.map(s => svgEl('circle', { r: 5.5, fill: s.color, class: 'dyn-dot', visibility: 'hidden' }));
  svg.append(cross, ...rings);

  const tip = h('div', { class: 'dyn-tip', hidden: true, role: 'status' });
  const wrap = h('div', { class: 'dyn-chart', tabindex: '0', role: 'img', 'aria-label': ariaLabel }, svg, tip);
  let idx = -1;

  function showAt(i) {
    if (!times.length) return;
    idx = Math.max(0, Math.min(times.length - 1, i));
    const t = times[idx], px = x(t);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    const rows = [];
    series.forEach((s, k) => {
      const p = s.pts.find(q => q.t === t);
      rings[k].setAttribute('visibility', p ? 'visible' : 'hidden');
      if (!p) return;
      rings[k].setAttribute('cx', px); rings[k].setAttribute('cy', y(trendOn ? p.trend : p.v));
      rows.push({ color: s.color, value: `${fmtNum(p.v)} ${unit}`, name: s.label });
      if (trendOn) rows.push({ color: null, value: `${fmtNum(p.trend)} ${unit}`, name: trendLabel });
    });
    const date = h('div', { class: 'dyn-tip-date' });
    date.textContent = fmtDateLong(t);
    tip.replaceChildren(date, ...rows.map(r => {
      const key = h('i', { class: 'dyn-key' });
      if (r.color) key.style.background = r.color; else key.classList.add('hollow');
      const value = h('strong'); value.textContent = r.value;
      const name = h('span', { class: 'dyn-tip-name' }); name.textContent = r.name;
      return h('div', { class: 'dyn-tip-row' }, key, value, name); // значение крупно, название вторично
    }));
    tip.hidden = false;
    const box = wrap.getBoundingClientRect(), sx = (px / W) * box.width;
    tip.style.top = '6px';
    tip.style.left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, sx + 12)) + 'px';
    if (sx + 12 + tip.offsetWidth > box.width) tip.style.left = Math.max(4, sx - tip.offsetWidth - 12) + 'px';
  }
  function hideAt() {
    idx = -1;
    cross.setAttribute('visibility', 'hidden');
    rings.forEach(r => r.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  }
  wrap.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect(), sx = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    times.forEach((t, i) => { if (Math.abs(x(t) - sx) < Math.abs(x(times[best]) - sx)) best = i; });
    showAt(best);
  });
  wrap.addEventListener('pointerleave', hideAt);
  wrap.addEventListener('focus', () => showAt(times.length - 1));
  wrap.addEventListener('blur', hideAt);
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); showAt(idx < 0 ? times.length - 1 : idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); showAt(idx < 0 ? times.length - 1 : idx + 1); }
    else if (e.key === 'Home') { e.preventDefault(); showAt(0); }
    else if (e.key === 'End') { e.preventDefault(); showAt(times.length - 1); }
    else if (e.key === 'Escape') hideAt();
  });
  return wrap;
}

/** Таблица с теми же данными, что на графике (новые записи сверху). */
export function dynamicsTable({ h, series, fmtDateLong, fmtNum, headDate, headTrend, showTrend }) {
  const times = [...new Set(series.flatMap(s => s.pts.map(p => p.t)))].sort((a, b) => b - a);
  const trendOn = series.length === 1 && showTrend;
  const th = text => { const e = h('th'); e.textContent = text; return e; };
  const td = text => { const e = h('td'); e.textContent = text; return e; };
  return h('div', { class: 'dyn-table-wrap' }, h('table', { class: 'dyn-table' },
    h('thead', null, h('tr', null, th(headDate), ...series.map(s => th(s.label)), trendOn ? th(headTrend) : null)),
    h('tbody', null, ...times.map(t => h('tr', null,
      td(fmtDateLong(t)),
      ...series.map(s => { const p = s.pts.find(q => q.t === t); return td(p ? fmtNum(p.v) : '—'); }),
      trendOn ? td(fmtNum(series[0].pts.find(q => q.t === t).trend)) : null)))));
}

/** Мини-график без осей: для плитки показателя и виджета. */
export function sparkline(pts, { width = 120, height = 32, color = SERIES_COLORS.main } = {}) {
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (pts.length < 2) return svg;
  const ts = pts.map(p => p.t), vs = pts.map(p => p.v);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const x = t => 2 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 4);
  const y = v => (v1 === v0 ? height / 2 : 2 + (1 - (v - v0) / (v1 - v0)) * (height - 4));
  svg.append(svgEl('polyline', { points: pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'line', stroke: color }));
  return svg;
}
