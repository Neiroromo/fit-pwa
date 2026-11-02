// Каркас приложения: статичная навигация (слева на ПК, снизу на телефоне),
// магазин модулей («+») и уведомления.

import { h, icon, modal, toast, dismissable } from './ui.js';
import { openProfile, avatarEl } from './profile.js';

export function buildShell(app) {
  const { registry, router } = app;
  const list = h('div', { class: 'nav-list' });
  const profileName = h('span', { class: 'profile-name' });
  let profileAv = h('span');
  const profileBtn = h('button', { class: 'profile-btn', title: 'Профиль и настройки', onClick: () => openProfile(app, profileBtn) }, profileAv, profileName);
  const bellDot = h('span', { class: 'dot', hidden: true });
  const bellBtn = h('button', { class: 'icon-btn bell', title: 'Уведомления', 'aria-label': 'Уведомления', onClick: () => openNotifications(app, bellBtn) }, icon('bell'), bellDot);
  const nav = h('nav', { class: 'nav' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'F'), h('span', { class: 'brand-name' }, 'Fit')),
    list,
    h('div', { class: 'nav-foot' }, profileBtn, bellBtn),
  );
  const view = h('main', { id: 'view' });
  const root = h('div', { class: 'shell' }, nav, view);

  function renderNav() {
    const cur = router.current();
    list.replaceChildren(
      ...registry.navItems().map(m =>
        h('a', { class: 'nav-item' + (m.id === cur ? ' active' : ''), href: '#/' + m.id, title: m.name },
          icon(m.icon, 22), h('span', { class: 'nav-label' }, m.name))),
      h('button', { class: 'nav-item add', title: 'Скачать модуль', onClick: () => openStore(app) },
        icon('plus', 22), h('span', { class: 'nav-label' }, 'Модули')),
    );
  }

  function renderProfile() {
    const p = app.profile;
    profileName.textContent = p.name;
    profileAv.replaceWith(profileAv = avatarEl(p, 32));
  }

  async function refreshBell() {
    const items = await app.db.collection('app/notifications').list();
    bellDot.hidden = !items.some(n => !n.read);
  }

  return { root, view, renderNav, renderProfile, refreshBell };
}

// ---------- Магазин модулей ----------

export function openStore(app) {
  const { registry } = app;
  const body = h('div', { class: 'store' });
  const m = modal({ title: 'Модули', body, wide: true });

  function render() {
    const items = registry.catalog();
    if (!items.length) {
      body.replaceChildren(h('p', { class: 'muted' }, 'Каталог недоступен. Проверьте подключение к интернету.'));
      return;
    }
    body.replaceChildren(h('p', { class: 'muted' }, 'Скачайте только то, что нужно. Модули загружаются из репозитория проекта и работают офлайн.'),
      ...items.map(item => {
        const inst = registry.isInstalled(item.id);
        const status = h('div', { class: 'store-status' });
        if (!item.available) status.append(h('span', { class: 'chip' }, 'Скоро'));
        else if (inst) {
          status.append(h('span', { class: 'chip ok' }, 'Установлен'));
          if (registry.needsUpdate(item.id)) status.append(downloadBtn(item, 'Обновить'));
        } else status.append(downloadBtn(item, 'Скачать'));
        return h('div', { class: 'store-item' + (item.available ? '' : ' disabled') },
          h('div', { class: 'store-ico' }, icon(item.icon, 24)),
          h('div', { class: 'store-info' },
            h('strong', null, item.name),
            h('span', { class: 'muted' }, item.description),
            item.available ? h('span', { class: 'muted small' }, `v${item.version} · ${item.size ?? ''}`) : null),
          status);
      }));
  }

  function downloadBtn(item, label) {
    const btn = h('button', { class: 'btn primary' }, icon('download', 16), label);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.replaceChildren('0%');
      try {
        const updating = registry.isInstalled(item.id);
        await registry.install(item.id, p => (btn.textContent = Math.round(p * 100) + '%'));
        toast(updating ? `«${item.name}» обновлён. Перезагрузите страницу.` : `«${item.name}» скачан`);
      } catch (e) {
        toast('Ошибка загрузки: ' + e.message);
      }
      render();
    });
    return btn;
  }

  const unsub = registry.subscribe(() => app.shell.renderNav());
  render();
  const origClose = m.close;
  m.close = () => { unsub(); origClose(); };
  return m;
}

// ---------- Уведомления ----------

export async function openNotifications(app, anchor) {
  document.querySelector('.popover')?.remove();
  const col = app.db.collection('app/notifications');
  const pop = h('div', { class: 'popover' });
  document.body.append(pop);
  const close = dismissable(pop, { ignore: [anchor] });

  async function render() {
    const items = (await col.list()).sort((a, b) => b.ts - a.ts);
    pop.replaceChildren(
      h('div', { class: 'pop-head' }, h('strong', null, 'Уведомления'),
        items.length ? h('button', { class: 'link', onClick: async () => {
          for (const n of items) await col.remove(n.id);
          app.shell.refreshBell();
          render();
        } }, 'Очистить') : null),
      items.length
        ? h('div', { class: 'notif-list' }, items.map(n =>
          h('div', { class: 'notif' + (n.read ? '' : ' unread') }, h('span', null, n.text),
            h('span', { class: 'muted small' }, new Date(n.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })))))
        : h('p', { class: 'muted empty' }, 'Пока ничего нового'),
    );
    for (const n of items.filter(n => !n.read)) await col.put({ ...n, read: true });
    app.shell.refreshBell();
  }
  render();
  return close;
}
