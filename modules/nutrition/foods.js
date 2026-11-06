// Блюда и продукты: своя база (создание, правка, удаление, избранное), составные блюда, шаблоны приёмов, выбор блюда для приёма пищи
// (в этом приёме, недавние, частые, избранное, справочник, штрихкод, онлайн), ввод количества и быстрое добавление калорий, обмен по QR.

import {
  UNITS, EXTRAS, LIMITS, fill, num, inRange, round1, dayKey, listFoods, putFood, toggleFav, putLog, listLog, nutrientsFor, recipeTotals, usageStats,
  removeWithUndo, listTemplates, applyTemplate, sumNutrients,
} from './data.js';
import { openShare, openImport } from './share.js';
import { searchBase, searchRu, findBarcode, barcodeVariants, matches } from './fooddb.js';
import { searchOnline, fetchByBarcode } from './offapi.js';
import { openBarcodeScanner } from './scan.js';

/** Оставляет только цифры и один разделитель: до 5 цифр целой части и до 1 дробной. */
function sanitize(v, int) {
  const s = String(v).replace(int ? /[^0-9]/g : /[^0-9.,]/g, '');
  if (int) return s.slice(0, 5);
  const i = s.search(/[.,]/);
  if (i < 0) return s.slice(0, 5);
  return s.slice(0, i).slice(0, 5) + s[i] + s.slice(i + 1).replace(/[.,]/g, '').slice(0, 1);
}

/** Числовое поле: буквы и символы не вводятся, при выходе проверяется диапазон. */
export function numField(ctx, { value = '', ph = '', range, int = false, onInput, cls = '' }) {
  const i = ctx.ui.h('input', { class: 'input num ' + cls, inputmode: int ? 'numeric' : 'decimal', placeholder: ph, value, autocomplete: 'off', maxlength: '8' });
  i.addEventListener('keydown', e => {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(int ? /[0-9]/ : /[0-9.,]/).test(e.key)) e.preventDefault();
  });
  i.addEventListener('input', () => {
    const clean = sanitize(i.value, int);
    if (clean !== i.value) {
      const pos = Math.max(0, (i.selectionStart ?? clean.length) - (i.value.length - clean.length));
      i.value = clean;
      i.setSelectionRange(pos, pos);
    }
    i.classList.remove('bad');
    onInput?.(i.value);
  });
  i.addEventListener('blur', () => {
    const bad = range && i.value.trim() !== '' && !inRange(num(i.value), range);
    i.classList.toggle('bad', !!bad);
    i.title = bad ? ctx.t('Допустимо от {lo} до {hi}', { lo: range[0], hi: range[1] }) : '';
  });
  return i;
}

