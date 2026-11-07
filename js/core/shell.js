// Каркас приложения: статичная навигация (слева на ПК, снизу на телефоне),
// магазин модулей («+») и уведомления.

import { h, icon, iconBtn, modal, toast, dismissable, confirmDialog } from './ui.js';
import { openProfile, avatarEl, shownName } from './profile.js';
import { translator, getSettings } from './i18n.js';

export function buildShell(app) {
  const { registry, router } = app;
  const list = h('div', { class: 'nav-list' });
  const pin = h('div', { class: 'nav-pin' }); // Хаб всегда на месте, остальные модули прокручиваются
  const profileName = h('span', { class: 'profile-name' });
  let profileAv = h('span');
  const profileBtn = h('button', { class: 'profile-btn', title: 'Профиль и настройки', onClick: () => openProfile(app, profileBtn) }, profileAv, profileName);
  const bellDot = h('span', { class: 'dot', hidden: true });
  const bellBtn = h('button', { class: 'icon-btn bell', title: 'Уведомления', 'aria-label': 'Уведомления', onClick: () => openNotifications(app, bellBtn) }, icon('bell'), bellDot);
  const nav = h('nav', { class: 'nav' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'F'), h('span', { class: 'brand-name' }, 'Fit')),
    pin,
    list,
    h('div', { class: 'nav-foot' }, profileBtn, bellBtn),
  );
  const view = h('main', { id: 'view' });
  const root = h('div', { class: 'shell' }, nav, view);

  function renderNav() {
    const cur = router.current();
    const link = m => h('a', { class: 'nav-item' + (m.id === cur ? ' active' : ''), href: '#/' + m.id, title: m.name, 'data-id': m.id, draggable: 'false' },
      icon(m.icon, 22), h('span', { class: 'nav-label' }, m.name),
      registry.needsUpdate(m.id) ? h('span', { class: 'upd-dot', title: 'Доступно обновление' }) : null);
    const items = registry.navItems();
    pin.replaceChildren(...items.filter(m => m.id === 'hub').map(link));
    list.replaceChildren(
      ...items.filter(m => m.id !== 'hub').map(link),
      h('button', { class: 'nav-item add', title: 'Скачать модуль', onClick: () => openStore(app) },
        icon('plus', 22), h('span', { class: 'nav-label' }, 'Модули')),
    );
  }

  // Нижняя панель на телефоне: модуль можно зажать и перетащить по списку (порядок сохраняется). Без отдельного окна.
  const HOLD_MS = 320;
  let drag = null; // активное перетаскивание
  const phoneNav = () => matchMedia('(max-width: 720px)').matches;
  list.addEventListener('pointerdown', e => {
    const item = e.target.closest('.nav-item[data-id]');
    if (!item || !phoneNav() || drag || e.button > 0) return;
    const st = { item, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, timer: null, dx: 0, to: 0, from: 0 };
    drag = st;
    st.timer = setTimeout(() => {
      const items = [...list.querySelectorAll('.nav-item[data-id]')];
      st.items = items; st.from = st.to = items.indexOf(item);
      st.rects = items.map(x => x.getBoundingClientRect());
      st.step = st.rects.length > 1 ? st.rects[1].left - st.rects[0].left : st.rects[0].width;
      st.scroll0 = list.scrollLeft;
      st.active = true;
      try { item.setPointerCapture(st.id); } catch { /* ignore */ }
      navigator.vibrate?.(12);
      list.classList.add('sorting');
      item.classList.add('lifted');
      items.forEach(x => { if (x !== item) x.style.transition = 'transform .15s ease'; });
    }, HOLD_MS);
  });
  list.addEventListener('pointermove', e => {
    const st = drag;
    if (!st || e.pointerId !== st.id) return;
    if (!st.active) { // сдвинулись до конца удержания: это обычная прокрутка списка
      if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 8) { clearTimeout(st.timer); drag = null; }
      return;
    }
    const dx = e.clientX - st.x0 + (list.scrollLeft - st.scroll0);
    st.dx = dx;
    st.item.style.transform = `translateX(${dx}px)`;
    const centre = st.rects[st.from].left + st.rects[st.from].width / 2 + dx;
    st.to = st.rects.reduce((n, r, k) => (centre > r.left + r.width / 2 ? k : n), 0);
    st.items.forEach((x, k) => {
      if (x === st.item) return;
      x.style.transform = st.from < st.to && k > st.from && k <= st.to ? `translateX(${-st.step}px)` : st.from > st.to && k < st.from && k >= st.to ? `translateX(${st.step}px)` : '';
    });
    const lr = list.getBoundingClientRect(); // у края панели список прокручивается сам
    if (e.clientX < lr.left + 36) list.scrollLeft -= 6; else if (e.clientX > lr.right - 36) list.scrollLeft += 6;
  });
  const endDrag = e => {
    const st = drag;
    if (!st || e.pointerId !== st.id) return;
    clearTimeout(st.timer);
    drag = null;
    if (!st.active) return;
    list.classList.remove('sorting');
    st.item.classList.remove('lifted');
    st.items.forEach(x => { x.style.transform = ''; x.style.transition = ''; });
    // отпускание не должно открывать модуль
    const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, true), 500);
    if (e.type === 'pointerup' && st.to !== st.from) registry.moveTo(st.item.dataset.id, st.to);
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);
  // пока модуль «взят», список не должен прокручиваться пальцем; контекстное меню долгого нажатия отключено
  list.addEventListener('touchmove', e => { if (drag?.active && e.cancelable) e.preventDefault(); }, { passive: false });
  list.addEventListener('contextmenu', e => { if (phoneNav()) e.preventDefault(); });

  function renderProfile() {
    const p = app.profile;
    profileName.textContent = shownName(p);
    profileAv.replaceWith(profileAv = avatarEl(p, 32));
  }

  window.addEventListener('fitpwa:google', renderProfile); // вход/выход Google меняет имя в блоке профиля

  async function refreshBell() {
    const items = await app.db.collection('app/notifications').list();
    bellDot.hidden = !items.some(n => !n.read);
  }

  return { root, view, renderNav, renderProfile, refreshBell };
}

