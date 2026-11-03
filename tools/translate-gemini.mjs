// Переводит translation/exercises.en.json через Gemini API порциями.
// Ключ берётся из .env.local (GEMINI_API_KEY) или из переменной окружения; в git он не попадает.
//   node tools/translate-gemini.mjs [--limit N] [--model gemini-2.5-flash]
// Готовые порции пишутся в translation/out/auto-NN.json; уже сделанные пропускаются (можно прерывать и запускать снова).
// Потом: node tools/translation.mjs apply
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const MODEL = arg('model', 'gemini-3-flash-preview');
const LIMIT = Number(arg('limit', Infinity));
const CHUNK_CHARS = 9_000; // небольшие порции: ответ приходит быстро, нет таймаутов
const CONCURRENCY = Number(arg('parallel', 3));

async function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = await readFile(new URL('.env.local', root), 'utf8').catch(() => '');
  return env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
}
const KEY = await loadKey();
if (!KEY) { console.error('Нет GEMINI_API_KEY (.env.local или переменная окружения)'); process.exit(1); }

// системная инструкция — раздел «Запрос для ИИ» из PROMPT.md
const prompt = await readFile(new URL('translation/PROMPT.md', root), 'utf8');
const system = prompt.slice(prompt.indexOf('Ты — профессиональный'), prompt.indexOf('### Как выдавать ответ порциями'))
  .replace('Я приложу JSON-файл `exercises.en.json` со списком', 'Я пришлю JSON-массив со списком');

const items = JSON.parse(await readFile(new URL('translation/exercises.en.json', root), 'utf8'));
const chunks = [];
for (let cur = [], size = 0, i = 0; i <= items.length; i++) {
  const it = items[i];
  const len = it ? JSON.stringify(it).length : 0;
  if (cur.length && (!it || size + len > CHUNK_CHARS)) { chunks.push(cur); cur = []; size = 0; }
  if (it) { cur.push(it); size += len; }
}
await mkdir(new URL('translation/out/', root), { recursive: true });

async function callGemini(batch) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(batch) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 65536 },
      }),
      });
    } catch (e) {
      console.log(`  сеть: ${e.cause?.code ?? e.message}, повтор`);
      await new Promise(r => setTimeout(r, 5000 * attempt));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = 15_000 * attempt;
      console.log(`  ${res.status}, повтор через ${wait / 1000} с`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`${res.status}: ${data.error?.message ?? 'ошибка API'}`);
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
    try { return JSON.parse(text); } catch { console.log(`  невалидный JSON (finish: ${data.candidates?.[0]?.finishReason}), повтор`); }
  }
  return null;
}

/** Оставляет только корректные записи: id из порции, число шагов совпадает. */
function validate(batch, result) {
  const byId = new Map(batch.map(b => [b.id, b]));
  const ok = [];
  for (const r of Array.isArray(result) ? result : []) {
    const src = byId.get(r?.id);
    if (!src) continue;
    if (src.name && !(typeof r.name === 'string' && r.name.trim())) continue;
    if (src.steps && !(Array.isArray(r.steps) && r.steps.length === src.steps.length && r.steps.every(s => typeof s === 'string' && s.trim()))) continue;
    ok.push({ id: r.id, ...(src.name ? { name: r.name } : {}), ...(src.steps ? { steps: r.steps } : {}) });
  }
  return ok;
}

let done = 0, accepted = 0, total = 0;
const pending = chunks.map((batch, i) => ({ batch, i })).filter(({ i }) => i < Infinity);

async function worker() {
  while (pending.length && done < LIMIT) {
    const { batch, i } = pending.shift();
    const file = new URL(`translation/out/auto-${String(i + 1).padStart(3, '0')}.json`, root);
    if (await access(file).then(() => true, () => false)) continue;
    done++;
    const result = await callGemini(batch);
    const ok = validate(batch, result);
    total += batch.length; accepted += ok.length;
    console.log(`Порция ${i + 1}/${chunks.length}: принято ${ok.length}/${batch.length}`);
    if (ok.length) await writeFile(file, JSON.stringify(ok));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log({ processedChunks: done, accepted, of: total, hint: 'node tools/translation.mjs apply' });
