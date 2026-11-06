// Шаг 2 сборки базы продуктов: отбор кандидатов USDA и перевод названий на русский через Gemini.
// Запуск: node tools/food-db/translate.mjs <usda.json> <рабочая папка> [--parallel 3] [--model gemini-3-flash-preview]
// Ключ берётся из .env.local (GEMINI_API_KEY); в репозиторий он не попадает, наружу уходят только названия продуктов.
// Готовые порции пишутся в <рабочая папка>/tr-NNN.json; уже сделанные пропускаются (можно прерывать и запускать снова).
// Результат: <рабочая папка>/base-ru.json — отобранные продукты с русскими названиями.

import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url);
const [inFile, work] = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^(\d+|gemini[\w.-]*)$/.test(a));
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
// модели перебираются по очереди: у бесплатного ключа дневной лимит запросов на каждую модель отдельный
const MODELS = arg('models', arg('model', 'gemini-3.5-flash')).split(',');
let modelIdx = 0;
const CONCURRENCY = Number(arg('parallel', 3));
const BATCH = Number(arg('batch', 120));
const GAP = Number(arg('gap', 0)) * 1000; // пауза после каждого запроса: у бесплатного ключа есть лимит запросов в минуту
if (!inFile || !work) { console.error('Использование: translate.mjs <usda.json> <work-dir>'); process.exit(1); }
fs.mkdirSync(work, { recursive: true });

// ---------- отбор ----------
const EXTRA = ['sat', 'na', 'chol', 'ca', 'fe', 'k', 'vc'];
const DROP_CAT = new Set(['Baby Foods', 'Fast Foods', 'Restaurant Foods', 'American Indian/Alaska Native Foods', 'Quality Control Materials', 'Branded Food Products Database']);
const BRANDS = /\b(mcdonald|burger king|wendy|taco bell|pizza hut|kfc|subway|domino|arby|popeye|little caesar|carl'?s jr|jack in the box|sonic|dairy queen|school lunch|usda commodity|nfs|babyfood|gerber|campbell|kellogg|general mills|nabisco|pillsbury|kraft|heinz|nestle|hershey|mars|starbucks|oscar mayer|jimmy dean|lean cuisine|stouffer|hormel|tyson|mission|la ricura)\b/i;
const items = JSON.parse(fs.readFileSync(inFile, 'utf8')).filter(x => !DROP_CAT.has(x.cat) && !BRANDS.test(x.en));

// одинаковые по сути записи (разные срезы, сорта, соль) сводятся к одной со средними значениями
const key = x => x.en.toLowerCase()
  .replace(/, trimmed to [^,]*/g, '').replace(/, (all grades|choice|select|prime)\b/g, '').replace(/, (with|without) salt\b/g, '')
  .replace(/, (boneless|bone-in)\b/g, '').replace(/\s+/g, ' ').trim();
const groups = new Map();
for (const x of items) { const k = x.cat + '|' + key(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
const avg = (a, f) => { const v = a.map(x => x[f]).filter(v => v != null); return v.length ? Math.round((v.reduce((s, y) => s + y, 0) / v.length) * 10) / 10 : null; };
const cands = [...groups.values()].map((g, i) => {
  const rep = g.slice().sort((a, b) => a.en.length - b.en.length)[0];
  const por = g.find(x => x.g && x.pn) ?? null;
  const o = { id: 'c' + i, en: rep.en, cat: rep.cat, kcal: Math.round(avg(g, 'kcal')), p: avg(g, 'p'), f: avg(g, 'f'), cb: avg(g, 'cb'), fib: avg(g, 'fib'), sug: avg(g, 'sug') };
  for (const k of EXTRA) { const v = avg(g, k); if (v != null) o[k] = v; }
  if (por) { o.g = por.g; o.pn = por.pn; }
  return o;
});
fs.writeFileSync(path.join(work, 'cands.json'), JSON.stringify(cands));
console.log(`После отбора и сведения: ${cands.length} из ${items.length}`);

// ---------- перевод ----------
async function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = await fs.promises.readFile(new URL('.env.local', root), 'utf8').catch(() => '');
  return env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
}
const KEY = await loadKey();
if (!KEY) { console.error('Нет GEMINI_API_KEY'); process.exit(1); }

const system = `Ты помогаешь собрать справочник продуктов для российского дневника питания.
Тебе приходит JSON-массив объектов {id, en, cat, pn?}: англоязычное название продукта из таблиц USDA, категория и описание порции.
Для КАЖДОГО объекта верни {id, ru, pr}:
- ru — короткое естественное русское название, как в российских таблицах калорийности, с существенными отличиями: сырой, варёный, жареный, запечённый, тушёный, консервированный, жирность, с кожей или без, цельнозерновой. Примеры: "Говядина, вырезка, варёная", "Яблоко, сырое", "Молоко 2,5 %", "Куриная грудка без кожи, жареная". Технические детали USDA (сорт, толщина жира, drained, enriched, unenriched, "year round average") не переноси. Первая буква заглавная, до 60 символов, без кавычек.
- ru = null, если продукт неинтересен российскому пользователю: экзотика (мясо диких животных, субпродукты редких видов, региональные продукты коренных народов), американские бренды и сети, детское питание, смеси и полуфабрикаты с торговыми названиями, технические позиции (сыворотка, мука из ... для промышленности).
- pr — если есть pn (описание порции), короткое русское существительное единицы порции в единственном числе: "шт", "ломтик", "стакан", "ст. л.", "ч. л.", "кусок", "порция", "чашка", "долька"; если pn непонятен или это просто унция, грамм или "serving", верни null.
Верни ТОЛЬКО JSON-массив тех же объектов в том же порядке, без пояснений.`;

async function call(batch) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELS[modelIdx]}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(batch) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'minimal' } } }),
      });
    } catch (e) { console.log(`  сеть: ${e.cause?.code ?? e.message}, повтор`); await new Promise(r => setTimeout(r, 5000 * attempt)); continue; }
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      if (/per day/i.test(body.error?.message ?? '')) { // дневной лимит этой модели исчерпан — берём следующую
        console.log(`  дневной лимит ${MODELS[modelIdx]} исчерпан`);
        if (modelIdx + 1 >= MODELS.length) { console.log('  все модели исчерпаны'); return null; }
        modelIdx++; console.log(`  переключаюсь на ${MODELS[modelIdx]}`);
        continue;
      }
    }
    if (res.status === 429 || res.status >= 500) { const w = 15_000 * attempt; console.log(`  ${res.status}, повтор через ${w / 1000} с`); await new Promise(r => setTimeout(r, w)); continue; }
    const data = await res.json();
    if (!res.ok) throw new Error(`${res.status}: ${data.error?.message ?? 'ошибка API'}`);
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
    try { return JSON.parse(text); } catch { console.log(`  невалидный JSON (${data.candidates?.[0]?.finishReason}), повтор`); }
  }
  return null;
}

