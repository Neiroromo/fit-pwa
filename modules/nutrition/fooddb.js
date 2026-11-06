// Встроенные офлайн-базы продуктов (собираются скриптами tools/food-db, лежат в data/ и скачиваются вместе с модулем):
//   data/base.bin — справочник базовых продуктов (по данным USDA FoodData Central, CC0): сырые и приготовленные продукты, ингредиенты; названия на русском и английском;
//   data/ru.bin   — популярные упаковочные товары России по штрихкоду (Open Food Facts, ODbL).
// Оба файла — JSON, сжатый gzip; читаются через DecompressionStream, один раз за сеанс. Если файла нет (например, не собран), поиск просто пуст.
//
// Формат base.bin: {v: 2, extra: [id доп. нутриентов], cats: [категории],
//   f: [[название ru, категория (индекс), ккал, Б, Ж, У, клетчатка|null, сахар|null, масса порции г|0, название порции|'', название en, [доп. нутриенты по extra]|null]]}
// Формат ru.bin:   {v: 1, p: [[штрихкод, название, бренд, ккал, Б, Ж, У, клетчатка|null, сахар|null]]} отсортирован по штрихкоду.
// Все значения — на 100 г или 100 мл.

const cache = new Map();

async function gunzipJson(file) {
  if (!cache.has(file)) {
    cache.set(file, (async () => {
      try {
        const res = await fetch(new URL(file, import.meta.url));
        if (!res.ok || !res.body) return null;
        return JSON.parse(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text());
      } catch { return null; }
    })());
  }
  return cache.get(file);
}

/** Грубая основа слова для поиска: отбрасываем окончание, чтобы «гречка» находила «гречневая», а «яйцо» — «яйца». */
export const stem = w => (w.length > 5 ? w.slice(0, -2) : w.length >= 4 ? w.slice(0, -1) : w);
/** Приведение для поиска: нижний регистр, «ё» → «е», только буквы и цифры. */
export const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Слова запроса, подготовленные для поиска (основы слов). */
export const queryWords = q => norm(q).split(' ').filter(Boolean).map(stem);
/** Подходит ли название запросу: каждое слово запроса — начало какого-то слова названия (с учётом форм слов). */
export function matches(name, q) {
  const words = queryWords(q);
  if (!words.length) return false;
  const n = ' ' + norm(name);
  return words.every(w => n.includes(' ' + w));
}

/** Жидкость — мерим в мл, остальное в граммах (эвристика: пользователь может поменять в форме блюда). */
const LIQUID = /(молоко|сливки|кефир|ряженка|йогурт питьевой|сок\b|нектар|напиток|вода|лимонад|квас|пиво|вино|чай|кофе|bevera|juice|milk|water|drink|soda|масло оливковое|растительное масло)/i;
export const isLiquid = (name, cat = '') => cat === 'Beverages' || LIQUID.test(name);

let baseIndex = null;
async function base() {
  if (baseIndex) return baseIndex;
  const d = await gunzipJson('data/base.bin');
  baseIndex = d ? { extra: d.extra ?? [], cats: d.cats, items: d.f, norm: d.f.map(r => ' ' + norm(r[0]) + ' ' + norm(r[10] ?? '')) } : { extra: [], cats: [], items: [], norm: [] };
  return baseIndex;
}

/** Размер справочника (для показа в интерфейсе); 0, если файла нет. */
export async function baseSize() { return (await base()).items.length; }

function baseToFood(r, { cats, extra }, lang) {
  const food = {
    name: lang === 'en' && r[10] ? r[10] : r[0], unit: isLiquid(r[0], cats[r[1]]) ? 'ml' : 'g', kcal: r[2], p: r[3], f: r[4], cb: r[5],
    ...(r[6] != null ? { fib: r[6] } : {}), ...(r[7] != null ? { sug: r[7] } : {}),
    ...(r[8] ? { portion: { size: r[8], name: r[9] || '' } } : {}),
    src: 'base',
  };
  r[11]?.forEach((v, i) => { if (v != null) food[extra[i]] = v; });
  return food;
}

/** Поиск по справочнику (по русским и английским названиям): каждое слово запроса — начало слова. Короткие названия и совпадения в начале — выше. */
export async function searchBase(q, limit = 30, lang = 'ru') {
  const words = queryWords(q);
  if (!words.length) return [];
  const idx = await base();
  const hits = [];
  for (let i = 0; i < idx.norm.length; i++) {
    const n = idx.norm[i];
    let score = 0, ok = true;
    for (const w of words) {
      const at = n.indexOf(' ' + w);
      if (at < 0) { ok = false; break; }
      score += at;
    }
    if (ok) hits.push([score + n.length / 20 + (n.startsWith(' ' + words[0]) ? -5 : 0), i]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  return hits.slice(0, limit).map(([, i]) => baseToFood(idx.items[i], idx, lang));
}

let ruIndex = null;
async function ru() {
  if (ruIndex) return ruIndex;
  const d = await gunzipJson('data/ru.bin');
  ruIndex = d?.p ?? [];
  return ruIndex;
}
export async function ruSize() { return (await ru()).length; }

function ruToFood(r) {
  const name = r[2] && !r[1].toLowerCase().includes(r[2].toLowerCase()) ? `${r[1]}, ${r[2]}` : r[1];
  return {
    name, unit: isLiquid(r[1]) ? 'ml' : 'g', kcal: r[3], p: r[4], f: r[5], cb: r[6],
    ...(r[7] != null ? { fib: r[7] } : {}), ...(r[8] != null ? { sug: r[8] } : {}),
    barcode: r[0], src: 'ru',
  };
}

/** Штрихкод из текста: EAN-8/13, UPC-A (12), GTIN-14; для кода DataMatrix «Честный знак» (GS1: 01 + GTIN-14 + 21 + серийный номер) берётся GTIN. Возвращает набор вариантов для поиска или null. */
export function barcodeVariants(text) {
  let s = String(text ?? '').replace(/[\x1d\s]/g, '');
  const gs1 = s.match(/^(?:\]d2|\]C1)?01(\d{14})/); // GS1 DataMatrix / Code 128
  if (gs1) s = gs1[1];
  if (!/^\d{8,14}$/.test(s)) return null;
  const v = new Set([s]);
  if (s.length === 14 && s[0] === '0') v.add(s.slice(1)); // GTIN-14 → EAN-13
  if (s.length === 12) v.add('0' + s);                      // UPC-A → EAN-13
  if (s.length === 13 && s[0] === '0') v.add(s.slice(1));
  return [...v];
}

/** Поиск товара по штрихкоду в офлайн-наборе (бинарный поиск по отсортированному списку). */
export async function findBarcode(text) {
  const variants = barcodeVariants(text);
  if (!variants) return null;
  const list = await ru();
  for (const code of variants) {
    let lo = 0, hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = list[mid][0];
      if (c === code) return ruToFood(list[mid]);
      if (c < code) lo = mid + 1; else hi = mid - 1;
    }
  }
  return null;
}

/** Поиск товаров по названию и бренду в офлайн-наборе (слова — начала слов). */
export async function searchRu(q, limit = 20) {
  const words = queryWords(q);
  if (!words.length) return [];
  const list = await ru();
  const out = [];
  for (const r of list) {
    const n = ' ' + norm(r[1] + ' ' + r[2]);
    if (words.every(w => n.includes(' ' + w))) { out.push(ruToFood(r)); if (out.length >= limit) break; }
  }
  return out;
}