// ---------- Обновление модулей ----------

/** Скачивает новую версию модуля и перезапускает страницу, чтобы всё применилось сразу. */
export async function updateModule(app, id, onProgress) {
  await app.registry.install(id, onProgress);
  location.reload();
  await new Promise(() => {}); // до перезагрузки ничего больше не делаем
}

/** Кнопка «Обновить» для заголовка модуля. */
export function updateButton(app, id) {
  const btn = h('button', { class: 'btn primary upd-btn', title: 'Скачать обновление модуля и перезапустить страницу' }, icon('download', 14), 'Обновить');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.replaceChildren('0%');
    try {
      await updateModule(app, id, p => (btn.textContent = Math.round(p * 100) + '%'));
    } catch (e) {
      btn.disabled = false;
      btn.replaceChildren(icon('download', 14), app.t('Обновить'));
      toast(app.t('Ошибка загрузки: {msg}', { msg: e.message }));
    }
  });
  return btn;
}

/** Уведомление о доступных обновлениях (по одному на версию модуля). */
export async function notifyUpdates(app) {
  const col = app.db.collection('app/notifications');
  const have = new Set((await col.list()).map(n => n.upd).filter(Boolean));
  for (const m of app.registry.installed()) {
    if (!app.registry.needsUpdate(m.id)) continue;
    const cat = app.registry.catalog().find(c => c.id === m.id);
    const key = `${m.id}@${cat.version}`;
    if (have.has(key)) continue;
    await col.put({ text: app.t('Доступно обновление «{name}» до версии {version}', { name: translator('app').tr(m.name), version: cat.version }), ts: Date.now(), read: false, upd: key });
  }
  app.shell.refreshBell();
}

// ---------- Магазин модулей ----------

