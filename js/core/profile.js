// Popup профиля: имя/аватар (локально), вход через Google (заглушка), язык, резервная копия данных.
// Настройка модулей — общее окно «Модули» (shell.js, openStore).

import { h, raw, icon, iconBtn, toast, dismissable } from './ui.js';
import { LANGS, getSettings, saveSettings, translator } from './i18n.js';

/** Имя для показа: введённое пользователем как есть; если не задано (или осталось старое «Гость») — «Гость» на языке приложения. */
export const shownName = p => (p.name && p.name !== 'Гость' ? p.name : translator('app').t('Гость'));

export function avatarEl(profile, size = 36) {
  const el = h('span', { class: 'avatar', style: { width: size + 'px', height: size + 'px', fontSize: size * 0.42 + 'px' } });
  if (profile.avatar) el.append(h('img', { src: profile.avatar, alt: '' }));
  else el.textContent = shownName(profile).trim().charAt(0).toUpperCase();
  return el;
}

function resizeImage(file, max = 160) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function openProfile(app, anchor) {
  const prev = document.querySelector('.popover');
  prev?._close?.();
  if (prev?.dataset.kind === 'profile') return; // повторное нажатие на кнопку профиля закрывает окно
  const pop = h('div', { class: 'popover profile-pop', 'data-kind': 'profile' });
  document.body.append(pop);
  const close = dismissable(pop, { ignore: [anchor] });
  pop._close = close;
  const stack = ['main'];

  const row = (ico, label, { sub, onClick, soon } = {}) =>
    h('button', { class: 'menu-row', disabled: !!soon, onClick },
      icon(ico, 20),
      h('span', { class: 'grow' }, label, sub ? h('small', { class: 'muted' }, sub) : null),
      soon ? h('span', { class: 'chip' }, 'Скоро') : icon('chevR', 18));

  const head = (title, back = true) =>
    h('div', { class: 'pop-head' },
      back ? iconBtn('chevL', 'Назад', () => { stack.pop(); render(); }) : null,
      h('strong', null, title));

  const views = {
    main: () => [
      h('div', { class: 'profile-card' }, avatarEl(app.profile, 48),
        h('div', null, h('strong', null, raw(shownName(app.profile))), h('div', { class: 'muted small' }, 'Локальный профиль'))),
      row('user', 'Имя и аватар', { onClick: () => go('profile') }),
      row('google', 'Войти через Google', { sub: 'Синхронизация данных между устройствами', soon: true }),
      row('grid', 'Настроить модули', { onClick: () => { close(); app.openStore(); } }), // то же окно, что и кнопка «Модули» в навигации
      row('globe', 'Язык', { sub: LANGS[getSettings().app], onClick: () => go('lang') }),
      row('database', 'Данные на устройстве', { onClick: () => go('data') }),
    ],

    profile: () => {
      const name = h('input', { class: 'input', value: app.profile.name === 'Гость' ? '' : app.profile.name, maxlength: '30', placeholder: 'Гость' });
      const preview = h('div', { class: 'avatar-preview' }, avatarEl(app.profile, 72));
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
      const draft = { ...app.profile };
      const refresh = () => preview.replaceChildren(avatarEl({ ...draft, name: name.value }, 72));
      file.addEventListener('change', async () => {
        if (!file.files[0]) return;
        try { draft.avatar = await resizeImage(file.files[0]); refresh(); } catch { toast('Не удалось открыть изображение'); }
      });
      name.addEventListener('input', refresh);
      return [
        head('Имя и аватар'),
        h('div', { class: 'form' },
          preview,
          h('div', { class: 'row-gap' },
            h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'Загрузить'),
            h('button', { class: 'btn', onClick: () => { draft.avatar = null; refresh(); } }, 'Убрать')),
          file,
          h('label', { class: 'field' }, h('span', null, 'Имя'), name),
          h('p', { class: 'muted small' }, 'Изменение доступно при локальном использовании. После входа через Google имя и аватар подтянутся из аккаунта.'),
          h('button', { class: 'btn primary', onClick: async () => {
            app.profile = { name: name.value.trim(), avatar: draft.avatar };
            await app.db.kv.set('app/profile', app.profile);
            app.shell.renderProfile();
            stack.pop(); render();
            toast('Профиль сохранён');
          } }, 'Сохранить')),
      ];
    },

    // Язык: приложение целиком, отдельные модули и контент модулей (например, названия и техника упражнений) настраиваются независимо
    lang: () => {
      const cur = getSettings();
      const draft = { app: cur.app, modules: { ...cur.modules }, content: { ...cur.content } };
      const select = (value, options, onChange) => {
        const el = h('select', { class: 'input' }, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
        el.addEventListener('change', () => onChange(el.value));
        return el;
      };
      const langOptions = Object.entries(LANGS);
      const withAuto = (autoLabel) => [['auto', autoLabel], ...langOptions];
      const items = [{ id: 'hub', name: 'Хаб', content: [] }, ...app.registry.installed()];
      const trIn = id => translator(id, cur.app).tr; // названия модулей и контента — словарём модуля на язык приложения
      return [
        head('Язык'),
        h('div', { class: 'form' },
          h('label', { class: 'field' }, h('span', null, 'Язык приложения'), select(draft.app, langOptions, v => { draft.app = v; })),
          h('p', { class: 'muted small' }, 'Каждый модуль и его контент можно переключить отдельно. «Как в приложении» — язык следует за настройкой выше.'),
          ...items.flatMap(m => [
            h('strong', { class: 'lang-mod' }, trIn(m.id)(m.name)),
            h('label', { class: 'field' }, h('span', null, 'Интерфейс модуля'),
              select(draft.modules[m.id] ?? 'auto', withAuto('Как в приложении'), v => { draft.modules[m.id] = v; })),
            ...(m.content ?? []).map(c => h('label', { class: 'field' }, h('span', null, trIn(m.id)(c.title)),
              select(draft.content[`${m.id}.${c.id}`] ?? 'auto', withAuto('Как у модуля'), v => { draft.content[`${m.id}.${c.id}`] = v; }))),
          ]),
          h('button', { class: 'btn primary', onClick: async () => {
            await saveSettings(app.db, draft);
            toast('Язык сохранён. Перезагрузка…');
            setTimeout(() => location.reload(), 600);
          } }, 'Применить')),
      ];
    },

    data: () => {
      const file = h('input', { type: 'file', accept: 'application/json', hidden: true });
      file.addEventListener('change', async () => {
        try {
          await app.db.importAll(JSON.parse(await file.files[0].text()));
          toast('Данные восстановлены. Перезагрузка…');
          setTimeout(() => location.reload(), 800);
        } catch (e) { toast(e.message ? app.t(e.message) : 'Не удалось прочитать файл'); }
      });
      return [
        head('Данные на устройстве'),
        h('div', { class: 'form' },
          h('p', { class: 'muted small' }, 'В бета-версии все данные хранятся только в этом браузере. Делайте резервные копии. Позже данные переедут в ваш Google-профиль.'),
          h('button', { class: 'btn', onClick: async () => {
            const blob = new Blob([JSON.stringify(await app.db.exportAll(), null, 1)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `fit-backup-${new Date().toISOString().slice(0, 10)}.json` });
            a.click();
            URL.revokeObjectURL(a.href);
          } }, icon('download', 16), 'Экспорт в файл'),
          h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'Импорт из файла'),
          file),
      ];
    },
  };

  function go(v) { stack.push(v); render(); }
  function render() { pop.replaceChildren(...views[stack.at(-1)]().filter(Boolean)); }
  render();
  return close;
}
