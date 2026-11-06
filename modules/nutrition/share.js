// Обмен блюдами по коду: показать QR выбранных блюд, добавить блюда из кода — вставкой, камерой или картинкой с QR.

import { encodeFoods, decodeFoods } from './seed.js';
import { listFoods, putFood } from './data.js';

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

function makeQr(code) {
  const qr = window.qrcode(0, 'L');
  qr.addData(code, 'Alphanumeric');
  try { qr.make(); return qr; } catch { return null; }
}

/** Окно с QR для выбранных блюд (массив записей foods). */
export async function openShare(ctx, foods) {
  const { h, icon, modal, toast, raw } = ctx.ui;
  let code, qr = null;
  try {
    await loadScript('vendor/qrcode.js');
    code = await encodeFoods(foods);
    qr = makeQr(code);
  } catch (e) {
    console.error(e);
    return toast('Не удалось создать код');
  }
  let qrBox = null;
  if (qr) {
    // Картинка (PNG), а не SVG: тогда в меню по правой кнопке мыши есть «Копировать изображение»
    const n = qr.getModuleCount(), px = 8, pad = 4;
    const canvas = Object.assign(document.createElement('canvas'), { width: (n + pad * 2) * px, height: (n + pad * 2) * px });
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + pad) * px, (r + pad) * px, px, px);
    qrBox = h('div', { class: 'qr-box' }, h('img', { src: canvas.toDataURL('image/png'), alt: 'QR' }));
  }
  const field = h('textarea', { class: 'input seed', readonly: true, rows: '4' }, raw(code));
  field.addEventListener('focus', () => field.select());
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast('Код скопирован'); } catch { field.select(); toast('Выделено: нажмите Ctrl+C'); }
  };
  modal({
    title: 'Поделиться блюдами',
    body: h('div', { class: 'share' },
      h('strong', null, ctx.t('Блюд: {n}', { n: foods.length })),
      qrBox,
      h('p', { class: 'muted small' }, 'Покажите QR-код или отправьте код текстом. Получатель добавит блюда в этом приложении: «Мои блюда» → «Добавить по коду».'),
      qr ? null : h('p', { class: 'warn small' }, 'Код слишком длинный для QR — выберите меньше блюд или отправьте код текстом.'),
      field,
      h('button', { class: 'btn primary wide', onClick: copy }, icon('check', 16), 'Скопировать код')),
  });
}

/** Окно «Добавить по коду». onDone вызывается после добавления блюд. */
export function openImport(ctx, { onDone }) {
  const { h, icon, modal, toast } = ctx.ui;
  const input = h('textarea', { class: 'input seed', rows: '4', placeholder: 'Вставьте код блюд (FIN1-…)' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const m = modal({
    title: 'Добавить по коду',
    body: h('div', { class: 'share' },
      input,
      h('div', { class: 'row-gap wrap' },
        h('button', { class: 'btn', onClick: () => openScanner(ctx, text => { input.value = text; add(text); }) }, icon('qr', 16), 'Сканировать камерой'),
        h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'QR из картинки')),
      file),
    actions: [h('button', { class: 'btn primary', onClick: () => add(input.value) }, 'Добавить')],
  });
  input.focus();

  async function add(text) {
    let foods;
    try { foods = await decodeFoods(text); } catch { return toast('Неверный код блюд'); }
    // такое же блюдо (название, единица и КБЖУ) уже есть — не дублируем
    const have = await listFoods(ctx);
    const key = f => [f.name.toLowerCase(), f.unit, f.kcal, f.p, f.f, f.c].join('|');
    const keys = new Set(have.map(key));
    let added = 0;
    for (const f of foods) {
      if (keys.has(key(f))) continue;
      await putFood(ctx, f);
      keys.add(key(f));
      added++;
    }
    toast(ctx.t('Добавлено блюд: {n}', { n: added }) + (added < foods.length ? ctx.t(' (остальные уже есть)') : ''));
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

/** Камера: ищет QR с кодом блюд и отдаёт его текст. Поток останавливается при закрытии окна. */
function openScanner(ctx, onText) {
  const { h, modal, toast } = ctx.ui;
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
  const status = h('p', { class: 'muted small' }, 'Наведите камеру на QR-код блюд');
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
    try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { /* встроенного детектора нет — jsQR */ }
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
      if (text && /^FIN[12]-/.test(text.trim())) { m.close(); onText(text.trim()); return; }
      timer = setTimeout(tick, 200);
    };
    tick();
  })();
}
