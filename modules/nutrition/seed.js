// Код блюд для обмена (как у тренировок, см. modules/workouts/seed.js): JSON → deflate → base45 в QR «Alphanumeric».
//   FIN1-  сжатый deflate;  FIN2-  без сжатия (если браузер не умеет CompressionStream)
// Данные: {v:1, f:[[название, ед.('g'|'ml'), ккал, белки, жиры, углеводы, клетчатка|null, сахар|null, размер порции, название порции]]} — значения на 100 г / 100 мл.

const MAX_CODE = 20_000;
const MAX_RAW = 64 * 1024;
const canDeflate = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function toB45(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += B45[n % 45] + B45[Math.floor(n / 45) % 45] + B45[Math.floor(n / 2025)];
    } else out += B45[bytes[i] % 45] + B45[Math.floor(bytes[i] / 45)];
  }
  return out;
}
function fromB45(str) {
  if (str.length % 3 === 1) throw new Error('bad base45');
  const val = ch => { const v = B45.indexOf(ch); if (v < 0) throw new Error('bad base45'); return v; };
  const out = [];
  for (let i = 0; i < str.length; i += 3) {
    if (i + 2 < str.length) {
      const n = val(str[i]) + val(str[i + 1]) * 45 + val(str[i + 2]) * 2025;
      if (n > 65535) throw new Error('bad base45');
      out.push(n >> 8, n & 255);
    } else {
      const n = val(str[i]) + val(str[i + 1]) * 45;
      if (n > 255) throw new Error('bad base45');
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}

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

/** Список блюд → строка-код. Составное блюдо передаётся обычным (по значениям на 100 г), без состава. */
export async function encodeFoods(foods) {
  const f = foods.map(x => [x.name, x.unit, x.kcal, x.p, x.f, x.cb, x.fib ?? null, x.sug ?? null, ...(x.portion ? [x.portion.size, x.portion.name || ''] : [])]);
  const raw = new TextEncoder().encode(JSON.stringify({ v: 1, f }));
  return canDeflate ? `FIN1-${toB45(await pipe(raw, new CompressionStream('deflate-raw')))}` : `FIN2-${toB45(raw)}`;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nm = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : null; };

/** Строка-код → массив блюд {name, unit, kcal, p, f, cb, fib?, sug?, portion?}. Бросает ошибку на любой неверный код. */
export async function decodeFoods(text) {
  const raw = String(text ?? '').replace(/[\r\n\t]+/g, '').trim();
  const head = raw.match(/^FIN([12])-/);
  if (!head || raw.length > MAX_CODE) throw new Error('bad code');
  const body = raw.slice(5);
  if (!/^[0-9A-Z $%*+\-./:]*$/.test(body)) throw new Error('bad code');
  let bytes;
  try { bytes = fromB45(body); } catch { bytes = fromB45(body + ' '); } // мессенджеры могут съесть завершающий пробел
  if (head[1] === '1') {
    if (!canDeflate) throw new Error('no decompression');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (d?.v !== 1 || !Array.isArray(d.f) || !d.f.length || d.f.length > 100) throw new Error('bad data');
  return d.f.map(r => {
    const name = Array.isArray(r) ? str(r[0], 80) : '';
    const [kcal, p, f, cb] = [nm(r[2], 0, 2000), nm(r[3], 0, 100), nm(r[4], 0, 100), nm(r[5], 0, 100)];
    if (!name || [kcal, p, f, cb].includes(null)) throw new Error('bad food');
    const fib = nm(r[6], 0, 100), sug = nm(r[7], 0, 100);
    const size = nm(r[8], 1, 5000);
    return {
      name, unit: r[1] === 'ml' ? 'ml' : 'g', kcal, p, f, cb,
      ...(fib != null ? { fib } : {}), ...(sug != null ? { sug } : {}),
      ...(size ? { portion: { size, name: str(r[9], 20) } } : {}),
    };
  });
}
