// Каталог упражнений (exercises.json: free-exercise-db + wger): выбор из списка и карточка с техникой.

const GROUPS = {
  chest: 'Грудь', back: 'Спина', shoulders: 'Плечи', arms: 'Руки', abs: 'Пресс', legs: 'Ноги', glutes: 'Ягодицы', cardio: 'Кардио', neck: 'Шея',
};
const MUSCLES = {
  abdominals: 'пресс', abductors: 'отводящие бедра', adductors: 'приводящие бедра', biceps: 'бицепс', calves: 'икры', chest: 'грудь',
  forearms: 'предплечья', glutes: 'ягодицы', hamstrings: 'задняя поверхность бедра', lats: 'широчайшие', 'lower back': 'поясница',
  'middle back': 'середина спины', neck: 'шея', quadriceps: 'квадрицепс', shoulders: 'плечи', traps: 'трапеции', triceps: 'трицепс',
  // названия из wger
  abs: 'пресс', quads: 'квадрицепс', trapezius: 'трапеции', 'obliquus externus abdominis': 'косые мышцы живота',
  brachialis: 'плечевая мышца', 'serratus anterior': 'передняя зубчатая', soleus: 'камбаловидная',
};
const EQUIP = {
  'body only': 'свой вес', bands: 'резинки', mat: 'коврик', 'exercise ball': 'фитбол', 'foam roll': 'ролл', 'pull-up bar': 'турник',
  bench: 'скамья', barbell: 'штанга', dumbbell: 'гантели', kettlebells: 'гиря', cable: 'блок', machine: 'тренажёр',
  'e-z curl bar': 'EZ-гриф', 'medicine ball': 'медбол', other: 'другое',
  'cable machine': 'блочный тренажёр', 'resistance band': 'эспандер',
};
const LEVEL = { beginner: 'новичок', intermediate: 'средний', expert: 'опытный' };

const label = (dict, k) => dict[k] ?? dict[String(k).toLowerCase()] ?? k;
export const displayName = ex => ex.ru || ex.n;

let cache;
export function loadCatalog() {
  cache ??= fetch(new URL('exercises.json', import.meta.url)).then(r => {
    if (!r.ok) throw new Error('Каталог упражнений недоступен');
    return r.json();
  }).catch(e => { cache = null; throw e; });
  return cache;
}

export async function getExercise(id) {
  return (await loadCatalog()).exercises.find(e => e.id === id) ?? null;
}

/** Карточка упражнения. Если передан onPick — внизу кнопка «Выбрать», onBack — стрелка назад. */
export function renderDetail(ctx, ex, { onPick, onBack } = {}) {
  const { h, icon, iconBtn } = ctx.ui;
  const steps = ex.dr?.length ? ex.dr : ex.d;
  const onlyEn = !ex.dr?.length;
  const tags = [
    ...ex.g.map(g => label(GROUPS, g)),
    ex.l ? LEVEL[ex.l] : null,
    ...(ex.e?.length ? ex.e.map(e => label(EQUIP, e)) : []),
    ex.h ? 'дома' : 'зал',
  ].filter(Boolean);
  const mus = list => (list ?? []).map(m => label(MUSCLES, m)).join(', ');
  return h('div', { class: 'ex-detail' },
    h('div', { class: 'row-gap' }, onBack ? iconBtn('chevL', 'К списку', onBack) : null,
      h('div', { class: 'grow' }, h('h3', null, displayName(ex)), ex.ru ? h('span', { class: 'muted small' }, ex.n) : null)),
    ex.img?.length ? h('div', { class: 'ex-imgs' }, ex.img.slice(0, 3).map(src => h('img', { src, alt: ex.n, loading: 'lazy' }))) : null,
    h('div', { class: 'row-gap wrap' }, tags.map(t => h('span', { class: 'chip' }, t))),
    ex.m?.length ? h('p', null, h('span', { class: 'muted' }, 'Основные мышцы: '), mus(ex.m)) : null,
    ex.s?.length ? h('p', null, h('span', { class: 'muted' }, 'Дополнительно: '), mus(ex.s)) : null,
    steps?.length ? h('div', null,
      h('strong', null, 'Техника выполнения'), onlyEn ? h('span', { class: 'muted small' }, ' · описание на английском') : null,
      h('ol', { class: 'ex-steps' }, steps.map(s => h('li', null, s)))) : h('p', { class: 'muted' }, 'Описания техники для этого упражнения пока нет.'),
    ex.cr ? h('p', { class: 'muted small' }, 'Источник: ' + ex.cr) : null,
    onPick ? h('button', { class: 'btn primary wide', onClick: () => onPick(ex) }, icon('check', 16), 'Выбрать') : null);
}

