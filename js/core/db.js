// Слой данных. Приложение и модули работают ТОЛЬКО через createDb(), а не напрямую с IndexedDB.
//
// Чтобы позже перейти на хранилище Google (Drive appDataFolder / Firestore), достаточно написать
// новый адаптер с тем же интерфейсом (list/get/put/remove/all/clear) либо обернуть IdbAdapter
// в движок синхронизации. Записи уже содержат всё нужное для синхронизации:
//   id        — глобально уникальный (UUID), генерируется на клиенте
//   createdAt / updatedAt — мс; разрешение конфликтов «last write wins» по updatedAt
//   deleted   — «мягкое» удаление (tombstone), чтобы удаление тоже синхронизировалось
// Данные модуля живут в своём пространстве имён «<moduleId>/<collection>».

import { uid } from './ui.js';

const DB_NAME = 'fitpwa-local';
const STORE = 'records';

const wrap = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export class IdbAdapter {
  constructor() {
    this.ready = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: ['c', 'id'] });
        s.createIndex('c', 'c');
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async #store(mode) {
    return (await this.ready).transaction(STORE, mode).objectStore(STORE);
  }
  async list(c) { return wrap((await this.#store('readonly')).index('c').getAll(c)); }
  async get(c, id) { return wrap((await this.#store('readonly')).get([c, id])); }
  async put(rec) { return wrap((await this.#store('readwrite')).put(rec)); }
  async remove(c, id) { return wrap((await this.#store('readwrite')).delete([c, id])); }
  async all() { return wrap((await this.#store('readonly')).getAll()); }
  async clear() { return wrap((await this.#store('readwrite')).clear()); }
}

const strip = ({ c, ...rest }) => rest;

export function createDb(adapter) {
  const listeners = new Map();
  const emit = c => {
    for (const fn of listeners.get(c) ?? []) fn();
    for (const fn of listeners.get('*') ?? []) fn(c);
  };

  function collection(name) {
    return {
      async list() {
        return (await adapter.list(name)).filter(r => !r.deleted).map(strip);
      },
      async get(id) {
        const r = await adapter.get(name, id);
        return r && !r.deleted ? strip(r) : null;
      },
      /** Создаёт или полностью заменяет запись. Без id — генерирует. */
      async put(obj) {
        const now = Date.now();
        const id = obj.id ?? uid();
        const prev = await adapter.get(name, id);
        const rec = { ...obj, c: name, id, createdAt: prev?.createdAt ?? now, updatedAt: now, deleted: false };
        await adapter.put(rec);
        emit(name);
        return strip(rec);
      },
      async remove(id) {
        const prev = await adapter.get(name, id);
        if (!prev) return;
        await adapter.put({ ...prev, deleted: true, updatedAt: Date.now() });
        emit(name);
      },
      subscribe(fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return () => listeners.get(name).delete(fn);
      },
    };
  }

  function kv(prefix) {
    const col = collection(prefix + '_kv');
    return {
      async get(key, fallback = null) {
        const r = await col.get(key);
        return r ? r.value : fallback;
      },
      set: (key, value) => col.put({ id: key, value }),
    };
  }

  return {
    collection,
    kv: kv(''),
    /** Изолированное пространство для модуля: коллекции и kv получают префикс. */
    scope(moduleId) {
      const p = moduleId + '/';
      return { collection: n => collection(p + n), kv: kv(p) };
    },
    onAnyChange(fn) {
      if (!listeners.has('*')) listeners.set('*', new Set());
      listeners.get('*').add(fn);
    },
    async exportAll() {
      return { app: 'fit-pwa', version: 1, exportedAt: new Date().toISOString(), records: await adapter.all() };
    },
    async importAll(data) {
      if (data?.app !== 'fit-pwa' || !Array.isArray(data.records)) throw new Error('Неверный файл резервной копии');
      for (const r of data.records) await adapter.put(r);
      emit('*');
    },
  };
}
