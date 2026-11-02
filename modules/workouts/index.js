// Модуль «Тренировки»: календарь + статистика, список тренировок, редактор, запуск.

import { DEFAULT_REST, dayKey, groupByDay, fmtClock, fmtHuman, fmtDate, fmtWeekday, fmtSet, sessionTotals, startOfWeek, buildActive, DAYS } from './data.js';
import { monthGrid } from './calendar.js';
import { openEditor } from './editor.js';
import { openRunner } from './runner.js';

const plural = (n, one, few, many) => {
  const m = n % 100, d = n % 10;
  return m > 10 && m < 15 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many;
};

export default {
  async mount(page, ctx, params) {
    const { h, icon, iconBtn, confirmDialog, toast, modal } = ctx.ui;
    const templatesCol = ctx.db.collection('templates');
    const sessionsCol = ctx.db.collection('sessions');

    let disposeRunner = null;
    const now = new Date();
    const calState = { year: now.getFullYear(), month: now.getMonth(), expanded: false, day: null, openSession: null };

    // ---------- главный экран ----------
    async function showHome() {
      disposeRunner?.();
      disposeRunner = null;
      const [templates, sessions, active] = await Promise.all([templatesCol.list(), sessionsCol.list(), ctx.db.kv.get('active')]);
      templates.sort((a, b) => a.createdAt - b.createdAt);

      const calBox = h('div', { class: 'card cal-card' });
      const listBox = h('div', { class: 'wk-list' });

      page.replaceChildren(
        h('header', { class: 'page-head' }, h('h1', null, 'Тренировки'),
          iconBtn('sliders', 'Настройки модуля', openSettings)),
        active ? activeBanner(active) : null,
        calBox,
        h('button', { class: 'btn primary wide', onClick: () => showEditor(null) }, icon('plus', 18), 'Создать тренировку'),
        h('h2', { class: 'section-title' }, 'Мои тренировки'),
        listBox,
      );

      drawCalendar(calBox, sessions);
      drawList(listBox, templates, sessions, active);
    }

    function activeBanner(active) {
      const t = h('strong', null);
      const upd = () => (t.textContent = fmtClock((Date.now() - active.startedAt) / 1000));
      upd();
      const iv = setInterval(() => (t.isConnected ? upd() : clearInterval(iv)), 1000);
      return h('button', { class: 'banner', onClick: () => showRunner(active) },
        icon('play', 18), h('span', { class: 'grow' }, `Идёт тренировка «${active.name}»`), t, icon('chevR', 18));
    }

    // ---------- календарь ----------
    function drawCalendar(box, sessions) {
      const marks = new Map([...groupByDay(sessions)].map(([k, v]) => [k, v.length]));
      const { year, month, expanded } = calState;
      const shift = d => {
        const dt = new Date(year, month + d, 1);
        calState.year = dt.getFullYear(); calState.month = dt.getMonth(); calState.day = null; calState.openSession = null;
        drawCalendar(box, sessions);
      };
      const zone = h('div', { class: 'cal-zone', role: 'button', tabindex: '0', 'aria-expanded': String(expanded), onClick: toggle },
        monthGrid(ctx.ui, {
          year, month, marks, nav: { onPrev: () => shift(-1), onNext: () => shift(1) },
          onDay: expanded ? (key, n) => { calState.day = calState.day === key ? null : key; drawCalendar(box, sessions); } : null,
        }),
        h('div', { class: 'cal-toggle muted small' }, expanded ? 'Свернуть' : 'Нажмите, чтобы увидеть статистику', icon(expanded ? 'chevU' : 'chevD', 16)));
      zone.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && e.target === zone && (e.preventDefault(), toggle()));
      function toggle() { calState.expanded = !calState.expanded; drawCalendar(box, sessions); }

      box.replaceChildren(zone);
      if (!expanded) return;

      const monthSessions = sessions
        .filter(s => { const d = new Date(s.startedAt); return d.getFullYear() === year && d.getMonth() === month; })
        .sort((a, b) => b.startedAt - a.startedAt);
      const shown = calState.day ? monthSessions.filter(s => dayKey(s.startedAt) === calState.day) : monthSessions;
      const totals = sessionTotals(monthSessions);

      box.append(h('div', { class: 'cal-stats' },
        h('div', { class: 'stat-row' },
          h('div', null, h('strong', null, String(totals.count)), h('span', { class: 'muted small' }, plural(totals.count, 'тренировка', 'тренировки', 'тренировок'))),
          h('div', null, h('strong', null, totals.sec ? fmtHuman(totals.sec) : '—'), h('span', { class: 'muted small' }, 'всего времени'))),
        calState.day ? h('button', { class: 'link', onClick: () => { calState.day = null; drawCalendar(box, sessions); } }, `Показан день ${calState.day.split('-').reverse().join('.')} · показать весь месяц`) : null,
        shown.length ? shown.map(s => sessionItem(s, box, sessions)) : h('p', { class: 'muted empty' }, 'В этом периоде тренировок нет')));
    }

    function sessionItem(s, box, sessions) {
      const open = calState.openSession === s.id;
      return h('div', { class: 'sess' + (open ? ' open' : '') },
        h('button', { class: 'sess-head', onClick: () => { calState.openSession = open ? null : s.id; drawCalendar(box, sessions); } },
          h('span', { class: 'sess-date' }, h('strong', null, fmtDate(s.startedAt)), h('span', { class: 'muted small' }, fmtWeekday(s.startedAt))),
          h('span', { class: 'grow' }, s.name),
          h('span', { class: 'muted' }, fmtHuman(s.durationSec)),
          icon(open ? 'chevU' : 'chevD', 16)),
        open ? h('div', { class: 'sess-body' }, s.exercises.map(ex =>
          h('div', { class: 'sess-ex' },
            h('strong', null, ex.name), ex.comment ? h('span', { class: 'muted small' }, ' · ' + ex.comment) : null,
            h('div', { class: 'sess-sets' }, ex.sets.map((x, i) =>
              h('div', { class: 'sess-set' },
                h('span', { class: 'muted' }, x.kind === 'warmup' ? 'Разминка' : `Сет ${ex.sets.slice(0, i + 1).filter(y => y.kind === 'work').length}`),
                h('span', null, fmtSet(x)),
                h('span', { class: 'muted small' }, x.restSec != null ? `отдых ${fmtClock(x.restSec)}` : '')))))))
        : null);
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
        const content = h('div', { class: 'wk-content' },
          h('div', { class: 'grow', onClick: () => showEditor(t) },
            h('strong', null, t.name),
            h('span', { class: 'muted small block' },
              `${t.exercises.length} ${plural(t.exercises.length, 'упражнение', 'упражнения', 'упражнений')}` + (last ? ` · последняя: ${fmtDate(last)}` : ''))),
          iconBtn('edit', 'Редактировать', () => showEditor(t)),
          h('button', { class: 'btn primary', onClick: () => startWorkout(t, active) }, icon('play', 14), 'Start'));
        const row = h('div', { class: 'wk-row' }, h('div', { class: 'wk-bg' }, icon('trash', 20), 'Удалить'), content);
        swipeToDelete(content, async () => {
          if (!(await confirmDialog(`Удалить тренировку «${t.name}»? История выполненных тренировок сохранится.`, { okText: 'Удалить', danger: true }))) return false;
          await templatesCol.remove(t.id);
          showHome();
          return true;
        });
        return row;
      }));
    }

    /** Зажать и потянуть влево — удалить. */
    function swipeToDelete(el, onCommit) {
      let sx = 0, dx = 0, down = false, moved = false, suppress = false, pid = 0;
      el.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
    function showEditor(tpl) {
      disposeRunner?.();
      openEditor(page, ctx, tpl, { onDone: showHome });
    }

    async function startWorkout(tpl, active) {
      if (active) {
        const resume = await confirmDialog(`Уже идёт тренировка «${active.name}». Вернуться к ней? (Чтобы начать новую, сначала завершите или отмените текущую.)`, { okText: 'Вернуться', title: 'Тренировка уже запущена' });
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
      else if (tpl) await startWorkout(tpl, null);
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
        const days = DAYS.map((d, i) => {
          const dt = new Date(monday); dt.setDate(monday.getDate() + i);
          return { d, hit: week.some(s => dayKey(s.startedAt) === dayKey(dt)), today: dayKey(dt) === dayKey(Date.now()) };
        });
        body.replaceChildren(
          h('div', { class: 'big-num' }, String(week.length), h('span', { class: 'muted' }, plural(week.length, 'тренировка', 'тренировки', 'тренировок'))),
          ctx.size.w >= 2 ? h('div', { class: 'week-strip' }, days.map(x =>
            h('div', { class: 'wd' + (x.hit ? ' hit' : '') + (x.today ? ' today' : '') }, h('span', { class: 'dot' }), h('span', { class: 'muted small' }, x.d)))) : null);
        body.onclick = () => ctx.router.go('workouts');
      },
    },
    {
      id: 'month',
      async render(body, ctx) {
        const sessions = await ctx.db.collection('sessions').list();
        const marks = new Map([...groupByDay(sessions)].map(([k, v]) => [k, v.length]));
        const d = new Date();
        body.replaceChildren(monthGrid(ctx.ui, { year: d.getFullYear(), month: d.getMonth(), marks, compact: true }));
        body.onclick = () => ctx.router.go('workouts');
      },
    },
    {
      id: 'quick',
      async render(body, ctx) {
        const { h, icon } = ctx.ui;
        const [templates, active] = await Promise.all([ctx.db.collection('templates').list(), ctx.db.kv.get('active')]);
        const limit = ctx.size.h >= 2 ? 5 : 2;
        if (!templates.length && !active) {
          body.replaceChildren(h('button', { class: 'btn', onClick: () => ctx.router.go('workouts', { create: true }) }, icon('plus', 16), 'Создать тренировку'));
          return;
        }
        body.replaceChildren(h('div', { class: 'quick-list' },
          active ? h('button', { class: 'quick-row active', onClick: () => ctx.router.go('workouts', { start: active.workoutId }) },
            h('span', { class: 'grow' }, `Идёт: ${active.name}`), icon('chevR', 16)) : null,
          templates.slice(0, active ? limit - 1 : limit).map(t =>
            h('button', { class: 'quick-row', onClick: () => ctx.router.go('workouts', { start: t.id }) },
              h('span', { class: 'grow' }, t.name), icon('play', 14)))));
      },
    },
  ],
};
