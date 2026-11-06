// Онлайн-поиск в Open Food Facts (https://world.openfoodfacts.org): товар по штрихкоду и поиск по названию.
// Данные открытые (лицензия ODbL), ключ не нужен, из браузера запросы разрешены (CORS). Правила сервиса: чтение продукта до 15 запросов в минуту,
// поиск до 10 в минуту и не «по мере набора», поэтому поиск запускается только по кнопке и не чаще одного запроса в несколько секунд.
// Качество данных у сервиса разное (пользователи правят сами), поэтому найденное всегда показывается в форме блюда для проверки.

import { isLiquid, barcodeVariants } from './fooddb.js';

const API = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_ru,brands,quantity,serving_quantity,nutriments';
const MIN_GAP = 7000; // мс между запросами поиска
let lastSearch = 0;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r1 = v => Math.round(v * 10) / 10;

/** Ответ Open Food Facts → блюдо {name, unit, kcal, p, f, cb, ...}; null, если нет названия или калорий/БЖУ. */
function toFood(p) {
  const name = (p.product_name_ru || p.product_name || '').replace(/\s+/g, ' ').trim();
  const n = p.nutriments ?? {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && num(n['energy_100g']) != null) kcal = num(n['energy_100g']) / 4.184; // только кДж
  const pr = num(n.proteins_100g), f = num(n.fat_100g), cb = num(n.carbohydrates_100g);
  if (!name || [kcal, pr, f, cb].includes(null)) return null;
  const brand = (p.brands ?? '').split(',')[0].trim();
  const fib = num(n.fiber_100g), sug = num(n.sugars_100g), serving = num(p.serving_quantity);
  const liquid = /\b\d+([.,]\d+)?\s?(ml|мл|l|л)\b/i.test(p.quantity ?? '') || isLiquid(name);
  return {
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name}, ${brand}` : name,
    unit: liquid ? 'ml' : 'g', kcal: Math.round(kcal), p: r1(pr), f: r1(f), cb: r1(cb),
    ...(fib != null ? { fib: r1(fib) } : {}), ...(sug != null ? { sug: r1(sug) } : {}),
    ...(serving && serving >= 1 && serving <= 5000 ? { portion: { size: serving, name: 'порция' } } : {}),
    barcode: p.code, src: 'off',
  };
}

async function get(url, signal) {
  let res;
  try { res = await fetch(url, { signal, headers: { Accept: 'application/json' } }); } catch (e) { if (e.name === 'AbortError') throw e; throw new Error('network'); }
  if (res.status === 503 || res.status === 429) throw new Error('busy');
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

/** Товар по штрихкоду (пробует варианты кода). null — такого товара нет или у него нет КБЖУ. Ошибки: 'network', 'busy'. */
export async function fetchByBarcode(text, signal) {
  for (const code of barcodeVariants(text) ?? []) {
    const d = await get(`${API}/api/v2/product/${code}.json?fields=${FIELDS}`, signal);
    if (d?.status === 1 && d.product) {
      const food = toFood({ ...d.product, code });
      return food ?? { missingNutrients: true, code, name: d.product.product_name_ru || d.product.product_name || '' };
    }
  }
  return null;
}

/** Поиск по названию (русские товары по умолчанию). Запускать только по действию пользователя; не чаще раза в несколько секунд. */
export async function searchOnline(q, { russiaOnly = true, signal } = {}) {
  const wait = lastSearch + MIN_GAP - Date.now();
  if (wait > 0) await new Promise((res, rej) => { const t = setTimeout(res, wait); signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('abort'), { name: 'AbortError' })); }); });
  lastSearch = Date.now();
  const params = new URLSearchParams({ search_terms: q, search_simple: '1', action: 'process', json: '1', page_size: '24', fields: FIELDS });
  if (russiaOnly) Object.entries({ tagtype_0: 'countries', tag_contains_0: 'contains', tag_0: 'russia' }).forEach(([k, v]) => params.set(k, v));
  const d = await get(`${API}/cgi/search.pl?${params}`, signal);
  return (d.products ?? []).map(toFood).filter(Boolean);
}
