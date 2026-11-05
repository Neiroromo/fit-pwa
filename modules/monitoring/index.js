// Модуль «Мониторинг»: два раздела — «Фитнес» (вес, процент жира, замеры тела) и «Медицина» (давление, пульс, температура); ввод, история и динамика.

import {
  MEASURES, GROUPS, SIDE_NAME, LIMITS, dayKey, parseDay, num, inRange, measureOf, sideKeys, splitKey,
  listEntries, putEntry, removeEntry, getSettings, saveSettings, lastValue, points,
  MEDICAL, VITAL_LABEL, listVitals, putVital, removeVital, vitalPoints,
} from './data.js';
import { estimateFat } from './estimate.js';
import { buildFigure } from './figure.js';
import { dynamicsChart, dynamicsTable, sparkline, withTrend, colorOfKey, SERIES_COLORS } from './charts.js';

const DAY = 86_400_000;
const PERIODS = [
  { days: 14, label: '2 нед' },
  { days: 30, label: '1 мес' },
  { days: 90, label: '3 мес' },
  { days: 182, label: '6 мес' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё' },
];

/** Оставляет только цифры и один разделитель: до 3 цифр целой части и до 2 дробной. int — только целые числа. */
function sanitizeNumber(v, int = false) {
  const s = String(v).replace(int ? /[^0-9]/g : /[^0-9.,]/g, '');
  if (int) return s.slice(0, 3);
  const i = s.search(/[.,]/);
  if (i < 0) return s.slice(0, 3);
  return s.slice(0, i).slice(0, 3) + s[i] + s.slice(i + 1).replace(/[.,]/g, '').slice(0, 2);
}

/** Числовое поле: буквы и символы не вводятся, при выходе из поля значение проверяется по диапазону. */
function numField(ctx, { get, set, ph, range, int = false, onInput }) {
  const i = ctx.ui.h('input', { class: 'input num', inputmode: int ? 'numeric' : 'decimal', placeholder: ph, value: get(), autocomplete: 'off', maxlength: '6' });
  i.addEventListener('keydown', e => {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(int ? /[0-9]/ : /[0-9.,]/).test(e.key)) e.preventDefault();
  });
  i.addEventListener('input', () => {
    const clean = sanitizeNumber(i.value, int);
    if (clean !== i.value) { // вставка или автозаполнение с лишними символами
      const pos = Math.max(0, (i.selectionStart ?? clean.length) - (i.value.length - clean.length));
      i.value = clean;
      i.setSelectionRange(pos, pos);
    }
    i.classList.remove('bad');
    set(i.value);
    onInput?.();
  });
  i.addEventListener('blur', () => {
    const bad = i.value.trim() !== '' && !inRange(num(i.value), range);
    i.classList.toggle('bad', bad);
    i.title = bad ? ctx.t('Допустимо от {lo} до {hi}', { lo: range[0], hi: range[1] }) : '';
  });
  return i;
}

/**
 * Переносит значения замеров группы при смене режима «вместе / раздельно»:
 * общее значение → обе стороны, две стороны → среднее. Повторный вызов ничего не меняет.
 */
function moveSplitValues(vals, groupId, on) {
  for (const m of MEASURES.filter(m => m.group === groupId)) {
    const [c, r, l] = sideKeys(m.id).map(k => num(vals[k]));
    if (on) {
      if (c != null) { vals[`${m.id}.r`] = vals[`${m.id}.l`] = vals[m.id]; }
      delete vals[m.id];
    } else {
      const sides = [r, l].filter(v => v != null);
      if (sides.length && c == null) vals[m.id] = String(Math.round((sides.reduce((a, b) => a + b, 0) / sides.length) * 10) / 10);
      delete vals[`${m.id}.r`]; delete vals[`${m.id}.l`];
    }
  }
}

