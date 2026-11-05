// Схематичная мужская фигура с линиями замеров. Наведение (или нажатие / фокус) на линию показывает, как правильно сделать замер.

import { MEASURES, measureOf } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};

// Линии замеров: сегменты [x1, x2, y] в системе координат 200×420. Парные конечности — по линии на каждой стороне.
const mirror = (x1, x2, y) => [[x1, x2, y], [200 - x2, 200 - x1, y]];
const LINES = {
  neck: [[86, 114, 63]],
  shoulders: [[40, 160, 88]],
  chest: [[62, 138, 116]],
  waist: [[68, 132, 188]],
  hips: [[64, 136, 236]],
  biceps: mirror(38, 59, 120),
  forearm: mirror(33, 49, 180),
  thigh: mirror(63, 95, 262),
  calf: mirror(66, 88, 345),
};

// Туловище и конечности: «капсулы» (толстые линии с круглыми концами) с обводкой.
const LIMBS = [
  [52, 94, 44, 150, 18], [44, 150, 38, 212, 14], // рука
  [80, 226, 78, 300, 32], [78, 300, 76, 388, 22], // нога
];

export function buildFigure(ctx, { onHover } = {}) {
  const { h } = ctx.ui;
  const svg = el('svg', { viewBox: '0 0 200 420', class: 'fig-svg', role: 'img', 'aria-label': ctx.t('Схема замеров тела') });

  // конечности (левая и правая симметрично)
  const limbs = el('g', { class: 'fg-limbs' }, svg);
  for (const [x1, y1, x2, y2, w] of LIMBS) {
    for (const mx of [false, true]) {
      const a = mx ? 200 - x1 : x1, b = mx ? 200 - x2 : x2;
      el('line', { x1: a, y1, x2: b, y2, 'stroke-width': w + 2, class: 'fg-out' }, limbs);
      el('line', { x1: a, y1, x2: b, y2, 'stroke-width': w, class: 'fg-in' }, limbs);
    }
  }
  el('path', { class: 'fg-body', d: 'M64 84 Q100 72 136 84 L131 130 Q128 160 126 186 L131 226 L69 226 L74 186 Q72 160 69 130 Z' }, svg);
  el('rect', { class: 'fg-body', x: 91, y: 52, width: 18, height: 24, rx: 7 }, svg);
  el('circle', { class: 'fg-body', cx: 100, cy: 34, r: 20 }, svg);
  el('ellipse', { class: 'fg-body', cx: 76, cy: 397, rx: 13, ry: 5 }, svg);
  el('ellipse', { class: 'fg-body', cx: 124, cy: 397, rx: 13, ry: 5 }, svg);
  // фигура смотрит на нас: правая сторона человека — слева на рисунке
  el('text', { x: 76, y: 414, class: 'fg-side', 'text-anchor': 'middle' }, svg).textContent = ctx.t('П');
  el('text', { x: 124, y: 414, class: 'fg-side', 'text-anchor': 'middle' }, svg).textContent = ctx.t('Л');

  const tip = h('div', { class: 'm-tip', hidden: true, role: 'tooltip' });
  const wrap = h('div', { class: 'fig' }, svg, tip);

  const groups = new Map();
  function place(x, y) {
    const r = wrap.getBoundingClientRect();
    tip.style.left = '0px';
    tip.style.top = '0px';
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.max(0, Math.min(r.width - w, x - r.left + 14)) + 'px';
    tip.style.top = Math.max(0, Math.min(r.height - hgt, y - r.top + 14)) + 'px';
  }
  function show(id, x, y) {
    const m = measureOf(id);
    // replaceChildren превращает null в текст «null», поэтому пустое отбрасываем
    tip.replaceChildren(...[
      h('strong', null, m.name),
      h('span', null, m.tip),
      m.group ? h('span', { class: 'muted small' }, 'Если включён раздельный ввод — меряйте правую и левую стороны отдельно.') : null,
    ].filter(Boolean));
    tip.hidden = false;
    place(x, y);
    highlight(id);
    onHover?.(id);
  }
  function hide() {
    tip.hidden = true;
    highlight(null);
    onHover?.(null);
  }
  function highlight(id) {
    for (const [k, g] of groups) g.classList.toggle('on', k === id);
  }

  for (const m of MEASURES) {
    const g = el('g', { class: 'mline', tabindex: '0', role: 'img', 'aria-label': ctx.t(m.name), 'data-k': m.id }, svg);
    for (const [x1, x2, y] of LINES[m.id]) {
      el('line', { x1, x2, y1: y, y2: y, class: 'ml-hit' }, g);
      el('line', { x1, x2, y1: y, y2: y, class: 'ml-vis' }, g);
      el('circle', { cx: x1, cy: y, r: 2, class: 'ml-dot' }, g);
      el('circle', { cx: x2, cy: y, r: 2, class: 'ml-dot' }, g);
    }
    g.addEventListener('pointerenter', e => show(m.id, e.clientX, e.clientY));
    g.addEventListener('pointermove', e => !tip.hidden && place(e.clientX, e.clientY));
    g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); show(m.id, r.left + r.width / 2, r.top); });
    g.addEventListener('blur', hide);
    // на сенсорных экранах наведения нет — подсказка по нажатию
    g.addEventListener('click', e => { if (e.pointerType === 'touch' || tip.hidden) show(m.id, e.clientX, e.clientY); });
    groups.set(m.id, g);
  }

  return { el: wrap, highlight, hide };
}
