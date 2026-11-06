// Popup профиля: имя/аватар (локально), вход через Google (заглушка), язык, резервная копия данных.
// Настройка модулей — общее окно «Модули» (shell.js, openStore).

import { h, raw, icon, iconBtn, toast, dismissable } from './ui.js';
import { LANGS, getSettings, saveSettings, translator } from './i18n.js';
import { getReminderSettings, saveReminderSettings, reminderOn } from './reminders.js';

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

/**
 * Загружает демо-набор demo/<имя>.json (список наборов — demo/index.json). Импорт только добавляет записи.
 * Нужен app.db; вызывается из профиля и из main.js по ссылке вида ?demo=<имя>.
 */
export async function loadDemo(app, name) {
  if (!/^[\w-]+$/.test(name)) throw new Error('Неверное имя набора');
  const res = await fetch(new URL(`demo/${name}.json`, document.baseURI), { cache: 'no-cache' });
  if (!res.ok) throw new Error('Набор не найден');
  await app.db.importAll(await res.json());
}

export function openProfile(app, anchor, startView = 'main') {
  const prev = document.querySelector('.popover');
  prev?._close?.();
  if (prev?.dataset.kind === 'profile') return; // повторное нажатие на кнопку профиля закрывает окно
  const pop = h('div', { class: 'popover profile-pop', 'data-kind': 'profile' });
  document.body.append(pop);
  const close = dismissable(pop, { ignore: [anchor] });
  pop._close = close;
  const stack = startView === 'main' ? ['main'] : ['main', startView];

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
      row('user', 'Личные данные', { sub: 'Имя, аватар, пол, дата рождения', onClick: () => go('profile') }),
      row('google', 'Войти через Google', { sub: 'Синхронизация данных между устройствами', soon: true }),
      row('bell', 'Напоминания', { sub: 'По модулям и функциям', onClick: () => go('reminders') }),
      row('grid', 'Настроить модули', { onClick: () => { close(); app.openStore(); } }), // то же окно, что и кнопка «Модули» в навигации
      row('globe', 'Язык', { sub: LANGS[getSettings().app], onClick: () => go('lang') }),
      row('database', 'Данные на устройстве', { onClick: () => go('data') }),
    ],

    profile: () => {
      const name = h('input', { class: 'input', value: app.profile.name === 'Гость' ? '' : app.profile.name, maxlength: '30', placeholder: 'Гость' });
      const preview = h('div', { class: 'avatar-preview' }, avatarEl(app.profile, 72));
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
      const draft = { ...app.profile };
      // пол и дата рождения принадлежат пользователю, а не модулю: их используют все модули (через ctx.user())
      const birth = h('input', { class: 'input', type: 'date', value: draft.birth || '', max: new Date().toISOString().slice(0, 10), min: '1900-01-01' });
      const sexBox = h('div', { class: 'size-chips' });
      const drawSex = () => sexBox.replaceChildren(...[['m', 'Мужской'], ['f', 'Женский']].map(([id, label]) =>
        h('button', { type: 'button', class: 'chip-btn' + (draft.sex === id ? ' on' : ''), onClick: () => { draft.sex = draft.sex === id ? null : id; drawSex(); } }, label)));
      drawSex();
      const refresh = () => preview.replaceChildren(avatarEl({ ...draft, name: name.value }, 72));
      file.addEventListener('change', async () => {
        if (!file.files[0]) return;
        try { draft.avatar = await resizeImage(file.files[0]); refresh(); } catch { toast('Не удалось открыть изображение'); }
      });
      name.addEventListener('input', refresh);
      return [
        head('Личные данные'),
        h('div', { class: 'form' },
          preview,
          h('div', { class: 'row-gap' },
            h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'Загрузить'),
            h('button', { class: 'btn', onClick: () => { draft.avatar = null; refresh(); } }, 'Убрать')),
          file,
          h('label', { class: 'field' }, h('span', null, 'Имя'), name),
          h('div', { class: 'field' }, h('span', null, 'Пол'), sexBox),
          h('label', { class: 'field' }, h('span', null, 'Дата рождения'), birth),
          h('p', { class: 'muted small' }, 'Пол и дата рождения нужны модулям для расчётов, например нормы калорий. Они хранятся только на этом устройстве.'),
          h('p', { class: 'muted small' }, 'Изменение доступно при локальном использовании. После входа через Google имя и аватар подтянутся из аккаунта.'),
          h('button', { class: 'btn primary', onClick: async () => {
            app.profile = { ...app.profile, name: name.value.trim(), avatar: draft.avatar, sex: draft.sex ?? null, birth: birth.value || '' };
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

    // Напоминания: общее окно для всех модулей. Каждый установленный модуль приносит свои напоминания (manifest.reminders).
    reminders: () => {
      const box = h('div', { class: 'form rem' });
      (async () => {
        const s = await getReminderSettings(app.db);
        const save = () => saveReminderSettings(app.db, s);
        const sw = (checked, label, hint, onChange) => {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = checked;
          cb.addEventListener('change', () => onChange(cb.checked));
          return h('label', { class: 'rem-row' }, cb, h('span', { class: 'grow' }, h('strong', null, label), hint ? h('span', { class: 'muted small block' }, hint) : null));
        };
        const time = (key, label) => {
          const i = h('input', { class: 'input time', type: 'time', value: s.quiet[key] });
          i.addEventListener('change', () => { if (i.value) { s.quiet[key] = i.value; save(); } });
          return h('label', { class: 'field' }, h('span', null, label), i);
        };
        const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
        const mods = app.registry.installed().filter(m => (m.reminders ?? []).length);
        const kids = [
          h('p', { class: 'muted small' }, 'Напоминания приходят, пока приложение открыто: в колокольчик, всплывающим сообщением и системным уведомлением. Без сервера доставить их в закрытое приложение нельзя.'),
          perm === 'default' ? h('button', { class: 'btn', onClick: async () => { await Notification.requestPermission(); render(); } }, 'Разрешить системные уведомления') : null,
          perm === 'granted' ? h('p', { class: 'muted small' }, 'Системные уведомления разрешены.') : null,
          perm === 'denied' ? h('p', { class: 'muted small' }, 'Системные уведомления запрещены в настройках браузера.') : null,
          h('div', { class: 'rem-group' },
            sw(s.quiet.on, 'Тихие часы', 'В это время напоминания не показываются', on => { s.quiet.on = on; save(); }),
            h('div', { class: 'row-gap' }, time('from', 'С'), time('to', 'До'))),
          ...mods.map(m => {
            const tr = translator(m.id, getSettings().app).tr;
            return h('div', { class: 'rem-group' },
              h('div', { class: 'rem-mod' }, icon(m.icon, 18), h('strong', null, raw(tr(m.name)))),
              ...m.reminders.map(r => sw(reminderOn(s, m.id, r), raw(tr(r.title)), r.description ? raw(tr(r.description)) : null, on => { s.enabled[`${m.id}.${r.id}`] = on; save(); })));
          }),
          mods.length ? null : h('p', { class: 'muted' }, 'Установленные модули пока не предлагают напоминаний. Они появятся здесь сами, когда вы скачаете модуль с напоминаниями (например, «Дневник питания»).'),
        ].filter(Boolean);
        box.replaceChildren(...kids);
      })();
      return [head('Напоминания'), box];
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
      // тестовые наборы данных из demo/ (если папка есть): одна кнопка вместо выбора файла
      const demoBox = h('div', { class: 'form' });
      fetch(new URL('demo/index.json', document.baseURI), { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
        .then(list => {
          if (!list.length) return;
          demoBox.replaceChildren(
            h('strong', null, 'Демо-данные'),
            h('p', { class: 'muted small' }, 'Тестовые наборы для проверки модулей. Загрузка только добавляет записи.'),
            ...list.map(d => h('button', { class: 'btn', onClick: async () => {
              try {
                await loadDemo(app, d.file);
                toast('Демо-данные загружены. Перезагрузка…');
                setTimeout(() => location.reload(), 800);
              } catch (e) { toast(app.t(e.message)); }
            } }, icon('download', 16), raw(d.title))));
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
        demoBox,
      ];
    },
  };

  function go(v) { stack.push(v); render(); }
  function render() { pop.replaceChildren(...views[stack.at(-1)]().filter(Boolean)); }
  render();
  return close;
}
