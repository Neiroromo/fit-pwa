// Импорт файла, подготовленного ИИ-агентом (формат «fit-pwa-ai» v1, описан в ai/AGENT.md).
//
// Принципы:
//  • Ничего не перезаписывается. Агент не пишет id: все записи получают новые id, существующие записи не трогаются.
//  • Сначала проверка и предпросмотр: что будет добавлено, что уже есть, что отброшено и почему. Запись — только после подтверждения.
//  • Всё созданное помечается {ai: {batch, by, at}}: в интерфейсе у таких записей значок «ИИ»; импорт можно отменить целиком по номеру партии.
//  • Названия упражнений и продуктов сопоставляются с каталогами приложения (точно, без скобок, затем близко); спорные совпадения показываются в предпросмотре.

import { h, icon, modal, toast, uid } from './ui.js';
import { getSettings as getLangSettings } from './i18n.js';

const MAX = { exercises: 100, foods: 300, workouts: 30, mealPlan: 500, dishes: 1000 };
const GROUP_KEYS = ['chest', 'back', 'shoulders', 'arms', 'abs', 'legs', 'glutes', 'cardio', 'neck'];
const GROUP_RU = { грудь: 'chest', спина: 'back', плечи: 'shoulders', руки: 'arms', пресс: 'abs', ноги: 'legs', ягодицы: 'glutes', кардио: 'cardio', шея: 'neck' };
const LEVELS = ['beginner', 'intermediate', 'expert'];
const MEALS_DEFAULT = [{ id: 'breakfast', name: 'Завтрак' }, { id: 'lunch', name: 'Обед' }, { id: 'dinner', name: 'Ужин' }, { id: 'snack', name: 'Перекус' }];
const BATCHES_KEY = 'app/ai-imports';

const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const noParens = s => norm(String(s ?? '').replace(/\([^)]*\)/g, ' '));
const r1 = v => Math.round(v * 10) / 10;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max;
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00'));

// ---------- справочники приложения (загружаются при необходимости) ----------
let catalogP = null, baseP = null;
const loadCatalog = () => (catalogP ??= fetch(new URL('modules/workouts/exercises.json', document.baseURI)).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(j => j.exercises));
const loadBase = () => (baseP ??= fetch(new URL('modules/nutrition/data/base.bin', document.baseURI))
  .then(async r => { if (!r.ok) throw new Error(); return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()); }));
const LIQUID = /(молоко|сливки|кефир|ряженка|йогурт питьевой|сок\b|нектар|напиток|вода|лимонад|квас|пиво|вино|чай|кофе|масло оливковое|растительное масло)/i;

/** Поиск по названию: точное → без скобок (если однозначно) → близкое по словам (если однозначно). Возвращает {value, how}. */
function makeMatcher() {
  const exact = new Map(), loose = new Map(), words = [];
  return {
    add(names, value) {
      for (const n of names.filter(Boolean)) {
        const k = norm(n);
        if (!exact.has(k)) exact.set(k, value);
        const l = noParens(n);
        if (!loose.has(l)) loose.set(l, new Set());
        loose.get(l).add(value);
      }
      words.push({ set: new Set(names.filter(Boolean).flatMap(n => noParens(n).split(' ').filter(Boolean))), value });
    },
    find(name) {
      const k = norm(name);
      if (exact.has(k)) return { value: exact.get(k), how: 'exact' };
      const l = noParens(name), hits = loose.get(l);
      if (hits?.size === 1) return { value: [...hits][0], how: 'loose' };
      const q = new Set(l.split(' ').filter(Boolean));
      if (q.size < 2) return null;
      let best = null, second = 0;
      for (const w of words) {
        let common = 0;
        for (const t of q) if (w.set.has(t)) common++;
        const score = common / (q.size + w.set.size - common);
        if (!best || score > best.score) { second = best?.score ?? 0; best = { score, value: w.value }; } else if (score > second) second = score;
      }
      return best && best.score >= 0.75 && best.score > second ? { value: best.value, how: 'close' } : null;
    },
  };
}

// ---------- проверка и построение плана ----------
/**
 * Разбирает файл и возвращает план: что будет создано (records), строки предпросмотра (rows) и счётчики.
 * Ничего не записывает.
 */