export const unitName = (ctx, u) => ctx.t(UNITS[u] ?? u);
export const fmt = (ctx, v) => (Math.round(v * 10) / 10).toLocaleString(ctx.locale);
export const macroLine = (ctx, x) => `${ctx.t('Б')} ${fmt(ctx, x.p)} · ${ctx.t('Ж')} ${fmt(ctx, x.f)} · ${ctx.t('У')} ${fmt(ctx, x.cb)}`;
const foodLine = (ctx, x) => `${x.kcal} ${ctx.t('ккал')} · ${macroLine(ctx, x)} · ${ctx.t('на 100')} ${unitName(ctx, x.unit)}`;
/** «клетчатка 2 г · натрий 120 мг» для заданных дополнительных нутриентов (только те, что есть); ids — какие показывать. */
export function extrasText(ctx, x, ids = EXTRAS.map(e => e.id)) {
  return EXTRAS.filter(e => ids.includes(e.id) && x[e.id] != null && x[e.id] !== 0).map(e => `${ctx.t(e.name).toLowerCase()} ${fmt(ctx, x[e.id])} ${ctx.t(e.unit)}`).join(' · ');
}
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- форма блюда ----------
/** Создание или правка блюда (обычного или составного). onSaved(food) вызывается после сохранения; isNew — блюдо из шаблона (справочник, товар), id нет. */
export function openFoodForm(ctx, food, { onSaved, isNew = false } = {}) {
  const { h, icon, iconBtn, modal, toast, raw } = ctx.ui;
  const s = v => (v != null ? String(v).replace('.', ',') : '');
  const f = {
    name: food?.name ?? '', unit: food?.unit ?? 'g', recipe: !!food?.recipe, mode: 'per100',
    kcal: s(food?.kcal), p: s(food?.p), f: s(food?.f), cb: s(food?.cb),
    ex: Object.fromEntries(EXTRAS.map(e => [e.id, s(food?.[e.id])])),
    portion: !!food?.portion, size: food?.portion ? String(food.portion.size) : '', pname: food?.portion?.name ?? '',
    items: (food?.recipe?.items ?? []).map(x => ({ ...x })), yield: food?.recipe ? String(food.recipe.yield) : '',
  };
  const name = h('input', { class: 'input', placeholder: 'Название', value: f.name, maxlength: '80' });
  name.addEventListener('input', () => { f.name = name.value; });

  const unitBox = h('div', { class: 'size-chips' });
  const modeBox = h('div', { class: 'size-chips' });
  const valBox = h('div', { class: 'size-chips' });
  const per = h('p', { class: 'muted small' });
  const portionUnit = h('span', { class: 'muted' });
  const plain = h('div', { class: 'form' });
  const comp = h('div', { class: 'form' });

  const drawUnit = () => {
    fill(unitBox, Object.keys(UNITS).map(u => h('button', { type: 'button', class: 'chip-btn' + (f.unit === u ? ' on' : ''), onClick: () => { f.unit = u; drawUnit(); } }, u === 'g' ? 'Граммы' : 'Миллилитры')));
    fill(modeBox,
      h('button', { type: 'button', class: 'chip-btn' + (!f.recipe ? ' on' : ''), onClick: () => { f.recipe = false; drawMode(); drawUnit(); } }, 'Обычное'),
      h('button', { type: 'button', class: 'chip-btn' + (f.recipe ? ' on' : ''), onClick: () => { f.recipe = true; drawMode(); drawUnit(); } }, 'Составное (рецепт)'));
    // значения: на 100 или на порцию (только когда порция задана): на упаковках чаще указано «на порцию»
    valBox.hidden = f.recipe || !f.portion;
    if (valBox.hidden) f.mode = 'per100';
    fill(valBox,
      h('button', { type: 'button', class: 'chip-btn' + (f.mode === 'per100' ? ' on' : ''), onClick: () => { f.mode = 'per100'; drawUnit(); } }, ctx.t('На 100 {u}', { u: unitName(ctx, f.unit) })),
      h('button', { type: 'button', class: 'chip-btn' + (f.mode === 'serving' ? ' on' : ''), onClick: () => { f.mode = 'serving'; drawUnit(); } }, 'На порцию'));
    per.textContent = f.recipe ? ctx.t('Значения на 100 {u} считаются по составу', { u: unitName(ctx, f.unit) })
      : f.mode === 'serving' ? ctx.t('Значения на одну порцию: пересчитаются на 100 {u} автоматически', { u: unitName(ctx, f.unit) })
        : ctx.t('Значения указываются на 100 {u}', { u: unitName(ctx, f.unit) });
    portionUnit.textContent = unitName(ctx, f.unit);
  };
  const drawMode = () => { plain.hidden = f.recipe; comp.hidden = !f.recipe; if (f.recipe) drawComp(); };

  const field = (label, get, set, range, int, ph = '0') => h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, label),
    numField(ctx, { value: get(), range, int, ph, onInput: v => set(v) }));
  plain.append(
    h('div', { class: 'nf-grid' },
      field('Калории, ккал', () => f.kcal, v => { f.kcal = v; }, LIMITS.kcal, true),
      field('Белки, г', () => f.p, v => { f.p = v; }, LIMITS.macro),
      field('Жиры, г', () => f.f, v => { f.f = v; }, LIMITS.macro),
      field('Углеводы, г', () => f.cb, v => { f.cb = v; }, LIMITS.macro)),
    h('details', { class: 'nf-more', open: !!food && EXTRAS.some(e => food[e.id] != null) },
      h('summary', null, 'Дополнительно: клетчатка, сахар, соль, минералы'),
      h('div', { class: 'nf-grid' }, EXTRAS.map(e => field(`${ctx.t(e.name)}, ${ctx.t(e.unit)}`, () => f.ex[e.id], v => { f.ex[e.id] = v; }, [0, e.max], e.d === 0, '—')))));

  // --- состав составного блюда ---
  const compList = h('div', { class: 'nf-items' });
  const compSum = h('div', { class: 'nf-preview' });
  const yieldInput = numField(ctx, { value: f.yield, ph: 'сумма', range: LIMITS.amount, onInput: v => { f.yield = v; drawSum(); } });
  const drawSum = () => {
    const t = recipeTotals(f.items, num(f.yield));
    fill(compSum, f.items.length
      ? [h('strong', null, raw(`${t.per100.kcal} ${ctx.t('ккал')} ${ctx.t('на 100')} ${unitName(ctx, f.unit)}`)), h('span', { class: 'muted small' }, raw(`${macroLine(ctx, t.per100)} · ${ctx.t('выход')} ${fmt(ctx, t.yield)} ${unitName(ctx, f.unit)}`))]
      : [h('span', { class: 'muted small' }, 'Добавьте продукты состава')]);
  };
  const drawComp = () => {
    fill(compList, f.items.map((x, i) => h('div', { class: 'nf-item' },
      h('button', { type: 'button', class: 'food-main', title: 'Изменить количество', onClick: () => openAmountSimple(ctx, { ...x.base, name: x.name, unit: x.unit }, amount => { x.amount = amount; drawComp(); }, x.amount) },
        h('span', { class: 'grow' }, raw(x.name), h('span', { class: 'muted small block' }, raw(`${fmt(ctx, x.amount)} ${unitName(ctx, x.unit)} · ${nutrientsFor(x.base, x.amount).kcal} ${ctx.t('ккал')}`)))),
      iconBtn('trash', 'Убрать', () => { f.items.splice(i, 1); drawComp(); }, 'danger'))));
    drawSum();
  };
  comp.append(
    h('p', { class: 'muted small' }, 'Соберите блюдо из своих продуктов. Калории и БЖУ посчитаются на 100 г готового блюда. Нажмите на продукт, чтобы изменить количество. Если блюдо уварилось или ужарилось, укажите массу готового.'),
    compList,
    h('button', { type: 'button', class: 'btn', onClick: () => openPicker(ctx, { title: 'Продукт в состав', pick: async food2 => {
      if (food2.recipe && food?.id && food2.id === food.id) return toast('Блюдо нельзя добавить в само себя');
      openAmountSimple(ctx, food2, amount => {
        const base = { kcal: food2.kcal, p: food2.p, f: food2.f, cb: food2.cb };
        for (const e of EXTRAS) if (food2[e.id] != null) base[e.id] = food2[e.id];
        f.items.push({ name: food2.name, unit: food2.unit, amount, base });
        drawComp();
      });
    } }) }, icon('plus', 16), 'Добавить продукт'),
    h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Масса готового блюда (необязательно)'), yieldInput),
    compSum);

  // --- порция ---
  const portionBox = h('div', { class: 'nf-portion' });
  const cb = h('input', { type: 'checkbox' });
  cb.checked = f.portion;
  cb.addEventListener('change', () => { f.portion = cb.checked; portionBox.hidden = !f.portion; drawUnit(); });
  portionBox.append(
    h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Размер порции'),
      h('div', { class: 'row-gap' }, numField(ctx, { value: f.size, range: LIMITS.portion, int: true, ph: '0', onInput: v => { f.size = v; } }), portionUnit)),
    h('label', { class: 'nf-cell grow' }, h('span', { class: 'muted small' }, 'Название порции'),
      (() => { const i = h('input', { class: 'input', placeholder: 'шт, ломтик, стакан…', value: f.pname, maxlength: '20' }); i.addEventListener('input', () => { f.pname = i.value; }); return i; })()));
  portionBox.hidden = !f.portion;

  async function save() {
    const nm = f.name.trim();
    if (!nm) return toast('Введите название');
    let portion;
    if (f.portion) {
      const size = num(f.size);
      if (!inRange(size, LIMITS.portion)) return toast('Укажите размер порции');
      portion = { size, name: f.pname.trim() };
    }
    let vals, recipe;
    if (f.recipe) {
      if (!f.items.length) return toast('Добавьте продукты состава');
      const y = num(f.yield);
      if (f.yield.trim() && !inRange(y, LIMITS.amount)) return toast('Проверьте массу готового блюда');
      const t = recipeTotals(f.items, y);
      vals = t.per100;
      recipe = { yield: round1(t.yield), items: f.items };
    } else {
      // значения на порцию пересчитываются на 100 г / 100 мл
      const k = f.mode === 'serving' && portion ? 100 / portion.size : 1;
      const [kcal, p, fat, c] = [num(f.kcal), num(f.p), num(f.f), num(f.cb)].map(v => (v == null ? v : v * k));
      if (!inRange(kcal, LIMITS.kcal)) return toast('Проверьте калории: от 0 до 2000 на 100');
      for (const [v, label] of [[p, 'белки'], [fat, 'жиры'], [c, 'углеводы']]) {
        if (!inRange(v, LIMITS.macro)) return toast(ctx.t('Проверьте {x}: от 0 до 100 на 100', { x: ctx.t(label) }));
      }
      vals = { kcal: Math.round(kcal), p: round1(p), f: round1(fat), cb: round1(c) };
      for (const e of EXTRAS) {
        if (!f.ex[e.id].trim()) continue;
        const v = num(f.ex[e.id]);
        if (v == null || v * k < 0 || v * k > e.max) return toast(ctx.t('Проверьте поле «{x}»', { x: ctx.t(e.name) }));
        vals[e.id] = roundTo(v * k, e.d);
      }
    }
    const rec = await putFood(ctx, { ...(food && !isNew ? { id: food.id, ...(food.fav ? { fav: true } : {}) } : {}), ...(food?.barcode ? { barcode: food.barcode } : {}), ...(food?.src ? { src: food.src } : {}), name: nm, unit: f.unit, ...vals, ...(portion ? { portion } : {}), ...(recipe ? { recipe } : {}) });
    m.close();
    onSaved?.(rec);
  }

  const m = modal({
    title: food && !isNew ? 'Изменить блюдо' : 'Новое блюдо',
    body: h('div', { class: 'form nf' },
      name,
      food?.barcode || food?.src === 'ru' || food?.src === 'off' ? h('p', { class: 'muted small' }, raw(`${food.barcode ? ctx.t('Штрихкод') + ': ' + food.barcode + '. ' : ''}${food.src === 'ru' || food.src === 'off' ? ctx.t('Данные Open Food Facts вносят пользователи: проверьте значения.') : ''}`)) : null,
      h('div', { class: 'nf-sub' }, 'Вид'), modeBox,
      h('div', { class: 'nf-sub' }, 'Мерить в'), unitBox,
      h('label', { class: 'check' }, cb, h('span', null, 'Есть размер порции')),
      portionBox,
      valBox, per,
      plain, comp),
    actions: [h('button', { class: 'btn primary', onClick: save }, 'Сохранить')],
  });
  drawUnit();
  drawMode();
  name.focus();
}

