// Мини-хелперы для DOM без фреймворка: h(), иконки, модальные окна, тосты.
// Строки, попадающие в DOM через h() и диалоги, проходят через переводчик (см. i18n.js):
// ядро использует общий переводчик, а каждый модуль получает свою копию (createUi) с языком модуля.

const same = s => s;
let appTr = same;
export const setAppTranslator = fn => { appTr = fn ?? same; };

const TR_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);

function makeH(getTr) {
  return function h(tag, props, ...kids) {
    const tr = getTr();
    const el = document.createElement(tag);
    for (const [k, raw] of Object.entries(props ?? {})) {
      const v = typeof raw === 'string' && TR_ATTRS.has(k) ? tr(raw) : raw;
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    append(el, kids, tr);
    return el;
  };
}

export function append(el, kids, tr = same) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(typeof k === 'string' ? tr(k) : String(k)));
  }
  return el;
}

/** Уникальный id. crypto.randomUUID есть только в защищённом контексте (https или localhost), а по http://IP-адрес его нет: тогда getRandomValues. */
export const uid = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  sliders: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  chevU: '<path d="M6 15l6-6 6 6"/>',
  grip: '<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  skip: '<path d="M5 5l9 7-9 7zM19 5v14"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  nutrition: '<path d="M12 7c-3-2-7 0-7 5 0 4 3 8 5 8 1 0 1-.5 2-.5s1 .5 2 .5c2 0 5-4 5-8 0-5-4-7-7-5z"/><path d="M12 7c0-2 1-3 3-4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  google: '<path d="M20 12h-8M20 12a8 8 0 1 1-2.3-5.7"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h0"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3M20 14v1M14 20h2M20 18v2h-2"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v3.5c0 1.5 2 3 5 5.5-3 2.5-5 4-5 5.5V21M17 3v3.5c0 1.5-2 3-5 5.5 3 2.5 5 4 5 5.5V21"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  chart: '<path d="M4 4v16h16"/><path d="M7 15l4-4 3 3 5-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  swap: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
  undo: '<path d="M9 6L4 11l5 5M4 11h9a5 5 0 0 1 0 10h-4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 3h6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  drop: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
  pill: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-40 12 12)"/><path d="M9.5 8.7l5.8 6.6"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.setProperty('--s', size + 'px');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.grid}</svg>`;
  return span;
}

/** Набор хелперов с переводчиком getTr(): строки переводятся, текст из raw() — нет (данные пользователя, контент). */
export function createUi(getTr = () => appTr) {
  const h = makeH(getTr);
  /** Текстовый узел без перевода: названия упражнений, технику и прочий контент передают через него. */
  const raw = s => document.createTextNode(String(s ?? ''));

  function iconBtn(name, title, onClick, cls = '') {
    return h('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, onClick }, icon(name, 20));
  }

  /** Модальное окно. body — Node или массив; actions — массив кнопок. */
  function modal({ title, body, actions, wide = false, onClose } = {}) {
    const overlay = h('div', { class: 'overlay' });
    const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      document.body.classList.toggle('modal-open', !!document.querySelector('.overlay, .popover')); // фон снова прокручивается, когда закрыто последнее окно
      onClose?.();
    };
    const onKey = e => e.key === 'Escape' && close();
    box.append(
      h('div', { class: 'modal-head' }, h('h2', null, title ?? ''), iconBtn('x', 'Закрыть', close)),
      h('div', { class: 'modal-body' }, body),
    );
    if (actions?.length) box.append(h('div', { class: 'modal-actions' }, actions));
    overlay.append(box);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) { close(); swallowNextClick(); } }); // нажатие на фон только закрывает окно, кнопка под фоном не срабатывает
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    document.body.classList.add('modal-open'); // пока окно открыто, страница под ним не прокручивается
    return { el: box, close };
  }

  function confirmDialog(text, { okText = 'Ок', danger = false, title = 'Подтвердите' } = {}) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } m.close(); };
      const m = modal({
        title,
        body: h('p', null, text),
        actions: [
          h('button', { class: 'btn', onClick: () => finish(false) }, 'Отмена'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => finish(true) }, okText),
        ],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  }

  /** Всплывающее сообщение. С opts.action («Отменить») показывается дольше и содержит кнопку: onAction вызывается по нажатию. */
  function toast(text, opts) {
    document.querySelector('.toast')?.remove();
    const t = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'toast-text' }, text),
      opts?.action ? h('button', { class: 'toast-act', onClick: () => { clearTimeout(toastTimer); t.remove(); opts.onAction?.(); } }, opts.action) : null);
    const ms = opts?.action ? 7000 : 2600;
    // нижний край сообщения постепенно заполняется цветом: так видно, когда оно исчезнет
    const bar = h('i', { class: 'toast-bar', 'aria-hidden': 'true' });
    bar.style.animationDuration = ms + 'ms';
    t.append(bar);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
    swipeDownToDismiss(t, () => { clearTimeout(toastTimer); t.remove(); });
  }

  /** На телефоне сообщение можно смахнуть вниз. */
  function swipeDownToDismiss(el, onDismiss) {
    if (!matchMedia('(pointer: coarse)').matches) return;
    let id = null, sy = 0, dy = 0;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || id != null || e.target.closest('.toast-act')) return;
      id = e.pointerId; sy = e.clientY; dy = 0;
      el.style.transition = 'none';
      try { el.setPointerCapture(id); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - sy); // вверх не тянется
      el.style.transform = `translateY(${dy}px)`;
      el.style.opacity = String(Math.max(0.3, 1 - dy / 120));
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      el.style.transition = 'transform .18s ease, opacity .18s ease';
      if (e.type === 'pointerup' && dy > 36) {
        el.style.transform = 'translateY(140%)'; el.style.opacity = '0';
        setTimeout(onDismiss, 170);
      } else { el.style.transform = ''; el.style.opacity = ''; }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  return { h, raw, icon, iconBtn, modal, confirmDialog, toast, uid, clamp, dismissable };
}

let toastTimer;

/** Закрывается по клику вне и Escape. Возвращает close(). */
/** Гасит ближайший click (на 500 мс): им заканчивается нажатие, которым закрыли окно, и оно не должно попасть в кнопку под фоном. */
function swallowNextClick() {
  const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, true), 500);
}

export function dismissable(el, { ignore = [], onClose } = {}) {
  document.body.classList.add('modal-open'); // пока открыто всплывающее окно, страница под ним не прокручивается
  const close = () => {
    el.remove();
    document.body.classList.toggle('modal-open', !!document.querySelector('.overlay, .popover'));
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onDown = e => {
    if (el.contains(e.target) || ignore.some(i => i?.contains(e.target))) return;
    if (!el.isConnected) { close(); return; } // окно уже убрано другим путём: только снять слушатели, нажатие не гасим
    close();
    swallowNextClick(); // нажатие на фон только закрывает окно: следующий за ним click на кнопке под фоном не должен сработать
  };
  const onKey = e => e.key === 'Escape' && close();
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  document.addEventListener('keydown', onKey);
  return close;
}

export const ui = createUi();
export const { h, raw, iconBtn, modal, confirmDialog, toast } = ui;