export async function buildPlan(app, data) {
  const rows = [];      // {kind, text, status: 'new'|'exists'|'mapped'|'warn'|'error', detail}
  const records = [];   // {c, rec}
  const counts = { exercises: 0, foods: 0, workouts: 0, meals: 0, skipped: 0 };
  const row = (kind, text, status, detail = '') => { rows.push({ kind, text, status, detail }); if (status === 'error') counts.skipped++; };
  const fatal = msg => ({ fatal: msg, rows, records: [], counts });

  if (!data || typeof data !== 'object' || Array.isArray(data)) return fatal('Файл не похож на данные от ИИ: ожидается объект JSON.');
  if (data.format !== 'fit-pwa-ai') return fatal('Это не файл формата «fit-pwa-ai» (поле format). Возможно, это резервная копия приложения: её загружают в разделе «Импорт из файла».');
  if (data.version !== 1) return fatal('Неизвестная версия формата (поддерживается version: 1).');
  const by = isStr(data.generatedBy, 60) ? data.generatedBy.trim() : 'ИИ';
  const batch = 'ai-' + uid().slice(0, 8);
  const at = typeof data.createdAt === 'string' && isDay(data.createdAt) ? data.createdAt : new Date().toISOString().slice(0, 10);
  const mark = { batch, by, at };
  const sections = ['exercises', 'foods', 'workouts', 'mealPlan'].filter(k => Array.isArray(data[k]) && data[k].length);
  if (!sections.length) return fatal('В файле нет ни упражнений, ни продуктов, ни тренировок, ни меню (разделы exercises, foods, workouts, mealPlan).');

  const lang = (() => { // язык названий упражнений: настройка контента → язык модуля → язык приложения
    const s = getLangSettings();
    const pick = [s.content?.['workouts.exercises'], s.modules?.workouts, s.app].find(v => v && v !== 'auto');
    return pick ?? 'ru';
  })();
  const exName = ex => (lang === 'en' ? ex.n : ex.ru || ex.n);

  // --- существующие данные пользователя ---
  const col = c => app.db.collection(c);
  const [customEx, templates, foodsHave, nutSettings] = await Promise.all([
    col('workouts/exercises').list(), col('workouts/templates').list(), col('nutrition/foods').list(), app.db.scope('nutrition').kv.get('settings', null),
  ]);
  const meals = (nutSettings?.meals?.length ? nutSettings.meals : MEALS_DEFAULT);
  const installed = id => app.registry.isInstalled(id);

  // ---- упражнения ----
  const exMatch = makeMatcher(); // каталог + свои + новые из файла
  const needCatalog = sections.includes('exercises') || sections.includes('workouts');
  let catalog = [];
  if (needCatalog) { try { catalog = await loadCatalog(); } catch { rows.push({ kind: 'warn', text: 'Каталог упражнений не загрузился', status: 'warn', detail: 'Названия не сопоставлены с каталогом: проверьте подключение к интернету.' }); } }
  for (const ex of catalog) exMatch.add([ex.ru, ex.n], { ref: ex.id, name: exName(ex), source: 'catalog' });
  for (const ex of customEx) exMatch.add([ex.n, ex.ru], { ref: ex.id, name: exName(ex), source: 'custom' });

  const seenEx = new Set();
  (data.exercises ?? []).slice(0, MAX.exercises).forEach((e, i) => {
    const label = `Упражнение ${i + 1}`;
    if (!e || !isStr(e.name, 80)) return row('exercise', label, 'error', 'нет названия (name, 1–80 символов)');
    const name = e.name.trim();
    if (!Array.isArray(e.groups) || !e.groups.length) return row('exercise', name, 'error', 'не указана группа мышц (groups)');
    if (seenEx.has(norm(name))) return row('exercise', name, 'error', 'повтор названия в файле');
    seenEx.add(norm(name));
    const found = exMatch.find(name);
    if (found?.how === 'exact') return row('exercise', name, 'exists', found.value.source === 'catalog' ? 'уже есть в каталоге' : 'уже есть среди ваших упражнений');
    const groups = [...new Set(e.groups.filter(g => isStr(g, 30)).map(g => GROUP_RU[norm(g)] ?? norm(g)))].slice(0, 6);
    if (!groups.length) return row('exercise', name, 'error', 'группа мышц указана неверно');
    const list = (v, n = 8) => (Array.isArray(v) ? v.filter(x => isStr(x, 30)).map(x => x.trim().toLowerCase()).slice(0, n) : []);
    const steps = Array.isArray(e.steps) ? e.steps.filter(x => isStr(x, 300)).map(x => x.trim()).slice(0, 12) : [];
    const rec = { id: 'cx:' + uid(), custom: true, n: name, g: groups, e: list(e.equipment), m: list(e.muscles), s: list(e.secondary), l: LEVELS.includes(e.level) ? e.level : '', d: steps, img: [], ai: mark };
    records.push({ c: 'workouts/exercises', rec });
    exMatch.add([name], { ref: rec.id, name, source: 'new' });
    counts.exercises++;
    row('exercise', name, 'new', groups.join(', ') + (found ? ` (похоже на «${found.value.name}», но создано отдельным)` : ''));
  });

  // ---- продукты ----
  const foodMatch = makeMatcher(); // новые из файла + свои + справочник
  let base = null;
  const needBase = sections.includes('foods') || sections.includes('mealPlan');
  if (needBase && sections.includes('mealPlan')) { try { base = await loadBase(); } catch { rows.push({ kind: 'warn', text: 'Справочник продуктов не загрузился', status: 'warn', detail: 'Продукты можно сопоставить только со своими и описанными в файле.' }); } }
  for (const f of foodsHave) foodMatch.add([f.name], { food: f, source: 'mine' });
  if (base) base.f.forEach((r, i) => foodMatch.add([r[0], r[10]], { baseRow: r, source: 'base', i }));

  const newFoods = new Map(); // norm имени → запись
  const seenFood = new Set();
  (data.foods ?? []).slice(0, MAX.foods).forEach((f, i) => {
    const label = `Продукт ${i + 1}`;
    if (!f || !isStr(f.name, 80)) return row('food', label, 'error', 'нет названия (name, 1–80 символов)');
    const name = f.name.trim();
    if (seenFood.has(norm(name))) return row('food', name, 'error', 'повтор названия в файле');
    seenFood.add(norm(name));
    if (f.unit !== 'g' && f.unit !== 'ml') return row('food', name, 'error', 'unit должен быть "g" или "ml"');
    const nums = { kcal: [0, 900], protein: [0, 100], fat: [0, 100], carbs: [0, 100] };
    for (const [k, [lo, hi]] of Object.entries(nums)) if (!isNum(f[k]) || f[k] < lo || f[k] > hi) return row('food', name, 'error', `поле ${k} должно быть числом от ${lo} до ${hi}`);
    if (f.protein + f.fat + f.carbs > 100.5) return row('food', name, 'error', 'белки + жиры + углеводы больше 100 г на 100 г');
    const mine = foodsHave.find(x => norm(x.name) === norm(name) && x.unit === f.unit);
    if (mine) { newFoods.set(norm(name), mine); return row('food', name, 'exists', 'уже есть среди ваших блюд'); }
    const rec = { id: uid(), name, unit: f.unit, kcal: r1(f.kcal), p: r1(f.protein), f: r1(f.fat), cb: r1(f.carbs), src: 'own', ai: mark };
    for (const [k, to] of [['fiber', 'fib'], ['sugar', 'sug']]) if (isNum(f[k]) && f[k] >= 0 && f[k] <= 100) rec[to] = r1(f[k]);
    if (f.portion && isNum(f.portion.size) && f.portion.size >= 1 && f.portion.size <= 5000 && isStr(f.portion.name, 20)) rec.portion = { size: f.portion.size, name: f.portion.name.trim() };
    const calc = 4 * rec.p + 4 * rec.cb + 9 * rec.f;
    records.push({ c: 'nutrition/foods', rec });
    newFoods.set(norm(name), rec);
    counts.foods++;
    const odd = Math.abs(rec.kcal - calc) > 0.25 * Math.max(calc, 50);
    row('food', name, odd ? 'warn' : 'new', `${rec.kcal} ккал · Б ${rec.p} · Ж ${rec.f} · У ${rec.cb} на 100 ${f.unit === 'ml' ? 'мл' : 'г'}` + (odd ? `. Калории не сходятся с БЖУ (по БЖУ ≈ ${Math.round(calc)}): проверьте значения` : ''));
  });

  // ---- тренировки ----
  const takenNames = new Set(templates.map(t => norm(t.name)));
  (data.workouts ?? []).slice(0, MAX.workouts).forEach((w, i) => {
    const label = `Тренировка ${i + 1}`;
    if (!w || !isStr(w.name, 80)) return row('workout', label, 'error', 'нет названия (name, 1–80 символов)');
    if (!Array.isArray(w.exercises) || !w.exercises.length) return row('workout', w.name, 'error', 'нет упражнений (exercises)');
    let name = w.name.trim(), n = 2;
    while (takenNames.has(norm(name))) name = `${w.name.trim()} (${n++})`; // такое название уже есть: добавляем номер, существующая тренировка не трогается
    takenNames.add(norm(name));
    const exs = [], notes = [];
    for (const [j, x] of w.exercises.slice(0, 30).entries()) {
      if (!x || !isStr(x.name, 80)) { notes.push(`упражнение ${j + 1}: нет названия`); continue; }
      if (!Number.isInteger(x.sets) || x.sets < 1 || x.sets > 10) { notes.push(`«${x.name}»: sets должно быть целым от 1 до 10`); continue; }
      const found = exMatch.find(x.name);
      const item = { id: uid(), name: found ? found.value.name : x.name.trim(), comment: isStr(x.comment, 300) ? x.comment.trim() : '', sets: x.sets, warmup: x.warmup === true };
      if (found) { item.ref = found.value.ref; item.refName = item.name; if (found.how !== 'exact') notes.push(`«${x.name}» → «${found.value.name}»`); }
      else notes.push(`«${x.name}» нет в каталоге: оставлено как есть, без картинок и техники`);
      exs.push(item);
    }
    if (!exs.length) return row('workout', name, 'error', 'не осталось ни одного корректного упражнения');
    records.push({ c: 'workouts/templates', rec: { id: uid(), name, exercises: exs, ai: mark } });
    counts.workouts++;
    row('workout', name, notes.length ? 'mapped' : 'new', `${exs.length} упр.` + (name !== w.name.trim() ? `; название занято, добавлено как «${name}»` : '') + (notes.length ? '; ' + notes.join('; ') : ''));
  });

  // ---- меню ----
  const foodCache = new Map(); // norm → запись продукта для журнала (создаётся один раз)
  const resolveFood = name => {
    const k = norm(name);
    if (newFoods.has(k)) return { food: newFoods.get(k) };
    if (foodCache.has(k)) return { food: foodCache.get(k) };
    const found = foodMatch.find(name);
    if (!found) return null;
    const v = found.value;
    let food = v.food;
    if (v.source === 'base') { // продукт из справочника сохраняется в «Мои блюда» (как при обычном добавлении)
      const r = v.baseRow, cat = base.cats[r[1]];
      food = { id: uid(), name: r[0], unit: cat === 'Beverages' || LIQUID.test(r[0]) ? 'ml' : 'g', kcal: r[2], p: r[3], f: r[4], cb: r[5], src: 'base', ai: mark };
      if (r[6] != null) food.fib = r[6];
      if (r[7] != null) food.sug = r[7];
      if (r[8]) food.portion = { size: r[8], name: r[9] || '' };
      records.push({ c: 'nutrition/foods', rec: food });
      counts.foods++;
      row('food', food.name, 'new', 'из справочника приложения');
    }
    foodCache.set(k, food);
    return { food, how: found.how, found: found.value };
  };
  const mealOf = text => meals.find(m => norm(m.id) === norm(text) || norm(m.name) === norm(text));
  let dishes = 0;
  const days = new Set();
  const dayNotes = [];
  (data.mealPlan ?? []).slice(0, MAX.mealPlan).forEach((d, i) => {
    const label = `Приём ${i + 1}`;
    if (!d || !isDay(d.date)) return row('meal', label, 'error', 'дата должна быть в формате YYYY-MM-DD');
    const meal = mealOf(d.meal);
    if (!meal) return row('meal', `${d.date}, ${d.meal}`, 'error', 'такого приёма нет: используйте breakfast, lunch, dinner, snack или название вашего приёма');
    if (!Array.isArray(d.items) || !d.items.length) return row('meal', `${d.date}, ${meal.name}`, 'error', 'нет блюд (items)');
    const entries = [], bad = [];
    for (const it of d.items.slice(0, 20)) {
      if (dishes >= MAX.dishes) { bad.push('превышен лимит блюд'); break; }
      if (!it || !isStr(it.food, 80) || !isNum(it.amount) || it.amount < 1 || it.amount > 3000) { bad.push(`«${it?.food ?? '?'}»: нужны food и amount от 1 до 3000`); continue; }
      const r = resolveFood(it.food);
      if (!r) { bad.push(`«${it.food}» нет ни в справочнике, ни среди ваших блюд, ни в разделе foods`); continue; }
      const food = r.food, k = it.amount / 100;
      const entry = { id: uid(), date: d.date, meal: meal.id, foodId: food.id, planned: true, name: food.name, unit: food.unit, amount: r1(it.amount), kcal: Math.round(food.kcal * k), p: r1(food.p * k), f: r1(food.f * k), cb: r1(food.cb * k) };
      const snap = { name: food.name, unit: food.unit, kcal: food.kcal, p: food.p, f: food.f, cb: food.cb };
      for (const e of ['fib', 'sug']) if (food[e] != null) { entry[e] = r1(food[e] * k); snap[e] = food[e]; }
      if (food.portion) snap.portion = food.portion;
      entry.base = snap; entry.ai = mark;
      entries.push(entry);
      if (r.how && r.how !== 'exact') dayNotes.push(`«${it.food}» → «${food.name}»`);
      dishes++;
    }
    for (const e of entries) records.push({ c: 'nutrition/log', rec: e });
    if (entries.length) { counts.meals += entries.length; days.add(d.date); }
    const kcal = entries.reduce((s, e) => s + e.kcal, 0);
    row('meal', `${d.date}, ${meal.name}`, bad.length ? (entries.length ? 'warn' : 'error') : 'new', `${entries.length} блюд, ${kcal} ккал` + (bad.length ? '; пропущено: ' + bad.join('; ') : ''));
  });
  if (dayNotes.length) rows.push({ kind: 'warn', text: 'Названия продуктов сопоставлены приблизительно', status: 'mapped', detail: [...new Set(dayNotes)].join('; ') });
  counts.days = days.size;

  if (!records.length && !rows.some(r => r.status === 'exists')) return { fatal: 'Из файла нечего добавить: все элементы содержат ошибки (см. список ниже).', rows, records: [], counts, batch, by, at, note: data.note };
  return { rows, records, counts, batch, by, at, note: typeof data.note === 'string' ? data.note.slice(0, 500) : '' };
}

