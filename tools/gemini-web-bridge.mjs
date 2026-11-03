// Локальный мост между страницей gemini.google.com и translation/out/:
//   GET  /next          — следующая необработанная порция {i, total, prompt} (204, когда всё готово)
//   POST /result?i=N    — принимает ответ Gemini (текст), проверяет и пишет translation/out/web-NNN.json
// Страница Gemini гоняет цикл «получить → отправить в чат → забрать ответ → вернуть сюда» сама,
// поэтому переводы не проходят через контекст Claude. Запуск: node tools/gemini-web-bridge.mjs [--chars 9000]
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', 8787));
const CHUNK_CHARS = Number(arg('chars', 9_000));

const prompt = await readFile(new URL('translation/PROMPT.md', root), 'utf8');
const system = prompt.slice(prompt.indexOf('Ты — профессиональный'), prompt.indexOf('### Как выдавать ответ порциями'))
  .replace('Я приложу JSON-файл `exercises.en.json` со списком', 'Ниже JSON-массив со списком');

const items = JSON.parse(await readFile(new URL('translation/exercises.en.json', root), 'utf8'));
const chunks = [];
for (let cur = [], size = 0, i = 0; i <= items.length; i++) {
  const it = items[i];
  const len = it ? JSON.stringify(it).length : 0;
  if (cur.length && (!it || size + len > CHUNK_CHARS)) { chunks.push(cur); cur = []; size = 0; }
  if (it) { cur.push(it); size += len; }
}
await mkdir(new URL('translation/out/', root), { recursive: true });

const PREFIX = arg('prefix', 'web'); // для повторных проходов по остатку: другой префикс, чтобы не пропускать старые файлы
const fileOf = i => new URL(`translation/out/${PREFIX}-${String(i + 1).padStart(3, '0')}.json`, root);
const exists = f => access(f).then(() => true, () => false);

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

/** Разбирает верхнеуровневые объекты массива по одному (учитывает строки), битые пропускает. */
function salvage(body) {
  const out = [];
  let depth = 0, start = -1, inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && --depth === 0) { try { out.push(JSON.parse(body.slice(start, i + 1))); } catch { /* битая запись */ } }
  }
  return out;
}

/** Достаёт JSON-массив из ответа чата (может быть в ```-блоке и с пояснениями вокруг). */
function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('['), b = body.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  const arr = body.slice(a, b + 1);
  try { return JSON.parse(arr); } catch { /* Gemini иногда теряет ключ "id": — чиним и разбираем по записям */ }
  return salvage(arr.replace(/\{\s*"((?:fe|wg):[^"]*)"\s*,/g, '{"id": "$1",'));
}

let handedOut = new Set();
const cors = {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*', 'access-control-allow-private-network': 'true',
};
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { ...cors, 'content-type': type }); res.end(body); };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/next') {
    for (let i = 0; i < chunks.length; i++) {
      if (handedOut.has(i) || await exists(fileOf(i))) continue;
      handedOut.add(i);
      return send(res, 200, JSON.stringify({ i, total: chunks.length, prompt: system + '\n\nВот JSON-массив для перевода. Верни только валидный JSON-массив в одном блоке кода.\n\n' + JSON.stringify(chunks[i]) }));
    }
    return send(res, 204, '');
  }
  if (url.pathname === '/result' && req.method === 'POST') {
    const i = Number(url.searchParams.get('i'));
    let text = '';
    for await (const c of req) text += c;
    let ok = [];
    try { ok = validate(chunks[i], extractJson(text)); } catch { /* невалидный JSON — принято 0 */ }
    if (ok.length) await writeFile(fileOf(i), JSON.stringify(ok));
    handedOut.delete(i);
    console.log(`Порция ${i + 1}/${chunks.length}: принято ${ok.length}/${chunks[i].length}`);
    return send(res, 200, JSON.stringify({ accepted: ok.length, of: chunks[i].length }));
  }
  if (url.pathname === '/status') {
    let done = 0; for (let i = 0; i < chunks.length; i++) if (await exists(fileOf(i))) done++;
    return send(res, 200, JSON.stringify({ done, total: chunks.length }));
  }
  send(res, 404, '{}');
}).listen(PORT, '127.0.0.1', () => console.log(`Мост: http://127.0.0.1:${PORT}, порций ${chunks.length}`));
