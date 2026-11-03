// Перевод каталога упражнений на русский.
//   node tools/translation.mjs batches   — разрезать то, что ещё не переведено, на файлы translation/in/part-NN.json
//   node tools/translation.mjs apply     — проверить translation/out/part-NN.json и влить переводы в exercises.json
// Накопленные переводы лежат в translation/ru.json ({id: {n, s}}) и переживают пересборку каталога.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const CATALOG = new URL('modules/workouts/exercises.json', root);
const STORE = new URL('translation/ru.json', root);
const MAX_CHARS = 45_000; // размер одной порции (≈ 12k токенов на входе)

const readJson = async (u, fallback) => { try { return JSON.parse(await readFile(u, 'utf8')); } catch { return fallback; } };

/** Накладывает translation/ru.json на каталог (используется и сборщиком каталога). */
export function overlay(exercises, store) {
  let n = 0;
  for (const ex of exercises) {
    const t = store[ex.id];
    if (!t) continue;
    if (t.n) ex.ru = t.n;
    if (t.s?.length && t.s.length === ex.d?.length) ex.dr = t.s;
    n++;
  }
  return n;
}

async function batches() {
  const { exercises } = await readJson(CATALOG);
  // переводить нужно название (если нет русского) и шаги техники (если есть английские и нет русских)
  const items = exercises
    .map(ex => ({
      id: ex.id,
      name: ex.ru ? undefined : ex.n,
      steps: ex.d?.length && !ex.dr?.length ? ex.d : undefined,
    }))
    .filter(it => it.name || it.steps);
  const parts = [];
  let cur = [], size = 0;
  for (const it of items) {
    const len = JSON.stringify(it).length;
    if (cur.length && size + len > MAX_CHARS) { parts.push(cur); cur = []; size = 0; }
    cur.push(it); size += len;
  }
  if (cur.length) parts.push(cur);
  await mkdir(new URL('translation/in/', root), { recursive: true });
  await mkdir(new URL('translation/out/', root), { recursive: true });
  for (const [i, part] of parts.entries()) {
    const name = `part-${String(i + 1).padStart(2, '0')}.json`;
    await writeFile(new URL('translation/in/' + name, root), JSON.stringify(part));
  }
  console.log({ exercisesToTranslate: items.length, parts: parts.length });
}

async function apply() {
  const { exercises, ...meta } = await readJson(CATALOG);
  const byId = new Map(exercises.map(e => [e.id, e]));
  const store = await readJson(STORE, {});
  const problems = [];
  let accepted = 0;
  const dir = new URL('translation/out/', root);
  const files = (await readdir(dir).catch(() => [])).filter(f => /^part-\d+\.json$/.test(f)).sort();
  for (const f of files) {
    let data;
    try { data = JSON.parse(await readFile(new URL(f, dir), 'utf8')); } catch (e) { problems.push(`${f}: невалидный JSON (${e.message})`); continue; }
    if (!Array.isArray(data)) { problems.push(`${f}: ожидался массив`); continue; }
    for (const it of data) {
      const ex = byId.get(it?.id);
      if (!ex) { problems.push(`${f}: неизвестный id ${it?.id}`); continue; }
      const rec = { ...(store[ex.id] ?? {}) };
      if (typeof it.name === 'string' && it.name.trim()) rec.n = it.name.trim();
      if (Array.isArray(it.steps) && it.steps.length) {
        if (it.steps.length !== ex.d?.length) { problems.push(`${f}: ${ex.id} — шагов ${it.steps.length}, а в оригинале ${ex.d?.length ?? 0}`); }
        else rec.s = it.steps.map(s => String(s).trim());
      }
      if (rec.n || rec.s) { store[ex.id] = rec; accepted++; }
    }
  }
  await mkdir(new URL('translation/', root), { recursive: true });
  await writeFile(STORE, JSON.stringify(store));
  const n = overlay(exercises, store);
  await writeFile(CATALOG, JSON.stringify({ ...meta, exercises }));
  console.log({ files: files.length, accepted, inCatalog: n, withRuName: exercises.filter(e => e.ru).length, total: exercises.length });
  if (problems.length) { console.log('\nПроблемы (эти записи пропущены, их нужно перевести заново):'); problems.slice(0, 50).forEach(p => console.log(' -', p)); if (problems.length > 50) console.log(` … и ещё ${problems.length - 50}`); }
}

const cmd = process.argv[2];
if (process.argv[1]?.endsWith('translation.mjs')) {
  if (cmd === 'batches') await batches();
  else if (cmd === 'apply') await apply();
  else if (cmd) console.log('Команды: batches | apply');
}
