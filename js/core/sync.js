// Синхронизация локальных данных с Google Диском (скрытая папка приложения).
//
// Модель: каждая запись уже имеет id, updatedAt и deleted (см. db.js), поэтому данные сливаются ПО ЗАПИСЯМ:
// побеждает более свежий updatedAt, удаление — тоже запись (tombstone). На Диске один файл на модуль
// (sync-<модуль>.json), чтобы не гонять лишнее. Не синхронизируется то, что относится к устройству:
// список установленных модулей, язык, напоминания и журнал импортов ИИ, уведомления.
//
// Когда синхронизируем: после входа, по кнопке «Синхронизировать», через несколько секунд после правок
// и при возвращении на вкладку. Самая первая синхронизация, если данные есть и тут, и на Диске, спрашивает,
// что взять (объединить / заменить локальные / заменить Диск); дальше всё сливается само.

import { modal, h, toast, raw } from './ui.js';
import * as google from './google.js';

const LAST_KEY = 'fitpwa-sync-last';           // {at, pulled, pushed}: когда и что синхронизировали на ЭТОМ устройстве
const SKIP_KV = new Set(['app/modules', 'app/lang', 'app/reminders', 'app/ai-imports']);
const skip = r => r.c === 'app/notifications' || (r.c === '_kv' && SKIP_KV.has(r.id));
const groupOf = r => (r.c === '_kv' ? 'app' : r.c.split('/')[0]);
const fileOf = g => `sync-${g}.json`;
const key = r => `${r.c}\u0000${r.id}`;
const live = list => list.filter(r => !r.deleted).length;

export function getLastSync() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY)); } catch { return null; }
}
const setLast = v => { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch { /* приватный режим */ } };
export const clearLastSync = () => { try { localStorage.removeItem(LAST_KEY); } catch { /* ничего */ } };

let running = null;
let applying = false; // идёт запись данных с Диска в базу — не считать это правкой пользователя
const listeners = new Set();
let state = { busy: false, error: null };
export const onSyncState = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSyncState = () => state;
const setState = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };

async function readRemote() {
  const files = (await google.listAppFiles()).filter(f => /^sync-.+\.json$/.test(f.name));
  const records = [];
  for (const f of files) {
    const data = await google.getJsonById(f.id);
    if (Array.isArray(data?.records)) records.push(...data.records);
  }
  return records;
}

/** Спрашивает пользователя, что взять при первой синхронизации. Возвращает 'merge' | 'remote' | 'local' | null (отмена). */
function askStrategy(local, remote) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } m.close(); };
    const stamp = list => {
      const t = Math.max(0, ...list.map(r => r.updatedAt || 0));
      return t ? new Date(t).toLocaleString() : '—';
    };
    const btn = (cls, title, sub, v) => h('button', { class: 'btn ' + cls, style: { textAlign: 'left', display: 'block', height: 'auto', padding: '10px 14px' }, onClick: () => finish(v) },
      h('strong', null, title), h('div', { class: 'small muted' }, sub));
    const m = modal({
      title: 'Что взять при синхронизации?',
      body: h('div', { class: 'form' },
        h('p', null, 'Данные есть и на этом устройстве, и на Google Диске.'),
        h('p', { class: 'muted small' }, raw(`Здесь: ${live(local)} записей, последнее изменение ${stamp(local)}`), h('br'), raw(`На Диске: ${live(remote)} записей, последнее изменение ${stamp(remote)}`)),
        btn('primary', 'Объединить (рекомендуется)', 'Сохранить всё; если запись есть и там, и тут — взять более свежую', 'merge'),
        btn('', 'Взять данные с Диска', 'Данные на этом устройстве будут заменены данными с Диска', 'remote'),
        btn('', 'Взять данные с этого устройства', 'Данные на Диске будут заменены данными с этого устройства', 'local')),
      actions: [h('button', { class: 'btn', onClick: () => finish(null) }, 'Отмена')],
      onClose: () => { if (!done) { done = true; resolve(null); } },
    });
  });
}