export function openStore(app, { onClose } = {}) {
  const { registry } = app;
  const { tr } = translator('app');
  const body = h('div', { class: 'store' });
  let unsub = () => {};
  // onClose — куда вернуться после закрытия (например, в настройки профиля, если окно открыто оттуда)
  const m = modal({ title: 'Модули', body, wide: true, onClose: () => { unsub(); onClose?.(); } });
  const nameOf = mod => translator(mod.id, getSettings().app).tr(mod.name);

  const section = (title, rows) => (rows.length ? h('div', { class: 'store-section' }, h('h3', { class: 'store-title' }, title), ...rows) : null);

  const card = (ico, name, desc, version, actions, disabled = false, handle = null, inline = !!handle) =>
    h('div', { class: 'store-item' + (disabled ? ' disabled' : '') + (inline ? ' inline' : '') },
      handle,
      h('div', { class: 'store-ico' }, icon(ico, 24)),
      h('div', { class: 'store-info' },
        h('strong', null, name),
        desc ? h('span', { class: 'muted' }, desc) : null,
        version ? h('span', { class: 'muted small' }, version) : null),
      h('div', { class: 'store-status' }, ...actions));

  function render() {
    const installed = registry.installed();
    const catalog = registry.catalog();
    const have = new Set(installed.map(x => x.id));
    const info = id => catalog.find(c => c.id === id);

    const installedRows = [
      card('home', 'Хаб', 'Виджеты ваших модулей', null, [h('span', { class: 'chip' }, 'основной')], false, null, true),
      ...installed.map((mod, i) => {
        const cat = info(mod.id);
        const el = card(mod.icon, nameOf(mod), cat ? tr(cat.description) : '', `v${mod.version}`, [
          h('div', { class: 'row-gap' },
            registry.needsUpdate(mod.id) ? downloadBtn(cat, 'Обновить') : null,
            iconBtn('chevU', 'Выше', () => registry.move(mod.id, -1), 'store-arrow' + (i === 0 ? ' off' : '')),
            iconBtn('chevD', 'Ниже', () => registry.move(mod.id, 1), 'store-arrow' + (i === installed.length - 1 ? ' off' : '')),
            iconBtn('trash', 'Удалить', () => removeModule(mod), 'danger')),
        ], false, h('button', { class: 'drag-handle', title: 'Перетащить, чтобы изменить порядок', 'aria-label': 'Перетащить' }, icon('grip', 18)));
        el.dataset.id = mod.id;
        el.classList.add('sortable');
        return el;
      }),
    ];
    const free = catalog.filter(c => !have.has(c.id));
    const available = free.filter(c => c.available).map(c => card(c.icon, tr(c.name), tr(c.description), `v${c.version} · ${c.size ?? ''}`, [downloadBtn(c, 'Скачать')]));
    const soon = free.filter(c => !c.available).map(c => card(c.icon, tr(c.name), tr(c.description), null, [h('span', { class: 'chip' }, 'Скоро')], true));

    body.replaceChildren(...[
      h('p', { class: 'muted store-intro' }, 'Скачайте только то, что нужно. Модули загружаются из репозитория проекта и работают офлайн.'),
      section('Установленные', installedRows),
      section('Можно установить', available),
      section('Скоро', soon),
      catalog.length ? null : h('p', { class: 'muted' }, 'Каталог недоступен. Проверьте подключение к интернету.'),
    ].filter(Boolean));
  }

  async function removeModule(mod) {
    const ok = await confirmDialog(app.t('Удалить модуль «{name}» с устройства? Ваши данные сохранятся и вернутся при повторной установке.', { name: nameOf(mod) }), { okText: 'Удалить', danger: true });
    if (!ok) return;
    await registry.uninstall(mod.id);
    if (app.router.current() === mod.id) app.router.go('hub');
  }

  function downloadBtn(item, label) {
    const btn = h('button', { class: 'btn primary' }, icon('download', 16), label);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.replaceChildren('0%');
      try {
        const updating = registry.isInstalled(item.id);
        if (updating) return updateModule(app, item.id, p => (btn.textContent = Math.round(p * 100) + '%')); // скачивает и перезапускает страницу
        await registry.install(item.id, p => (btn.textContent = Math.round(p * 100) + '%'));
        toast(app.t('«{name}» скачан', { name: tr(item.name) }));
      } catch (e) {
        toast(app.t('Ошибка загрузки: {msg}', { msg: e.message }));
        render();
      }
    });
    return btn;
  }

  // любое изменение набора или порядка модулей перерисовывает и навигацию, и это окно
  unsub = registry.subscribe(() => { app.shell.renderNav(); render(); });
  render();

  // Перетаскивание модулей за ручку слева: карточка следует за пальцем или мышью, остальные расступаются; при отпускании порядок сохраняется.
  body.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.drag-handle');
    const item = handle?.closest('.sortable');
    if (!item || e.button > 0) return;
    e.preventDefault();
    const items = [...body.querySelectorAll('.sortable')];
    const from = items.indexOf(item);
    const rects = items.map(x => x.getBoundingClientRect());
    const startY = e.clientY, step = rects[from].height + (rects[1] ? rects[1].top - rects[0].bottom : 8);
    let to = from;
    handle.setPointerCapture(e.pointerId);
    item.classList.add('dragging');
    items.forEach(x => { if (x !== item) x.style.transition = 'transform .15s ease'; });
    const scroller = body.closest('.modal-body');
    const move = ev => {
      const dy = ev.clientY - startY;
      item.style.transform = `translateY(${dy}px)`;
      const centre = rects[from].top + rects[from].height / 2 + dy;
      to = items.reduce((n, _, k) => (centre > rects[k].top + rects[k].height / 2 ? k : n), 0);
      items.forEach((x, k) => {
        if (x === item) return;
        x.style.transform = from < to && k > from && k <= to ? `translateY(${-step}px)` : from > to && k < from && k >= to ? `translateY(${step}px)` : '';
      });
      if (scroller) { // у края окна список прокручивается сам
        const r = scroller.getBoundingClientRect();
        if (ev.clientY < r.top + 40) scroller.scrollTop -= 8; else if (ev.clientY > r.bottom - 40) scroller.scrollTop += 8;
      }
    };
    const end = ev => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      item.classList.remove('dragging');
      items.forEach(x => { x.style.transform = ''; x.style.transition = ''; });
      if (ev.type === 'pointerup' && to !== from) registry.moveTo(item.dataset.id, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  return m;
}