/** Модальный список с поиском и фильтрами. */
export function openPicker(ctx, { onPick }) {
  const { h, icon, modal } = ctx.ui;
  const state = { q: '', group: null, place: 'all', limit: 40 };
  const body = h('div', { class: 'picker-ex' }, h('p', { class: 'muted' }, 'Загрузка каталога…'));
  const m = modal({ title: 'Каталог упражнений', body, wide: true });
  let data = [];

  const chip = (text, on, fn) => h('button', { class: 'chip-btn' + (on ? ' on' : ''), onClick: fn }, text);

  function matches(ex) {
    if (state.group && !ex.g.includes(state.group)) return false;
    if (state.place === 'home' && !ex.h) return false;
    if (state.place === 'gym' && ex.h) return false;
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    return ex.n.toLowerCase().includes(q) || (ex.ru ?? '').toLowerCase().includes(q);
  }

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по названию…' });
  search.addEventListener('input', () => { state.q = search.value.trim(); state.limit = 40; renderList(); });
  const filters = h('div', { class: 'ex-filters' });
  const list = h('div', { class: 'ex-results' });

  function renderFilters() {
    filters.replaceChildren(
      h('div', { class: 'size-chips' },
        chip('Всё', state.place === 'all', () => { state.place = 'all'; update(); }),
        chip('Дома', state.place === 'home', () => { state.place = 'home'; update(); }),
        chip('Зал', state.place === 'gym', () => { state.place = 'gym'; update(); })),
      h('div', { class: 'size-chips' },
        chip('Все мышцы', !state.group, () => { state.group = null; update(); }),
        Object.entries(GROUPS).map(([k, v]) => chip(v, state.group === k, () => { state.group = k; update(); }))));
  }

  function renderList() {
    const all = data.filter(matches);
    const shown = all.slice(0, state.limit);
    // replaceChildren превращает null в текст «null», поэтому пустые значения отбрасываем
    list.replaceChildren(...[
      h('div', { class: 'muted small' }, `Найдено: ${all.length}`),
      ...shown.map(ex => h('button', { class: 'ex-item', onClick: () => showDetail(ex) },
        ex.img?.[0] ? h('img', { src: ex.img[0], alt: '', loading: 'lazy' }) : h('span', { class: 'ex-noimg' }, icon('dumbbell', 22)),
        h('span', { class: 'grow' }, h('strong', null, displayName(ex)),
          h('span', { class: 'muted small block' }, [ex.g.map(g => label(GROUPS, g)).join(', '), (ex.e ?? []).map(e => label(EQUIP, e)).join(', ') || null].filter(Boolean).join(' · '))))),
      all.length > shown.length ? h('button', { class: 'btn', onClick: () => { state.limit += 60; renderList(); } }, 'Показать ещё') : null,
      !all.length ? h('p', { class: 'muted empty' }, 'Ничего не найдено') : null,
    ].filter(Boolean));
  }

  const update = () => { state.limit = 40; renderFilters(); renderList(); };

  function showHome() {
    m.el.querySelector('h2').textContent = 'Каталог упражнений';
    body.replaceChildren(search, filters, list);
    renderFilters(); renderList();
  }
  function showDetail(ex) {
    m.el.querySelector('h2').textContent = 'Упражнение';
    body.replaceChildren(renderDetail(ctx, ex, { onBack: showHome, onPick: e => { m.close(); onPick(e); } }));
  }

  loadCatalog().then(c => { data = c.exercises; showHome(); search.focus(); })
    .catch(e => body.replaceChildren(h('p', { class: 'muted' }, e.message)));
}

/** Только просмотр техники (из окна тренировки). */
export async function openDetail(ctx, id) {
  const { h, modal } = ctx.ui;
  const ex = await getExercise(id).catch(() => null);
  modal({ title: 'Техника', wide: true, body: ex ? renderDetail(ctx, ex) : h('p', { class: 'muted' }, 'Упражнение не найдено в каталоге.') });
}
