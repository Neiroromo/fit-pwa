// Окно идущей тренировки: общий таймер, упражнения, подходы, таймер отдыха.
// Состояние (active) сохраняется в kv после каждого изменения — тренировка переживает перезагрузку.

import { fmtClock, beep } from './data.js';

export function openRunner(el, ctx, s, { restDefault, onExit, onFinish }) {
  const { h, icon, iconBtn, confirmDialog, modal, toast, dismissable } = ctx.ui;

  let saveTimer;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 150); };
  const flush = () => { clearTimeout(saveTimer); return ctx.db.kv.set('active', s); };

  const totalEl = h('span', { class: 'run-total' });
  const restBar = h('div', { class: 'rest-bar', hidden: true });
  const list = h('div', { class: 'run-list' });
  let restTime = null;
  let rows = []; // [{row, set}] для подсветки текущего подхода

  // ---------- таймер отдыха ----------
  function startRest(exIdx, setIdx) {
    s.rest = { start: Date.now(), total: restDefault, ex: exIdx, set: setIdx, notified: false };
    renderRest();
  }

  function stopRest() {
    const r = s.rest;
    if (!r) return;
    const set = s.exercises[r.ex]?.sets[r.set];
    if (set) set.restSec = Math.round((Date.now() - r.start) / 1000);
    s.rest = null;
    renderRest();
    save();
  }

  function renderRest() {
    const r = s.rest;
    restBar.hidden = !r;
    if (!r) { restTime = null; return; }
    restTime = h('strong', { class: 'rest-time' });
    restBar.replaceChildren(
      h('span', { class: 'muted' }, 'Отдых'),
      restTime,
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn sm', onClick: () => { r.total = Math.max(5, r.total - 15); save(); tick(); } }, '−15'),
        h('button', { class: 'btn sm', onClick: () => { r.total += 15; r.notified = false; save(); tick(); } }, '+15'),
        h('button', { class: 'btn sm primary', onClick: stopRest }, icon('skip', 14), 'Пропустить')));
    tick();
    save();
  }

  function tick() {
    totalEl.textContent = fmtClock((Date.now() - s.startedAt) / 1000);
    const r = s.rest;
    if (r && restTime) {
      const left = r.total - (Date.now() - r.start) / 1000;
      restTime.textContent = left > 0 ? fmtClock(Math.ceil(left)) : '+' + fmtClock(-left);
      restBar.classList.toggle('over', left <= 0);
      if (left <= 0 && !r.notified) { r.notified = true; beep(); save(); }
    }
  }
  const interval = setInterval(tick, 250);

  // ---------- упражнения ----------
  function markCurrent(scroll = false) {
    const cur = rows.find(r => !r.set.done);
    rows.forEach(r => r.row.classList.toggle('current', r === cur));
    if (scroll && cur) cur.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function setRow(ex, exIdx, set, idx, label) {
    const kg = h('input', { class: 'input num', type: 'number', inputmode: 'decimal', step: '0.5', min: '0', value: String(set.kg), 'aria-label': 'Вес, кг' });
    const reps = h('input', { class: 'input num', type: 'number', inputmode: 'numeric', step: '1', min: '0', value: String(set.reps), 'aria-label': 'Повторения' });
    kg.addEventListener('input', () => { set.kg = parseFloat(kg.value) || 0; save(); });
    reps.addEventListener('input', () => { set.reps = parseInt(reps.value, 10) || 0; save(); });
    kg.addEventListener('focus', () => kg.select());
    reps.addEventListener('focus', () => reps.select());
    const btn = h('button', { class: 'done-btn' + (set.done ? ' on' : ''), 'aria-label': 'Отметить выполненным' }, icon('check', 20));
    const row = h('div', { class: 'set-row' + (set.kind === 'warmup' ? ' warmup' : '') + (set.done ? ' done' : '') },
      h('span', { class: 'set-label' }, label),
      h('span', { class: 'set-prev muted' }, set.prevKg != null ? `${set.prevKg} × ${set.prevReps}` : '—'),
      kg, reps, btn);
    btn.addEventListener('click', () => {
      set.kg = parseFloat(kg.value) || 0;
      set.reps = parseInt(reps.value, 10) || 0;
      set.done = !set.done;
      row.classList.toggle('done', set.done);
      btn.classList.toggle('on', set.done);
      if (set.done) {
        stopRest(); // фиксирует фактическую длительность предыдущего отдыха
        if (set.kind === 'work') startRest(exIdx, idx); // разминка — сразу к следующему сету
      } else if (s.rest && s.rest.ex === exIdx && s.rest.set === idx) {
        stopRest();
      }
      save();
      markCurrent(set.done);
    });
    rows.push({ row, set });
    return row;
  }

  function exerciseCard(ex, exIdx) {
    let work = 0;
    const menuBtn = iconBtn('more', 'Настройки упражнения', () => openMenu(menuBtn, ex));
    const commentEl = h('span', { class: 'ex-comment' }, ex.comment ? ex.comment : '');
    return h('section', { class: 'card run-ex' },
      h('div', { class: 'run-ex-head' },
        h('div', { class: 'grow' }, h('strong', null, ex.name), commentEl),
        menuBtn),
      h('div', { class: 'set-head muted small' }, h('span', null, 'Сет'), h('span', null, 'Прошлый раз'), h('span', null, 'Кг'), h('span', null, 'Повт.'), h('span')),
      ...ex.sets.map((set, i) => setRow(ex, exIdx, set, i, set.kind === 'warmup' ? 'Р' : String(++work))));
  }

  function openMenu(anchor, ex) {
    document.querySelector('.menu')?.remove();
    const menu = h('div', { class: 'menu' });
    const close = dismissable(menu, { ignore: [anchor] });
    const item = (text, fn) => h('button', { class: 'menu-row', onClick: () => { close(); fn(); } }, text);
    menu.append(
      item(ex.comment ? 'Изменить комментарий' : 'Добавить комментарий', () => editComment(ex)),
      item('Добавить подход', () => {
        const last = ex.sets.at(-1);
        ex.sets.push({ kind: 'work', prevKg: null, prevReps: null, kg: last?.kg ?? 0, reps: last?.reps ?? 0, done: false, restSec: null });
        renderList(); save();
      }),
      item('Убрать последний подход', () => {
        if (ex.sets.length <= 1) return toast('В упражнении должен остаться хотя бы один подход');
        ex.sets.pop(); renderList(); save();
      }));
    anchor.parentElement.append(menu);
  }

  function editComment(ex) {
    const input = h('input', { class: 'input', value: ex.comment, placeholder: 'Например: узкий хват, пауза внизу', maxlength: '120' });
    const m = modal({
      title: 'Комментарий',
      body: input,
      actions: [h('button', { class: 'btn primary', onClick: () => { ex.comment = input.value.trim(); m.close(); renderList(); save(); } }, 'Сохранить')],
    });
    input.focus();
    input.addEventListener('keydown', e => e.key === 'Enter' && m.el.querySelector('.btn.primary').click());
  }

  function renderList() {
    rows = [];
    list.replaceChildren(...s.exercises.map(exerciseCard));
    markCurrent();
  }

  // ---------- завершение ----------
  async function finish() {
    const hasDone = s.exercises.some(ex => ex.sets.some(x => x.done));
    const ok = await confirmDialog(
      hasDone ? 'Завершить тренировку и сохранить результаты? Неотмеченные подходы не сохранятся.' : 'Нет ни одного отмеченного подхода. Завершить без сохранения?',
      { okText: 'Завершить' });
    if (!ok) return;
    stopRest();
    const endedAt = Date.now();
    if (hasDone) {
      await ctx.db.collection('sessions').put({
        workoutId: s.workoutId, name: s.name, startedAt: s.startedAt, endedAt,
        durationSec: Math.round((endedAt - s.startedAt) / 1000),
        exercises: s.exercises
          .map(ex => ({ name: ex.name, comment: ex.comment, sets: ex.sets.filter(x => x.done).map(({ kind, kg, reps, restSec }) => ({ kind, kg, reps, restSec })) }))
          .filter(ex => ex.sets.length),
      });
      ctx.notify(`Тренировка «${s.name}» завершена: ${fmtClock((endedAt - s.startedAt) / 1000)}`);
    }
    await ctx.db.kv.set('active', null);
    dispose(false);
    onFinish();
  }

  async function cancel() {
    if (!(await confirmDialog('Отменить тренировку? Все введённые данные будут потеряны.', { okText: 'Отменить тренировку', danger: true }))) return;
    await ctx.db.kv.set('active', null);
    dispose(false);
    onFinish();
  }

  let disposed = false;
  function dispose(keep = true) {
    if (disposed) return;
    disposed = true;
    clearInterval(interval);
    clearTimeout(saveTimer);
    if (keep) flush();
  }

  renderList();
  renderRest();
  tick();
  el.replaceChildren(
    h('header', { class: 'run-head' },
      iconBtn('chevL', 'Свернуть (тренировка продолжится)', () => { dispose(); onExit(); }),
      h('div', { class: 'grow' }, h('h1', null, s.name), h('div', { class: 'muted small' }, 'Тренировка идёт')),
      totalEl,
      h('button', { class: 'btn primary', onClick: finish }, 'Завершить')),
    list,
    h('button', { class: 'link danger-text', onClick: cancel }, 'Отменить тренировку'),
    restBar,
  );

  return () => dispose();
}
