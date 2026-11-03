// Сид тренировки: компактный код для обмена между пользователями (как сид мира в Minecraft).
// Формат: «FIT1-<base64url>» — JSON, сжатый deflate; «FIT0-…» — то же без сжатия, если браузер не умеет CompressionStream.
// Внутри только то, что нужно, чтобы воссоздать тренировку: название и упражнения (название, подходы, разминка, комментарий, id из каталога).

const MAX_CODE = 20_000; // длина строки кода
const MAX_RAW = 64 * 1024; // максимальный размер после распаковки (защита от «бомб»)
const canDeflate = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

const toB64u = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = str => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RAW) throw new Error('too large');
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Шаблон тренировки → строка-сид. */
export async function encodeSeed(tpl) {
  const data = { v: 1, n: tpl.name, e: tpl.exercises.map(x => [x.name, x.sets, x.warmup ? 1 : 0, x.comment || '', x.ref || '']) };
  const raw = new TextEncoder().encode(JSON.stringify(data));
  return canDeflate ? `FIT1-${toB64u(await pipe(raw, new CompressionStream('deflate-raw')))}` : `FIT0-${toB64u(raw)}`;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Строка-сид → { name, exercises: [{ name, sets, warmup, comment, ref?, refName? }] }. Бросает ошибку на любой неверный код. */
export async function decodeSeed(text) {
  const code = String(text ?? '').replace(/\s+/g, '');
  const m = code.length <= MAX_CODE && code.match(/^FIT([01])-([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('bad code');
  let bytes = fromB64u(m[2]);
  if (m[1] === '1') {
    if (!canDeflate) throw new Error('no decompression');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  const d = JSON.parse(new TextDecoder().decode(bytes));
  const name = str(d?.n, 60);
  if (d?.v !== 1 || !name || !Array.isArray(d.e) || !d.e.length || d.e.length > 60) throw new Error('bad data');
  const exercises = d.e.map(r => {
    const exName = Array.isArray(r) ? str(r[0], 60) : '';
    if (!exName) throw new Error('bad exercise');
    const ref = typeof r[4] === 'string' && /^(fe|wg):[\w.-]{1,80}$/.test(r[4]) ? r[4] : null;
    return {
      name: exName,
      sets: Math.min(10, Math.max(1, Math.round(Number(r[1])) || 3)),
      warmup: r[2] === 1,
      comment: str(r[3], 500),
      ...(ref ? { ref, refName: exName } : {}),
    };
  });
  return { name, exercises };
}
