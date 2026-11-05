// Модуль «Мониторинг»: вес, процент жира и замеры тела; история и динамика.

import {
  MEASURES, GROUPS, SIDE_NAME, LIMITS, dayKey, parseDay, num, inRange, measureOf, sideKeys, splitKey,
  listEntries, putEntry, removeEntry, getSettings, saveSettings, lastValue, points,
} from './data.js';
import { estimateFat } from './estimate.js';
import { buildFigure } from './figure.js';
import { lineChart, sparkline, SERIES_COLORS } from './charts.js';

const DAY = 86_400_000;
const PERIODS = [
  { days: 30, label: '1 мес' },
  { days: 90, label: '3 мес' },
  { days: 182, label: '6 мес' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё' },
];

export default {
  async mount(page, ctx, params) {
    const { h, icon, iconBtn, confirmDialog, toast, raw } = ctx.ui;
    let entries = await listEntries(ctx);
    let settings = await getSettings(ctx);
    const state = { tab: 'input', hist: 'body', period: 90, measure: 'biceps', date: dayKey() };

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
        h('header', { class: 'page-head' }, h('h1', null, 'Мониторинг')),
        tabs([['input', 'Ввод'], ['history', 'История']], state.tab, t => { state.tab = t; render(); }),
        view);
      if (state.tab === 'input') renderInput(); else renderHistory();
    }

    // ---------- ввод ----------
    function renderInput() {
      const form = { date: state.date, weight: '', fat: '', height: settings.height != null ? String(settings.height) : '', vals: {} };
      const split = { ...settings.split };
      const entry = entries.find(e => e.date === form.date);
      if (entry) {
        form.weight = entry.weight != null ? String(entry.weight) : '';
        form.fat = entry.fat != null ? String(entry.fat) : '';
        for (const [k, v] of Object.entries(entry.m ?? {})) form.vals[k] = String(v);
        // в записи с раздельными значениями показываем правую и левую стороны
        for (const g of GROUPS) {
          const keys = MEASURES.filter(m => m.group === g.id).flatMap(m => Object.keys(entry.m ?? {}).filter(k => splitKey(k)[0] === m.id));
          if (keys.some(k => splitKey(k)[1])) split[g.id] = true;
          else if (keys.length) split[g.id] = false;
        }
      }

      const fig = buildFigure(ctx, { onHover: id => markRow(id) });
      const list = h('div', { class: 'm-list' });
      const markRow = id => list.querySelectorAll('.m-row').forEach(r => r.classList.toggle('on', r.dataset.k === id));

      const numInput = (get, set, ph, cls = '') => {
        const i = h('input', { class: 'input num ' + cls, inputmode: 'decimal', placeholder: ph, value: get(), autocomplete: 'off' });
        i.addEventListener('input', () => { set(i.value); updateEstimate(); });
        return i;
      };
      const hint = key => {
        const v = lastValue(entries, e => e.m?.[key], form.date);
        return v != null ? fmtNum(v) : '—';
      };

      // --- процент жира: оценка ---
      const estBox = h('div', { class: 'est' });
      const fatInput = numInput(() => form.fat, v => (form.fat = v), '—');
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
            h('button', { class: 'btn sm', onClick: () => { form.fat = String(est.value); fatInput.value = form.fat; } }, 'Подставить')),
          h('span', { class: 'muted small' }, note));
      }

      // --- замеры ---
      function drawMeasures() {
        const rows = [];
        const row = m => {
          const sided = m.group && split[m.group];
          const field = key => numInput(() => form.vals[key] ?? '', v => (form.vals[key] = v), hint(key));
          const body = sided
            ? h('div', { class: 'm-pair' }, ['r', 'l'].map(s => h('label', { class: 'm-side' }, h('span', { class: 'muted small' }, s === 'r' ? 'П' : 'Л'), field(`${m.id}.${s}`))))
            : field(m.id);
          const r = h('div', { class: 'm-row', 'data-k': m.id }, h('span', { class: 'm-name' }, m.name), body);
          r.addEventListener('pointerenter', () => fig.highlight(m.id));
          r.addEventListener('pointerleave', () => fig.highlight(null));
          r.addEventListener('focusin', () => fig.highlight(m.id));
          r.addEventListener('focusout', () => fig.highlight(null));
          return r;
        };
        for (const m of MEASURES.filter(m => !m.group)) rows.push(row(m));
        for (const g of GROUPS) {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = !!split[g.id];
          cb.addEventListener('change', () => { toggleSplit(g.id, cb.checked); });
          rows.push(h('label', { class: 'check m-split' }, cb, h('span', null, ctx.t('{name}: правая и левая отдельно', { name: ctx.t(g.name) }))));
          for (const m of MEASURES.filter(m => m.group === g.id)) rows.push(row(m));
        }
        list.replaceChildren(...rows);
      }

      /** Переключение «вместе / раздельно»: значения переносятся (общее → обе стороны, обе стороны → среднее). */
      function toggleSplit(groupId, on) {
        split[groupId] = on;
        for (const m of MEASURES.filter(m => m.group === groupId)) {
          const [c, r, l] = sideKeys(m.id).map(k => num(form.vals[k]));
          if (on) {
            if (c != null) { form.vals[`${m.id}.r`] = form.vals[`${m.id}.l`] = form.vals[m.id]; }
            delete form.vals[m.id];
          } else {
            const sides = [r, l].filter(v => v != null);
            if (sides.length) form.vals[m.id] = String(Math.round((sides.reduce((a, b) => a + b, 0) / sides.length) * 10) / 10);
            delete form.vals[`${m.id}.r`]; delete form.vals[`${m.id}.l`];
          }
        }
        settings = { ...settings, split: { ...settings.split, [groupId]: on } };
        saveSettings(ctx, settings);
        drawMeasures();
      }

      async function save() {
        const out = { date: form.date };
        const weight = num(form.weight), fat = num(form.fat), height = num(form.height);
        if (form.weight.trim() && !inRange(weight, LIMITS.weight)) return toast('Проверьте вес');
        if (form.fat.trim() && !inRange(fat, LIMITS.fat)) return toast('Проверьте процент жира');
        if (weight != null) out.weight = weight;
        if (fat != null) out.fat = fat;
        const m = {};
        for (const meas of MEASURES) {
          const keys = meas.group && split[meas.group] ? [`${meas.id}.r`, `${meas.id}.l`] : [meas.id];
          for (const k of keys) {
            const raw = form.vals[k];
            if (raw == null || !String(raw).trim()) continue;
            const v = num(raw);
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
              h('label', { class: 'field' }, h('span', null, 'Вес, кг'), numInput(() => form.weight, v => (form.weight = v), hintOf(e => e.weight))),
              h('label', { class: 'field' }, h('span', null, 'Рост, см'), numInput(() => form.height, v => (form.height = v), '—'))),
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
    function renderHistory() {
      const subs = [['body', 'Вес и жир'], ['measures', 'Замеры'], ['log', 'Записи']];
      const head = [tabs(subs, state.hist, t => { state.hist = t; renderHistory(); })];
      if (state.hist !== 'log') head.push(tabs(PERIODS.map(p => [p.days, p.label]), state.period, d => { state.period = d; renderHistory(); }));
      const body = state.hist === 'body' ? bodyHistory() : state.hist === 'measures' ? measuresHistory() : logHistory();
      view.replaceChildren(...head, body);
    }

    const fromMs = () => (state.period ? Date.now() - state.period * DAY : 0);
    /** Границы оси времени: при «Всё» — от первой точки. */
    const range = pts => ({ from: state.period ? fromMs() : Math.min(...pts.map(p => p.t)), to: Date.now() });

    function statLine(pts, unit) {
      if (pts.length < 2) return pts.length ? h('p', { class: 'muted small' }, ctx.t('Сейчас: {v} {unit}', { v: fmtNum(pts.at(-1).v), unit: ctx.t(unit) })) : null;
      const d = pts.at(-1).v - pts[0].v;
      return h('p', { class: 'muted small' }, ctx.t('Сейчас: {v} {unit} · за период: {d}', { v: fmtNum(pts.at(-1).v), unit: ctx.t(unit), d: signed(d) }));
    }

    function chartCard(title, pts, unit) {
      if (!pts.length) return h('div', { class: 'card' }, h('strong', null, title), h('p', { class: 'muted empty' }, 'Нет данных за этот период'));
      const { from, to } = range(pts);
      return h('div', { class: 'card' }, h('strong', null, title), statLine(pts, unit),
        lineChart({ series: [{ color: SERIES_COLORS[0], pts }], from, to, fmtDate: fmtDay, fmtNum, unit: ' ' + ctx.t(unit) }));
    }

    function bodyHistory() {
      return h('div', { class: 'mon-cols' },
        chartCard(ctx.t('Вес'), points(entries, e => e.weight, fromMs()), 'кг'),
        chartCard(ctx.t('Процент жира'), points(entries, e => e.fat, fromMs()), '%'));
    }

    function measuresHistory() {
      const present = id => sideKeys(id).filter(k => points(entries, e => e.m?.[k]).length);
      const chips = h('div', { class: 'size-chips' }, MEASURES.map(m =>
        h('button', { class: 'chip-btn' + (m.id === state.measure ? ' on' : ''), disabled: !present(m.id).length && m.id !== state.measure,
          onClick: () => { state.measure = m.id; renderHistory(); } }, m.name)));

      const keys = sideKeys(state.measure).filter(k => points(entries, e => e.m?.[k], fromMs()).length);
      const series = keys.map((k, i) => ({ key: k, color: SERIES_COLORS[i % SERIES_COLORS.length], pts: points(entries, e => e.m?.[k], fromMs()) }));
      const chart = series.length
        ? h('div', { class: 'card' },
          h('strong', null, ctx.t('{name}, см', { name: ctx.t(measureOf(state.measure).name) })),
          series.length > 1 ? h('div', { class: 'legend' }, series.map(s => h('span', { class: 'legend-i' }, h('i', { style: `background:${s.color}` }), raw(sideLabel(s.key))))) : null,
          lineChart({ series, ...range(series.flatMap(s => s.pts)), fmtDate: fmtDay, fmtNum, unit: ' ' + ctx.t('см') }))
        : h('div', { class: 'card' }, h('p', { class: 'muted empty' }, 'Нет данных за этот период'));

      // изменения всех замеров за период: первое и последнее значение
      const rows = [];
      for (const m of MEASURES) {
        for (const k of sideKeys(m.id)) {
          const pts = points(entries, e => e.m?.[k], fromMs());
          if (!pts.length) continue;
          const first = pts[0].v, last = pts.at(-1).v;
          rows.push(h('button', { class: 'chg-row' + (m.id === state.measure ? ' on' : ''), onClick: () => { state.measure = m.id; renderHistory(); } },
            h('span', { class: 'grow' }, raw(sideLabel(k))),
            pts.length > 1 ? h('span', { class: 'muted' }, `${fmtNum(first)} → ${fmtNum(last)}`) : h('span', { class: 'muted' }, fmtNum(last)),
            pts.length > 1 ? h('strong', { class: last > first ? 'up' : last < first ? 'down' : '' }, signed(last - first)) : h('span')));
        }
      }
      return h('div', { class: 'mon-cols' }, h('div', null, chips, chart),
        h('div', { class: 'card' }, h('strong', null, 'Изменения за период'),
          rows.length ? h('div', { class: 'chg-list' }, rows) : h('p', { class: 'muted empty' }, 'Нет данных за этот период')));
    }

    function logHistory() {
      if (!entries.length) return h('p', { class: 'muted empty' }, 'Записей пока нет. Добавьте первую на вкладке «Ввод».');
      return h('div', { class: 'mon-log' }, [...entries].reverse().map(e => {
        const n = Object.keys(e.m ?? {}).length;
        const bits = [e.weight != null ? `${fmtNum(e.weight)} ${ctx.t('кг')}` : null, e.fat != null ? `${fmtNum(e.fat)} %` : null,
          n ? ctx.t('замеров: {n}', { n }) : null].filter(Boolean);
        return h('div', { class: 'log-row' },
          h('div', { class: 'grow' }, h('strong', null, raw(fmtDayLong(e.date))), h('span', { class: 'muted small block' }, raw(bits.join(' · ')))),
          iconBtn('edit', 'Редактировать', () => { state.date = e.date; state.tab = 'input'; render(); }),
          iconBtn('trash', 'Удалить', async () => {
            if (!(await confirmDialog(ctx.t('Удалить запись от {date}?', { date: fmtDayLong(e.date) }), { okText: 'Удалить', danger: true }))) return;
            await removeEntry(ctx, e.date);
            entries = await listEntries(ctx);
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
