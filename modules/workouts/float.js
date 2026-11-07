// Выпадающий список подсказок под полем ввода.
// Список — обычный элемент внутри обёртки поля (position: absolute относительно неё), а не position: fixed у body:
// так он всегда рядом с полем и едет вместе с ним, как бы страница или окно ни прокручивались. На iPhone клавиатура сдвигает область просмотра
// и окно прокручивается само; фиксированные координаты при этом расходятся с полем (список оказывался у другого поля).
// Прокручиваемое окно растёт вместе со списком, поэтому он не обрезается. Если снизу не хватает видимого места (клавиатура) — раскрывается вверх.

const track = new WeakMap();
const coarse = () => matchMedia('(pointer: coarse)').matches;

function place(el, anchor) {
  if (!el.isConnected || el.hidden) return;
  const vv = window.visualViewport;
  const r = anchor.getBoundingClientRect();
  const visTop = vv ? vv.offsetTop : 0, visBottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const h = el.offsetHeight;
  // запас под панель над клавиатурой (стрелки и «галочка») и сторонние клавиатуры
  const need = h + (coarse() ? 72 : 8);
  const up = visBottom - r.bottom < need && r.top - visTop > h + 8;
  el.classList.toggle('up', up);
  el.style.touchAction = el.scrollHeight > el.clientHeight + 1 ? 'pan-y' : 'none'; // список короче окна: касание не должно прокручивать страницу под ним
}

/** Показывает список el у поля anchor (el лежит в обёртке поля). */
export function dropShow(el, anchor) {
  el.hidden = false;
  el.classList.add('drop');
  place(el, anchor);
  if (!track.has(el)) {
    const again = () => place(el, anchor);
    // клавиатура выезжает ~0,3 с и меняет видимую область: направление пересчитываем
    const late = [setTimeout(again, 150), setTimeout(again, 400), setTimeout(again, 800)];
    const vv = window.visualViewport;
    vv?.addEventListener('resize', again);
    track.set(el, () => { late.forEach(clearTimeout); vv?.removeEventListener('resize', again); });
  }
}

export function dropHide(el) {
  track.get(el)?.();
  track.delete(el);
  el.hidden = true;
}

/** Прокручивает список так, чтобы выбранный пункт был виден (только сам список: scrollIntoView на iOS мог сдвигать страницу). */
export function revealSelected(el) {
  const on = el.querySelector('.on');
  if (!on) return;
  const top = on.offsetTop, bottom = top + on.offsetHeight;
  if (top < el.scrollTop) el.scrollTop = top; else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
}

/**
 * Держит подсказки живыми, пока по ним водят пальцем: на iPhone поле может потерять фокус до того, как придёт click по пункту.
 * Возвращает функцию pressing() — «сейчас касаются списка».
 */
export function trackPress(el) {
  let down = false, t;
  el.addEventListener('pointerdown', () => { down = true; clearTimeout(t); });
  const up = () => { clearTimeout(t); t = setTimeout(() => (down = false), 400); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('mousedown', e => e.preventDefault()); // мышь: поле ввода не теряет фокус
  return () => down;
}
