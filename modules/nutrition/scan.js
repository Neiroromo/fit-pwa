// Сканер штрихкодов: камера, картинка или ввод цифр. Читает EAN-13/EAN-8/UPC и DataMatrix «Честный знак» (из него берётся GTIN).
// Если в браузере есть встроенный BarcodeDetector с EAN, используется он (быстро); иначе библиотека ZXing (vendor/zxing.js, Apache-2.0).

import { barcodeVariants } from './fooddb.js';

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

const WANTED = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'code_128'];

/** Нативный детектор с поддержкой EAN или null. */
async function nativeDetector() {
  try {
    if (!('BarcodeDetector' in window)) return null;
    const have = await BarcodeDetector.getSupportedFormats();
    const formats = WANTED.filter(f => have.includes(f));
    return formats.includes('ean_13') ? new BarcodeDetector({ formats }) : null;
  } catch { return null; }
}

async function zxingReader() {
  await loadScript('vendor/zxing.js');
  const Z = window.ZXing;
  const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.CODE_128]], [Z.DecodeHintType.TRY_HARDER, true]]);
  return new Z.BrowserMultiFormatReader(hints, 250);
}

/** Штрихкод с картинки (файл): текст или null. */
export async function readBarcodeFromImage(file) {
  const det = await nativeDetector();
  if (det) {
    const bmp = await createImageBitmap(file);
    const r = await det.detect(bmp);
    if (r[0]?.rawValue) return r[0].rawValue;
  }
  const reader = await zxingReader();
  const url = URL.createObjectURL(file);
  try { return (await reader.decodeFromImageUrl(url)).getText(); } catch { return null; } finally { URL.revokeObjectURL(url); reader.reset(); }
}

/** Окно сканирования. onCode(текст) вызывается с найденным штрихкодом (после проверки, что это штрихкод товара). */
export function openBarcodeScanner(ctx, onCode) {
  const { h, icon, modal, toast } = ctx.ui;
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
  const status = h('p', { class: 'muted small' }, 'Наведите камеру на штрихкод товара');
  const manual = h('input', { class: 'input', inputmode: 'numeric', placeholder: 'Или введите цифры штрихкода', maxlength: '32', autocomplete: 'off' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let stopped = false, stream = null, reader = null, timer = 0;
  const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); try { reader?.reset(); } catch { /* ничего */ } };
  const done = text => {
    if (!barcodeVariants(text)) return false;
    stop(); m.close(); onCode(text);
    return true;
  };
  const submitManual = () => { if (!done(manual.value)) toast('Штрихкод — от 8 до 14 цифр'); };
  manual.addEventListener('keydown', e => { if (e.key === 'Enter') submitManual(); });
  manual.addEventListener('input', () => { manual.value = manual.value.replace(/[^\d]/g, ''); });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    try { const t = await readBarcodeFromImage(f); if (!t) toast('Штрихкод на изображении не найден'); else if (!done(t)) toast('Это не штрихкод товара'); } catch (e) { console.error(e); toast('Не удалось прочитать изображение'); }
  });
  const m = modal({
    title: 'Сканирование штрихкода',
    body: h('div', { class: 'share' }, video, status,
      h('div', { class: 'row-gap' }, h('div', { class: 'grow' }, manual), h('button', { class: 'btn primary', onClick: submitManual }, 'Найти')),
      h('button', { class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'Штрихкод из картинки'), file),
    onClose: stop,
  });

  (async () => {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { status.textContent = ctx.t('Нет доступа к камере: введите цифры штрихкода или загрузите картинку.'); return; }
    if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const det = await nativeDetector();
    if (det) {
      const tick = async () => {
        if (stopped) return;
        try { if (video.videoWidth) { const r = await det.detect(video); if (r[0]?.rawValue && done(r[0].rawValue)) return; } } catch { /* кадр не распознан */ }
        timer = setTimeout(tick, 200);
      };
      tick();
    } else {
      try {
        reader = await zxingReader();
        reader.decodeFromVideoElement(video, res => { if (res && !stopped) done(res.getText()); });
      } catch (e) { console.error(e); status.textContent = ctx.t('Не удалось запустить сканер: введите цифры штрихкода.'); }
    }
  })();
}
