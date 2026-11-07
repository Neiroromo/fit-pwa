// Свайп влево по карточке тренировки — удалить (только касания; на ПК есть кнопка-корзина).
// Вертикальную прокрутку оставляем браузеру (touch-action: pan-y), горизонтальный жест ведём сами: карточка следует за пальцем,
// при отпускании дальше порога (или после резкого смаха) уезжает за край и вызывается onCommit; иначе возвращается на место.

export function swipeRemove(row, content, onCommit) {
  let id = null, sx = 0, sy = 0, dx = 0, t0 = 0, active = false;

  const snapBack = () => {
    content.style.transition = 'transform .2s ease';
    content.style.transform = '';
    row.classList.remove('swiping');
  };
  const noClick = () => {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    row.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => row.removeEventListener('click', stop, true), 400);
  };

  content.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || id != null || e.target.closest('button')) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; active = false; t0 = performance.now();
  });
  content.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!active) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my) * 1.5) return; // вертикальное движение — это прокрутка страницы
      active = true;
      try { content.setPointerCapture(id); } catch { /* ignore */ }
      content.style.transition = 'none';
      row.classList.add('swiping');
    }
    dx = Math.min(0, mx);
    content.style.transform = `translateX(${dx}px)`;
  });
  const end = e => {
    if (e.pointerId !== id) return;
    const was = active, w = content.offsetWidth || 1;
    const fast = -dx > 40 && -dx / Math.max(1, performance.now() - t0) > 0.6; // резкий смах
    id = null; active = false;
    try { content.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!was) return;
    noClick();
    if (e.type !== 'pointerup' || (-dx < w * 0.3 && !fast)) { snapBack(); return; }
    content.style.transition = 'transform .16s ease-in';
    content.style.transform = 'translateX(-105%)';
    setTimeout(async () => {
      try { await onCommit(); } finally { if (row.isConnected) snapBack(); }
    }, 160);
  };
  content.addEventListener('pointerup', end);
  content.addEventListener('pointercancel', end);
  // пока ведём по горизонтали, страница не должна подхватывать вертикальную прокрутку
  content.addEventListener('touchmove', e => { if (active && e.cancelable) e.preventDefault(); }, { passive: false });
}
