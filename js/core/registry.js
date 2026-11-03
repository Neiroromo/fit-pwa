// Реестр модулей: каталог доступных, установленные, скачивание/удаление, динамическая загрузка.
//
// «Скачать модуль» = забрать его manifest.json и все файлы из репозитория (GitHub Pages)
// в Cache Storage ('fitpwa-modules'). Service worker отдаёт их оттуда, поэтому
// установленный модуль работает офлайн. Состояние (что установлено и в каком порядке)
// хранится в db как kv 'app/modules'.

const CACHE = 'fitpwa-modules';
const STATE_KEY = 'app/modules';

export const HUB = { id: 'hub', name: 'Хаб', icon: 'home', core: true, version: '1', widgets: [] };

const baseUrl = id => new URL(`modules/${id}/`, document.baseURI);

export function createRegistry(db) {
  let catalog = [];
  let installed = []; // [{id, name, icon, version, entry, files, styles, widgets, content}] — в порядке навигации
  const loaded = new Map();
  const subs = new Set();
  const emit = () => subs.forEach(fn => fn());

  const persist = () => db.kv.set(STATE_KEY, installed);

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'reload' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  return {
    HUB,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    async init() {
      installed = await db.kv.get(STATE_KEY, []);
      try {
        catalog = (await fetchJson(new URL('modules/catalog.json', document.baseURI))).modules;
      } catch {
        catalog = []; // офлайн: каталог недоступен, установленные модули продолжают работать
      }
    },

    catalog: () => catalog,
    installed: () => installed,
    /** Для навигации: хаб всегда первый. */
    navItems: () => [HUB, ...installed],
    isInstalled: id => id === 'hub' || installed.some(m => m.id === id),
    get: id => (id === 'hub' ? HUB : installed.find(m => m.id === id)),
    needsUpdate(id) {
      const have = installed.find(m => m.id === id);
      const cat = catalog.find(m => m.id === id);
      return !!(have && cat && cat.version !== have.version);
    },

    async install(id, onProgress = () => {}) {
      const base = baseUrl(id);
      const manifest = await fetchJson(new URL('manifest.json', base));
      const files = [manifest.entry, ...(manifest.files ?? []), ...(manifest.styles ?? [])];
      const cache = 'caches' in window ? await caches.open(CACHE) : null;
      let n = 0;
      for (const f of files) {
        const url = new URL(f, base);
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${f}`);
        await cache?.put(url, res);
        onProgress(++n / files.length);
      }
      const entry = {
        id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version,
        entry: manifest.entry, styles: manifest.styles ?? [], files, widgets: manifest.widgets ?? [], content: manifest.content ?? [],
      };
      installed = installed.filter(m => m.id !== id);
      installed.push(entry);
      await persist();
      emit();
      return entry;
    },

    async uninstall(id) {
      const m = installed.find(x => x.id === id);
      if (!m) return;
      const cache = 'caches' in window ? await caches.open(CACHE) : null;
      for (const f of m.files) await cache?.delete(new URL(f, baseUrl(id)));
      installed = installed.filter(x => x.id !== id);
      loaded.delete(id);
      document.querySelectorAll(`link[data-module="${id}"]`).forEach(l => l.remove());
      await persist();
      emit();
    },

    async move(id, dir) {
      const i = installed.findIndex(m => m.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= installed.length) return;
      [installed[i], installed[j]] = [installed[j], installed[i]];
      await persist();
      emit();
    },

    /** Загружает код модуля (однократно). Хаб — встроенный. */
    load(id) {
      if (loaded.has(id)) return loaded.get(id);
      let p;
      if (id === 'hub') {
        p = import('../hub/index.js').then(m => m.default);
      } else {
        const m = installed.find(x => x.id === id);
        if (!m) return Promise.reject(new Error('Module not installed: ' + id));
        const base = baseUrl(id);
        for (const css of m.styles) {
          if (document.querySelector(`link[data-module="${id}"][data-f="${css}"]`)) continue;
          document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL(css, base).href }));
          const link = document.head.lastElementChild;
          link.dataset.module = id;
          link.dataset.f = css;
        }
        p = import(new URL(m.entry, base).href).then(mod => mod.default);
      }
      loaded.set(id, p);
      p.catch(() => loaded.delete(id));
      return p;
    },
  };
}