// ---------- Уведомления ----------

export async function openNotifications(app, anchor) {
  const prev = document.querySelector('.popover');
  prev?._close?.();
  if (prev?.dataset.kind === 'notifications') return; // повторное нажатие на колокольчик закрывает окно
  const col = app.db.collection('app/notifications');
  const pop = h('div', { class: 'popover', 'data-kind': 'notifications' });
  document.body.append(pop);
  const close = dismissable(pop, { ignore: [anchor] });
  pop._close = close;

  async function render() {
    const items = (await col.list()).sort((a, b) => b.ts - a.ts);
    pop.replaceChildren(
      h('div', { class: 'pop-head' }, h('strong', null, 'Уведомления'),
        iconBtn('sliders', 'Настроить напоминания', () => { pop._close?.(); document.querySelector('.profile-btn') && import('./profile.js').then(m => m.openProfile(app, document.querySelector('.profile-btn'), 'reminders')); }),
        items.length ? h('button', { class: 'link', onClick: async () => {
          for (const n of items) await col.remove(n.id);
          app.shell.refreshBell();
          render();
        } }, 'Очистить') : null),
      items.length
        ? h('div', { class: 'notif-list' }, items.map(n =>
          h('div', { class: 'notif' + (n.read ? '' : ' unread') }, h('span', null, n.text),
            h('span', { class: 'muted small' }, new Date(n.ts).toLocaleString(translator('app').locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })))))
        : h('p', { class: 'muted empty' }, 'Пока ничего нового'),
    );
    for (const n of items.filter(n => !n.read)) await col.put({ ...n, read: true });
    app.shell.refreshBell();
  }
  render();
  return close;
}
