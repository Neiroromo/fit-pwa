// Каталог упражнений (exercises.json: free-exercise-db + wger + свои упражнения пользователя): выбор из списка и карточка с техникой.

import { customExercises, removeCustom } from './customstore.js';

export const GROUPS = {
  chest: 'Грудь', back: 'Спина', shoulders: 'Плечи', arms: 'Руки', abs: 'Пресс', legs: 'Ноги', glutes: 'Ягодицы', cardio: 'Кардио', neck: 'Шея',
};
export const MUSCLES = {
  abdominals: 'пресс', abductors: 'отводящие бедра', adductors: 'приводящие бедра', biceps: 'бицепс', calves: 'икры', chest: 'грудь',
  forearms: 'предплечья', glutes: 'ягодицы', hamstrings: 'задняя поверхность бедра', lats: 'широчайшие', 'lower back': 'поясница',
  'middle back': 'середина спины', neck: 'шея', quadriceps: 'квадрицепс', shoulders: 'плечи', traps: 'трапеции', triceps: 'трицепс',
  // названия из wger
  abs: 'пресс', quads: 'квадрицепс', trapezius: 'трапеции', 'obliquus externus abdominis': 'косые мышцы живота',
  brachialis: 'плечевая мышца', 'serratus anterior': 'передняя зубчатая', soleus: 'камбаловидная',
};
export const EQUIP = {
  'body only': 'свой вес', bands: 'резинки', mat: 'коврик', 'exercise ball': 'фитбол', 'foam roll': 'ролл', 'pull-up bar': 'турник',
  bench: 'скамья', barbell: 'штанга', dumbbell: 'гантели', kettlebells: 'гиря', cable: 'блок', machine: 'тренажёр',
  'e-z curl bar': 'EZ-гриф', 'medicine ball': 'медбол', other: 'другое',
  'cable machine': 'блочный тренажёр', 'resistance band': 'эспандер',
};
export const LEVEL = { beginner: 'новичок', intermediate: 'средний', expert: 'опытный' };

const GROUPS_EN = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', abs: 'Abs', legs: 'Legs', glutes: 'Glutes', cardio: 'Cardio', neck: 'Neck' };

const label = (dict, k) => dict[k] ?? dict[String(k).toLowerCase()] ?? k;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Подписи тегов на языке контента: русские — из словарей выше, английские — исходные значения каталога. */
export const labels = lang => (lang === 'en'
  ? { group: g => GROUPS_EN[g] ?? cap(g), muscle: cap, equip: cap, level: cap, place: home => (home ? 'Home' : 'Gym') }
  : { group: g => label(GROUPS, g), muscle: m => label(MUSCLES, m), equip: e => label(EQUIP, e), level: l => LEVEL[l], place: home => (home ? 'дома' : 'зал') });

// У wger и free-exercise-db оборудование названо по-разному — для фильтра сводим к одному значению.
// Упражнение без указанного оборудования считаем «со своим весом».
export const EQUIP_ALIAS = { 'cable machine': 'cable', 'resistance band': 'bands' };
export const equipKeys = ex => (ex.e?.length ? [...new Set(ex.e.map(e => EQUIP_ALIAS[e] ?? e))] : ['body only']);

/** Название упражнения на языке контента ('en' — оригинал каталога; иначе русский перевод, если есть). */
export const displayName = (ex, lang = 'ru') => (lang === 'en' ? ex.n : ex.ru || ex.n);

