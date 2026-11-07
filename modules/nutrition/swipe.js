// Жесты для сенсорных экранов (телефон). Мышь и ПК не затрагиваются: на устройствах без касания функции возвращают элемент как есть.
// Вертикальная прокрутка остаётся за браузером (touch-action: pan-y), горизонтальное движение обрабатываем сами.

const touchOnly = () => matchMedia('(pointer: coarse)').matches;

/** Гасит ближайший click после жеста, чтобы свайп не нажимал кнопку под пальцем. */
function swallowNextClick(el) {
  const stop = e => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', stop, true), 400);
}

/**
 * Свайп влево удаляет: элемент сдвигается, под ним краснеет фон с корзиной; если протянуть дальше порога — вызывается onDelete.
 * Возвращает обёртку (её и нужно вставлять в разметку).
 */
export function swipeDelete({ h, icon }, el, onDelete) {
  if (!touchOnly()) return el;
  const bg = h('div', { class: 'swipe-bg', 'aria-hidden': 'true' }, icon('trash', 20));
  el.classList.add('swipe-front');
  const wrap = h('div', { class: 'swipe' }, bg, el);
  let id = null, sx = 0, sy = 0, dx = 0, active = false, limit = 90;

  const reset = () => {
    el.style.transition = 'transform .18s ease';
    el.style.transform = '';
    bg.style.opacity = '0';
    bg.classList.remove('ready');
  };
  const finish = e => {
    if (e.pointerId !== id) return;
    const was = active, commit = active && e.type === 'pointerup' && -dx > limit;
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    id = null; active = false;
    if (!was) return;
    swallowNextClick(wrap);
    if (!commit) { reset(); return; }
    el.style.transition = 'transform .18s ease';
    el.style.transform = 'translateX(-105%)';
    setTimeout(() => {
      onDelete();
      if (wrap.isConnected) reset(); // удаление не убрало строку (например, отмена): вернуть на место
    }, 180);
  };

  wrap.addEventListener('pointerdown', e => {
    // вложенный свайп (блюдо внутри приёма) обрабатывает только самый внутренний элемент
    if (e.pointerType !== 'touch' || id != null || e.target.closest('.swipe') !== wrap) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; active = false;
    limit = Math.max(80, wrap.offsetWidth * 0.32);
  });
  wrap.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!active) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my) * 1.5) return;
      active = true;
      try { wrap.setPointerCapture(id); } catch { /* ignore */ }
      el.style.transition = 'none';
    }
    dx = Math.min(0, mx);
    el.style.transform = `translateX(${dx}px)`;
    bg.style.opacity = String(Math.min(1, -dx / 60));
    bg.classList.toggle('ready', -dx > limit);
  });
  wrap.addEventListener('pointerup', finish);
  wrap.addEventListener('pointercancel', finish);
  // пока ведём горизонтально, страница не должна «подхватывать» вертикальную прокрутку (иначе после жеста она ещё едет по инерции и съедает следующее нажатие)
  wrap.addEventListener('touchmove', e => { if (active && e.cancelable) e.preventDefault(); }, { passive: false });
  return wrap;
}

/**
 * Лента, которую можно «листать» пальцем: пока палец ведёт, элемент следует за ним; при отпускании, если протянули достаточно (больше четверти
 * ширины) или резко смахнули, элемент уезжает и вызывается onPrev (вправо) / onNext (влево); иначе возвращается на место.
 * Новое содержимое рисует вызвавший код (обычно перерисовкой с классом slide-next / slide-prev, который выезжает с нужной стороны).
 */
export function swipeSides(el, { onPrev, onNext }) {
  if (!touchOnly()) return;
  el.classList.add('swipe-x');
  let id = null, sx = 0, sy = 0, dx = 0, t0 = 0, active = false;
  const snap = () => { el.style.transition = 'transform .2s ease, opacity .2s ease'; el.style.transform = ''; el.style.opacity = ''; };
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || id != null) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; active = false; t0 = performance.now();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!active) {
      if (Math.abs(mx) < 8 || Math.abs(mx) < Math.abs(my) * 1.2) return;
      active = true;
      try { el.setPointerCapture(id); } catch { /* ignore */ }
      el.style.transition = 'none';
    }
    dx = mx;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / (el.offsetWidth * 1.4)));
  });
  const end = e => {
    if (e.pointerId !== id) return;
    const was = active, w = el.offsetWidth || 1, fast = Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.5;
    id = null; active = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!was) return;
    swallowNextClick(el);
    if (e.type !== 'pointerup' || (Math.abs(dx) < w * 0.25 && !fast)) { snap(); return; }
    // дотянули: лента уезжает за край, потом перерисовывается новая неделя, которая выезжает с противоположной стороны
    el.style.transition = 'transform .16s ease-in, opacity .16s ease-in';
    el.style.transform = `translateX(${dx > 0 ? 100 : -100}%)`;
    el.style.opacity = '0';
    setTimeout(() => (dx > 0 ? onPrev : onNext)(), 150);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('touchmove', e => { if (active && e.cancelable) e.preventDefault(); }, { passive: false });
}
