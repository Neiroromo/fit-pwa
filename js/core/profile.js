// Popup профиля: имя/аватар (локально), вход через Google (заглушка), язык, резервная копия данных.
// Настройка модулей — общее окно «Модули» (shell.js, openStore).

import { h, raw, icon, iconBtn, toast, dismissable, confirmDialog } from './ui.js';
import { LANGS, getSettings, saveSettings, translator } from './i18n.js';
import { getUser as getGoogleUser, isSignedIn as googleSignedIn, wasLinked as googleLinked } from './google.js';
import { getReminderSettings, saveReminderSettings, reminderOn } from './reminders.js';

/** Имя для показа: введённое пользователем как есть; если не задано (или осталось старое «Гость») — «Гость» на языке приложения. */
export const shownName = p => {
  const g = googleLinked() ? getGoogleUser() : null; // подключён Google — показываем имя из аккаунта
  return g?.name || (p.name && p.name !== 'Гость' ? p.name : translator('app').t('Гость'));
};

/** Цветной логотип Google (признак подключённого аккаунта). */
export function googleLogo(size = 20) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.setProperty('--s', size + 'px');
  span.innerHTML = '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C.9 16.4 0 20.100 0 24s.9 7.600 2.600 10.800l7.900-6.200z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.500-5.800c-2.100 1.400-4.800 2.300-8.400 2.300-6.300 0-11.600-4.100-13.500-9.900l-7.900 6.200C6.500 42.600 14.600 48 24 48z"/></svg>';
  return span;
}

export function avatarEl(profile, size = 36) {
  const el = h('span', { class: 'avatar', style: { width: size + 'px', height: size + 'px', fontSize: size * 0.42 + 'px' } });
  const photo = profile.avatar || (googleLinked() ? getGoogleUser()?.photo : null); // своё фото важнее; иначе — из Google вместо буквы
  if (photo) el.append(h('img', { src: photo, alt: '', referrerpolicy: 'no-referrer' }));
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
      typeof ico === 'string' ? icon(ico, 20) : ico,
      h('span', { class: 'grow' }, label, sub ? h('small', { class: 'muted' }, sub) : null),
      soon ? h('span', { class: 'chip' }, 'Скоро') : icon('chevR', 18));

  const head = (title, back = true) =>
    h('div', { class: 'pop-head' },
      back ? iconBtn('chevL', 'Назад', () => { stack.pop(); render(); }) : null,
      h('strong', null, title));

  const views = {
    main: () => [
      h('div', { class: 'profile-card' }, avatarEl(app.profile, 48),
        h('div', null, h('strong', null, raw(shownName(app.profile))), h('div', { class: 'muted small' }, googleLinked() && getGoogleUser()?.email ? getGoogleUser().email : 'Локальный профиль'))),
      row('user', 'Личные данные', { sub: 'Имя, аватар, пол, дата рождения', onClick: () => go('profile') }),
      row(googleLinked() ? googleLogo(20) : 'google', 'Google', { sub: googleLinked() ? 'Подключено' : 'Синхронизация данных между устройствами (тест)', onClick: () => go('google') }),
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

    // Прототип подключения к Google: вход и проверка записи/чтения файла в скрытой папке приложения на Диске.
    google: () => {
      const status = h('p', { class: 'muted small' }, 'Проверка подключения…');
      const log = h('pre', { class: 'muted small', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } });
      const say = t => { log.textContent += (log.textContent ? '\n' : '') + t; };
      const g = () => import('./google.js');
      const signBtn = h('button', { class: 'btn', onClick: null }, googleLogo(16), 'Войти через Google');
      const offBtn = h('button', { class: 'btn', hidden: true }, 'Отключить'); // виден только когда аккаунт подключён
      const refresh = async () => {
        const m = await g();
        offBtn.hidden = !m.wasLinked();
        signBtn.disabled = m.isSignedIn();
        const u = m.getUser();
        status.textContent = m.isSignedIn() ? `Подключено: ${u?.email || 'аккаунт Google'} (сессия активна).` : m.wasLinked() ? 'Входили раньше; нажмите «Войти», чтобы продолжить сессию.' : 'Не подключено.';
      };
      refresh();
      const run = fn => async () => {
        try { await fn(await g()); } catch (e) { say('Ошибка: ' + (e.message || e)); }
        refresh();
      };
      offBtn.onclick = run(async m => { m.signOut(); say('Отключено, доступ отозван.'); app.shell.renderProfile(); });
      signBtn.onclick = run(async m => { await m.signIn(); say('Вход выполнен.'); app.shell.renderProfile(); });
      return [
        head('Google'),
        h('div', { class: 'form' },
          status,
          h('p', { class: 'muted small' }, 'Тестовый режим. Данные приложения хранятся в скрытой папке вашего Google Диска; остальные файлы приложению недоступны.'),
          signBtn,
          h('button', { class: 'btn', onClick: run(async m => {
            const stamp = new Date().toISOString();
            const meta = await m.putJson('connection-test.json', { app: 'fit-pwa', stamp });
            const back = await m.getJson('connection-test.json');
            say(`Записано и прочитано: ${back?.stamp === stamp ? 'совпадает ✓' : 'НЕ совпадает'}\nИзменён: ${meta.modifiedTime}\nФайлов в папке: ${(await m.listFiles()).length}`);
          }) }, icon('database', 16), 'Проверить Диск (записать и прочитать)'),
          h('button', { class: 'btn danger', onClick: run(async m => {
            if (!(await confirmDialog('Удалить все данные приложения из вашего Google Диска? Данные на этом устройстве останутся. Действие необратимо.', { okText: 'Удалить с Диска', danger: true }))) return;
            say(`Удалено файлов на Диске: ${await m.deleteAllFiles()}`);
          }) }, icon('trash', 16), 'Удалить данные на Google Диске'),
          offBtn,
          log),
      ];
    },

    data: () => {
      const file =h('input', { type: 'file', accept: 'application/json', hidden: true });
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
          h('p', { class: 'muted small' }, 'В бета-версии все данные хранятся только в этом браузере. Делайте резервные копии или подключите Google (раздел «Google»).'),
          h('button', { class: 'btn', onClick: async () => {
            const blob = new Blob([JSON.stringify(await app.db.exportAll(), null, 1)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `fit-backup-${new Date().toISOString().slice(0, 10)}.json` });
            a.click();
            URL.revokeObjectURL(a.href);
          } }, icon('download', 16), 'Экспорт в файл'),
          h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'Импорт из файла'),
          file,
          h('button', { class: 'btn danger', onClick: async () => {
            if (!(await confirmDialog('Удалить ВСЕ данные на этом устройстве: записи всех модулей, историю и настройки? Данные в Google Диске не затрагиваются. Действие необратимо — сделайте резервную копию, если нужно.', { okText: 'Удалить всё', danger: true }))) return;
            await app.db.clearAll();
            toast('Данные удалены. Перезагрузка…');
            setTimeout(() => location.reload(), 800);
          } }, icon('trash', 16), 'Удалить все данные на устройстве')),
      ];
    },
  };

  function go(v) { stack.push(v); render(); }
  function render() { pop.replaceChildren(...views[stack.at(-1)]().filter(Boolean)); }
  render();
  return close;
}
