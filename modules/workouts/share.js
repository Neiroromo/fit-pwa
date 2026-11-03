// Обмен тренировками по коду (сиду): показать код и QR, добавить тренировку из кода — вставкой, камерой или картинкой с QR.

import { encodeSeed, decodeSeed } from './seed.js';
import { getExercise, displayName } from './catalog.js';
import { customExercises, saveCustom } from './customstore.js';

// Библиотеки QR лежат в vendor/ и скачиваются вместе с модулем (работают офлайн), грузятся только когда нужны.
const scripts = new Map();
function loadScript(file) {
  if (!scripts.has(file)) {
    scripts.set(file, new Promise((resolve, reject) => {
      const el = Object.assign(document.createElement('script'), { src: new URL(file, import.meta.url).href });
      el.onload = resolve;
      el.onerror = () => { scripts.delete(file); reject(new Error('Не удалось загрузить ' + file)); };
      document.head.append(el);
    }));
  }
  return scripts.get(file);
}

/** Строит QR для кода; null, если код не помещается в один QR. Коды FIT2/FIT3 — base45, поэтому режим «Alphanumeric» (плотнее байтового). */
function makeQr(seed) {
  const qr = window.qrcode(0, 'L');
  qr.addData(seed, /^FIT[23]-/.test(seed) ? 'Alphanumeric' : 'Byte');
  try { qr.make(); return qr; } catch { return null; }
}

/** Окно «Поделиться»: QR-код и текстовый код тренировки. */
export async function openShare(ctx, tpl) {
  const { h, icon, modal, toast, raw } = ctx.ui;
  // определения своих упражнений прикладываются к коду, чтобы у получателя появились и они, и их теги
  const custom = new Map();
  for (const e of tpl.exercises) {
    if (!String(e.ref ?? '').startsWith('cx:') || custom.has(e.ref)) continue;
    const def = await getExercise(e.ref);
    if (def) custom.set(def.id, def);
  }
  let seed, qr = null, level = 0;
  try {
    await loadScript('vendor/qrcode.js');
    // Если с полной информацией не помещается в один QR — по очереди отбрасываем шаги техники, затем мышцы
    for (; level <= 2; level++) {
      seed = await encodeSeed(tpl, { custom, level });
      qr = makeQr(seed);
      if (qr || !custom.size) break;
    }
    level = Math.min(level, 2);
  } catch (e) {
    console.error(e);
    return toast('Не удалось создать код');
  }
  const notes = [];
  if (custom.size) notes.push(ctx.t('Свои упражнения передаются без картинок.'));
  if (custom.size && level === 1) notes.push(ctx.t('Шаги техники не поместились в QR и не переданы.'));
  if (custom.size && level >= 2) notes.push(ctx.t('Шаги техники и мышцы не поместились в QR и не переданы.'));
  if (!qr) notes.push(ctx.t('Код слишком длинный для QR — отправьте его текстом.'));

  let qrBox = null;
  if (qr) {
    // Картинка (PNG), а не SVG: тогда в меню по правой кнопке мыши есть стандартное «Копировать изображение»
    const n = qr.getModuleCount(), px = 8, pad = 4;
    const canvas = Object.assign(document.createElement('canvas'), { width: (n + pad * 2) * px, height: (n + pad * 2) * px });
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + pad) * px, (r + pad) * px, px, px);
    qrBox = h('div', { class: 'qr-box' }, h('img', { src: canvas.toDataURL('image/png'), alt: 'QR' }));
  }

  const field = h('textarea', { class: 'input seed', readonly: true, rows: '4' }, raw(seed));
  field.addEventListener('focus', () => field.select());
  const copy = async () => {
    try { await navigator.clipboard.writeText(seed); toast('Код скопирован'); } catch { field.select(); toast('Выделено: нажмите Ctrl+C'); }
  };
  modal({
    title: 'Поделиться тренировкой',
    body: h('div', { class: 'share' },
      h('strong', null, raw(tpl.name)),
      qrBox,
      h('p', { class: 'muted small' }, 'Покажите QR-код или отправьте код текстом. Получатель добавит тренировку в этом приложении: «Добавить по коду».'),
      ...notes.map(t => h('p', { class: 'warn small' }, t)),
      field,
      h('button', { class: 'btn primary wide', onClick: copy }, icon('check', 16), 'Скопировать код')),
  });
}

