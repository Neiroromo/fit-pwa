// Данные модуля «Мониторинг».
//
// Два раздела: «Фитнес» (вес, жир, замеры тела — коллекция entries) и «Медицина» (давление, пульс, температура — коллекция vitals).
//
// Коллекция entries — одна запись на день (id = дата 'YYYY-MM-DD'):
//   {id, date, weight?: кг, fat?: %, m?: {ключ замера: см}}
// Ключи замеров: 'neck', 'chest', … Для парных конечностей замер либо общий ('biceps'),
// либо раздельный ('biceps.r' — правая, 'biceps.l' — левая); в истории встречаются оба вида.
// Коллекция vitals — любое число замеров в день, у каждого своё время:
//   {id, ts: мс, sys?: верхнее, dia?: нижнее (мм рт. ст.), pulse?: уд/мин, temp?: °C}; давление вносится парой (sys + dia).
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

export const LIMITS = {
  weight: [20, 400], fat: [2, 70], height: [100, 250], measure: [5, 250],
  sys: [60, 260], dia: [30, 160], pulse: [25, 250], temp: [30, 45], // медицинские показатели
};
export const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

/** Подсказки: как правильно мерить. Линии на схеме и тексты привязаны к этим ключам. */
export const MEASURES = [
  { id: 'neck', section: 'body', name: 'Шея', tip: 'Лента — на середине шеи, чуть ниже кадыка. Прилегает плотно, но не врезается. Голова прямо, взгляд вперёд, плечи расслаблены.' },
  { id: 'shoulders', section: 'body', name: 'Плечи', tip: 'Обхват по самым широким точкам дельтовидных мышц, лента горизонтально через грудь и лопатки. Стойте прямо, руки расслаблены вдоль тела.' },
  { id: 'chest', section: 'body', name: 'Грудь', tip: 'Лента проходит на уровне сосков и под подмышками, по лопаткам. Руки опущены, замер на спокойном выдохе; лента горизонтально и не врезается.' },
  { id: 'waist', section: 'body', name: 'Талия', tip: 'Измеряется на уровне пупка, на спокойном выдохе: живот не втягивайте и не выпячивайте. Лента горизонтально. Этот замер вместе с шеей и ростом используется для оценки процента жира.' },
  { id: 'hips', section: 'body', name: 'Ягодицы', tip: 'По самой выступающей части ягодиц, лента горизонтально. Стойте прямо, ноги вместе, мышцы расслаблены.' },
  { id: 'biceps', section: 'body', name: 'Бицепс', group: 'arms', tip: 'Середина плеча между плечевым суставом и локтем, рука расслаблена и опущена. Лента перпендикулярно плечу. Выберите один способ (расслабленный или напряжённый) и придерживайтесь его.' },
  { id: 'forearm', section: 'body', name: 'Предплечье', group: 'arms', tip: 'В самой толстой части, примерно на треть длины предплечья ниже локтя. Рука расслаблена, ладонь повёрнута вперёд.' },
  { id: 'thigh', section: 'body', name: 'Бедро', group: 'legs', tip: 'В самой толстой части, примерно на 5–10 см ниже ягодичной складки. Вес на обе ноги, мышцы расслаблены, лента горизонтально.' },
  { id: 'calf', section: 'body', name: 'Голень', group: 'legs', tip: 'В самой широкой части икры. Стойте прямо, вес на обе ноги, мышцы расслаблены.' },
  // --- размеры для подбора одежды и обуви (на схеме линий нет, подсказка — по значку «Как измерить» в строке) ---
  { id: 'shoulderw', section: 'clothes', name: 'Ширина плеч', range: [30, 70], tip: 'От одной плечевой точки (где плечо переходит в руку) до другой по спине. Лента лежит по верхней части лопаток. Нужна для пиджаков и рубашек.' },
  { id: 'back', section: 'clothes', name: 'Длина спины', range: [35, 70], tip: 'От выступающего позвонка у основания шеи вниз по позвоночнику до линии талии. Нужна для курток и пиджаков.' },
  { id: 'sleeve', section: 'clothes', name: 'Длина рукава', group: 'arms', range: [40, 100], tip: 'От плечевой точки (края плеча) вдоль слегка согнутой руки через локоть до косточки запястья.' },
  { id: 'wrist', section: 'clothes', name: 'Обхват запястья', group: 'arms', range: [10, 30], tip: 'Вокруг запястья над косточкой, плотно, но не врезаясь. Нужен для часов и браслетов.' },
  { id: 'palm', section: 'clothes', name: 'Обхват ладони', group: 'arms', range: [15, 35], tip: 'Вокруг ладони по самой широкой части, без большого пальца. Нужен для перчаток.' },
  { id: 'inseam', section: 'clothes', name: 'Длина по внутреннему шву', range: [50, 110], tip: 'От паха вдоль внутренней стороны ноги до пола или до нужной длины брюк. Удобно мерить по хорошо севшим брюкам.' },
  { id: 'outseam', section: 'clothes', name: 'Длина по внешнему шву', range: [70, 130], tip: 'От линии талии вдоль боковой стороны ноги до пола или до нужной длины брюк.' },
  { id: 'head', section: 'clothes', name: 'Обхват головы', range: [45, 70], tip: 'Лента проходит по лбу над бровями и ушами и по самой выступающей части затылка. Нужен для шапок и шлемов.' },
  { id: 'ankle', section: 'clothes', name: 'Обхват щиколотки', group: 'legs', range: [15, 40], tip: 'Над щиколоткой, по самой тонкой части. Нужен для носков, высокой обуви и фиксаторов.' },
  { id: 'foot', section: 'clothes', name: 'Длина стопы', group: 'legs', range: [18, 35], tip: 'Встаньте на лист бумаги, отметьте самую дальнюю точку большого пальца и пятку, измерьте расстояние. Лучше вечером; если стопы разные, берите большую. По длине стопы показывается примерный размер обуви.' },
  { id: 'footw', section: 'clothes', name: 'Ширина стопы', group: 'legs', range: [6, 16], tip: 'Расстояние между самыми широкими точками стопы (у основания пальцев). Нужна, чтобы выбирать узкую или широкую колодку.' },
];