/** Простое окно «сколько»: для состава блюда. cb(amount) вызывается с количеством в г или мл. */
function openAmountSimple(ctx, food, cb, initial = 100) {
  const { h, modal, toast } = ctx.ui;
  let v = String(initial).replace('.', ',');
  const input = numField(ctx, { value: v, ph: '0', range: LIMITS.amount, onInput: x => { v = x; } });
  const go = () => {
    const a = num(v);
    if (!inRange(a, LIMITS.amount)) return toast('Укажите количество');
    m.close();
    cb(a);
  };
  const m = modal({
    title: food.name,
    body: h('div', { class: 'form' }, h('div', { class: 'row-gap' }, input, h('span', { class: 'muted' }, unitName(ctx, food.unit)))),
    actions: [h('button', { class: 'btn primary', onClick: go }, 'Сохранить')],
  });
  input.focus();
  input.select();
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ---------- количество ----------
/**
 * Окно ввода количества: добавляет блюдо в приём (rec нет) или правит запись журнала (rec есть: можно перенести в другой приём и удалить).
 * base — блюдо на 100 г / 100 мл: запись журнала хранит его «снимок», поэтому правка блюда историю не меняет.
 * meals — приёмы для переноса; на будущие даты блюдо по умолчанию попадает в план.
 */
export function openAmount(ctx, base, { rec, date, meal, meals = [], onDone }) {
  const { h, modal, toast, raw } = ctx.ui;
  const hasPortion = !!base.portion;
  const st = { mode: hasPortion ? 'portion' : 'unit', value: '', planned: rec ? !!rec.planned : (date ?? rec?.date) > dayKey(), meal: rec?.meal ?? meal };
  if (rec) {
    if (hasPortion && Math.abs(rec.amount / base.portion.size - Math.round(rec.amount / base.portion.size * 10) / 10) < 1e-6) st.value = String(round1(rec.amount / base.portion.size));
    else { st.mode = 'unit'; st.value = String(rec.amount); }
  } else st.value = hasPortion ? '1' : '100';

  const preview = h('div', { class: 'nf-preview' });
  const modeBox = h('div', { class: 'size-chips' });
  const mealBox = h('div', { class: 'size-chips' });
  const input = numField(ctx, { value: st.value, ph: '0', onInput: v => { st.value = v; update(); } });
  const unitLabel = h('span', { class: 'muted' });

  const amount = () => {
    const v = num(st.value);
    return v == null ? null : st.mode === 'portion' ? v * base.portion.size : v;
  };
  function update() {
    const a = amount();
    unitLabel.textContent = st.mode === 'portion' ? (base.portion.name ? ctx.t(base.portion.name) : ctx.t('порц.')) : unitName(ctx, base.unit);
    if (hasPortion) {
      fill(modeBox,
        h('button', { type: 'button', class: 'chip-btn' + (st.mode === 'portion' ? ' on' : ''), onClick: () => switchMode('portion') }, 'Порции'),
        h('button', { type: 'button', class: 'chip-btn' + (st.mode === 'unit' ? ' on' : ''), onClick: () => switchMode('unit') }, unitName(ctx, base.unit)));
    }
    if (rec && meals.length) fill(mealBox, meals.map(mm => h('button', { type: 'button', class: 'chip-btn' + (st.meal === mm.id ? ' on' : ''), onClick: () => { st.meal = mm.id; update(); } }, raw(ctx.t(mm.name)))));
    if (a == null || !inRange(a, LIMITS.amount)) { fill(preview, h('span', { class: 'muted small' }, 'Укажите количество')); return; }
    const n = nutrientsFor(base, a);
    const extra = extrasText(ctx, n);
    fill(preview,
      h('strong', null, `${n.kcal} ${ctx.t('ккал')}`),
      h('span', { class: 'muted small' }, raw(macroLine(ctx, n))),
      extra ? h('span', { class: 'muted small' }, raw(extra)) : null,
      st.mode === 'portion' ? h('span', { class: 'muted small' }, raw(`= ${fmt(ctx, a)} ${unitName(ctx, base.unit)}`)) : null);
  }
  function switchMode(mode) {
    const a = amount();
    st.mode = mode;
    if (a != null) st.value = String(round1(mode === 'portion' ? a / base.portion.size : a)).replace('.', ',');
    input.value = st.value;
    update();
  }

  async function save() {
    const a = amount();
    if (a == null || !inRange(a, LIMITS.amount)) return toast('Укажите количество');
    const n = nutrientsFor(base, a);
    const foodId = base.id ?? rec?.foodId;
    const snap = { name: base.name, unit: base.unit, kcal: base.kcal, p: base.p, f: base.f, cb: base.cb };
    for (const e of EXTRAS) if (base[e.id] != null) snap[e.id] = base[e.id];
    if (base.portion) snap.portion = base.portion;
    await putLog(ctx, {
      ...(rec ? { id: rec.id } : {}), date: rec?.date ?? date, meal: st.meal,
      ...(foodId ? { foodId } : {}), ...(st.planned ? { planned: true } : {}),
      name: base.name, unit: base.unit, amount: round1(a), ...n, base: snap,
    });
    m.close();
    onDone?.();
  }

  const planBox = h('input', { type: 'checkbox' });
  planBox.checked = st.planned;
  planBox.addEventListener('change', () => { st.planned = planBox.checked; });
  const m = modal({
    title: base.name,
    body: h('div', { class: 'form' },
      h('p', { class: 'muted small' }, raw(`${ctx.t('На 100')} ${unitName(ctx, base.unit)}: ${base.kcal} ${ctx.t('ккал')} · ${macroLine(ctx, base)}`)),
      hasPortion ? modeBox : null,
      h('div', { class: 'row-gap' }, input, unitLabel),
      preview,
      h('label', { class: 'check' }, planBox, h('span', null, 'В план (в итоги дня не входит, пока не отмечено съеденным)')),
      rec && meals.length ? [h('span', { class: 'nf-sub' }, 'Перенести в приём'), mealBox] : null),
    actions: [
      rec ? h('button', { class: 'btn danger', onClick: () => { m.close(); removeWithUndo(ctx, 'log', rec, 'Блюдо удалено', onDone); } }, 'Удалить') : null,
      h('button', { class: 'btn primary', onClick: save }, rec ? 'Сохранить' : 'Добавить'),
    ].filter(Boolean),
  });
  update();
  input.focus();
  input.select();
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

/** Быстрое добавление: только калории (и при желании БЖУ), без продукта. rec — правка существующей записи. */
export function openQuickAdd(ctx, { rec, date, meal, meals = [], onDone }) {
  const { h, modal, toast, raw } = ctx.ui;
  const s = v => (v != null ? String(v).replace('.', ',') : '');
  const st = { name: rec?.name ?? '', kcal: s(rec?.kcal), p: s(rec?.p), f: s(rec?.f), cb: s(rec?.cb), planned: rec ? !!rec.planned : (date ?? '') > dayKey(), meal: rec?.meal ?? meal };
  const name = h('input', { class: 'input', placeholder: 'Название (необязательно)', value: st.name, maxlength: '60' });
  name.addEventListener('input', () => { st.name = name.value; });
  const mealBox = h('div', { class: 'size-chips' });
  const drawMeals = () => fill(mealBox, meals.map(mm => h('button', { type: 'button', class: 'chip-btn' + (st.meal === mm.id ? ' on' : ''), onClick: () => { st.meal = mm.id; drawMeals(); } }, raw(ctx.t(mm.name)))));
  const fld = (label, key, range, int) => h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, label), numField(ctx, { value: st[key], range, int, ph: key === 'kcal' ? '0' : '—', onInput: v => { st[key] = v; } }));
  const planBox = h('input', { type: 'checkbox' });
  planBox.checked = st.planned;
  planBox.addEventListener('change', () => { st.planned = planBox.checked; });
  async function save() {
    const kcal = num(st.kcal);
    if (!inRange(kcal, LIMITS.quickKcal)) return toast('Укажите калории');
    const [p, f, cb] = [num(st.p) ?? 0, num(st.f) ?? 0, num(st.cb) ?? 0];
    if (![p, f, cb].every(v => inRange(v, LIMITS.quickMacro))) return toast('Проверьте белки, жиры и углеводы');
    await putLog(ctx, {
      ...(rec ? { id: rec.id } : {}), date: rec?.date ?? date, meal: st.meal, ...(st.planned ? { planned: true } : {}),
      name: st.name.trim(), unit: 'g', amount: 0, kcal: Math.round(kcal), p: round1(p), f: round1(f), cb: round1(cb), quick: true,
    });
    m.close();
    onDone?.();
  }
  const m = modal({
    title: rec ? 'Быстрое добавление' : 'Быстрое добавление калорий',
    body: h('div', { class: 'form' },
      h('p', { class: 'muted small' }, 'Когда нет времени искать продукт: впишите калории (и БЖУ, если знаете).'),
      name,
      h('div', { class: 'nf-grid' }, fld('Калории, ккал', 'kcal', LIMITS.quickKcal, true), fld('Белки, г', 'p', LIMITS.quickMacro), fld('Жиры, г', 'f', LIMITS.quickMacro), fld('Углеводы, г', 'cb', LIMITS.quickMacro)),
      h('label', { class: 'check' }, planBox, h('span', null, 'В план (в итоги дня не входит, пока не отмечено съеденным)')),
      rec && meals.length ? [h('span', { class: 'nf-sub' }, 'Перенести в приём'), mealBox] : null),
    actions: [
      rec ? h('button', { class: 'btn danger', onClick: () => { m.close(); removeWithUndo(ctx, 'log', rec, 'Запись удалена', onDone); } }, 'Удалить') : null,
      h('button', { class: 'btn primary', onClick: save }, rec ? 'Сохранить' : 'Добавить'),
    ].filter(Boolean),
  });
  if (rec && meals.length) drawMeals();
  name.focus();
}