const batches = [];
for (let i = 0; i < cands.length; i += BATCH) batches.push(cands.slice(i, i + BATCH).map(({ id, en, cat, pn }) => ({ id, en, cat, ...(pn ? { pn } : {}) })));
const pending = batches.map((b, i) => ({ b, i }));
let ok = 0;
async function worker() {
  while (pending.length) {
    const { b, i } = pending.shift();
    const file = path.join(work, `tr-${String(i + 1).padStart(3, '0')}.json`);
    if (fs.existsSync(file)) continue;
    const r = await call(b);
    if (GAP) await new Promise(res => setTimeout(res, GAP));
    const ids = new Set(b.map(x => x.id));
    const arr = Array.isArray(r) ? r : Object.values(r ?? {}).find(Array.isArray); // ответ мог прийти в обёртке {"items": [...]}
    const good = (arr ?? []).filter(x => ids.has(x?.id) && (x.ru === null || (typeof x.ru === 'string' && x.ru.trim())));
    console.log(`Порция ${i + 1}/${batches.length}: принято ${good.length}/${b.length}`);
    if (good.length >= b.length * 0.9) { fs.writeFileSync(file, JSON.stringify(good)); ok += good.length; }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ---------- сборка base-ru.json ----------
const tr = new Map();
for (const f of fs.readdirSync(work).filter(n => /^tr-\d+\.json$/.test(n))) for (const x of JSON.parse(fs.readFileSync(path.join(work, f), 'utf8'))) tr.set(x.id, x);
const outList = [];
const seen = new Set();
for (const c of cands) {
  const t = tr.get(c.id);
  if (!t || !t.ru) continue;
  const name = t.ru.trim().replace(/\s+/g, ' ');
  if (seen.has(name.toLowerCase())) continue; // одинаковое русское название у двух позиций — оставляем первую
  seen.add(name.toLowerCase());
  const r = { ru: name, en: c.en, cat: c.cat, kcal: c.kcal, p: c.p, f: c.f, cb: c.cb };
  for (const k of EXTRA) if (c[k] != null) r[k] = c[k];
  if (c.fib != null) r.fib = c.fib;
  if (c.sug != null) r.sug = c.sug;
  if (c.g && t.pr) { r.g = c.g; r.pr = t.pr; }
  outList.push(r);
}
fs.writeFileSync(path.join(work, 'base-ru.json'), JSON.stringify(outList));
console.log(`Переведено и отобрано: ${outList.length} из ${cands.length} (обработано порций: ${fs.readdirSync(work).filter(n => /^tr-/.test(n)).length}/${batches.length})`);