export const SECTIONS = [
  { id: 'body', name: 'Тело' },
  { id: 'clothes', name: 'Одежда и обувь' },
];

/**
 * Примерный размер мужской обуви по длине стопы (см): EU — парижский пункт (1,5 × длина + 2), US — по Бреннок (3 × длина в дюймах − 22),
 * UK = US − 1. Округление до 0,5. Это ориентир: колодки разных брендов отличаются.
 */
export function shoeSizes(cm) {
  const half = v => Math.round(v * 2) / 2;
  const us = 3 * (cm / 2.54) - 22;
  return { eu: half(1.5 * cm + 2), us: half(us), uk: half(us - 1) };
}

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

// ---------- медицинские показатели ----------
/** Показатели медицинского раздела. keys — поля записи vitals, из которых строятся ряды графика. */
export const MEDICAL = [
  { id: 'pressure', name: 'Давление', unit: 'мм рт. ст.', keys: ['sys', 'dia'] },
  { id: 'pulse', name: 'Пульс', unit: 'уд/мин', keys: ['pulse'] },
  { id: 'temp', name: 'Температура', unit: '°C', keys: ['temp'] },
];
export const VITAL_LABEL = { sys: 'Верхнее', dia: 'Нижнее' };

export async function listVitals(ctx) {
  return (await ctx.db.collection('vitals').list()).sort((a, b) => a.ts - b.ts);
}
export const putVital = (ctx, rec) => ctx.db.collection('vitals').put(rec);
export const removeVital = (ctx, id) => ctx.db.collection('vitals').remove(id);

/** Точки {t, v} поля записей vitals за период. */
export function vitalPoints(vitals, key, fromMs = 0) {
  return vitals.filter(r => r[key] != null && r.ts >= fromMs).map(r => ({ t: r.ts, v: r[key] }));
}
