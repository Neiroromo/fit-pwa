// Сид тренировки: компактный код для обмена между пользователями (как сид мира в Minecraft).
//
// Форматы (префикс — формат кода):
//   FIT2-  JSON, сжатый deflate, затем base45 (алфавит QR «Alphanumeric»: 5,5 бит на символ вместо 8 — код помещается в QR плотнее)
//   FIT3-  то же без сжатия (если браузер не умеет CompressionStream)
//   FIT1-/FIT0-  прежние коды (base64url): только читаются
//
// Что попадает в код. v2: {v:2, n:название, e:[[название, подходов, разминка 0/1, комментарий, ссылка]], x:[свои упражнения]}.
// Ссылка — id упражнения из каталога («fe:…», «wg:…») или число: номер своего упражнения в x.
// Своё упражнение: [название, группы, оборудование, основные мышцы, дополнительные, дома 0/1, уровень, шаги техники] — без картинок.
// Ужатие: массивы вместо объектов, пустое не пишется, одинаковые теги сжимает deflate, свои упражнения не дублируются в x.
// Если даже так не влезает в один QR, openShare по очереди отбрасывает шаги техники (level 1), затем и мышцы (level 2).

const MAX_CODE = 20_000; // длина строки кода
const MAX_RAW = 64 * 1024; // максимальный размер после распаковки (защита от «бомб»)
const canDeflate = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// ---------- base64url (старые коды) ----------
const toB64u = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = str => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
};

// ---------- base45 (RFC 9285) ----------
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
export function toB45(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += B45[n % 45] + B45[Math.floor(n / 45) % 45] + B45[Math.floor(n / 2025)];
    } else {
      out += B45[bytes[i] % 45] + B45[Math.floor(bytes[i] / 45)];
    }
  }
  return out;
}
export function fromB45(str) {
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

/**
 * Шаблон тренировки → строка-сид.
 * custom: Map<id своего упражнения, его запись> — определения своих упражнений, которые нужно приложить к коду.
 * level: 0 — всё; 1 — без шагов техники; 2 — ещё и без мышц.
 */
export async function encodeSeed(tpl, { custom = new Map(), level = 0 } = {}) {
  const x = [], index = new Map();
  const e = tpl.exercises.map(r => {
    let ref = r.ref || '';
    const def = custom.get(r.ref);
    if (def) {
      if (!index.has(def.id)) {
        index.set(def.id, x.length);
        x.push([def.n, def.g ?? [], def.e ?? [], level >= 2 ? [] : def.m ?? [], level >= 2 ? [] : def.s ?? [], def.h ? 1 : 0, def.l ?? '', level >= 1 ? [] : def.d ?? []]);
      }
      ref = index.get(def.id);
    } else if (String(ref).startsWith('cx:')) ref = ''; // своё упражнение без определения — отдаём просто названием
    return [r.name, r.sets, r.warmup ? 1 : 0, r.comment || '', ref];
  });
  const data = { v: 2, n: tpl.name, e, ...(x.length ? { x } : {}) };
  const raw = new TextEncoder().encode(JSON.stringify(data));
  return canDeflate ? `FIT2-${toB45(await pipe(raw, new CompressionStream('deflate-raw')))}` : `FIT3-${toB45(raw)}`;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, n, max) => (Array.isArray(v) ? v.slice(0, n).map(x => str(x, max)).filter(Boolean) : []);

/**
 * Строка-сид → { name, exercises: [{ name, sets, warmup, comment, ref?, refName?, custom? }], defs: [свои упражнения] }.
 * У упражнения со своим определением custom — индекс в defs. Бросает ошибку на любой неверный код.
 */
export async function decodeSeed(text) {
  const raw = String(text ?? '').replace(/[\r\n\t]+/g, '').trim();
  const head = raw.match(/^FIT([0-3])-/);
  if (!head || raw.length > MAX_CODE) throw new Error('bad code');
  const kind = head[1];
  let body = raw.slice(5);
  let bytes;
  if (kind === '2' || kind === '3') {
    if (!/^[0-9A-Z $%*+\-./:]*$/.test(body)) throw new Error('bad code');
    // мессенджеры могут съесть завершающий пробел — он допустимый символ base45
    try { bytes = fromB45(body); } catch (e) { bytes = fromB45(body + ' '); }
  } else {
    body = body.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('bad code');
    bytes = fromB64u(body);
  }
  if (kind === '1' || kind === '2') {
    if (!canDeflate) throw new Error('no decompression');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  const d = JSON.parse(new TextDecoder().decode(bytes));
  const name = str(d?.n, 60);
  if ((d?.v !== 1 && d?.v !== 2) || !name || !Array.isArray(d.e) || !d.e.length || d.e.length > 60) throw new Error('bad data');

  const defs = (d.v === 2 && Array.isArray(d.x) ? d.x.slice(0, 60) : []).map(r => {
    const n = Array.isArray(r) ? str(r[0], 60) : '';
    if (!n) throw new Error('bad exercise definition');
    return {
      n,
      g: strList(r[1], 12, 40), e: strList(r[2], 12, 40), m: strList(r[3], 12, 40), s: strList(r[4], 12, 40),
      h: r[5] === 1 ? 1 : 0, l: str(r[6], 20), d: strList(r[7], 40, 600),
    };
  });

  const exercises = d.e.map(r => {
    const exName = Array.isArray(r) ? str(r[0], 60) : '';
    if (!exName) throw new Error('bad exercise');
    const ref = typeof r[4] === 'string' && /^(fe|wg):[\w.-]{1,80}$/.test(r[4]) ? r[4] : null;
    const custom = Number.isInteger(r[4]) && r[4] >= 0 && r[4] < defs.length ? r[4] : undefined;
    return {
      name: exName,
      sets: Math.min(10, Math.max(1, Math.round(Number(r[1])) || 3)),
      warmup: r[2] === 1,
      comment: str(r[3], 500),
      ...(ref ? { ref, refName: exName } : {}),
      ...(custom != null ? { custom } : {}),
    };
  });
  return { name, exercises, defs };
}
