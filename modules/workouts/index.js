// Модуль «Тренировки»: список тренировок, история, редактор, запуск. Календарь — виджет для Хаба.

import { DEFAULT_REST, dayKey, groupByDay, fmtClock, makeFmt, startOfWeek, buildActive } from './data.js';
import { monthGrid } from './calendar.js';
import { openEditor } from './editor.js';
import { openRunner } from './runner.js';
import { openShare, openImport } from './share.js';
import { openHistory } from './history.js';
import { refreshCustom } from './customstore.js';
import { openPicker } from './catalog.js';

export default {
  async mount(page, ctx, params) {
    const { h, icon, iconBtn, confirmDialog, toast, modal } = ctx.ui;
    const { plural } = ctx;
    const fmt = makeFmt(ctx);
    await refreshCustom(ctx); // свои упражнения нужны каталогу, подсказкам, карточкам и импорту
    const templatesCol = ctx.db.collection('templates');
    const sessionsCol = ctx.db.collection('sessions');

    let disposeRunner = null;

    // ---------- главный экран ----------
    async function showHome() {
      disposeRunner?.();
      disposeRunner = null;
      const [templates, sessions, active] = await Promise.all([templatesCol.list(), sessionsCol.list(), ctx.db.kv.get('active')]);
      templates.sort((a, b) => a.createdAt - b.createdAt);

      const listBox = h('div', { class: 'wk-list' });

      page.replaceChildren(...[
        h('header', { class: 'page-head' }, h('h1', null, 'Тренировки'),
          h('div', { class: 'row-gap' },
            iconBtn('dumbbell', 'Все упражнения', () => openPicker(ctx, {})),
            iconBtn('hourglass', 'Настройки модуля', openSettings))),
        active ? activeBanner(active) : null,
        h('div', { class: 'section-head' },
          h('h2', { class: 'section-title' }, 'Мои тренировки'),
          h('div', { class: 'row-gap' },
            iconBtn('history', 'История', showHistory),
            iconBtn('plus', 'Создать тренировку', () => showEditor(null), 'solid'),
            iconBtn('qr', 'Добавить по коду', () => openImport(ctx, { onDone: showHome })))),
        listBox,
      ].filter(Boolean));

      drawList(listBox, templates, sessions, active);
    }

    function activeBanner(active) {
      const t = h('strong', null);
      const upd = () => (t.textContent = fmtClock(((active.pausedAt ?? Date.now()) - active.startedAt - (active.pausedTotal ?? 0)) / 1000));
      upd();
      const iv = setInterval(() => (t.isConnected ? upd() : clearInterval(iv)), 1000);
      return h('button', { class: 'banner', onClick: () => showRunner(active) },
        icon('play', 18), h('span', { class: 'grow' }, ctx.ui.raw(active.name)), t, icon('chevR', 18));
    }

    // ---------- список тренировок ----------
    function drawList(box, templates, sessions, active) {
      if (!templates.length) {
        box.replaceChildren(h('p', { class: 'muted empty' }, 'Пока нет ни одной тренировки. Создайте первую — например, «Грудь и трицепс».'));
        return;
      }
      const lastDone = new Map();
      for (const s of sessions) if (!lastDone.has(s.workoutId) || lastDone.get(s.workoutId) < s.startedAt) lastDone.set(s.workoutId, s.startedAt);

      box.replaceChildren(...templates.map(t => {
        const last = lastDone.get(t.id);
        const remove = async () => {
          if (!(await confirmDialog(ctx.t('Удалить тренировку «{name}»? История выполненных тренировок сохранится.', { name: t.name }), { okText: 'Удалить', danger: true }))) return false;
          await templatesCol.remove(t.id);
          showHome();
          return true;
        };
        const content = h('div', { class: 'wk-content' },
          h('div', { class: 'grow', onClick: () => showEditor(t) },
            h('strong', null, t.name),
            h('span', { class: 'muted small block' },
              `${t.exercises.length} ${plural(t.exercises.length, 'упражнение', 'упражнения', 'упражнений')}` + (last ? ctx.t(' · последняя: {date}', { date: fmt.date(last) }) : ''))),
          t.draft ? null : iconBtn('share', 'Поделиться тренировкой', () => openShare(ctx, t)),
          iconBtn('edit', 'Редактировать', () => showEditor(t)),
          iconBtn('trash', 'Удалить тренировку', remove, 'danger desktop-only'),
          t.draft ? null : iconBtn('play', 'Начать тренировку', () => startWorkout(t, active), 'solid'));
        const row = h('div', { class: 'wk-row' + (t.draft ? ' draft' : '') }, h('div', { class: 'wk-bg' }, icon('trash', 20), 'Удалить'), content);
        swipeToDelete(content, remove);
        return row;
      }));
    }

    /** Зажать и потянуть влево — удалить. Только для касаний: на ПК (мышь) для этого есть кнопка-корзина. */
    function swipeToDelete(el, onCommit) {
      let sx = 0, dx = 0, down = false, moved = false, suppress = false, pid = 0;
      el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' || e.target.closest('button')) return;
        sx = e.clientX; dx = 0; down = true; moved = false; pid = e.pointerId;
      });
      el.addEventListener('pointermove', e => {
        if (!down) return;
        dx = e.clientX - sx;
        if (!moved && Math.abs(dx) > 8) { moved = true; el.setPointerCapture(pid); el.style.transition = 'none'; }
        if (moved) el.style.transform = `translateX(${Math.min(0, dx)}px)`;
      });
      const end = async () => {
        if (!down) return;
        down = false;
        el.style.transition = '';
        if (!moved) return;
        suppress = true;
        setTimeout(() => (suppress = false), 0);
        if (dx < -el.offsetWidth * 0.35) {
          el.style.transform = 'translateX(-30%)';
          if (await onCommit()) return;
        }
        el.style.transform = '';
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
    }

    // ---------- действия ----------
    function showHistory() {
      disposeRunner?.();
      openHistory(page, ctx, { onBack: showHome });
    }

    function showEditor(tpl) {
      disposeRunner?.();
      disposeRunner = openEditor(page, ctx, tpl, { onDone: showHome });
    }

    async function startWorkout(tpl, active) {
      if (active) {
        const resume = await confirmDialog(ctx.t('Уже идёт тренировка «{name}». Вернуться к ней? (Чтобы начать новую, сначала завершите или отмените текущую.)', { name: active.name }), { okText: 'Вернуться', title: 'Тренировка уже запущена' });
        if (resume) showRunner(active);
        return;
      }
      const sessions = await sessionsCol.list();
      const fresh = buildActive(tpl, sessions);
      await ctx.db.kv.set('active', fresh);
      showRunner(fresh);
    }

    async function showRunner(active) {
      const settings = await ctx.db.kv.get('settings', { rest: DEFAULT_REST });
      disposeRunner = openRunner(page, ctx, active, { restDefault: settings.rest, onExit: showHome, onFinish: showHome });
    }

    function openSettings() {
      ctx.db.kv.get('settings', { rest: DEFAULT_REST }).then(settings => {
        const rest = h('input', { class: 'input num', type: 'number', min: '10', max: '600', step: '5', value: String(settings.rest) });
        const m = modal({
          title: 'Настройки тренировок',
          body: h('label', { class: 'field' }, h('span', null, 'Отдых между подходами, сек'), rest),
          actions: [h('button', { class: 'btn primary', onClick: async () => {
            await ctx.db.kv.set('settings', { ...settings, rest: Math.min(600, Math.max(10, parseInt(rest.value, 10) || DEFAULT_REST)) });
            m.close(); toast('Сохранено');
          } }, 'Сохранить')],
        });
      });
    }

    // ---------- вход ----------
    if (params?.create) showEditor(null);
    else if (params?.start) {
      const [tpl, active] = await Promise.all([templatesCol.get(params.start), ctx.db.kv.get('active')]);
      if (active) await showRunner(active);
      else if (tpl && !tpl.draft) await startWorkout(tpl, null);
      else await showHome();
    } else await showHome();

    return () => disposeRunner?.();
  },

  // ---------- виджеты для Хаба ----------
  widgets: [
    {
      id: 'week',
      async render(body, ctx) {
        const { h } = ctx.ui;
        const sessions = await ctx.db.collection('sessions').list();
        const monday = startOfWeek();
        const week = sessions.filter(s => s.startedAt >= monday.getTime());
        const days = makeFmt(ctx).dayNames().map((d, i) => {
          const dt = new Date(monday); dt.setDate(monday.getDate() + i);
          return { d, hit: week.some(s => dayKey(s.startedAt) === dayKey(dt)), today: dayKey(dt) === dayKey(Date.now()) };
        });
        body.replaceChildren(...[
          h('div', { class: 'big-num' }, String(week.length), h('span', { class: 'muted' }, ctx.plural(week.length, 'тренировка', 'тренировки', 'тренировок'))),
          ctx.size.w >= 2 ? h('div', { class: 'week-strip' }, days.map(x =>
            h('div', { class: 'wd' + (x.hit ? ' hit' : '') + (x.today ? ' today' : '') }, h('span', { class: 'dot' }), h('span', { class: 'muted small' }, x.d)))) : null,
        ].filter(Boolean));
        body.onclick = () => ctx.router.go('workouts');
      },
    },
    {
      id: 'month',
      async render(body, ctx) {
        const sessions = await ctx.db.collection('sessions').list();
        const marks = new Map([...groupByDay(sessions)].map(([k, v]) => [k, v.length]));
        const d = new Date();
        body.replaceChildren(monthGrid(ctx, { year: d.getFullYear(), month: d.getMonth(), marks, compact: true }));
        body.onclick = () => ctx.router.go('workouts');
      },
    },
    {
      id: 'quick',
      async render(body, ctx) {
        const { h, icon } = ctx.ui;
        const [templates, active] = await Promise.all([ctx.db.collection('templates').list().then(l => l.filter(t => !t.draft)), ctx.db.kv.get('active')]);
        const limit = ctx.size.h >= 2 ? 5 : 2;
        if (!templates.length && !active) {
          body.replaceChildren(h('button', { class: 'btn', onClick: () => ctx.router.go('workouts', { create: true }) }, icon('plus', 16), 'Создать тренировку'));
          return;
        }
        body.replaceChildren(h('div', { class: 'quick-list' },
          active ? h('button', { class: 'quick-row active', onClick: () => ctx.router.go('workouts', { start: active.workoutId }) },
            h('span', { class: 'grow' }, ctx.t('Идёт: {name}', { name: active.name })), icon('chevR', 16)) : null,
          templates.slice(0, active ? limit - 1 : limit).map(t =>
            h('button', { class: 'quick-row', onClick: () => ctx.router.go('workouts', { start: t.id }) },
              h('span', { class: 'grow' }, t.name), icon('play', 14)))));
      },
    },
  ],
};
