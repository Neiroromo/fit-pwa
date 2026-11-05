// Схематичная мужская фигура с линиями замеров. Наведение (или нажатие / фокус) на линию показывает, как правильно сделать замер.
// Контуры — в shape.js.

import { MEASURES, measureOf } from './data.js';
import { BODY_PATH, VIEWBOX, LINES, SIDE_LABELS } from './shape.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};

export function buildFigure(ctx, { onHover } = {}) {
  const { h } = ctx.ui;
  const svg = el('svg', { viewBox: VIEWBOX, class: 'fig-svg', role: 'img', 'aria-label': ctx.t('Схема замеров тела') });

  // заливка с мягким переходом сверху вниз
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id: 'fg-grad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0', class: 'fg-stop-a' }, grad);
  el('stop', { offset: '1', class: 'fg-stop-b' }, grad);

  el('path', { d: BODY_PATH, class: 'fg-shape', 'fill-rule': 'evenodd' }, svg);
  // фигура смотрит на нас: правая сторона человека — слева на рисунке
  for (const [side, label] of [['r', 'П'], ['l', 'Л']]) {
    el('text', { x: SIDE_LABELS[side][0], y: SIDE_LABELS[side][1], class: 'fg-side', 'text-anchor': 'middle' }, svg).textContent = ctx.t(label);
  }

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

  for (const m of MEASURES.filter(m => LINES[m.id])) { // у замеров для одежды линий на схеме нет
    const g = el('g', { class: 'mline', tabindex: '0', role: 'img', 'aria-label': ctx.t(m.name), 'data-k': m.id }, svg);
    for (const [x1, y1, x2, y2] of LINES[m.id]) {
      el('line', { x1, y1, x2, y2, class: 'ml-hit' }, g);
      el('line', { x1, y1, x2, y2, class: 'ml-vis' }, g);
      el('circle', { cx: x1, cy: y1, r: 3, class: 'ml-dot' }, g);
      el('circle', { cx: x2, cy: y2, r: 3, class: 'ml-dot' }, g);
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

  /** Скрывает линии отключённых замеров. */
  function setHidden(ids) {
    for (const [k, g] of groups) g.classList.toggle('off', ids.has(k));
  }

  return { el: wrap, highlight, hide, setHidden };
}