/** Окно «Добавить по коду». onDone вызывается после добавления тренировки. */
export function openImport(ctx, { onDone }) {
  const { h, icon, modal, toast, raw } = ctx.ui;
  const input = h('textarea', { class: 'input seed', rows: '4', placeholder: 'Вставьте код тренировки (FIT2-…)' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const m = modal({
    title: 'Добавить по коду',
    body: h('div', { class: 'share' },
      input,
      h('div', { class: 'row-gap wrap' },
        h('button', { class: 'btn', onClick: scan }, icon('qr', 16), 'Сканировать камерой'),
        h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'QR из картинки')),
      file),
    actions: [h('button', { class: 'btn primary', onClick: () => add(input.value) }, 'Добавить')],
  });
  input.focus();

  /** Своё упражнение из кода: такое же (название + группы + оборудование) уже есть — берём его, иначе создаём с теми же тегами. */
  async function importCustom(def) {
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    const found = customExercises().find(e => e.n.toLowerCase() === def.n.toLowerCase() && same(e.g ?? [], def.g) && same(e.e ?? [], def.e));
    if (found) return found;
    return saveCustom(ctx, { n: def.n, g: def.g, e: def.e, m: def.m, s: def.s, h: def.h, l: def.l, d: def.d, img: [] });
  }

  async function add(text) {
    let tpl, defs;
    try { ({ defs, ...tpl } = await decodeSeed(text)); } catch { return toast('Неверный код тренировки'); }
    const lang = ctx.contentLang('exercises');
    const own = [];
    for (const def of defs) own.push(await importCustom(def));
    for (const ex of tpl.exercises) {
      ex.id = ctx.ui.uid();
      if (ex.custom != null) {
        const c = own[ex.custom];
        ex.ref = c.id; ex.name = c.n; ex.refName = c.n;
        delete ex.custom;
        continue;
      }
      if (!ex.ref) continue;
      // название берём из каталога на языке получателя; нет такого упражнения — оставляем как есть, без связи с каталогом
      const found = await getExercise(ex.ref).catch(() => null);
      if (found) { ex.name = displayName(found, lang); ex.refName = ex.name; } else { delete ex.ref; delete ex.refName; }
    }
    await ctx.db.collection('templates').put(tpl);
    toast(ctx.t('Тренировка «{name}» добавлена', { name: tpl.name }));
    m.close();
    onDone();
  }

  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const text = await readQrFromImage(f);
      if (!text) return toast('QR-код на изображении не найден');
      input.value = text;
      add(text);
    } catch (e) { console.error(e); toast('Не удалось прочитать изображение'); }
  });

  function scan() {
    openScanner(ctx, text => { input.value = text; add(text); });
  }
}

async function readQrFromImage(file) {
  await loadScript('vendor/jsQR.js');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  return window.jsQR(data, width, height)?.data ?? null;
}

/** Камера: ищет QR с кодом тренировки и отдаёт его текст. Поток останавливается при закрытии окна. */
function openScanner(ctx, onText) {
  const { h, modal, toast } = ctx.ui;
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
  const status = h('p', { class: 'muted small' }, 'Наведите камеру на QR-код тренировки');
  let stream = null, stopped = false, timer = 0;
  const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  const m = modal({ title: 'Сканирование', body: h('div', { class: 'share' }, video, status), onClose: stop });

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      m.close();
      return toast('Нет доступа к камере');
    }
    if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});

    let detector = null;
    try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { /* встроенного детектора нет — используем jsQR */ }
    if (!detector) await loadScript('vendor/jsQR.js');
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (stopped) return;
      let text = null;
      try {
        if (video.videoWidth) {
          if (detector) text = (await detector.detect(video))[0]?.rawValue ?? null;
          else {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            g.drawImage(video, 0, 0);
            const { data, width, height } = g.getImageData(0, 0, canvas.width, canvas.height);
            text = window.jsQR(data, width, height)?.data ?? null;
          }
        }
      } catch { /* кадр не распознан */ }
      if (text && /^FIT[0-3]-/.test(text.trim())) { m.close(); onText(text.trim()); return; }
      timer = setTimeout(tick, 200);
    };
    tick();
  })();
}