// ---------- запись, отмена, снятие меток ----------
export async function commitPlan(app, plan) {
  const refs = [];
  for (const { c, rec } of plan.records) { await app.db.collection(c).put(rec); refs.push([c, rec.id]); }
  const list = await app.db.kv.get(BATCHES_KEY, []);
  list.unshift({ id: plan.batch, at: Date.now(), by: plan.by, note: plan.note ?? '', counts: plan.counts, refs });
  await app.db.kv.set(BATCHES_KEY, list.slice(0, 20));
  window.dispatchEvent(new HashChangeEvent('hashchange')); // открытый модуль перерисуется с новыми данными
}

async function undoBatch(app, b) {
  for (const [c, id] of b.refs) await app.db.collection(c).remove(id);
  await app.db.kv.set(BATCHES_KEY, (await app.db.kv.get(BATCHES_KEY, [])).filter(x => x.id !== b.id));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
async function unmarkBatch(app, b) {
  for (const [c, id] of b.refs) {
    const rec = await app.db.collection(c).get(id);
    if (rec?.ai) { const { ai, ...rest } = rec; await app.db.collection(c).put(rest); }
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// ---------- инструкция для ИИ (копирование) ----------
const baseUrl = () => new URL('ai/', document.baseURI).href;

async function buildPrompt(app, withData) {
  let guide = '';
  try { guide = await (await fetch(new URL('ai/AGENT.md', document.baseURI), { cache: 'no-cache' })).text(); } catch { /* офлайн */ }
  const parts = [
    `Ты помогаешь пользователю приложения Fit. Прочитай инструкцию ниже и выполни задачу пользователя: составь JSON-файл формата fit-pwa-ai.`,
    `Адрес инструкции и списков: ${baseUrl()} (ссылки вида lists.txt, exercises/…, foods/… в инструкции отсчитываются от этого адреса).`,
    guide ? '\n---\n' + guide : `\nИнструкция не загрузилась (нет сети). Откройте ${baseUrl()}AGENT.md и вставьте её сюда.`,
  ];
  if (withData) {
    const lines = [], u = app.profile ?? {};
    const age = u.birth ? Math.floor((Date.now() - new Date(u.birth)) / 31557600000) : null;
    if (u.sex) lines.push(`- Пол: ${u.sex === 'm' ? 'мужской' : 'женский'}`);
    if (age != null) lines.push(`- Возраст: ${age}`);
    const body = await app.db.scope('shared').kv.get('body', null);
    if (body?.heightCm) lines.push(`- Рост: ${body.heightCm} см`);
    const w = body?.weights?.at(-1);
    if (w) lines.push(`- Вес: ${w[1]} кг (на ${w[0]})`);
    const ns = await app.db.scope('nutrition').kv.get('settings', null);
    if (ns?.goals?.kcal) lines.push(`- Цель по калориям: ${ns.goals.kcal} ккал в день (белки ${ns.goals.p} г, жиры ${ns.goals.f} г, углеводы ${ns.goals.cb} г)`);
    lines.push(`- Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}`);
    parts.push('\n---\n## Данные пользователя (для расчётов)\n' + lines.join('\n'));
  } else parts.push(`\n---\nСегодняшняя дата: ${new Date().toISOString().slice(0, 10)}`);
  return parts.join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* не защищённый контекст */ }
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0', top: '0' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

// ---------- окно «Импорт от ИИ» ----------
export function openAiImport(app, { onClose } = {}) {
  const t = app.t;
  const out = h('div', { class: 'ai-out' });
  const hist = h('div', { class: 'ai-hist' });
  const paste = h('textarea', { class: 'input seed', rows: '4', placeholder: 'Или вставьте сюда JSON от ИИ', spellcheck: 'false' });
  const file = h('input', { type: 'file', accept: 'application/json,.json,text/plain', hidden: true });
  const withData = h('input', { type: 'checkbox' });
  let plan = null;

  const statusIcon = { new: 'plus', exists: 'check', mapped: 'swap', warn: 'info', error: 'x' };
  const statusText = { new: 'добавится', exists: 'уже есть', mapped: 'сопоставлено', warn: 'проверьте', error: 'не добавится' };
  const kindName = { exercise: 'Упражнения', food: 'Продукты', workout: 'Тренировки', meal: 'Меню', warn: 'Замечания' };

  function showPlan(p) {
    plan = p;
    if (p.fatal && !p.rows.length) { out.replaceChildren(h('p', { class: 'ai-err' }, t(p.fatal))); return; }
    const c = p.counts;
    const summary = [
      c.workouts ? t('Тренировок: {n}', { n: c.workouts }) : null,
      c.exercises ? t('Новых упражнений: {n}', { n: c.exercises }) : null,
      c.foods ? t('Новых продуктов: {n}', { n: c.foods }) : null,
      c.meals ? t('Блюд в меню: {n} (дней: {d})', { n: c.meals, d: c.days }) : null,
    ].filter(Boolean);
    const groups = new Map();
    for (const r of p.rows) { if (!groups.has(r.kind)) groups.set(r.kind, []); groups.get(r.kind).push(r); }
    const body = [...groups].map(([kind, list]) => h('details', { class: 'ai-group', open: list.some(r => r.status === 'error' || r.status === 'warn') || list.length <= 6 },
      h('summary', null, `${t(kindName[kind] ?? kind)} (${list.length})`),
      ...list.slice(0, 80).map(r => h('div', { class: 'ai-row ' + r.status },
        icon(statusIcon[r.status] ?? 'info', 14),
        h('div', { class: 'grow' }, h('strong', null, document.createTextNode(r.text)), r.detail ? h('span', { class: 'muted small block' }, document.createTextNode(r.detail)) : null),
        h('span', { class: 'chip' }, t(statusText[r.status] ?? r.status)))),
      list.length > 80 ? h('p', { class: 'muted small' }, t('…и ещё {n}', { n: list.length - 80 })) : null));
    const mods = [];
    if (c.workouts || c.exercises) if (!app.registry.isInstalled('workouts')) mods.push(t('Модуль «Тренировки» не установлен: данные сохранятся и появятся после установки.'));
    if (c.foods || c.meals) if (!app.registry.isInstalled('nutrition')) mods.push(t('Модуль «Дневник питания» не установлен: данные сохранятся и появятся после установки.'));
    out.replaceChildren(
      p.fatal ? h('p', { class: 'ai-err' }, t(p.fatal)) : null,
      h('div', { class: 'ai-sum' }, h('strong', null, document.createTextNode(t('Файл от: {by}', { by: p.by }))), p.note ? h('p', { class: 'muted small' }, document.createTextNode(p.note)) : null,
        summary.length ? h('p', null, summary.join(' · ')) : h('p', { class: 'muted' }, t('Новых записей нет.'))),
      ...mods.map(m => h('p', { class: 'muted small' }, m)),
      ...body,
      p.records.length ? h('button', { class: 'btn primary wide', onClick: doCommit }, icon('check', 16), t('Добавить {n} записей', { n: p.records.length })) : null,
      h('p', { class: 'muted small' }, t('Существующие данные не изменяются. Добавленное помечается значком «ИИ», весь импорт можно отменить ниже.')));
  }

  async function doCommit() {
    if (!plan?.records.length) return;
    try {
      await commitPlan(app, plan);
      toast(t('Добавлено записей: {n}', { n: plan.records.length }));
      plan = null; paste.value = '';
      out.replaceChildren(h('p', { class: 'ai-ok' }, t('Готово. Добавленное помечено значком «ИИ».')));
      drawHist();
    } catch (e) { console.error(e); toast(t('Не удалось сохранить: {msg}', { msg: e.message })); }
  }

  async function check(text) {
    out.replaceChildren(h('p', { class: 'muted' }, t('Проверяю…')));
    let data;
    try { data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return out.replaceChildren(h('p', { class: 'ai-err' }, t('Это не JSON. Скопируйте ответ ИИ целиком, без пояснений до и после блока.'))); }
    try { showPlan(await buildPlan(app, data)); } catch (e) { console.error(e); out.replaceChildren(h('p', { class: 'ai-err' }, t('Не удалось разобрать файл: {msg}', { msg: e.message }))); }
  }

  file.addEventListener('change', async () => { const f = file.files[0]; file.value = ''; if (f) check(await f.text()); });

  async function drawHist() {
    const list = await app.db.kv.get(BATCHES_KEY, []);
    hist.replaceChildren(...(list.length ? [
      h('h3', { class: 'ai-h' }, t('Прошлые импорты')),
      ...list.map(b => h('div', { class: 'ai-batch' },
        h('div', { class: 'grow' }, h('strong', null, document.createTextNode(b.by)), h('span', { class: 'muted small block' }, document.createTextNode(`${new Date(b.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${t('записей: {n}', { n: b.refs.length })}`))),
        h('button', { class: 'btn sm', title: t('Убрать значок «ИИ», записи останутся'), onClick: async () => { await unmarkBatch(app, b); toast(t('Метки сняты')); } }, t('Снять метки')),
        h('button', { class: 'btn sm danger', onClick: async () => { await undoBatch(app, b); toast(t('Импорт отменён: записи удалены')); drawHist(); } }, t('Отменить импорт')))),
    ] : []));
  }

  const m = modal({
    title: 'Импорт от ИИ',
    wide: true,
    onClose,
    body: h('div', { class: 'form ai-form' },
      h('p', { class: 'muted small' }, 'ИИ (ChatGPT, Gemini, Claude и другие) может составить программу тренировок или меню в виде файла. Дайте ему ссылку на инструкцию, получите JSON и загрузите его здесь: данные добавятся к вашим, ничего не перезапишется.'),
      h('div', { class: 'row-gap wrap' },
        h('button', { class: 'btn', onClick: async () => toast((await copyText(await buildPrompt(app, withData.checked))) ? t('Инструкция скопирована: вставьте её в чат с ИИ') : t('Не удалось скопировать')) }, icon('copy', 16), 'Скопировать инструкцию для ИИ'),
        h('button', { class: 'btn', onClick: async () => toast((await copyText(baseUrl() + 'AGENT.md')) ? t('Ссылка скопирована') : t('Не удалось скопировать')) }, icon('copy', 16), 'Скопировать ссылку')),
      h('label', { class: 'check' }, withData, h('span', null, 'Добавить в инструкцию мои данные (пол, возраст, рост, вес, цель по калориям)')),
      h('hr', { class: 'ai-hr' }),
      h('div', { class: 'row-gap wrap' },
        h('button', { class: 'btn primary', onClick: () => file.click() }, icon('upload', 16), 'Выбрать файл от ИИ'),
        file),
      paste,
      h('button', { class: 'btn', onClick: () => paste.value.trim() ? check(paste.value) : toast(t('Вставьте JSON или выберите файл')) }, icon('check', 16), 'Проверить вставленное'),
      out, hist),
  });
  drawHist();
  return m;
}
