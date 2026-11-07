// Форма своего упражнения: название, теги (из существующих или новые), мышцы, техника, картинки.
// Форма — как карточка упражнения в каталоге. Новые теги не требуют отдельной настройки: фильтры каталога строятся по тегам всех упражнений.

import { GROUPS, MUSCLES, LEVEL, EQUIP_ALIAS, labels, equipKeys, parseQuery, scoreName } from './catalog.js';
import { saveCustom } from './customstore.js';
import { dropShow, dropHide, revealSelected, trackPress } from './float.js';

const MAX_IMAGES = 4;
const IMAGE_SIDE = 800; // длинная сторона после уменьшения, пикселей

/**
 * Поле тегов: выбранные теги стоят прямо в поле ввода, как «плашки», и после них можно набирать дальше.
 * По фокусу и при вводе поверх окна показывается прокручиваемый список подсказок (видно три).
 * Tab / стрелки — перебор, Enter — добавить выбранную подсказку или набранный текст как новый тег,
 * Backspace в пустом поле — убрать последний тег, Esc — убрать подсказки (текст остаётся). get() возвращает выбранные ключи.
 */
function tagPicker(ctx, { options, labelOf, selected = [], placeholder }) {
  const { h, icon, raw } = ctx.ui;
  const sel = [...selected];
  const opts = [...new Set([...options, ...selected])];
  const pills = h('span', { class: 'tag-pills' });
  const sug = h('div', { class: 'ex-sug tags', hidden: true });
  const input = h('input', { placeholder, maxlength: '40', autocomplete: 'off' });
  const box = h('div', { class: 'tag-box', onClick: () => input.focus() }, pills, input);
  const wrap = h('div', { class: 'tag-wrap' }, box, sug); // список — внутри обёртки, под полем
  let list = [], at = -1;

  const drawPills = fresh => {
    pills.replaceChildren(...sel.map(k => h('span', { class: 'tag-pill' + (k === fresh ? ' fresh' : '') },
      raw(labelOf(k)),
      h('button', { type: 'button', class: 'tag-x', tabindex: '-1', 'aria-label': 'Убрать тег', onClick: e => { e.stopPropagation(); remove(k); } }, icon('x', 12)))));
    input.placeholder = sel.length ? '' : ctx.t(placeholder);
  };
  const drawSug = () => {
    // выбор — по click: свайп по списку листает его, а не выбирает тег
    sug.replaceChildren(...list.map((k, i) => h('button', {
      type: 'button', class: 'ex-sug-item' + (i === at ? ' on' : ''), tabindex: '-1',
      onClick: () => add(k),
    }, raw(labelOf(k)))));
    if (list.length) { dropShow(sug, box); revealSelected(sug); } else dropHide(sug); // список прилегает к границе поля
  };
  const pressing = trackPress(sug); // поле ввода не теряет фокус, пока список листают

  /** Пересчитывает подсказки под набранный текст: совпадение по началу любого слова, уже выбранные не предлагаются. */
  const compute = () => {
    const pq = parseQuery(input.value);
    const free = opts.filter(k => !sel.includes(k));
    list = pq
      ? free.map(k => ({ k, score: Math.min(...[labelOf(k), k].map(t => scoreName(t, pq) ?? Infinity)) })).filter(x => x.score !== Infinity).sort((a, b) => a.score - b.score).map(x => x.k)
      : free;
    at = -1;
    drawSug();
  };
  const move = d => {
    const to = Math.min(list.length - 1, Math.max(-1, at + d));
    if (to === at) return;
    at = to;
    drawSug();
  };
  function remove(key) {
    sel.splice(sel.indexOf(key), 1);
    drawPills();
    if (document.activeElement === input) compute();
  }
  function add(key) {
    if (key == null) {
      const t = input.value.trim().replace(/\s+/g, ' ');
      if (!t) return;
      // уже существующий тег (по ключу или подписи) не дублируем, иначе заводим новый
      key = opts.find(k => k.toLowerCase() === t.toLowerCase() || labelOf(k).toLowerCase() === t.toLowerCase()) ?? t;
      if (!opts.includes(key)) opts.push(key);
    }
    if (!sel.includes(key)) sel.push(key);
    input.value = '';
    drawPills(key);
    compute();
    input.focus();
  }
  input.addEventListener('focus', compute);
  input.addEventListener('input', compute);
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input && !pressing()) { list = []; at = -1; dropHide(sug); } }, 150));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      // текст набран или подсказка выбрана стрелками — добавляем тег; поле пустое и выбора нет — ввод закончен (клавиатура телефона скрывается)
      if (input.value.trim() || at >= 0) add(at >= 0 ? list[at] : null); else input.blur();
      return;
    }
    if (e.key === 'Backspace' && !input.value && sel.length) { e.preventDefault(); remove(sel.at(-1)); return; }
    if (!list.length) return;
    const down = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
    const up = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && at > 0);
    if (down || up) { e.preventDefault(); move(down ? 1 : -1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); list = []; at = -1; dropHide(sug); }
  });
  drawPills();
  return { el: wrap, get: () => [...sel] };
}

