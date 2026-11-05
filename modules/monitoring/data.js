// Данные модуля «Мониторинг».
//
// Коллекция entries — одна запись на день (id = дата 'YYYY-MM-DD'):
//   {id, date, weight?: кг, fat?: %, m?: {ключ замера: см}}
// Ключи замеров: 'neck', 'chest', … Для парных конечностей замер либо общий ('biceps'),
// либо раздельный ('biceps.r' — правая, 'biceps.l' — левая); в истории встречаются оба вида.
// kv 'settings': {height: см | null, split: {arms: bool, legs: bool}, hidden: [ключи отключённых замеров]}
// Отключённый замер не показывается (ввод, схема, история), но уже внесённые значения сохраняются.

const pad = n => String(n).padStart(2, '0');

export const dayKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
export const parseDay = key => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** «72,5» и «72.5» → 72.5; пусто или не число → null */
export const num = s => {
  const v = parseFloat(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export const LIMITS = { weight: [20, 400], fat: [2, 70], height: [100, 250], measure: [5, 250] };
export const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

/** Подсказки: как правильно мерить. Линии на схеме и тексты привязаны к этим ключам. */
export const MEASURES = [
  { id: 'neck', name: 'Шея', tip: 'Лента — на середине шеи, чуть ниже кадыка. Прилегает плотно, но не врезается. Голова прямо, взгляд вперёд, плечи расслаблены.' },
  { id: 'shoulders', name: 'Плечи', tip: 'Обхват по самым широким точкам дельтовидных мышц, лента горизонтально через грудь и лопатки. Стойте прямо, руки расслаблены вдоль тела.' },
  { id: 'chest', name: 'Грудь', tip: 'Лента проходит на уровне сосков и под подмышками, по лопаткам. Руки опущены, замер на спокойном выдохе; лента горизонтально и не врезается.' },
  { id: 'waist', name: 'Талия', tip: 'Измеряется на уровне пупка, на спокойном выдохе: живот не втягивайте и не выпячивайте. Лента горизонтально. Этот замер вместе с шеей и ростом используется для оценки процента жира.' },
  { id: 'hips', name: 'Ягодицы', tip: 'По самой выступающей части ягодиц, лента горизонтально. Стойте прямо, ноги вместе, мышцы расслаблены.' },
  { id: 'biceps', name: 'Бицепс', group: 'arms', tip: 'Середина плеча между плечевым суставом и локтем, рука расслаблена и опущена. Лента перпендикулярно плечу. Выберите один способ (расслабленный или напряжённый) и придерживайтесь его.' },
  { id: 'forearm', name: 'Предплечье', group: 'arms', tip: 'В самой толстой части, примерно на треть длины предплечья ниже локтя. Рука расслаблена, ладонь повёрнута вперёд.' },
  { id: 'thigh', name: 'Бедро', group: 'legs', tip: 'В самой толстой части, примерно на 5–10 см ниже ягодичной складки. Вес на обе ноги, мышцы расслаблены, лента горизонтально.' },
  { id: 'calf', name: 'Голень', group: 'legs', tip: 'В самой широкой части икры. Стойте прямо, вес на обе ноги, мышцы расслаблены.' },
];

export const GROUPS = [
  { id: 'arms', name: 'Руки' },
  { id: 'legs', name: 'Ноги' },
];

export const measureOf = id => MEASURES.find(m => m.id === id);

/** Ключи данных замера: общий и раздельные. */
export const sideKeys = id => [id, id + '.r', id + '.l'];

/** Из ключа данных — (замер, сторона): 'biceps.r' → ['biceps', 'r']. */
export const splitKey = key => {
  const [id, side] = key.split('.');
  return [id, side ?? null];
};

export const SIDE_NAME = { r: 'правая', l: 'левая' };

// ---------- хранилище ----------
export async function listEntries(ctx) {
  return (await ctx.db.collection('entries').list()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function putEntry(ctx, entry) {
  return ctx.db.collection('entries').put({ ...entry, id: entry.date });
}

export function removeEntry(ctx, date) {
  return ctx.db.collection('entries').remove(date);
}

const DEFAULT_SETTINGS = { height: null, split: { arms: false, legs: false }, hidden: [] };

export async function getSettings(ctx) {
  const s = await ctx.db.kv.get('settings', null);
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), split: { ...DEFAULT_SETTINGS.split, ...(s?.split ?? {}) }, hidden: [...(s?.hidden ?? [])] };
}

export const saveSettings = (ctx, s) => ctx.db.kv.set('settings', s);

// ---------- выборки ----------
/** Последнее известное значение показателя (get(entry) → число|undefined) не позже даты upTo. */
export function lastValue(entries, get, upTo = '9999') {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].date > upTo) continue;
    const v = get(entries[i]);
    if (v != null) return v;
  }
  return null;
}

/** Точки {t, v} показателя за период (t — мс, начало дня). */
export function points(entries, get, fromMs = 0) {
  const out = [];
  for (const e of entries) {
    const v = get(e);
    const t = parseDay(e.date).getTime();
    if (v != null && t >= fromMs) out.push({ t, v });
  }
  return out;
}