/** Нижний регистр, ё=е, знаки препинания → пробел. Пробел в конце запроса сохраняется: он означает «слово закончено». */
const norm = str => String(str ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ');

/** Запрос → {tokens, closed}. Возвращает null для пустого запроса. */
export function parseQuery(q) {
  const n = norm(q).replace(/^ +/, '');
  const tokens = n.split(' ').filter(Boolean);
  return tokens.length ? { tokens, closed: n.endsWith(' ') } : null;
}

/** Совпадение названия с запросом по любому слову (не только по началу): «рук» найдёт и «Сгибание рук», и «Разгибание рук». Меньше — лучше, null — не подходит. */
export function scoreName(name, pq) {
  const words = norm(name).split(' ').filter(Boolean);
  let pos = 0;
  for (let i = 0; i < pq.tokens.length; i++) {
    const tok = pq.tokens[i];
    const whole = pq.closed && i === pq.tokens.length - 1; // «рук » — слово «рук» целиком, а не «рукоятка»
    const at = words.findIndex(w => (whole ? w === tok : w.startsWith(tok)));
    if (at < 0) return null;
    if (i === 0) pos = at;
  }
  return pos * 100 + Math.min(words.length, 99);
}

/** Лучшее совпадение упражнения на любом языке: {score, name} или null. */
export function matchExercise(ex, pq) {
  let best = null;
  for (const name of [ex.ru, ex.n]) {
    if (!name) continue;
    const score = scoreName(name, pq);
    if (score != null && (!best || score < best.score)) best = { score, name };
  }
  return best;
}

/** Лучшие упражнения по тексту запроса (для подсказок при вводе). */
export async function suggest(q, limit = 3) {
  const pq = parseQuery(q);
  if (!pq) return [];
  const found = [];
  const exercises = [...(await loadCatalog()).exercises, ...customExercises()];
  for (const ex of exercises) {
    const m = matchExercise(ex, pq);
    if (m) found.push({ ex, score: m.score });
  }
  return found.sort((a, b) => a.score - b.score).slice(0, limit).map(f => f.ex);
}

let cache;
export function loadCatalog() {
  cache ??= fetch(new URL('exercises.json', import.meta.url)).then(r => {
    if (!r.ok) throw new Error('Каталог упражнений недоступен');
    return r.json();
  }).catch(e => { cache = null; throw e; });
  return cache;
}

export async function getExercise(id) {
  if (String(id).startsWith('cx:')) return customExercises().find(e => e.id === id) ?? null;
  return (await loadCatalog()).exercises.find(e => e.id === id) ?? null;
}

/** Карточка упражнения. Если передан onPick(ex, lang) — внизу кнопка «Выбрать», onBack — стрелка назад. Язык карточки можно переключить (только для просмотра и выбора, настройки не меняются). */
export function renderDetail(ctx, ex, { onPick, onBack, onEdit, onDelete } = {}) {
  const { h, icon, iconBtn, raw } = ctx.ui; // контент (названия, теги, техника) идёт через raw — его язык задаётся отдельно от языка интерфейса
  let lang = ctx.contentLang('exercises');
  const root = h('div', { class: 'ex-detail' });

  function draw() {
    const L = labels(lang);
    const steps = lang === 'en' ? (ex.d?.length ? ex.d : ex.dr) : (ex.dr?.length ? ex.dr : ex.d);
    const hasRu = !!(ex.ru || ex.dr?.length);
    const onlyEnglish = !ex.custom && !hasRu; // перевода нет совсем: вместо переключателя языка — пометка
    const onlyEn = !ex.custom && hasRu && lang !== 'en' && !ex.dr?.length;
    const tags = [
      ...(ex.g ?? []).map(L.group),
      ex.l ? L.level(ex.l) : null,
      ...(ex.e?.length ? ex.e.map(L.equip) : []),
      ].filter(Boolean);
    const mus = list => raw((list ?? []).map(L.muscle).join(', '));
    const langChip = (code, text) => h('button', { class: 'chip-btn' + (lang === code ? ' on' : ''), onClick: () => { lang = code; draw(); } }, text);
    root.replaceChildren(...[
      h('div', { class: 'row-gap' }, onBack ? iconBtn('chevL', 'К списку', onBack) : null,
        h('div', { class: 'grow' }, h('h3', null, raw(displayName(ex, lang))), lang !== 'en' && ex.ru ? h('span', { class: 'muted small' }, raw(ex.n)) : null),
        hasRu ? h('div', { class: 'size-chips' }, langChip('ru', 'RU'), langChip('en', 'EN')) : onlyEnglish ? h('span', { class: 'chip ok' }, raw('English')) : null,
        ex.custom && onEdit ? iconBtn('edit', 'Редактировать', () => onEdit(ex)) : null,
        ex.custom && onDelete ? iconBtn('trash', 'Удалить упражнение', () => onDelete(ex), 'danger') : null),
      ex.img?.length ? h('div', { class: 'ex-imgs' }, ex.img.slice(0, 3).map(src => h('img', { src, alt: ex.n, loading: 'lazy' }))) : null,
      h('div', { class: 'row-gap wrap' }, tags.map(t => h('span', { class: 'chip' }, raw(t)))),
      ex.m?.length ? h('p', null, h('span', { class: 'muted' }, 'Основные мышцы: '), mus(ex.m)) : null,
      ex.s?.length ? h('p', null, h('span', { class: 'muted' }, 'Дополнительно: '), mus(ex.s)) : null,
      steps?.length ? h('div', null,
        h('strong', null, 'Техника выполнения'), onlyEn ? h('span', { class: 'muted small' }, ' · описание на английском') : null,
        h('ol', { class: 'ex-steps' }, steps.map(s => h('li', null, raw(s))))) : h('p', { class: 'muted' }, 'Описания техники для этого упражнения пока нет.'),
      ex.cr ? h('p', { class: 'muted small' }, 'Источник: ', raw(ex.cr)) : null,
      onPick ? h('button', { class: 'btn primary wide', onClick: () => onPick(ex, lang) }, icon('check', 16), 'Выбрать') : null,
    ].filter(Boolean));
  }

  draw();
  return root;
}

/** Модальный список с поиском и фильтрами. */
export function openPicker(ctx, { onPick, current, query }) {
  const { h, icon, modal, raw } = ctx.ui;
  const lang = ctx.contentLang('exercises');
  const L = labels(lang);
  const state = { group: null, equip: new Set(), media: false, limit: 40 };
  const body = h('div', { class: 'picker-ex' }, h('p', { class: 'muted' }, 'Загрузка каталога…'));
  const m = modal({ title: 'Каталог упражнений', body, wide: true });
  let data = [];
  let equipOptions = [];
  let groupOptions = Object.keys(GROUPS);

  const chip = (text, on, fn, off = false) => h('button', { class: 'chip-btn' + (on ? ' on' : ''), onClick: fn, disabled: off && !on }, text);

  let pq = null;
  let hits = null; // упражнения, подходящие под текст поиска (считаем один раз на запрос)
  const setQuery = text => {
    pq = parseQuery(text);
    hits = pq ? new Set(data.filter(ex => matchExercise(ex, pq))) : null;
  };
  /** Подходит ли упражнение под фильтры s (без текста поиска). */
  function passes(ex, s) {
    if (s.group && !(ex.g ?? []).includes(s.group)) return false;
    if (s.equip.size && !equipKeys(ex).some(k => s.equip.has(k))) return false;
    if (s.media && !ex.img?.length) return false;
    return true;
  }
  const matches = ex => passes(ex, state) && (!hits || hits.has(ex));
  /** Остаются ли упражнения, если к текущему выбору применить изменение patch. Фильтры без результатов делаем неактивными. */
  const has = patch => {
    const s = { ...state, ...patch };
    return data.some(ex => (!hits || hits.has(ex)) && passes(ex, s));
  };

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по названию…' });
  search.addEventListener('input', () => { setQuery(search.value); state.limit = 40; renderFilters(); renderList(); });
  const initialQuery = query;
  const filters = h('div', { class: 'ex-filters' });
  const list = h('div', { class: 'ex-results' });

  function renderFilters() {
    const group = (title, ...rows) => h('div', { class: 'filter-group' }, h('div', { class: 'filter-title' }, title), ...rows);
    filters.replaceChildren(
      group('Визуализация', h('div', { class: 'size-chips' },
        chip('С картинками', state.media, () => { state.media = !state.media; update(); }, !has({ media: true })))),
      group('Группа мышц', h('div', { class: 'size-chips' },
        chip('Все мышцы', !state.group, () => { state.group = null; update(); }),
        groupOptions.map(k => chip(raw(L.group(k)), state.group === k, () => { state.group = k; update(); }, !has({ group: k }))))),
      // оборудование: можно выбрать несколько (подходит любое из выбранных), по убыванию популярности
      group('Оборудование', h('div', { class: 'size-chips' },
        chip('Любое оборудование', !state.equip.size, () => { state.equip.clear(); update(); }),
        equipOptions.map(k => chip(raw(L.equip(k)), state.equip.has(k), () => { state.equip.has(k) ? state.equip.delete(k) : state.equip.add(k); update(); }, !has({ equip: new Set([k]) }))))));
  }

  function renderList() {
    const all = data.filter(matches);
    const shown = all.slice(0, state.limit);
    // replaceChildren превращает null в текст «null», поэтому пустые значения отбрасываем
    list.replaceChildren(...[
      h('div', { class: 'muted small' }, ctx.t('Найдено: {n}', { n: all.length })),
      ...shown.map(ex => h('button', { class: 'ex-item', onClick: () => showDetail(ex) },
        ex.img?.[0] ? h('img', { src: ex.img[0], alt: '', loading: 'lazy' }) : h('span', { class: 'ex-noimg' }, icon('dumbbell', 22)),
        h('span', { class: 'grow' }, h('strong', null, raw(displayName(ex, lang))),
          h('span', { class: 'muted small block' }, raw([(ex.g ?? []).map(L.group).join(', '), (ex.e ?? []).map(L.equip).join(', ') || null].filter(Boolean).join(' · ')))))),
      all.length > shown.length ? h('button', { class: 'btn', onClick: () => { state.limit += 60; renderList(); } }, 'Показать ещё') : null,
      !all.length ? h('p', { class: 'muted empty' }, 'Ничего не найдено') : null,
    ].filter(Boolean));
  }

  const update = () => { state.limit = 40; renderFilters(); renderList(); };

  function showHome() {
    m.el.querySelector('h2').textContent = ctx.t('Каталог упражнений');
    body.replaceChildren(
      h('div', { class: 'row-gap' }, h('div', { class: 'grow' }, search),
        h('button', { class: 'btn', onClick: () => showForm(null) }, icon('plus', 16), 'Своё упражнение')),
      filters, list);
    renderFilters(); renderList();
  }
  function showDetail(ex) {
    m.el.querySelector('h2').textContent = ctx.t('Упражнение');
    body.replaceChildren(renderDetail(ctx, ex, { onBack: showHome, onPick: onPick ? (e, l) => { m.close(); onPick(e, l); } : undefined, onEdit: showForm, onDelete: removeOwn }));
  }

  /** Форма своего упражнения (код формы грузится только когда нужна). */
  async function showForm(ex) {
    const { customForm } = await import('./custom.js');
    m.el.querySelector('h2').textContent = ctx.t(ex ? 'Редактирование упражнения' : 'Новое упражнение');
    body.replaceChildren(customForm(ctx, {
      ex, data,
      onDone: async saved => { await reload(); saved ? showDetail(saved) : showHome(); },
    }));
  }

  async function removeOwn(ex) {
    if (!(await ctx.ui.confirmDialog(ctx.t('Удалить упражнение «{name}»? В тренировках оно останется под своим названием.', { name: ex.n }), { okText: 'Удалить', danger: true }))) return;
    await removeCustom(ctx, ex.id);
    ctx.ui.toast('Упражнение удалено');
    await reload();
    showHome();
  }

  /** Пересобирает список (каталог + свои) и наборы фильтров: новые теги своих упражнений сразу попадают в фильтры. */
  async function reload() {
    data = [...(await loadCatalog()).exercises, ...customExercises()];
    const counts = new Map();
    for (const ex of data) for (const k of equipKeys(ex)) counts.set(k, (counts.get(k) ?? 0) + 1);
    equipOptions = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const extra = new Set();
    for (const ex of data) for (const g of ex.g ?? []) if (!(g in GROUPS)) extra.add(g);
    groupOptions = [...Object.keys(GROUPS), ...[...extra].sort()];
    state.equip = new Set([...state.equip].filter(k => equipOptions.includes(k)));
    if (state.group && !groupOptions.includes(state.group)) state.group = null;
    setQuery(search.value);
  }

  loadCatalog().then(async () => {
    const initial = query;
    await reload();
    if (initial) { search.value = initial; setQuery(initial); }
    const cur = current && data.find(e => e.id === current);
    if (cur) return showDetail(cur);
    showHome();
    search.focus();
  })
    .catch(e => body.replaceChildren(h('p', { class: 'muted' }, e.message)));
}

/** Только просмотр техники (из окна тренировки). */
export async function openDetail(ctx, id) {
  const { h, modal } = ctx.ui;
  const ex = await getExercise(id).catch(() => null);
  modal({ title: 'Техника', wide: true, body: ex ? renderDetail(ctx, ex) : h('p', { class: 'muted' }, 'Упражнение не найдено в каталоге.') });
}
