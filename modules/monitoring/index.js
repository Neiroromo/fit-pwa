// Модуль «Мониторинг»: вес, процент жира и замеры тела; история и динамика.

import {
  MEASURES, GROUPS, SIDE_NAME, LIMITS, dayKey, parseDay, num, inRange, measureOf, sideKeys, splitKey,
  listEntries, putEntry, removeEntry, getSettings, saveSettings, lastValue, points,
} from './data.js';
import { estimateFat } from './estimate.js';
import { buildFigure } from './figure.js';
import { dynamicsChart, dynamicsTable, sparkline, withTrend, colorOfKey, SERIES_COLORS } from './charts.js';

const DAY = 86_400_000;
const PERIODS = [
  { days: 30, label: '1 мес' },
  { days: 90, label: '3 мес' },
  { days: 182, label: '6 мес' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё' },
];

/** Оставляет только цифры и один разделитель: до 3 цифр целой части и до 2 дробной. */
function sanitizeNumber(v) {
  const s = String(v).replace(/[^0-9.,]/g, '');
  const i = s.search(/[.,]/);
  if (i < 0) return s.slice(0, 3);
  return s.slice(0, i).slice(0, 3) + s[i] + s.slice(i + 1).replace(/[.,]/g, '').slice(0, 2);
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
    let settings = await getSettings(ctx);
    // form — то, что набрано в форме ввода; хранится здесь, чтобы не потеряться при смене настроек
    const state = { tab: 'input', hview: 'dynamics', metric: 'weight', trend: true, dview: 'chart', period: 90, date: dayKey(), form: null };

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
      page.replaceChildren(
        h('header', { class: 'page-head' }, h('h1', null, 'Мониторинг'), iconBtn('sliders', 'Настройки мониторинга', openSettings)),
        tabs([['input', 'Ввод'], ['history', 'История']], state.tab, t => { state.tab = t; render(); }),
        view);
      if (state.tab === 'input') renderInput(); else renderHistory();
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
      modal({
        title: 'Настройки мониторинга',
        body: h('div', { class: 'mon-set' },
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

      /** Числовое поле: буквы и символы не вводятся, при выходе из поля значение проверяется по диапазону. */
      const numInput = (get, set, ph, range) => {
        const i = h('input', { class: 'input num', inputmode: 'decimal', placeholder: ph, value: get(), autocomplete: 'off', maxlength: '6' });
        i.addEventListener('keydown', e => {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !/[0-9.,]/.test(e.key)) e.preventDefault();
        });
        i.addEventListener('input', () => {
          const clean = sanitizeNumber(i.value);
          if (clean !== i.value) { // вставка или автозаполнение с лишними символами
            const pos = Math.max(0, (i.selectionStart ?? clean.length) - (i.value.length - clean.length));
            i.value = clean;
            i.setSelectionRange(pos, pos);
          }
          i.classList.remove('bad');
          set(i.value);
          updateEstimate();
        });
        i.addEventListener('blur', () => {
          const bad = i.value.trim() !== '' && !inRange(num(i.value), range);
          i.classList.toggle('bad', bad);
          i.title = bad ? ctx.t('Допустимо от {lo} до {hi}', { lo: range[0], hi: range[1] }) : '';
        });
        return i;
      };
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

    // ---------- история ----------
    // Экран «Динамика»: слева плитки показателей (текущее значение, изменение за период, мини-график), справа большой график выбранного.
    // Один ряд фильтров сверху (период) действует на всё ниже.
    const fromMs = () => (state.period ? Date.now() - state.period * DAY : 0);

    function metricsList() {
      return [
        { id: 'weight', name: 'Вес', unit: 'кг', get: e => e.weight, tau: 7 },
        { id: 'fat', name: 'Процент жира', unit: '%', get: e => e.fat, tau: 10 },
        ...visible().map(m => ({ id: m.id, name: m.name, unit: 'см', measure: true, tau: 10 })),
      ];
    }

    /** Ряды показателя: тренд считается по всей истории, чтобы он не менялся от выбранного периода; pts — только выбранный период. */
    function seriesOf(metric) {
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
      const title = metric.measure ? ctx.t('{name}, см', { name: ctx.t(metric.name) }) : metric.id === 'weight' ? ctx.t('Вес, кг') : ctx.t('Процент жира, %');
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
        // несколько рядов (общее / правая / левая): легенда с изменением по каждому
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
        ? dynamicsTable({ ...common, fmtDateLong: ms => fmtDayLong(dayKey(ms)), headDate: ctx.t('Дата'), headTrend: ctx.t('Тренд') })
        : dynamicsChart({ ...common, ...range, fmtDate: fmtDay, fmtDateLong: ms => fmtDayLong(dayKey(ms)), unit, trendLabel: ctx.t('Тренд'), ariaLabel: title }));
      if (single && state.trend && state.dview === 'chart') {
        parts.push(h('p', { class: 'muted small' }, 'Линия — сглаженный тренд, точки — отдельные записи: суточные колебания не искажают картину.'));
      }
      return h('div', { class: 'card dyn-main' }, ...parts);
    }

    function renderHistory() {
      const filters = h('div', { class: 'dyn-filters' },
        state.hview === 'dynamics' ? tabs(PERIODS.map(p => [p.days, p.label]), state.period, d => { state.period = d; renderHistory(); }) : h('span'),
        tabs([['dynamics', 'Динамика'], ['log', 'Записи']], state.hview, v => { state.hview = v; renderHistory(); }));
      if (state.hview === 'log') { view.replaceChildren(filters, logHistory()); return; }

      const list = metricsList().map(m => [m, seriesOf(m)]);
      if (!list.some(([m]) => m.id === state.metric)) state.metric = 'weight';
      const [cur, curSeries] = list.find(([m]) => m.id === state.metric);
      view.replaceChildren(filters, h('div', { class: 'dyn' },
        h('div', { class: 'dyn-tiles' }, list.map(([m, s]) => tile(m, s))),
        mainCard(cur, curSeries)));
    }

    function logHistory() {
      if (!entries.length) return h('p', { class: 'muted empty' }, 'Записей пока нет. Добавьте первую на вкладке «Ввод».');
      return h('div', { class: 'mon-log' }, [...entries].reverse().map(e => {
        const hidden = hiddenSet();
        const n = Object.keys(e.m ?? {}).filter(k => !hidden.has(splitKey(k)[0])).length;
        const bits = [e.weight != null ? `${fmtNum(e.weight)} ${ctx.t('кг')}` : null, e.fat != null ? `${fmtNum(e.fat)} %` : null,
          n ? ctx.t('замеров: {n}', { n }) : null].filter(Boolean);
        return h('div', { class: 'log-row' },
          h('div', { class: 'grow' }, h('strong', null, raw(fmtDayLong(e.date))), h('span', { class: 'muted small block' }, raw(bits.join(' · ')))),
          iconBtn('edit', 'Редактировать', () => { state.date = e.date; state.form = null; state.tab = 'input'; render(); }),
          iconBtn('trash', 'Удалить', async () => {
            if (!(await confirmDialog(ctx.t('Удалить запись от {date}?', { date: fmtDayLong(e.date) }), { okText: 'Удалить', danger: true }))) return;
            await removeEntry(ctx, e.date);
            entries = await listEntries(ctx);
            if (state.form?.date === e.date) state.form = null;
            renderHistory();
          }, 'danger'));
      }));
    }

    if (params?.tab) state.tab = params.tab;
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
  ],
};
