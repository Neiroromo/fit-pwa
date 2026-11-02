import { IdbAdapter, createDb } from './core/db.js';
import { createRegistry } from './core/registry.js';
import { buildShell, openStore } from './core/shell.js';
import { ui } from './core/ui.js';

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

const app = { db, registry, router, profile: { name: 'Гость', avatar: null } };

/** Контекст, который получает каждый модуль. Модуль не знает о ядре ничего сверх этого. */
function moduleContext(id) {
  const scoped = db.scope(id);
  return {
    id,
    db: scoped,
    ui,
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  await registry.init();
  app.profile = await db.kv.get('app/profile', app.profile);
  app.shell = buildShell(app);
  app.openStore = () => openStore(app);
  document.getElementById('app').replaceChildren(app.shell.root);
  app.shell.renderProfile();
  app.shell.refreshBell();
  registry.subscribe(() => app.shell.renderNav());

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
      if (mine !== token) return;
      const page = document.createElement('div');
      page.className = 'page';
      app.shell.view.replaceChildren(page);
      cleanup = await mod.mount(page, moduleContext(id), params);
    } catch (e) {
      console.error(e);
      app.shell.view.replaceChildren(ui.h('div', { class: 'page' }, ui.h('p', { class: 'muted' }, 'Не удалось открыть модуль: ' + e.message)));
    }
  }
  addEventListener('hashchange', route);
  route();
}

boot();
