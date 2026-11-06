// Общая система напоминаний. Модуль объявляет напоминания в manifest.json (reminders: [{id, title, description, default}])
// и реализует в своём коде default.reminders.check(ctx, {now, on}) → [{key, text}]: что нужно напомнить прямо сейчас.
// Ядро раз в полминуты вызывает check у всех установленных модулей (даже если страница модуля закрыта, пока открыто приложение),
// не повторяет одно и то же напоминание в течение дня и учитывает настройки пользователя: включено ли каждое напоминание и «тихие часы».
// Доставка: колокольчик, всплывающее сообщение и системное уведомление браузера (если разрешено).
// Напоминания приходят, пока приложение открыто: доставить их в закрытое приложение без сервера нельзя.
// Включаются и выключаются в «Профиль → Напоминания»; при установке модуля его напоминания появляются там сами.

import { toast } from './ui.js';

const KEY = 'app/reminders';
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DEFAULTS = { enabled: {}, quiet: { on: false, from: '22:00', to: '08:00' }, fired: { date: '', keys: [] } };

export async function getReminderSettings(db) {
  const s = (await db.kv.get(KEY, null)) ?? {};
  return { ...DEFAULTS, ...s, enabled: { ...(s.enabled ?? {}) }, quiet: { ...DEFAULTS.quiet, ...(s.quiet ?? {}) }, fired: { ...DEFAULTS.fired, ...(s.fired ?? {}) } };
}
export const saveReminderSettings = (db, s) => db.kv.set(KEY, s);

/** Включено ли напоминание r модуля mod: явный выбор пользователя, иначе значение по умолчанию из манифеста. */
export const reminderOn = (s, mod, r) => s.enabled[`${mod}.${r.id}`] ?? r.default !== false;

/** Попадает ли момент в «тихие часы» (в том числе через полночь). */
export function inQuietHours(q, d = new Date()) {
  if (!q.on) return false;
  const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const now = d.getHours() * 60 + d.getMinutes(), from = mins(q.from), to = mins(q.to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

function deliver(app, text, tag) {
  app.db.collection('app/notifications').put({ text, ts: Date.now(), read: false }).then(() => app.shell.refreshBell());
  toast(text);
  systemNotify(text, tag);
}

/**
 * Системное уведомление. Через service worker (registration.showNotification) — только так оно работает на телефонах
 * (Android, iPhone в установленном PWA); обычный new Notification() там не поддерживается. Запасной вариант — для десктопа.
 */
async function systemNotify(text, tag) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const icon = new URL('icons/icon-192.png', document.baseURI).href;
  const opts = { tag, icon, badge: icon, data: { url: new URL('./', document.baseURI).href } };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) return await reg.showNotification('Fit', { ...opts, body: text });
  } catch { /* пробуем запасной вариант */ }
  try { new Notification('Fit', { ...opts, body: text }); } catch { /* уведомление не показано */ }
}

/** Запускает проверку напоминаний. moduleContext(id) даёт модулю его обычный контекст. */
export function startReminders(app, moduleContext) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const s = await getReminderSettings(app.db);
      if (inQuietHours(s.quiet)) return;
      const today = dayKey();
      if (s.fired.date !== today) s.fired = { date: today, keys: [] };
      let changed = false;
      for (const m of app.registry.installed()) {
        const defs = m.reminders ?? [];
        const on = Object.fromEntries(defs.map(r => [r.id, reminderOn(s, m.id, r)]));
        if (!Object.values(on).some(Boolean)) continue;
        const mod = await app.registry.load(m.id).catch(() => null);
        if (!mod?.reminders?.check) continue;
        let list = [];
        try { list = (await mod.reminders.check(moduleContext(m.id), { now: Date.now(), on })) ?? []; } catch (e) { console.error(e); }
        for (const it of list) {
          const key = `${m.id}.${it.key}`;
          if (s.fired.keys.includes(key)) continue;
          s.fired.keys.push(key);
          changed = true;
          deliver(app, it.text, key);
        }
      }
      if (changed) await saveReminderSettings(app.db, s);
    } catch (e) { console.error(e); } finally { busy = false; }
  };
  setTimeout(tick, 4000);
  return setInterval(tick, 30_000);
}
