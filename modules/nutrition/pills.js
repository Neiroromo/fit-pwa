// Таблетки: расписание (время, дни недели, курс), отметки приёма с датой и временем, статусы «принято / пора / пропущено», журнал.

import {
  dayKey, fill, parseDay, listPillLog, listPills, putPill, putPillLog, removeWithUndo, pillDay, slotsOn, WEEKDAYS,
} from './data.js';

const pad = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const timeOf = (ctx, ts) => new Date(ts).toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' });

/** Отметки одной таблетки за день по возрастанию времени. */
export function logsOfDay(pillLog, pillId, date) {
  const start = parseDay(date).getTime(), end = start + 86_400_000;
  return pillLog.filter(r => r.pillId === pillId && r.ts >= start && r.ts < end).sort((a, b) => a.ts - b.ts);
}

/** Карточка раздела «Таблетки» для выбранного дня. env: {ctx, date, render}. */
export function pillsCard(env, pills, pillLog) {
  const { ctx, date, render } = env;
  const { h, icon, iconBtn, raw } = ctx.ui;
  const today = date === dayKey();
  const dayStart = parseDay(date).getTime();
  const take = async (pill, ts) => { await putPillLog(ctx, { pillId: pill.id, ts }); render(); };

  const rows = pills.map(p => {
    const logs = logsOfDay(pillLog, p.id, date);
    const { slots, extra } = pillDay(p, date, logs);
    const scheduled = slotsOn(p, date).length > 0;
    const hasSchedule = (p.times ?? []).length > 0;
    const chips = [];
    for (const s of slots) {
      const label = s.status === 'done' ? `${s.time} · ${timeOf(ctx, s.log.ts)}` : s.time;
      const text = { done: null, due: ctx.t('пора'), missed: ctx.t('пропущено'), upcoming: null }[s.status];
      chips.push(h('button', {
        type: 'button', class: `chip-btn slot ${s.status}`,
        title: s.status === 'done' ? ctx.t('Изменить отметку') : ctx.t('Отметить принятой'),
        onClick: () => (s.log ? editMark(env, s.log, p) : take(p, today ? Date.now() : s.ts)),
      }, icon(s.status === 'done' ? 'check' : s.status === 'upcoming' ? 'clock' : 'flag', 12), raw(label), text ? h('span', { class: 'slot-t' }, text) : null));
    }
    for (const r of extra) chips.push(h('button', { type: 'button', class: 'chip-btn slot extra', title: ctx.t('Изменить отметку'), onClick: () => editMark(env, r, p) }, icon('check', 12), raw(timeOf(ctx, r.ts))));
    const nothing = !chips.length;
    return h('div', { class: 'nut-pill' },
      h('div', { class: 'grow' }, h('strong', null, raw(p.name)), p.dose ? h('span', { class: 'muted small block' }, raw(p.dose)) : null,
        chips.length ? h('div', { class: 'row-gap wrap nut-times' }, chips) : h('span', { class: 'muted small block' }, hasSchedule && !scheduled ? 'В этот день не нужно' : 'Сегодня не принято')),
      iconBtn('clock', 'Отметить с другим временем', () => editMark(env, null, p)),
      h('button', { class: 'btn sm primary', onClick: () => {
        const next = slots.find(s => !s.log);
        take(p, today ? Date.now() : (next ? next.ts : dayStart + 12 * 3_600_000));
      } }, icon('check', 14), 'Принял'));
  });
  return h('section', { class: 'card nut-pills' },
    h('div', { class: 'nut-sec-head' }, icon('pill', 20), h('strong', { class: 'grow' }, 'Таблетки'),
      iconBtn('history', 'Журнал приёма', () => openPillJournal(env, pills)),
      iconBtn('edit', 'Список таблеток', () => openPillList(env, pills))),
    rows.length ? h('div', { class: 'nut-pill-list' }, rows) : h('p', { class: 'muted' }, 'Добавьте таблетки, которые нужно принимать, кнопкой со значком карандаша.'));
}

/** Отметка приёма с датой и временем: новая (rec нет) или правка существующей. */
export function editMark(env, rec, pill) {
  const { ctx, date, render } = env;
  const { h, modal, toast } = ctx.ui;
  const input = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(rec?.ts ?? (date === dayKey() ? Date.now() : parseDay(date).getTime() + 12 * 3_600_000)), max: toLocalInput(Date.now() + 86_400_000) });
  const m = modal({
    title: pill.name,
    body: h('div', { class: 'form' }, h('span', { class: 'muted small' }, 'Дата и время приёма'), input),
    actions: [
      rec ? h('button', { class: 'btn danger', onClick: () => { m.close(); removeWithUndo(ctx, 'pilllog', rec, 'Отметка удалена', render); } }, 'Удалить') : null,
      h('button', { class: 'btn primary', onClick: async () => {
        const ts = new Date(input.value).getTime();
        if (!Number.isFinite(ts)) return toast('Укажите дату и время');
        await putPillLog(ctx, { ...(rec ? { id: rec.id } : {}), pillId: pill.id, ts });
        m.close();
        render();
      } }, 'Сохранить'),
    ].filter(Boolean),
  });
}