export default {
  async mount(page, ctx, params) {
    const { h, icon, iconBtn, confirmDialog, toast, raw, modal } = ctx.ui;
    let entries = await listEntries(ctx);
    let vitals = await listVitals(ctx);
    let settings = await getSettings(ctx);
    // form — то, что набрано в форме ввода; хранится здесь, чтобы не потеряться при смене настроек
    const state = { tab: 'input', cat: 'fitness', hcat: 'all', vform: null, hview: 'dynamics', metric: 'weight', trend: true, dview: 'chart', period: 90, date: dayKey(), form: null };

    const hiddenSet = () => new Set(settings.hidden);
    const visible = () => MEASURES.filter(m => !hiddenSet().has(m.id));

    const fmtNum = v => (Math.round(v * 10) / 10).toLocaleString(ctx.locale);
    const fmtDay = ms => new Date(ms).toLocaleDateString(ctx.locale, { day: 'numeric', month: 'short' });
    const fmtDayLong = key => parseDay(key).toLocaleDateString(ctx.locale, { day: 'numeric', month: 'long', year: 'numeric' });
    const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v));
    const sideLabel = key => {
      const [id, side] = splitKey(key);
      return side ? `${ctx.t(measureOf(id).name)}, ${ctx.t(SIDE_NAME[side])}` : ctx.t(measureOf(id).name);
    };

    const view = h('div', { class: 'mon-view' });
    const tabs = (items, current, onPick) => h('div', { class: 'size-chips' }, items.map(([id, label]) =>
      h('button', { class: 'chip-btn' + (id === current ? ' on' : ''), onClick: () => onPick(id) }, label)));

    function render() {
      // раздел (фитнес / медицина) выбирается во вводе; в истории тот же выбор — фильтр с пунктом «Всё»
      const catBar = state.tab === 'input' ? tabs([['fitness', 'Фитнес'], ['medical', 'Медицина']], state.cat, c => { state.cat = c; render(); }) : null;
      page.replaceChildren(...[
        h('header', { class: 'page-head' }, h('h1', null, 'Мониторинг'), iconBtn('sliders', 'Настройки мониторинга', openSettings)),
        tabs([['input', 'Ввод'], ['history', 'История']], state.tab, t => { state.tab = t; render(); }),
        catBar,
        view,
      ].filter(Boolean));
      if (state.tab !== 'input') renderHistory();
      else if (state.cat === 'medical') renderMedicalInput();
      else renderInput();
    }

    // ---------- настройки ----------
    function openSettings() {
      const change = async next => {
        settings = { ...settings, ...next };
        await saveSettings(ctx, settings);
        render();
      };
      const check = (checked, label, onChange) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = checked;
        cb.addEventListener('change', () => onChange(cb.checked));
        return h('label', { class: 'check' }, cb, h('span', null, label));
      };
      // две колонки (на широком экране): слева «Фитнес», справа «Медицина»
      modal({
        title: 'Настройки мониторинга',
        wide: true,
        body: h('div', { class: 'mon-set' },
          h('div', { class: 'set-col' },
          h('div', { class: 'set-head' }, 'Фитнес'),
          h('div', { class: 'set-title' }, 'Показатели замеров'),
          ...MEASURES.map(m => check(!hiddenSet().has(m.id), m.name, on => {
            const hidden = hiddenSet();
            if (on) hidden.delete(m.id); else hidden.add(m.id);
            change({ hidden: [...hidden] });
          })),
          h('p', { class: 'muted small' }, 'Отключённый замер не показывается, но уже внесённые значения сохраняются.'),
          h('div', { class: 'set-title' }, 'Правая и левая отдельно'),
          ...GROUPS.map(g => check(!!settings.split[g.id], g.name, on => {
            if (state.form) moveSplitValues(state.form.vals, g.id, on); // набранное в форме переносится
            change({ split: { ...settings.split, [g.id]: on } });
          })),
          h('p', { class: 'muted small' }, 'Руки: бицепс и предплечье. Ноги: бедро и голень. Если выключено, вводится одно общее значение.')),
          h('div', { class: 'set-col' },
          h('div', { class: 'set-head' }, 'Медицина'),
          h('div', { class: 'set-title' }, 'Медицинские показатели'),
          ...MEDICAL.map(m => check(!hiddenSet().has(m.id), m.name, on => {
            const hidden = hiddenSet();
            if (on) hidden.delete(m.id); else hidden.add(m.id);
            change({ hidden: [...hidden] });
          })),
          h('p', { class: 'muted small' }, 'Отключённый показатель не показывается, но уже внесённые записи сохраняются.'))),
      });
    }

    // ---------- ввод ----------
    /** Состояние формы для даты: набранное (если дата та же) или значения сохранённой записи. */
    function formFor(date) {
      if (state.form?.date === date) return state.form;
      const entry = entries.find(e => e.date === date);
      const form = { date, weight: '', fat: '', height: settings.height != null ? String(settings.height) : '', vals: {} };
      if (entry) {
        form.weight = entry.weight != null ? String(entry.weight) : '';
        form.fat = entry.fat != null ? String(entry.fat) : '';
        for (const [k, v] of Object.entries(entry.m ?? {})) form.vals[k] = String(v);
        for (const g of GROUPS) moveSplitValues(form.vals, g.id, !!settings.split[g.id]); // приводим к текущему режиму
      }
      return (state.form = form);
    }

    function renderInput() {
      const form = formFor(state.date);
      const fig = buildFigure(ctx, { onHover: id => markRow(id) });
      fig.setHidden(hiddenSet());
      const list = h('div', { class: 'm-list' });
      const markRow = id => list.querySelectorAll('.m-row').forEach(r => r.classList.toggle('on', r.dataset.k === id));

      const numInput = (get, set, ph, range) => numField(ctx, { get, set, ph, range, onInput: updateEstimate });
      const hint = key => {
        const v = lastValue(entries, e => e.m?.[key], form.date);
        return v != null ? fmtNum(v) : '—';
      };

      // --- процент жира: оценка ---
      const estBox = h('div', { class: 'est' });
      const fatInput = numInput(() => form.fat, v => (form.fat = v), '—', LIMITS.fat);
      function updateEstimate() {
        const cur = k => num(form.vals[k]) ?? lastValue(entries, e => e.m?.[k], form.date);
        const est = estimateFat({
          heightCm: num(form.height),
          weightKg: num(form.weight) ?? lastValue(entries, e => e.weight, form.date),
          waist: cur('waist'), neck: cur('neck'),
        });
        if (!est) {
          estBox.replaceChildren(h('span', { class: 'muted small' }, 'Для оценки укажите рост и вес, а лучше ещё замеры талии и шеи.'));
          return;
        }
        const note = { good: 'По росту, талии и шее (метод ВМС США) с поправкой по другим формулам. Погрешность около ±3–4 %.',
          ok: 'По росту и талии. Добавьте замер шеи — оценка станет точнее.',
          rough: 'Грубая оценка по росту и весу: она не отличает мышцы от жира. Добавьте замеры талии и шеи.' }[est.quality];
        estBox.replaceChildren(
          h('div', { class: 'est-row' },
            h('span', null, 'Оценка: '), h('strong', null, `≈ ${fmtNum(est.value)} %`),
            h('button', { class: 'btn sm', onClick: () => { form.fat = String(est.value).replace('.', ','); fatInput.value = form.fat; fatInput.classList.remove('bad'); } }, 'Подставить')),
          h('span', { class: 'muted small' }, note));
      }

      // --- замеры ---
      function drawMeasures() {
        const rows = visible().map(m => {
          const sided = m.group && settings.split[m.group];
          const field = key => numInput(() => form.vals[key] ?? '', v => (form.vals[key] = v), hint(key), LIMITS.measure);
          const body = sided
            ? h('div', { class: 'm-pair' }, ['r', 'l'].map(s => h('label', { class: 'm-side' }, h('span', { class: 'muted small' }, s === 'r' ? 'П' : 'Л'), field(`${m.id}.${s}`))))
            : field(m.id);
          const r = h('div', { class: 'm-row', 'data-k': m.id }, h('span', { class: 'm-name' }, m.name), body);
          r.addEventListener('pointerenter', () => fig.highlight(m.id));
          r.addEventListener('pointerleave', () => fig.highlight(null));
          r.addEventListener('focusin', () => fig.highlight(m.id));
          r.addEventListener('focusout', () => fig.highlight(null));
          return r;
        });
        list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted small' }, 'Все замеры отключены в настройках.')]));
      }

      async function save() {
        const out = { date: form.date };
        const weight = num(form.weight), fat = num(form.fat), height = num(form.height);
        if (form.weight.trim() && !inRange(weight, LIMITS.weight)) return toast('Проверьте вес');
        if (form.fat.trim() && !inRange(fat, LIMITS.fat)) return toast('Проверьте процент жира');
        if (form.height.trim() && !inRange(height, LIMITS.height)) return toast('Проверьте рост');
        if (weight != null) out.weight = weight;
        if (fat != null) out.fat = fat;
        const m = {};
        // значения отключённых замеров остаются как были
        const hidden = hiddenSet();
        const existing = entries.find(e => e.date === form.date);
        for (const [k, v] of Object.entries(existing?.m ?? {})) if (hidden.has(splitKey(k)[0])) m[k] = v;
        for (const meas of visible()) {
          const keys = meas.group && settings.split[meas.group] ? [`${meas.id}.r`, `${meas.id}.l`] : [meas.id];
          for (const k of keys) {
            const text = form.vals[k];
            if (text == null || !String(text).trim()) continue;
            const v = num(text);
            if (!inRange(v, LIMITS.measure)) return toast(ctx.t('Проверьте замер: {name}', { name: sideLabel(k) }));
            m[k] = v;
          }
        }
        if (Object.keys(m).length) out.m = m;
        if (weight == null && fat == null && !out.m) return toast('Введите хотя бы одно значение');
        if (height != null && height !== settings.height) {
          settings = { ...settings, height };
          await saveSettings(ctx, settings);
        }
        await putEntry(ctx, out);
        entries = await listEntries(ctx);
        state.form = null;
        toast('Сохранено');
        renderInput();
      }

      const date = h('input', { class: 'input', type: 'date', value: form.date, max: dayKey() });
      date.addEventListener('change', () => { if (date.value) { state.date = date.value; renderInput(); } });

      drawMeasures();
      updateEstimate();
      view.replaceChildren(h('div', { class: 'mon-input' },
        h('div', { class: 'card mon-fig' }, fig.el, h('p', { class: 'muted small' }, 'Наведите на линию на схеме, чтобы увидеть, как правильно сделать замер.')),
        h('div', { class: 'mon-form' },
          h('div', { class: 'card mon-main' },
            h('label', { class: 'field' }, h('span', null, 'Дата'), date),
            h('div', { class: 'mon-two' },
              h('label', { class: 'field' }, h('span', null, 'Вес, кг'), numInput(() => form.weight, v => (form.weight = v), hintOf(e => e.weight), LIMITS.weight)),
              h('label', { class: 'field' }, h('span', null, 'Рост, см'), numInput(() => form.height, v => (form.height = v), '—', LIMITS.height))),
            h('label', { class: 'field' }, h('span', null, 'Процент жира, %'), fatInput),
            estBox),
          h('div', { class: 'card' }, h('strong', null, 'Замеры, см'), list),
          h('button', { class: 'btn primary wide', onClick: save }, icon('check', 16), 'Сохранить'))));

      function hintOf(get) {
        const v = lastValue(entries, get, form.date);
        return v != null ? fmtNum(v) : '—';
      }
    }

    // ---------- ввод: медицина ----------
    const pad2 = n => String(n).padStart(2, '0');
    const fmtDateTime = ms => new Date(ms).toLocaleString(ctx.locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const newVital = () => {
      const d = new Date();
      return { id: null, date: dayKey(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, sys: '', dia: '', pulse: '', temp: '' };
    };
    const vitalTs = f => {
      const [y, m, d] = f.date.split('-').map(Number), [hh, mm] = f.time.split(':').map(Number);
      return new Date(y, m - 1, d, hh, mm).getTime();
    };
    const lastVital = key => {
      for (let i = vitals.length - 1; i >= 0; i--) if (vitals[i][key] != null) return vitals[i][key];
      return null;
    };
    /** Краткая строка значений записи: «120/80 мм рт. ст. · 68 уд/мин · 36,6 °C». */
    const vitalBits = v => {
      const hidden = hiddenSet();
      return [
        v.sys != null && !hidden.has('pressure') ? `${v.sys}/${v.dia} ${ctx.t('мм рт. ст.')}` : null,
        v.pulse != null && !hidden.has('pulse') ? `${v.pulse} ${ctx.t('уд/мин')}` : null,
        v.temp != null && !hidden.has('temp') ? `${fmtNum(v.temp)} °C` : null,
      ].filter(Boolean);
    };
    const editVital = v => {
      const d = new Date(v.ts), str = x => (x != null ? String(x) : '');
      state.vform = { id: v.id, date: dayKey(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, sys: str(v.sys), dia: str(v.dia), pulse: str(v.pulse), temp: str(v.temp) };
      state.tab = 'input'; state.cat = 'medical';
      render();
    };
    async function deleteVital(v, after) {
      if (!(await confirmDialog(ctx.t('Удалить запись от {date}?', { date: fmtDateTime(v.ts) }), { okText: 'Удалить', danger: true }))) return;
      await removeVital(ctx, v.id);
      vitals = await listVitals(ctx);
      if (state.vform?.id === v.id) state.vform = null;
      after();
    }

    function renderMedicalInput() {
      const f = (state.vform ??= newVital());
      const hidden = hiddenSet();
      const ph = key => { const v = lastVital(key); return v != null ? fmtNum(v) : '—'; };
      const field = (key, range, int = false) => numField(ctx, { get: () => f[key], set: v => (f[key] = v), ph: ph(key), range, int });
      const date = h('input', { class: 'input', type: 'date', value: f.date, max: dayKey() });
      date.addEventListener('change', () => { if (date.value) f.date = date.value; });
      const time = h('input', { class: 'input', type: 'time', value: f.time });
      time.addEventListener('change', () => { if (time.value) f.time = time.value; });
      const labeled = (title, input) => h('label', { class: 'field' }, h('span', null, title), input);

      async function save() {
        const sys = num(f.sys), dia = num(f.dia), pulse = num(f.pulse), temp = num(f.temp);
        if ((f.sys.trim() || f.dia.trim()) && (sys == null || dia == null)) return toast('Давление вносится парой: верхнее и нижнее');
        if (sys != null && !inRange(sys, LIMITS.sys)) return toast('Проверьте верхнее давление');
        if (dia != null && !inRange(dia, LIMITS.dia)) return toast('Проверьте нижнее давление');
        if (sys != null && dia != null && sys <= dia) return toast('Верхнее давление должно быть больше нижнего');
        if (f.pulse.trim() && !inRange(pulse, LIMITS.pulse)) return toast('Проверьте пульс');
        if (f.temp.trim() && !inRange(temp, LIMITS.temp)) return toast('Проверьте температуру');
        const rec = { ts: vitalTs(f) };
        if (f.id) rec.id = f.id;
        if (sys != null) { rec.sys = sys; rec.dia = dia; }
        if (pulse != null) rec.pulse = pulse;
        if (temp != null) rec.temp = temp;
        // значения отключённых показателей остаются, как были
        const orig = f.id ? vitals.find(v => v.id === f.id) : null;
        for (const m of MEDICAL) if (hidden.has(m.id) && orig) for (const k of m.keys) if (orig[k] != null) rec[k] = orig[k];
        if (rec.sys == null && rec.pulse == null && rec.temp == null) return toast('Введите хотя бы одно значение');
        await putVital(ctx, rec);
        vitals = await listVitals(ctx);
        state.vform = null;
        toast('Сохранено');
        renderMedicalInput();
      }

      const recent = [...vitals].reverse().slice(0, 8);
      const fields = [
        !hidden.has('pressure') ? h('div', { class: 'mon-two' },
          labeled('Верхнее давление', field('sys', LIMITS.sys, true)), labeled('Нижнее давление', field('dia', LIMITS.dia, true))) : null,
        !hidden.has('pulse') ? labeled('Пульс, уд/мин', field('pulse', LIMITS.pulse, true)) : null,
        !hidden.has('temp') ? labeled('Температура, °C', field('temp', LIMITS.temp)) : null,
      ].filter(Boolean);
      view.replaceChildren(h('div', { class: 'mon-med' },
        h('div', { class: 'card mon-main' },
          h('div', { class: 'mon-two' }, labeled('Дата', date), labeled('Время', time)),
          ...(fields.length ? fields : [h('p', { class: 'muted small' }, 'Все медицинские показатели отключены в настройках.')]),
          h('button', { class: 'btn primary wide', onClick: save }, icon('check', 16), 'Сохранить'),
          h('p', { class: 'muted small' }, 'Данные носят справочный характер и не заменяют консультацию врача.')),
        recent.length ? h('div', { class: 'card' }, h('strong', null, 'Последние записи'),
          h('div', { class: 'mon-log' }, recent.map(v => h('div', { class: 'log-row' },
            h('div', { class: 'grow' }, h('strong', null, raw(fmtDateTime(v.ts))), h('span', { class: 'muted small block' }, raw(vitalBits(v).join(' · ')))),
            iconBtn('edit', 'Редактировать', () => editVital(v)),
            iconBtn('trash', 'Удалить', () => deleteVital(v, renderMedicalInput), 'danger'))))) : null));
    }

    // ---------- история ----------
    // Экран «Динамика»: слева плитки показателей (текущее значение, изменение за период, мини-график), справа большой график выбранного.
    // Один ряд фильтров сверху (период) действует на всё ниже.
    const fromMs = () => (state.period ? Date.now() - state.period * DAY : 0);

    /** Показатели обоих разделов, отфильтрованные по выбранному разделу истории. */
    function metricsList() {
      const hidden = hiddenSet();
      const fit = [
        { id: 'weight', cat: 'fitness', name: 'Вес', unit: 'кг', get: e => e.weight, tau: 7 },
        { id: 'fat', cat: 'fitness', name: 'Процент жира', unit: '%', get: e => e.fat, tau: 10 },
        ...visible().map(m => ({ id: m.id, cat: 'fitness', name: m.name, unit: 'см', measure: true, tau: 10 })),
      ];
      const med = MEDICAL.filter(m => !hidden.has(m.id)).map(m => ({ id: m.id, cat: 'medical', name: m.name, unit: m.unit, vital: m.keys, tau: 7 }));
      return [...fit, ...med].filter(m => state.hcat === 'all' || m.cat === state.hcat);
    }

    /** Ряды показателя: тренд считается по всей истории, чтобы он не менялся от выбранного периода; pts — только выбранный период. */
    function seriesOf(metric) {
      if (metric.vital) {
        return metric.vital.filter(k => vitalPoints(vitals, k).length).map(k => {
          const all = withTrend(vitalPoints(vitals, k), metric.tau);
          return {
            key: k, label: VITAL_LABEL[k] ? ctx.t(VITAL_LABEL[k]) : ctx.t(metric.name),
            color: k === 'dia' ? SERIES_COLORS.l : SERIES_COLORS.main, all, pts: all.filter(p => p.t >= fromMs()),
          };
        });
      }
      const keys = metric.measure ? sideKeys(metric.id).filter(k => points(entries, e => e.m?.[k]).length) : [metric.id];
      return keys.map(k => {
        const get = metric.measure ? e => e.m?.[k] : metric.get;
        const all = withTrend(points(entries, get), metric.tau);
        return {
          key: k, label: metric.measure ? sideLabel(k) : ctx.t(metric.name),
          color: metric.measure ? colorOfKey(k) : SERIES_COLORS.main, all, pts: all.filter(p => p.t >= fromMs()),
        };
      });
    }

    function tile(metric, series) {
      const withPts = series.filter(s => s.pts.length);
      const value = withPts.length ? withPts.map(s => fmtNum(s.pts.at(-1).v)).join(' / ') : '—';
      const deltas = series.map(s => (s.pts.length > 1 ? signed(s.pts.at(-1).v - s.pts[0].v) : null));
      const delta = deltas.some(d => d != null) ? deltas.map(d => d ?? '—').join(' / ') : '';
      return h('button', { class: 'tile' + (metric.id === state.metric ? ' on' : '') + (withPts.length ? '' : ' empty'), onClick: () => { state.metric = metric.id; renderHistory(); } },
        h('span', { class: 'tile-name' }, metric.name),
        h('span', { class: 'tile-val' }, raw(value), withPts.length ? h('span', { class: 'muted small' }, metric.unit) : null),
        h('span', { class: 'tile-delta muted small' }, raw(delta)),
        withPts[0]?.pts.length > 1 ? sparkline(withPts[0].pts, { color: withPts[0].color }) : h('span', { class: 'tile-spark-empty' }));
    }

    function mainCard(metric, series) {
      const unit = ctx.t(metric.unit);
      const title = metric.vital ? ctx.t('{name}, {unit}', { name: ctx.t(metric.name), unit }) : metric.measure ? ctx.t('{name}, см', { name: ctx.t(metric.name) }) : metric.id === 'weight' ? ctx.t('Вес, кг') : ctx.t('Процент жира, %');
      // у медицинских записей есть время: в подсказке и таблице показываем дату с временем
      const longDate = metric.vital ? fmtDateTime : ms => fmtDayLong(dayKey(ms));
      const withPts = series.filter(s => s.pts.length);
      const single = series.length === 1;
      const head = h('div', { class: 'dyn-head' }, h('strong', null, title),
        h('div', { class: 'row-gap' },
          single && state.dview === 'chart' ? h('button', { class: 'chip-btn' + (state.trend ? ' on' : ''), onClick: () => { state.trend = !state.trend; renderHistory(); } }, 'Тренд') : null,
          tabs([['chart', 'График'], ['table', 'Таблица']], state.dview, v => { state.dview = v; renderHistory(); })));
      if (!series.length) return h('div', { class: 'card dyn-main' }, head, h('p', { class: 'muted empty' }, 'Данных пока нет. Добавьте запись на вкладке «Ввод».'));
      if (!withPts.length) return h('div', { class: 'card dyn-main' }, head, h('p', { class: 'muted empty' }, 'Нет данных за этот период'));

      const parts = [head];
      if (single) {
        const pts = series[0].pts, vs = pts.map(p => p.v), last = pts.at(-1).v;
        const stat = (label, value) => h('div', { class: 'dyn-stat' }, h('span', { class: 'muted small' }, label), h('strong', null, raw(value)));
        parts.push(h('div', { class: 'dyn-hero' },
          h('span', { class: 'dyn-hero-val' }, raw(fmtNum(last)), h('span', { class: 'muted' }, unit)),
          pts.length > 1 ? h('span', { class: 'muted' }, ctx.t('за период: {d}', { d: signed(last - pts[0].v) })) : null),
        h('div', { class: 'dyn-stats' },
          stat(ctx.t('Мин'), fmtNum(Math.min(...vs))), stat(ctx.t('Макс'), fmtNum(Math.max(...vs))),
          stat(ctx.t('Среднее'), fmtNum(vs.reduce((a, b) => a + b, 0) / vs.length)), stat(ctx.t('Записей'), String(vs.length))));
      } else {
        // несколько рядов (общее / правая / левая, верхнее / нижнее давление): легенда с изменением по каждому
        if (metric.vital) parts.push(h('div', { class: 'dyn-hero' }, h('span', { class: 'dyn-hero-val' }, raw(withPts.map(s => fmtNum(s.pts.at(-1).v)).join(' / ')), h('span', { class: 'muted' }, unit))));
        parts.push(h('div', { class: 'legend' }, withPts.map(s => {
          const first = s.pts[0].v, last = s.pts.at(-1).v;
          const key = h('i', { class: 'dyn-key' });
          key.style.background = s.color;
          return h('span', { class: 'legend-i' }, key, raw(`${s.label}: ${s.pts.length > 1 ? `${fmtNum(first)} → ${fmtNum(last)} (${signed(last - first)})` : fmtNum(last)}`));
        })));
      }

      // ось начинается с первой записи, если данных меньше, чем выбранный период, — иначе слева пустое место
      const firstT = Math.min(...withPts.flatMap(s => s.pts.map(p => p.t)));
      const range = { from: state.period ? Math.max(fromMs(), firstT) : firstT, to: Date.now() };
      const common = { h, series: withPts, fmtNum, showTrend: state.trend };
      parts.push(state.dview === 'table'
        ? dynamicsTable({ ...common, fmtDateLong: longDate, headDate: ctx.t('Дата'), headTrend: ctx.t('Тренд') })
        : dynamicsChart({ ...common, ...range, fmtDate: fmtDay, fmtDateLong: longDate, unit, trendLabel: ctx.t('Тренд'), ariaLabel: title }));
      if (single && state.trend && state.dview === 'chart') {
        parts.push(h('p', { class: 'muted small' }, 'Линия — сглаженный тренд, точки — отдельные записи: суточные колебания не искажают картину.'));
      }
      return h('div', { class: 'card dyn-main' }, ...parts);
    }

    function renderHistory() {
      const cats = tabs([['all', 'Всё'], ['fitness', 'Фитнес'], ['medical', 'Медицина']], state.hcat, c => { state.hcat = c; renderHistory(); });
      const filters = h('div', { class: 'dyn-filters' },
        state.hview === 'dynamics' ? tabs(PERIODS.map(p => [p.days, p.label]), state.period, d => { state.period = d; renderHistory(); }) : h('span'),
        tabs([['dynamics', 'Динамика'], ['log', 'Записи']], state.hview, v => { state.hview = v; renderHistory(); }));
      if (state.hview === 'log') { view.replaceChildren(cats, filters, logHistory()); return; }

      const list = metricsList().map(m => [m, seriesOf(m)]);
      if (!list.length) { view.replaceChildren(cats, filters, h('p', { class: 'muted empty' }, 'Нет включённых показателей. Включите их в настройках.')); return; }
      if (!list.some(([m]) => m.id === state.metric)) state.metric = list[0][0].id;
      const [cur, curSeries] = list.find(([m]) => m.id === state.metric);
      const tiles = [];
      let prevCat = null;
      for (const [m, s] of list) {
        if (state.hcat === 'all' && m.cat !== prevCat) { tiles.push(h('div', { class: 'tile-group' }, m.cat === 'fitness' ? 'Фитнес' : 'Медицина')); prevCat = m.cat; }
        tiles.push(tile(m, s));
      }
      view.replaceChildren(cats, filters, h('div', { class: 'dyn' }, h('div', { class: 'dyn-tiles' }, tiles), mainCard(cur, curSeries)));
    }

    function logHistory() {
      const items = [];
      if (state.hcat !== 'medical') for (const e of entries) items.push({ ts: parseDay(e.date).getTime(), kind: 'fit', e });
      if (state.hcat !== 'fitness') for (const v of vitals) items.push({ ts: v.ts, kind: 'med', v });
      if (!items.length) return h('p', { class: 'muted empty' }, 'Записей пока нет. Добавьте первую на вкладке «Ввод».');
      items.sort((a, b) => b.ts - a.ts);
      const tag = text => (state.hcat === 'all' ? h('span', { class: 'chip' }, text) : null);

      const fitRow = e => {
        const hidden = hiddenSet();
        const n = Object.keys(e.m ?? {}).filter(k => !hidden.has(splitKey(k)[0])).length;
        const bits = [e.weight != null ? `${fmtNum(e.weight)} ${ctx.t('кг')}` : null, e.fat != null ? `${fmtNum(e.fat)} %` : null,
          n ? ctx.t('замеров: {n}', { n }) : null].filter(Boolean);
        return h('div', { class: 'log-row' },
          h('div', { class: 'grow' }, h('strong', null, raw(fmtDayLong(e.date))), h('span', { class: 'muted small block' }, raw(bits.join(' · ')))),
          tag('Фитнес'),
          iconBtn('edit', 'Редактировать', () => { state.date = e.date; state.form = null; state.tab = 'input'; state.cat = 'fitness'; render(); }),
          iconBtn('trash', 'Удалить', async () => {
            if (!(await confirmDialog(ctx.t('Удалить запись от {date}?', { date: fmtDayLong(e.date) }), { okText: 'Удалить', danger: true }))) return;
            await removeEntry(ctx, e.date);
            entries = await listEntries(ctx);
            if (state.form?.date === e.date) state.form = null;
            renderHistory();
          }, 'danger'));
      };
      const medRow = v => h('div', { class: 'log-row' },
        h('div', { class: 'grow' }, h('strong', null, raw(fmtDateTime(v.ts))), h('span', { class: 'muted small block' }, raw(vitalBits(v).join(' · ')))),
        tag('Медицина'),
        iconBtn('edit', 'Редактировать', () => editVital(v)),
        iconBtn('trash', 'Удалить', () => deleteVital(v, renderHistory), 'danger'));

      return h('div', { class: 'mon-log' }, items.map(it => (it.kind === 'fit' ? fitRow(it.e) : medRow(it.v))));
    }

    if (params?.tab) state.tab = params.tab;
    if (params?.hcat) state.hcat = params.hcat;
    if (params?.metric) state.metric = params.metric;
    render();
  },

  // ---------- виджеты для Хаба ----------
  widgets: [
    {
      id: 'weight',
      async render(body, ctx) {
        const { h } = ctx.ui;
        const entries = await listEntries(ctx);
        const pts = points(entries, e => e.weight);
        body.onclick = () => ctx.router.go('monitoring');
        if (!pts.length) {
          body.replaceChildren(h('p', { class: 'muted' }, 'Вес ещё не вносился'));
          return;
        }
        const fmt = v => (Math.round(v * 10) / 10).toLocaleString(ctx.locale);
        const last = pts.at(-1).v;
        const prev = pts.at(-2)?.v;
        const month = pts.filter(p => p.t >= Date.now() - 30 * DAY);
        body.replaceChildren(...[
          h('div', { class: 'big-num' }, fmt(last), h('span', { class: 'muted' }, ctx.t('кг'))),
          prev != null ? h('span', { class: 'muted small' }, ctx.t('к прошлому: {d}', { d: (last - prev > 0 ? '+' : last - prev < 0 ? '−' : '') + fmt(Math.abs(last - prev)) })) : null,
          ctx.size.w >= 2 && month.length > 1 ? sparkline(month) : null,
        ].filter(Boolean));
      },
    },
    {
      id: 'pressure',
      async render(body, ctx) {
        const { h } = ctx.ui;
        const vitals = await listVitals(ctx);
        const last = [...vitals].reverse().find(v => v.sys != null);
        body.onclick = () => ctx.router.go('monitoring', { tab: 'history', hcat: 'medical', metric: 'pressure' });
        if (!last) {
          body.replaceChildren(h('p', { class: 'muted' }, 'Давление ещё не вносилось'));
          return;
        }
        const pulse = [...vitals].reverse().find(v => v.pulse != null)?.pulse;
        body.replaceChildren(...[
          h('div', { class: 'big-num' }, `${last.sys}/${last.dia}`, h('span', { class: 'muted' }, ctx.t('мм рт. ст.'))),
          pulse != null ? h('span', { class: 'muted small' }, ctx.t('Пульс: {n}', { n: pulse })) : null,
        ].filter(Boolean));
      },
    },
  ],
};
