// Service worker.
//  • Оболочка приложения (ядро + Хаб): network-first с откатом на кэш — онлайн всегда свежая версия, офлайн работает.
//  • Файлы скачанных модулей лежат в кэше 'fitpwa-modules' (кладёт registry.install) и отдаются cache-first.
const SHELL = 'fitpwa-shell-v2';
const MODULES = 'fitpwa-modules';

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/core/i18n.js', 'js/core/lang/en.js', 'js/core/db.js', 'js/core/registry.js', 'js/core/shell.js', 'js/core/profile.js', 'js/core/ui.js',
  'js/hub/index.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== MODULES).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  const isModuleFile = /\/modules\/[^/]+\/.+/.test(url.pathname);
  if (isModuleFile && req.cache !== 'reload') {
    e.respondWith(caches.open(MODULES).then(c => c.match(req)).then(hit => hit || fetch(req)));
    return;
  }

  e.respondWith(
    fetch(req, { cache: 'no-cache' }) // всегда сверяться с сервером, а не с HTTP-кэшем браузера: иначе ядро и Хаб могут оказаться разных версий
      .then(res => {
        if (res.ok && !isModuleFile) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
