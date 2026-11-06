// Графики истории: столбцы по дням с линией нормы. Одна ось, тонкая сетка, подпись значения по наведению (и по фокусу с клавиатуры).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

/** «Круглые» отметки оси: до count штук от 0 до max. */
export function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out = [];
  for (let v = 0; v <= max + step * 0.999; v += step) { out.push(Math.round(v * 100) / 100); if (v >= max) break; }
  return out;
}

/**
 * Столбцы по дням. points: [{date: 'YYYY-MM-DD', v: число | null}] подряд (дни без данных — v null, столбца нет).
 * goal — линия нормы; fmt(v) — подпись значения; color — цвет столбцов.
 */
export function barChart(ctx, { points, goal, color, fmt, goalLabel, label }) {
  const { h } = ctx.ui;
  const W = 640, H = 190, pl = 46, pr = 10, pt = 10, pb = 24;
  const vals = points.map(p => p.v ?? 0);
  const top = Math.max(goal ?? 0, ...vals, 1);
  const ticks = niceTicks(top * 1.05);
  const max = ticks.at(-1);
  const n = points.length;
  const bw = (W - pl - pr) / n;
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString(ctx.locale, { day: 'numeric', month: 'short' });

  const readout = h('div', { class: 'nut-readout muted small' }, ctx.t('Наведите на столбец, чтобы увидеть значение'));
  const show = i => {
    const p = points[i];
    readout.replaceChildren(h('strong', null, document.createTextNode(p.v != null ? fmt(p.v) : '—')), document.createTextNode(' · ' + fmtDay(p.date)));
    svg.querySelectorAll('.bar-on').forEach(b => b.classList.remove('bar-on'));
    svg.querySelector(`[data-i="${i}"]`)?.classList.add('bar-on');
  };

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nut-svg', role: 'img', 'aria-label': label ?? '' });
  for (const t of ticks) {
    svg.append(el('line', { x1: pl, x2: W - pr, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(el('text', { x: pl - 6, y: y(t) + 4, class: 'axis', 'text-anchor': 'end' }, document.createTextNode(String(t))));
  }
  const every = Math.ceil(n / 7);
  points.forEach((p, i) => {
    const x = pl + i * bw;
    if (i % every === 0 || i === n - 1) svg.append(el('text', { x: x + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, document.createTextNode(fmtDay(p.date))));
    const g = el('g', { 'data-i': i, tabindex: p.v != null ? '0' : '-1', class: 'bar-g' });
    g.append(el('rect', { x, y: pt, width: bw, height: H - pt - pb, fill: 'transparent' })); // зона наведения на весь день
    if (p.v != null && p.v > 0) g.append(el('rect', { x: x + bw * 0.15, y: y(p.v), width: bw * 0.7, height: H - pb - y(p.v), rx: Math.min(3, bw * 0.2), fill: color, class: 'bar-r' }));
    g.addEventListener('pointerenter', () => show(i));
    g.addEventListener('focus', () => show(i));
    svg.append(g);
  });
  if (goal) {
    svg.append(el('line', { x1: pl, x2: W - pr, y1: y(goal), y2: y(goal), class: 'goal' }));
    svg.append(el('text', { x: W - pr, y: y(goal) - 4, class: 'axis goal-t', 'text-anchor': 'end' }, document.createTextNode(goalLabel ?? '')));
  }
  return h('div', { class: 'nut-chart' }, readout, svg);
}

/** Таблица «двойник» графика: день и значение. */
export function dayTable(ctx, rows, headers) {
  const { h, raw } = ctx.ui;
  return h('div', { class: 'nut-table-wrap' }, h('table', { class: 'nut-table' },
    h('thead', null, h('tr', null, headers.map(x => h('th', null, x)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, raw(String(c)))))))));
}

/** Скачивание CSV (по действию пользователя). */
export function downloadCsv(name, rows) {
  const esc = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
