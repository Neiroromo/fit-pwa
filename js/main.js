import { IdbAdapter, createDb } from './core/db.js';
import { createRegistry } from './core/registry.js';
import { buildShell, openStore, updateButton, notifyUpdates } from './core/shell.js';
import { ui, createUi, setAppTranslator } from './core/ui.js';
import { initI18n, preload, translator, contentLang } from './core/i18n.js';
import { loadDemo } from './core/profile.js';
import { startReminders } from './core/reminders.js';

const db = createDb(new IdbAdapter());
const registry = createRegistry(db);

// ---------- Роутер (#/<moduleId>) ----------
let pendingParams = null;
const router = {
  current: () => location.hash.replace(/^#\//, '') || 'hub',
  go(id, params = null) {
    pendingParams = params;
    if (router.current() === id && location.hash) dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '/' + id;
  },
};

const app = { db, registry, router, profile: { name: '', avatar: null, sex: null, birth: '' } };

/** Возраст в полных годах по дате рождения 'YYYY-MM-DD'; null, если дата не задана или неправдоподобна. */
function ageOf(birth, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth ?? '')) return null;
  const [y, m, d] = birth.split('-').map(Number);
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a >= 10 && a <= 110 ? a : null;
}

/** Контекст, который получает каждый модуль. Модуль не знает о ядре ничего сверх этого. */
function moduleContext(id) {
  const scoped = db.scope(id);
  const T = translator(id); // язык этого модуля (может отличаться от языка приложения)
  return {
    id,
    db: scoped,
    /** Общее хранилище модулей (collection, kv): сюда модуль публикует то, что могут читать другие, например профиль тела из «Мониторинга». Читать можно всегда; если публикующего модуля нет, данных просто нет. */
    shared: db.scope('shared'),
    /** Личные данные пользователя из профиля приложения: {name, sex: 'm'|'f'|null, birth: 'YYYY-MM-DD'|'', age: число|null}. Не зависят от установленных модулей. */
    user: () => ({ name: app.profile.name, sex: app.profile.sex ?? null, birth: app.profile.birth ?? '', age: ageOf(app.profile.birth) }),
    /** Открывает окно «Личные данные» профиля (например, чтобы заполнить пол и дату рождения). */
    openProfile: (view = 'profile') => { const b = document.querySelector('.profile-btn'); if (b) { document.querySelector('.popover')?._close?.(); import('./core/profile.js').then(m => m.openProfile(app, b, view)); } },
    ui: createUi(() => T.tr),
    t: T.t,
    plural: T.plural,
    lang: T.lang,
    locale: T.locale,
    /** Язык контента модуля (например, ctx.contentLang('exercises')): отдельная настройка или язык модуля. */
    contentLang: contentId => contentLang(id, contentId),
    router,
    registry,
    moduleContext,
    openStore: () => app.openStore(),
    async notify(text) {
      await db.collection('app/notifications').put({ text, ts: Date.now(), read: false });
      app.shell.refreshBell();
    },
  };
}

async function boot() {
  // ссылка вида ?demo=<имя набора> (demo/<имя>.json) один раз загружает тестовые данные и убирает параметр из адреса
  // только при локальной разработке: на опубликованном сайте демо-данных нет
  const demo = ['localhost', '127.0.0.1'].includes(location.hostname) ? new URLSearchParams(location.search).get('demo') : null;
  if (demo) {
    try { await loadDemo({ db }, demo); ui.toast('Демо-данные загружены: ' + demo); } catch (e) { console.error(e); ui.toast('Не удалось загрузить демо-данные: ' + demo); }
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  await registry.init();
  await initI18n(db, registry.installed().map(m => m.id));
  app.t = translator('app').t;
  setAppTranslator(translator('app').tr);
  app.profile = { ...app.profile, ...(await db.kv.get('app/profile', {})) };
  app.shell = buildShell(app);
  app.openStore = opts => openStore(app, opts);
  document.getElementById('app').replaceChildren(app.shell.root);
  app.shell.renderProfile();
  app.shell.refreshBell();
  registry.subscribe(() => app.shell.renderNav());
  notifyUpdates(app).catch(console.error);
  startReminders(app, moduleContext); // напоминания модулей (см. core/reminders.js)

  let cleanup = null;
  let token = 0;
  async function route() {
    let id = router.current();
    if (!registry.isInstalled(id)) { id = 'hub'; history.replaceState(null, '', '#/hub'); }
    const mine = ++token;
    const params = pendingParams;
    pendingParams = null;
    app.shell.renderNav();
    try { await cleanup?.(); } catch (e) { console.error(e); }
    cleanup = null;
    app.shell.view.replaceChildren();
    try {
      const mod = await registry.load(id);
      await preload([id]); // словари только что скачанного модуля
      if (mine !== token) return;
      const page = document.createElement('div');
      page.className = 'page';
      app.shell.view.replaceChildren(page);
      const stop = await mod.mount(page, moduleContext(id), params);
      // Плашка с кнопкой «Обновить» — отдельный блок наверху страницы, принадлежит ядру: стили и перерисовка заголовка самого модуля
      // (обрезка текста, переполнение, replaceChildren) не могут её скрыть. Модуль перерисовывает страницу сам, поэтому следим за ней.
      let obs = null;
      if (registry.needsUpdate(id)) {
        const bar = ui.h('div', { class: 'upd-bar' }, ui.h('span', { class: 'upd-text' }, app.t('Доступно обновление модуля')), updateButton(app, id));
        const put = () => { if (bar.parentElement !== page || page.firstElementChild !== bar) page.prepend(bar); };
        put();
        obs = new MutationObserver(put);
        obs.observe(page, { childList: true, subtree: true });
      }
      cleanup = () => { obs?.disconnect(); return stop?.(); };
    } catch (e) {
      console.error(e);
      app.shell.view.replaceChildren(ui.h('div', { class: 'page' }, ui.h('p', { class: 'muted' }, app.t('Не удалось открыть модуль: {msg}', { msg: e.message }))));
    }
  }
  addEventListener('hashchange', route);
  route();
}

boot();
