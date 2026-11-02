// Хаб — встроенный (неудаляемый) модуль. Показывает виджеты других модулей на сетке.
// Раскладка хранится как [{id, key: '<moduleId>/<widgetId>', x, y, w, h}].

import { h, icon, iconBtn, modal, clamp, uid } from '../core/ui.js';

const GAP = 12;

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Раскладывает виджеты без наложений; firstId получает приоритет на своё место. */
function resolve(items, cols, firstId) {
  const first = items.filter(i => i.id === firstId);
  const rest = items.filter(i => i.id !== firstId).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const it of [...first, ...rest]) {
    const w = Math.min(it.w, cols);
    const p = { ...it, w, x: clamp(it.x, 0, cols - w), y: Math.max(0, it.y) };
    while (placed.some(o => overlaps(p, o))) p.y++;
    placed.push(p);
  }
  return placed;
}

function findFree(items, cols, w, hh) {
  w = Math.min(w, cols);
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!items.some(o => overlaps({ x, y, w, h: hh }, o))) return { x, y };
    }
  }
}

export default {
  async mount(page, ctx) {
    let layout = await ctx.db.kv.get('layout', []);
    let edit = false;
    let cols = 4;
    let cell = 150;
    let cleanups = [];

    const grid = h('div', { class: 'hub-grid' });
    const editBtn = h('button', { class: 'btn', onClick: () => { edit = !edit; render(); } });
    const addBtn = h('button', { class: 'btn primary', onClick: openPicker }, icon('plus', 16), 'Виджет');
    page.append(
      h('header', { class: 'page-head' }, h('h1', null, 'Хаб'), h('div', { class: 'row-gap' }, addBtn, editBtn)),
      grid,
    );

    const save = () => ctx.db.kv.set('layout', layout);
    const installedWidgets = () => ctx.registry.installed().flatMap(m => (m.widgets ?? []).map(w => ({ ...w, key: `${m.id}/${w.id}`, moduleName: m.name })));
    const widgetMeta = key => installedWidgets().find(w => w.key === key);

    function measure() {
      const width = grid.clientWidth;
      const c = clamp(Math.round(width / 190), 2, 6);
      const size = Math.floor((width - GAP * (c - 1)) / c);
      if (c !== cols || size !== cell) { cols = c; cell = size; return true; }
      return false;
    }

    async function renderWidget(item, body, meta) {
      try {
        const [mid, wid] = item.key.split('/');
        const mod = await ctx.registry.load(mid);
        const def = mod.widgets?.find(w => w.id === wid);
        if (!def) throw new Error('нет виджета');
        const dispose = await def.render(body, { ...ctx.moduleContext(mid), size: { w: item.w, h: item.h } });
        if (typeof dispose === 'function') cleanups.push(dispose);
      } catch (e) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'Виджет недоступен'));
        console.error(e);
      }
    }

    function render() {
      cleanups.forEach(fn => { try { fn(); } catch { /* ignore */ } });
      cleanups = [];
      editBtn.textContent = edit ? 'Готово' : 'Изменить';
      addBtn.hidden = !edit;
      grid.className = 'hub-grid' + (edit ? ' editing' : '');
      grid.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
      grid.style.gridAutoRows = `${cell}px`;
      grid.style.gap = GAP + 'px';

      const visible = layout.filter(l => widgetMeta(l.key));
      const items = resolve(visible, cols);
      const rows = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);

      const children = [];
      if (edit) {
        const total = Math.max(rows + 2, 4);
        for (let y = 0; y < total; y++) for (let x = 0; x < cols; x++) {
          children.push(h('div', { class: 'cell-bg', style: { gridColumn: x + 1, gridRow: y + 1 } }));
        }
      }
      for (const it of items) {
        const meta = widgetMeta(it.key);
        const body = h('div', { class: 'widget-body' });
        const w = h('div', {
          class: 'widget', style: { gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}` },
        }, h('div', { class: 'widget-title' }, meta.title), body);
        if (edit) {
          const sizes = (meta.sizes ?? [[1, 1]]).filter(([sw]) => sw <= cols);
          w.append(h('div', { class: 'widget-tools' },
            h('div', { class: 'size-chips' }, sizes.map(([sw, sh]) =>
              h('button', {
                class: 'chip-btn' + (sw === it.w && sh === it.h ? ' on' : ''),
                onClick: () => {
                  layout = resolve(items.map(i => (i.id === it.id ? { ...i, w: sw, h: sh } : i)), cols, it.id);
                  save(); render();
                },
              }, `${sw}×${sh}`))),
            iconBtn('x', 'Убрать виджет', () => { layout = layout.filter(l => l.id !== it.id); save(); render(); }, 'danger')));
          w.addEventListener('pointerdown', e => startDrag(e, it, w, items));
        }
        children.push(w);
        renderWidget(it, body, meta);
      }

      if (!layout.length && !edit) {
        children.push(h('button', { class: 'hub-empty', style: { gridColumn: '1 / -1', gridRow: '1 / span 2' }, onClick: openPicker },
          icon('plus', 40), h('strong', null, 'Добавить виджет'), h('span', { class: 'muted' }, 'Хаб собирает самое важное из ваших модулей')));
      }
      grid.replaceChildren(...children);
    }

    function startDrag(e, item, el, items) {
      if (e.target.closest('button') || e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const hint = h('div', { class: 'drop-hint' });
      grid.append(hint);
      const target = { x: item.x, y: item.y };
      const step = cell + GAP;
      const place = () => { hint.style.gridColumn = `${target.x + 1} / span ${item.w}`; hint.style.gridRow = `${target.y + 1} / span ${item.h}`; };
      place();
      const sx = e.clientX, sy = e.clientY;
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        target.x = clamp(Math.round((item.x * step + dx) / step), 0, cols - item.w);
        target.y = Math.max(0, Math.round((item.y * step + dy) / step));
        place();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        layout = resolve(items.map(i => (i.id === item.id ? { ...i, ...target } : i)), cols, item.id);
        save(); render();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    function openPicker() {
      const all = installedWidgets();
      const body = h('div', { class: 'picker' });
      const m = modal({ title: 'Добавить виджет', body, wide: true });
      if (!all.length) {
        body.append(
          h('p', { class: 'muted' }, 'Виджеты появляются вместе с модулями. Скачайте модуль, например «Тренировки», и его виджеты станут доступны здесь.'),
          h('button', { class: 'btn primary', onClick: () => { m.close(); ctx.openStore(); } }, icon('download', 16), 'Открыть список модулей'));
        return;
      }
      const byModule = Map.groupBy(all, w => w.moduleName);
      for (const [name, widgets] of byModule) {
        body.append(h('h3', { class: 'group' }, name), ...widgets.map(w =>
          h('div', { class: 'picker-item' },
            h('div', { class: 'grow' }, h('strong', null, w.title), h('span', { class: 'muted small block' }, w.description ?? '')),
            h('div', { class: 'size-chips' }, w.sizes.filter(([sw]) => sw <= cols).map(([sw, sh]) =>
              h('button', {
                class: 'chip-btn', title: `Добавить ${sw}×${sh}`,
                onClick: () => {
                  const cur = resolve(layout.filter(l => widgetMeta(l.key)), cols);
                  const pos = findFree(cur, cols, sw, sh);
                  layout = [...cur, { id: uid(), key: w.key, w: sw, h: sh, ...pos }];
                  save(); m.close(); render();
                },
              }, `${sw}×${sh}`))))));
      }
    }

    const ro = new ResizeObserver(() => { if (measure()) render(); });
    ro.observe(page);
    measure();
    render();

    return () => { ro.disconnect(); cleanups.forEach(fn => fn()); };
  },
};