// ---------- выбор блюда ----------
/**
 * Выбор блюда: шаблоны приёмов, свои блюда (вкладки «В этом приёме», «Недавние», «Частые», «Избранное», «Все»), встроенный справочник и товары
 * по штрихкоду, онлайн-поиск в Open Food Facts, быстрое добавление калорий. Выбор ведёт к вводу количества или, если задан pick, просто
 * отдаёт блюдо (так выбирают продукты для состава). Блюдо из справочника или товар при выборе сохраняется в свои блюда (товары — после проверки
 * значений в форме), поэтому дальше работает как своё.
 */
export async function openPicker(ctx, { date, meal, mealName, meals = [], onDone, pick, title }) {
  const { h, icon, iconBtn, modal, toast, raw } = ctx.ui;
  let foods = await listFoods(ctx);
  let templates = pick ? [] : await listTemplates(ctx);
  const log = await listLog(ctx);
  const usage = usageStats(log);
  const usageHere = usageStats(log, meal);
  const stat = (u, x) => u.get(x.id) ?? u.get('n:' + x.name.toLowerCase()) ?? { count: 0, last: 0 };
  let q = '';
  let tab = 'all';
  const tabs = h('div', { class: 'size-chips' });
  const list = h('div', { class: 'food-list' });
  const ext = h('div', { class: 'food-ext' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск блюда или штрихкод', autocomplete: 'off' });

  const sets = () => ({
    tpl: templates,
    here: meal ? foods.filter(x => stat(usageHere, x).count).sort((a, b) => stat(usageHere, b).count - stat(usageHere, a).count || stat(usageHere, b).last - stat(usageHere, a).last).slice(0, 15) : [],
    recent: foods.filter(x => stat(usage, x).count).sort((a, b) => stat(usage, b).last - stat(usage, a).last).slice(0, 15),
    frequent: foods.filter(x => stat(usage, x).count >= 2).sort((a, b) => stat(usage, b).count - stat(usage, a).count || stat(usage, b).last - stat(usage, a).last).slice(0, 15),
    fav: foods.filter(x => x.fav),
    all: foods,
  });
  const NAMES = { tpl: 'Шаблоны', here: 'В этом приёме', recent: 'Недавние', frequent: 'Частые', fav: 'Избранное', all: 'Все' };
  const choose = x => { m.close(); if (pick) pick(x); else openAmount(ctx, x, { date, meal, meals, onDone }); };

  const tplRow = t => {
    const tot = sumNutrients(t.items);
    return h('div', { class: 'food-item' },
      h('button', { type: 'button', class: 'food-main', onClick: async () => { const n = await applyTemplate(ctx, t, date, meal); m.close(); toast(ctx.t('Добавлено блюд: {n}', { n })); onDone?.(); } },
        h('span', { class: 'grow' }, h('strong', null, raw(t.name), h('span', { class: 'tag' }, 'шаблон')),
          h('span', { class: 'muted small block' }, raw(`${ctx.t('Блюд: {n}', { n: t.items.length })} · ${Math.round(tot.kcal)} ${ctx.t('ккал')} · ${macroLine(ctx, tot)}`)))),
      iconBtn('trash', 'Удалить шаблон', () => removeWithUndo(ctx, 'templates', t, 'Шаблон удалён', async () => { templates = await listTemplates(ctx); draw(); }), 'danger'),
      icon('plus', 18));
  };

  const draw = () => {
    const s = sets();
    if (!q && !s[tab].length && tab !== 'all') tab = s.here.length ? 'here' : s.recent.length ? 'recent' : 'all';
    const keys = Object.keys(NAMES).filter(k => k !== 'tpl' || !pick).filter(k => k !== 'here' || meal);
    fill(tabs, keys.map(k => h('button', { type: 'button', class: 'chip-btn' + (!q && tab === k ? ' on' : ''), onClick: () => { tab = k; q = ''; search.value = ''; draw(); drawExt(); } },
      NAMES[k], k === 'all' ? null : h('span', { class: 'cnt' }, raw(String(s[k].length))))));
    if (!q && tab === 'tpl') {
      fill(list, s.tpl.length ? s.tpl.map(tplRow) : [h('p', { class: 'muted' }, 'Шаблонов пока нет. Откройте приём с блюдами и нажмите «Сохранить как шаблон».')]);
      return;
    }
    const items = q ? foods.filter(x => matches(x.name, q)) : s[tab];
    fill(list, items.length ? items.map(x => h('div', { class: 'food-item' },
      h('button', { type: 'button', class: 'food-main', onClick: () => choose(x) },
        h('span', { class: 'grow' }, h('strong', null, raw(x.name), x.recipe ? h('span', { class: 'tag' }, 'рецепт') : null), h('span', { class: 'muted small block' }, raw(foodLine(ctx, x))))),
      iconBtn('star', x.fav ? 'Убрать из избранного' : 'В избранное', async () => { await toggleFav(ctx, x); foods = await listFoods(ctx); draw(); }, 'fav' + (x.fav ? ' on' : '')),
      icon('plus', 18))) : [h('p', { class: 'muted' }, foods.length ? (q ? 'Среди своих блюд ничего не найдено' : tab === 'fav' ? 'В избранное блюда добавляются звёздочкой' : 'Пока пусто') : 'Своих блюд пока нет: выберите из справочника, найдите товар или создайте блюдо.')]);
  };

  // --- справочник, товары, онлайн ---
  /** Блюдо из справочника: сохраняем в свои (один раз) и сразу ведём к вводу количества. */
  async function useBase(item) {
    const have = foods.find(x => x.src === 'base' && x.name === item.name);
    choose(have ?? (await putFood(ctx, item)));
  }
  /** Товар: показываем форму для проверки значений, после сохранения — ввод количества. */
  function reviewProduct(item) {
    const have = item.barcode && foods.find(x => x.barcode === item.barcode);
    if (have) return choose(have);
    openFoodForm(ctx, item, { onSaved: saved => choose(saved), isNew: true });
  }
  const section = (titleText, items, onPick, note) => (items.length ? h('div', { class: 'food-sec' },
    h('div', { class: 'nut-sub' }, titleText), note ? h('p', { class: 'muted small' }, note) : null,
    ...items.map(x => h('div', { class: 'food-item' },
      h('button', { type: 'button', class: 'food-main', onClick: () => onPick(x) },
        h('span', { class: 'grow' }, h('strong', null, raw(x.name)), h('span', { class: 'muted small block' }, raw(foodLine(ctx, x)))),
        icon('plus', 18))))) : null);

  let token = 0, online = { items: null, busy: false, msg: '', russia: true };
  async function drawExt() {
    const my = ++token;
    online = { ...online, items: null, msg: '', busy: false };
    const w = q.trim();
    if (w.length < 2) { fill(ext); return; }
    const isCode = !!barcodeVariants(w);
    const [b, r, bc] = await Promise.all([isCode ? [] : searchBase(w, 15, ctx.lang), isCode ? [] : searchRu(w, 12), isCode ? findBarcode(w) : null]);
    if (my !== token) return;
    const onlineBox = h('div', { class: 'food-sec' });
    const paintOnline = () => {
      const run = async () => {
        online = { ...online, busy: true, msg: ctx.t('Ищу в Open Food Facts…') }; paintOnline();
        try {
          if (isCode) { const f = await fetchByBarcode(w); online.items = f && !f.missingNutrients ? [f] : []; online.msg = f ? (f.missingNutrients ? ctx.t('Товар есть в базе, но без калорий и БЖУ: создайте блюдо вручную.') : '') : ctx.t('Товар не найден.'); }
          else { online.items = await searchOnline(w, { russiaOnly: online.russia }); online.msg = online.items.length ? '' : ctx.t('Ничего не найдено.'); }
        } catch (e) { online.items = null; online.msg = e.message === 'busy' ? ctx.t('Сервис сейчас занят, попробуйте позже.') : ctx.t('Нет связи с Open Food Facts.'); }
        online.busy = false; if (my === token) paintOnline();
      };
      const cb = h('input', { type: 'checkbox' }); cb.checked = online.russia; cb.addEventListener('change', () => { online.russia = cb.checked; });
      fill(onlineBox,
        h('div', { class: 'nut-sub' }, 'Онлайн: Open Food Facts'),
        h('div', { class: 'row-gap wrap' },
          h('button', { class: 'btn sm', disabled: online.busy, onClick: run }, icon('search', 14), isCode ? 'Найти штрихкод онлайн' : 'Искать онлайн'),
          isCode ? null : h('label', { class: 'check' }, cb, h('span', null, 'Только российские'))),
        online.msg ? h('p', { class: 'muted small' }, online.msg) : null,
        online.items?.length ? online.items.map(x => h('div', { class: 'food-item' },
          h('button', { type: 'button', class: 'food-main', onClick: () => reviewProduct(x) },
            h('span', { class: 'grow' }, h('strong', null, raw(x.name)), h('span', { class: 'muted small block' }, raw(foodLine(ctx, x)))), icon('plus', 18)))) : null);
    };
    paintOnline();
    fill(ext,
      section(ctx.t('Товар по штрихкоду'), bc ? [bc] : [], reviewProduct),
      section(ctx.t('Справочник продуктов'), b, useBase, ctx.t('Сырые и готовые продукты: значения на 100 г, можно добавлять сразу.')),
      section(ctx.t('Товары (офлайн)'), r, reviewProduct, ctx.t('Из базы Open Food Facts: значения проверьте перед добавлением.')),
      w.length >= 3 || isCode ? onlineBox : null);
  }

  /** Результат сканирования: свои блюда → офлайн-набор → онлайн. */
  async function handleBarcode(text) {
    const codes = barcodeVariants(text) ?? [];
    const own = foods.find(x => x.barcode && codes.includes(x.barcode));
    if (own) return choose(own);
    const local = await findBarcode(text);
    if (local) return reviewProduct(local);
    try {
      toast('Ищу в Open Food Facts…');
      const f = await fetchByBarcode(text);
      if (f && !f.missingNutrients) return reviewProduct(f);
      toast(f ? 'В базе нет калорий и БЖУ этого товара: заполните вручную' : 'Товар не найден: заполните вручную');
      openFoodForm(ctx, { name: f?.name ?? '', barcode: codes[0], kcal: undefined, src: 'own' }, { onSaved: saved => choose(saved), isNew: true });
    } catch (e) {
      toast(e.message === 'busy' ? 'Сервис занят, попробуйте позже' : 'Нет связи с Open Food Facts');
      openFoodForm(ctx, { name: '', barcode: codes[0], src: 'own' }, { onSaved: saved => choose(saved), isNew: true });
    }
  }

  search.addEventListener('input', () => { q = search.value; draw(); drawExt(); });
  const reload = async () => { foods = await listFoods(ctx); draw(); };
  const m = modal({
    title: title ? ctx.t(title) : ctx.t('Добавить в «{meal}»', { meal: ctx.t(mealName) }),
    wide: true,
    body: h('div', { class: 'form' },
      h('div', { class: 'row-gap wrap' }, h('div', { class: 'grow' }, search),
        h('button', { class: 'btn', title: 'Сканировать штрихкод', onClick: () => openBarcodeScanner(ctx, handleBarcode) }, icon('qr', 16), 'Штрихкод'),
        pick ? null : h('button', { class: 'btn', title: 'Быстро добавить калории без продукта', onClick: () => { m.close(); openQuickAdd(ctx, { date, meal, meals, onDone }); } }, icon('bolt', 16), 'Быстро'),
        h('button', { class: 'btn', onClick: () => openFoodForm(ctx, null, { onSaved: reload }) }, icon('plus', 16), 'Создать блюдо')),
      tabs, list, ext,
      h('p', { class: 'muted small' }, 'Справочник: USDA FoodData Central (CC0). Товары: Open Food Facts (ODbL), данные вносят пользователи.')),
  });
  tab = sets().here.length ? 'here' : sets().recent.length ? 'recent' : 'all';
  draw();
  search.focus();
}

// ---------- «Мои блюда»: обзор, правка, обмен ----------
export async function openFoodsManager(ctx, { onChange } = {}) {
  const { h, icon, iconBtn, modal, raw } = ctx.ui;
  let foods = await listFoods(ctx);
  const picked = new Set();
  const list = h('div', { class: 'food-list' });
  const bar = h('div', { class: 'row-gap wrap' });
  const reload = async () => { foods = await listFoods(ctx); for (const id of [...picked]) if (!foods.some(x => x.id === id)) picked.delete(id); draw(); onChange?.(); };

  function draw() {
    const top = list.scrollTop; // выбор не должен сбрасывать прокрутку списка
    const all = foods.length > 0 && picked.size === foods.length;
    const allCb = h('input', { type: 'checkbox' });
    allCb.checked = all;
    allCb.addEventListener('change', () => { picked.clear(); if (allCb.checked) foods.forEach(x => picked.add(x.id)); draw(); });
    const shareBtn = h('button', { class: 'btn primary', disabled: picked.size === 0, onClick: () => openShare(ctx, foods.filter(x => picked.has(x.id))) },
      icon('qr', 16), ctx.t('QR выбранных: {n}', { n: picked.size }));
    fill(bar,
      h('label', { class: 'check' }, allCb, h('span', null, 'Выбрать все')),
      h('span', { class: 'grow' }),
      shareBtn);
    fill(list, foods.length ? foods.map(x => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = picked.has(x.id);
      cb.addEventListener('change', () => { if (cb.checked) picked.add(x.id); else picked.delete(x.id); draw(); });
      return h('div', { class: 'food-item static' },
        h('label', { class: 'check' }, cb),
        h('span', { class: 'grow' }, h('strong', null, raw(x.name), x.recipe ? h('span', { class: 'tag' }, 'рецепт') : null),
          h('span', { class: 'muted small block' }, raw(foodLine(ctx, x)
            + (x.portion ? ` · ${ctx.t('порция')} ${x.portion.size} ${unitName(ctx, x.unit)}${x.portion.name ? ' (' + ctx.t(x.portion.name) + ')' : ''}` : '')))),
        iconBtn('star', x.fav ? 'Убрать из избранного' : 'В избранное', async () => { await toggleFav(ctx, x); reload(); }, 'fav' + (x.fav ? ' on' : '')),
        iconBtn('edit', 'Изменить', () => openFoodForm(ctx, x, { onSaved: reload })),
        iconBtn('trash', 'Удалить', () => removeWithUndo(ctx, 'foods', x, 'Блюдо удалено', reload), 'danger'));
    }) : [h('p', { class: 'muted' }, 'Блюд пока нет.')]);
    list.scrollTop = top;
  }

  modal({
    title: 'Мои блюда',
    wide: true,
    body: h('div', { class: 'form' },
      h('div', { class: 'row-gap wrap' },
        h('button', { class: 'btn', onClick: () => openFoodForm(ctx, null, { onSaved: reload }) }, icon('plus', 16), 'Создать блюдо'),
        h('button', { class: 'btn', onClick: () => openImport(ctx, { onDone: reload }) }, icon('qr', 16), 'Добавить по коду')),
      bar, list),
  });
  draw();
}