/**
 * Один проход синхронизации. opts.manual — запущена пользователем (можно открыть окно входа и спросить стратегию).
 * Возвращает {pulled, pushed} или null, если отменено/не выполнено.
 */
export function syncNow(app, { manual = false, strategy = null } = {}) {
  running ??= (async () => {
    setState({ busy: true, error: null });
    try {
      if (!google.isSignedIn()) await google.signIn({ interactive: manual });
      const local = (await app.db.exportAll()).records.filter(r => !skip(r));
      const remote = await readRemote();
      const first = !getLastSync();
      let mode = strategy ?? 'merge';
      if (!strategy && first && live(local) && live(remote)) {
        mode = await askStrategy(local, remote);
        if (!mode) return null;
      }

      const L = new Map(local.map(r => [key(r), r]));
      const R = new Map(remote.map(r => [key(r), r]));
      const now = Date.now();
      const toLocal = []; // что записать на устройство
      const toRemote = []; // что записать на Диск
      for (const k of new Set([...L.keys(), ...R.keys()])) {
        const l = L.get(k), r = R.get(k);
        if (l && !r) {
          if (mode === 'remote') toLocal.push({ ...l, deleted: true, updatedAt: now }); // «заменить локальные»: лишнее убираем
          else toRemote.push(l);
        } else if (!l && r) {
          if (mode === 'local') toRemote.push({ ...r, deleted: true, updatedAt: now });
          else toLocal.push(r);
        } else if ((l.updatedAt ?? 0) !== (r.updatedAt ?? 0) || !!l.deleted !== !!r.deleted) {
          const useRemote = mode === 'remote' ? true : mode === 'local' ? false : (r.updatedAt ?? 0) > (l.updatedAt ?? 0);
          (useRemote ? toLocal : toRemote).push(useRemote ? r : l);
        }
      }

      if (toLocal.length) {
        applying = true;
        try { await app.db.importAll({ app: 'fit-pwa', records: toLocal }); } finally { applying = false; }
      }
      if (toRemote.length) {
        const merged = new Map(remote.map(r => [key(r), r]));
        toRemote.forEach(r => merged.set(key(r), r));
        const groups = new Set(toRemote.map(groupOf));
        for (const g of groups) {
          const recs = [...merged.values()].filter(r => groupOf(r) === g);
          await google.putJson(fileOf(g), { app: 'fit-pwa', version: 1, group: g, syncedAt: new Date().toISOString(), records: recs });
        }
      }
      const res = { pulled: toLocal.length, pushed: toRemote.length };
      setLast({ at: Date.now(), ...res });
      setState({ busy: false, error: null });
      return res;
    } catch (e) {
      setState({ busy: false, error: e.message || String(e) });
      if (manual) throw e;
      return null;
    } finally {
      running = null;
      setState({ busy: false });
    }
  })();
  return running;
}

/**
 * Автоматическая синхронизация: после входа в Google, через несколько секунд после правок, при возврате на вкладку.
 * Тихая: если сессии Google нет, просто ждёт входа.
 */
export function startSync(app) {
  const auto = async why => {
    if (!google.wasLinked() || !google.isSignedIn()) return;
    const res = await syncNow(app).catch(() => null);
    if (res?.pulled) {
      toast('Данные обновлены из Google Диска');
      if (why !== 'edit') setTimeout(() => location.reload(), 900); // показать полученные данные: модули читают их при открытии
    }
  };
  let timer = null;
  app.db.onAnyChange(() => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => auto('edit'), 5000);
  });
  window.addEventListener('fitpwa:google', () => { if (google.isSignedIn()) auto('login'); });
  let last = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return;
    last = Date.now();
    auto('focus');
  });
  auto('boot'); // токен мог сохраниться с прошлой загрузки страницы
}
