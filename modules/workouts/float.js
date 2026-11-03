// Выпадающий список подсказок поверх интерфейса: position: fixed у поля ввода, не двигает вёрстку и не создаёт прокрутку.
// Если снизу не хватает места — раскрывается вверх.

const track = new WeakMap();

export function floatShow(el, anchor) {
  if (!el.isConnected) document.body.append(el);
  el.hidden = false;
  el.classList.add('float');
  const place = () => {
    if (!el.isConnected) return;
    const r = anchor.getBoundingClientRect();
    el.style.left = r.left + 'px';
    el.style.width = r.width + 'px';
    const h = el.offsetHeight;
    const below = innerHeight - r.bottom;
    el.style.top = (below < h + 8 && r.top > h + 8 ? r.top - h - 4 : r.bottom + 4) + 'px';
  };
  place();
  if (!track.has(el)) {
    // страница или окно прокручиваются / меняют размер — подсказки едут за полем
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    track.set(el, () => { removeEventListener('scroll', place, true); removeEventListener('resize', place); });
  }
}

export function floatHide(el) {
  track.get(el)?.();
  track.delete(el);
  el.hidden = true;
  el.remove();
}
