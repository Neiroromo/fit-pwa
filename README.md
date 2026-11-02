# Fit — модульное PWA

Трекер активности, менеджер тренировок, дневник питания. Сейчас: бета, данные локально в браузере (IndexedDB).
Описание проекта — `Описание.txt`.

## Запуск

Статический сайт без сборки (ES-модули), подходит для GitHub Pages.

```bash
python -m http.server 8080
```

Откройте http://localhost:8080.

## Архитектура

- `js/core/` — ядро: `db.js` (слой данных), `registry.js` (каталог/установка/загрузка модулей), `shell.js` (навигация, магазин, уведомления), `profile.js` (popup профиля), `ui.js` (хелперы).
- `js/hub/` — Хаб (встроенный модуль): сетка виджетов, режим редактирования, drag & drop.
- `modules/catalog.json` — список модулей, доступных для скачивания.
- `modules/<id>/` — модуль: `manifest.json` (файлы, виджеты), `index.js` (`export default { mount(el, ctx, params), widgets }`), стили.
- `sw.js` — service worker: оболочка network-first, файлы скачанных модулей cache-first (работают офлайн).

### Как добавить модуль
1. Создать `modules/<id>/` с `manifest.json` и `index.js`.
2. Добавить запись в `modules/catalog.json` (`available: true`).
3. Модуль получает `ctx` с изолированным `ctx.db` (коллекции и kv в пространстве `<id>/`), `ctx.ui`, `ctx.router`, `ctx.notify`.

### Подготовка к Google-хранилищу
Весь доступ к данным идёт через `createDb(adapter)`. Записи имеют `id` (UUID), `createdAt`, `updatedAt`, `deleted` (tombstone) —
этого достаточно для синхронизации. Переход = новый адаптер или движок синхронизации поверх `IdbAdapter`, код модулей не меняется.
