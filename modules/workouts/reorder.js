// Перетаскивание элементов списка за «ручку»: элемент следует за пальцем или мышью, остальные расступаются, при отпускании вызывается onMove(from, to).
// Работает и с касанием, и с мышью (ручка с touch-action: none, поэтому обычная прокрутка списка не мешает).

export function enableSort(box, { itemSel, handleSel, onMove }) {
  box.addEventListener('pointerdown', e => {
    const handle = e.target.closest(handleSel);
    const item = handle?.closest(itemSel);
    if (!item || e.button > 0 || !box.contains(item)) return;
    e.preventDefault();
    const items = [...box.querySelectorAll(itemSel)];
    const from = items.indexOf(item);
    const rects = items.map(x => x.getBoundingClientRect());
    const gap = rects[1] ? Math.max(0, rects[1].top - rects[0].bottom) : 10;
    const shift = rects[from].height + gap; // на столько сдвигаются соседи, когда элемент проходит мимо них
    const startY = e.clientY;
    const scroller = box.closest('#view');
    const scroll0 = scroller?.scrollTop ?? 0;
    let to = from;
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    item.classList.add('dragging');
    items.forEach(x => { if (x !== item) x.style.transition = 'transform .15s ease'; });

    const move = ev => {
      const dy = ev.clientY - startY + ((scroller?.scrollTop ?? 0) - scroll0);
      item.style.transform = `translateY(${dy}px)`;
      const centre = rects[from].top + rects[from].height / 2 + dy;
      to = items.reduce((n, _, k) => (centre > rects[k].top + rects[k].height / 2 ? k : n), 0);
      items.forEach((x, k) => {
        if (x === item) return;
        x.style.transform = from < to && k > from && k <= to ? `translateY(${-shift}px)` : from > to && k < from && k >= to ? `translateY(${shift}px)` : '';
      });
      if (scroller) { // у края экрана страница прокручивается сама
        const r = scroller.getBoundingClientRect();
        if (ev.clientY < r.top + 50) scroller.scrollTop -= 10; else if (ev.clientY > r.bottom - 50) scroller.scrollTop += 10;
      }
    };
    const end = ev => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      item.classList.remove('dragging');
      items.forEach(x => { x.style.transform = ''; x.style.transition = ''; });
      if (ev.type === 'pointerup' && to !== from) onMove(from, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}