async function downscale(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

/**
 * Форма создания/редактирования. data — все упражнения (для списков готовых тегов).
 * onDone(saved|null): saved — сохранённая запись, null — отмена.
 */
export function customForm(ctx, { ex, data, onDone }) {
  const { h, icon, raw, toast } = ctx.ui;
  const L = labels(ctx.contentLang('exercises'));

  // готовые теги: сначала стандартные, затем те, что уже завели пользователи
  const extra = (pick, known) => [...new Set(data.flatMap(pick))].filter(k => k && !known.includes(k)).sort();
  const groupKeys = [...Object.keys(GROUPS), ...extra(e => e.g ?? [], Object.keys(GROUPS))];
  const equipCount = new Map();
  for (const e of data) for (const k of equipKeys(e)) if (k !== 'body only') equipCount.set(k, (equipCount.get(k) ?? 0) + 1);
  const equipKeysAll = [...equipCount].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter(k => !(k in EQUIP_ALIAS));
  const seenLabel = new Set();
  const muscleBase = Object.keys(MUSCLES).filter(k => !seenLabel.has(MUSCLES[k]) && seenLabel.add(MUSCLES[k]));
  const muscleKeys = [...muscleBase, ...extra(e => [...(e.m ?? []), ...(e.s ?? [])], Object.keys(MUSCLES))];

  const name = h('input', { class: 'input big', placeholder: 'Название упражнения', value: ex?.n ?? '', maxlength: '60' });
  const groups = tagPicker(ctx, { options: groupKeys, labelOf: L.group, selected: ex?.g ?? [], placeholder: 'Новый тег' });
  const equip = tagPicker(ctx, { options: equipKeysAll, labelOf: L.equip, selected: ex?.e ?? [], placeholder: 'Новый тег' });
  const main = tagPicker(ctx, { options: muscleKeys, labelOf: L.muscle, selected: ex?.m ?? [], placeholder: 'Новый тег' });
  const sec = tagPicker(ctx, { options: muscleKeys, labelOf: L.muscle, selected: ex?.s ?? [], placeholder: 'Новый тег' });

  let level = ex?.l ?? '';
  const levelBox = h('div', { class: 'size-chips' });
  const drawLevel = () => levelBox.replaceChildren(...['', ...Object.keys(LEVEL)].map(k =>
    h('button', { type: 'button', class: 'chip-btn' + (level === k ? ' on' : ''), onClick: () => { level = k; drawLevel(); } }, k ? raw(L.level(k)) : 'Не указан')));
  drawLevel();

  const steps = h('textarea', { class: 'input', rows: '6', placeholder: 'Каждый шаг с новой строки' });
  steps.value = (ex?.d ?? []).join('\n');

  const images = [...(ex?.img ?? [])];
  const thumbs = h('div', { class: 'cx-imgs' });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const drawImages = () => thumbs.replaceChildren(...images.map((src, i) =>
    h('div', { class: 'cx-img' }, h('img', { src, alt: '' }),
      h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Удалить', onClick: () => { images.splice(i, 1); drawImages(); } }, icon('x', 16)))));
  drawImages();
  file.addEventListener('change', async () => {
    const files = [...file.files];
    file.value = '';
    for (const f of files) {
      if (images.length >= MAX_IMAGES) { toast('Не больше 4 картинок'); break; }
      try { images.push(await downscale(f)); } catch (e) { console.error(e); }
    }
    drawImages();
  });

  const field = (title, ...body) => h('div', { class: 'cx-field' }, h('span', { class: 'cx-label' }, title), ...body);

  async function save() {
    const n = name.value.trim();
    if (!n) return toast('Введите название упражнения');
    const rec = {
      ...(ex ?? {}), n, g: groups.get(), e: equip.get(), m: main.get(), s: sec.get(), l: level,
      d: steps.value.split('\n').map(s => s.trim()).filter(Boolean), img: images,
    };
    const saved = await saveCustom(ctx, rec);
    toast('Упражнение сохранено');
    onDone(saved);
  }

  return h('div', { class: 'cx-form' },
    name,
    field('Группы мышц (теги)', groups.el),
    field('Оборудование', equip.el),
    field('Основные мышцы', main.el),
    field('Дополнительные мышцы', sec.el),
    field('Уровень', levelBox),
    field('Техника выполнения', steps),
    field('Картинки', thumbs, h('button', { type: 'button', class: 'btn', onClick: () => file.click() }, icon('upload', 16), 'Добавить картинки'), file),
    h('div', { class: 'row-gap' },
      h('button', { type: 'button', class: 'btn', onClick: () => onDone(null) }, 'Отмена'),
      h('button', { type: 'button', class: 'btn primary', onClick: save }, icon('check', 16), 'Сохранить')));
}