export async function openPillJournal(env, pills) {
  const { ctx, render } = env;
  const { h, iconBtn, modal, raw } = ctx.ui;
  const body = h('div', { class: 'form' });
  const draw = async () => {
    const log = (await listPillLog(ctx)).sort((a, b) => b.ts - a.ts).slice(0, 200);
    const name = id => pills.find(p => p.id === id)?.name ?? ctx.t('(удалена)');
    fill(body, ...(log.length ? log.map(r => h('div', { class: 'nut-logrow' },
      h('div', { class: 'grow' }, h('strong', null, raw(name(r.pillId))),
        h('span', { class: 'muted small block' }, raw(new Date(r.ts).toLocaleString(ctx.locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })))),
      iconBtn('trash', 'Удалить', () => removeWithUndo(ctx, 'pilllog', r, 'Отметка удалена', () => { draw(); render(); }), 'danger'))) : [h('p', { class: 'muted' }, 'Отметок пока нет.')]));
  };
  modal({ title: 'Журнал приёма таблеток', wide: true, body });
  draw();
}

/** Список таблеток с расписанием: время, дни недели, курс. Изменения сохраняются сразу. */
export function openPillList(env, pills) {
  const { ctx, render } = env;
  const { h, icon, iconBtn, modal } = ctx.ui;
  const body = h('div', { class: 'form' });
  let list = [...pills];
  const draw = () => {
    fill(body, 
      ...list.map(p => {
        const save = () => putPill(ctx, p);
        const name = h('input', { class: 'input', value: p.name, placeholder: 'Название', maxlength: '60' });
        const dose = h('input', { class: 'input', value: p.dose ?? '', placeholder: 'Дозировка, напр. 1 таб.', maxlength: '60' });
        name.addEventListener('change', () => { if (name.value.trim()) { p.name = name.value.trim(); save(); } });
        dose.addEventListener('change', () => { p.dose = dose.value.trim(); save(); });

        const times = h('div', { class: 'row-gap wrap' });
        const drawTimes = () => {
          fill(times, ...(p.times ?? []).map((t, i) => {
            const inp = h('input', { class: 'input time', type: 'time', value: t });
            inp.addEventListener('change', () => { if (inp.value) { p.times[i] = inp.value; save(); } });
            return h('span', { class: 'nut-time' }, inp, iconBtn('x', 'Убрать время', () => { p.times.splice(i, 1); save(); drawTimes(); }));
          }), h('button', { type: 'button', class: 'chip-btn', onClick: () => { p.times = [...(p.times ?? []), '09:00']; save(); drawTimes(); } }, icon('plus', 12), 'Время'));
        };
        drawTimes();

        const days = h('div', { class: 'size-chips' });
        const drawDays = () => fill(days, ...WEEKDAYS.map((d, i) => {
          const on = !(p.days?.length) || p.days.includes(i);
          return h('button', { type: 'button', class: 'chip-btn' + (on ? ' on' : ''), onClick: () => {
            const cur = new Set(p.days?.length ? p.days : [0, 1, 2, 3, 4, 5, 6]);
            if (cur.has(i)) cur.delete(i); else cur.add(i);
            p.days = cur.size === 7 || cur.size === 0 ? [] : [...cur].sort();
            save(); drawDays();
          } }, d);
        }));
        drawDays();

        const from = h('input', { class: 'input', type: 'date', value: p.from ?? '' });
        const to = h('input', { class: 'input', type: 'date', value: p.to ?? '' });
        from.addEventListener('change', () => { p.from = from.value; save(); });
        to.addEventListener('change', () => { p.to = to.value; save(); });

        return h('div', { class: 'nut-pill-edit' },
          h('div', { class: 'grow nut-pill-fields' },
            name, dose,
            h('span', { class: 'nf-sub' }, 'Время приёма'), times,
            h('span', { class: 'nf-sub' }, 'Дни недели'), days,
            h('div', { class: 'nf-grid' },
              h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Курс с'), from),
              h('label', { class: 'nf-cell' }, h('span', { class: 'muted small' }, 'Курс по'), to))),
          iconBtn('trash', 'Удалить', () => removeWithUndo(ctx, 'pills', p, 'Таблетка удалена', async () => { list = await listPills(ctx); draw(); render(); }), 'danger'));
      }),
      h('button', { class: 'btn', onClick: async () => {
        const rec = await putPill(ctx, { name: ctx.t('Новая таблетка'), dose: '', order: list.length, times: [], days: [] });
        list.push(rec); draw(); render();
      } }, icon('plus', 16), 'Добавить таблетку'));
  };
  modal({ title: 'Таблетки', wide: true, body, onClose: () => render() });
  draw();
}
