// Редактор тренировки: название и список упражнений.

import { openPicker, displayName } from './catalog.js';

export function openEditor(el, ctx, template, { onDone }) {
  const { h, icon, iconBtn, uid, toast } = ctx.ui;
  const isNew = !template;
  const draft = structuredClone(template ?? { name: '', exercises: [] });
  if (!draft.exercises.length) draft.exercises.push(newExercise());

  function newExercise() {
    return { id: uid(), name: '', comment: '', sets: 3, warmup: false };
  }

  const name = h('input', { class: 'input big', placeholder: 'Название тренировки', value: draft.name, maxlength: '60' });
  name.addEventListener('input', () => (draft.name = name.value));
  const list = h('div', { class: 'ex-list' });

  function render() {
    list.replaceChildren(...draft.exercises.map((ex, i) => {
      const exName = h('input', { class: 'input', placeholder: 'Название упражнения', value: ex.name, maxlength: '60' });
      exName.addEventListener('input', () => {
        ex.name = exName.value;
        if (ex.ref && ex.name !== ex.refName) { delete ex.ref; delete ex.refName; } // название изменили вручную — связь с каталогом снимаем
      });
      const comment = h('input', { class: 'input', placeholder: 'Комментарий (необязательно)', value: ex.comment, maxlength: '120' });
      comment.addEventListener('input', () => (ex.comment = comment.value));
      const setsVal = h('span', { class: 'stepper-val' }, String(ex.sets));
      const step = d => { ex.sets = Math.min(10, Math.max(1, ex.sets + d)); setsVal.textContent = ex.sets; };
      const warm = h('input', { type: 'checkbox' });
      warm.checked = ex.warmup;
      warm.addEventListener('change', () => (ex.warmup = warm.checked));
      return h('div', { class: 'card ex-card' },
        h('div', { class: 'ex-top' },
          h('span', { class: 'ex-num' }, String(i + 1)),
          exName,
          iconBtn('search', 'Выбрать из каталога', () => pick(ex)),
          iconBtn('chevU', 'Выше', () => { move(i, -1); }, i === 0 ? 'off' : ''),
          iconBtn('chevD', 'Ниже', () => { move(i, 1); }, i === draft.exercises.length - 1 ? 'off' : ''),
          iconBtn('trash', 'Удалить упражнение', () => { draft.exercises.splice(i, 1); render(); }, 'danger')),
        comment,
        h('div', { class: 'ex-opts' },
          h('div', { class: 'stepper' }, h('span', { class: 'muted' }, 'Подходов'),
            h('button', { class: 'icon-btn', onClick: () => step(-1) }, icon('minus', 16)), setsVal,
            h('button', { class: 'icon-btn', onClick: () => step(1) }, icon('plus', 16))),
          h('label', { class: 'check' }, warm, h('span', null, 'Разминочный подход'))));
    }));
  }

  /** Подставляет упражнение из каталога в карточку ex (или создаёт новую, если ex не задан). */
  function pick(ex) {
    openPicker(ctx, {
      current: ex?.ref, // уже выбранное из каталога упражнение: окно сразу покажет его карточку, из неё можно вернуться к списку и выбрать другое
      onPick(found) {
        const target = ex ?? newExercise();
        target.name = displayName(found, ctx.contentLang('exercises'));
        target.ref = found.id;
        target.refName = target.name;
        if (!ex) {
          const last = draft.exercises.at(-1);
          if (last && !last.name.trim()) draft.exercises.pop(); // пустую заготовку заменяем
          draft.exercises.push(target);
        }
        render();
      },
    });
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.exercises.length) return;
    [draft.exercises[i], draft.exercises[j]] = [draft.exercises[j], draft.exercises[i]];
    render();
  }

  async function save() {
    const exercises = draft.exercises.filter(e => e.name.trim());
    if (!draft.name.trim()) return toast('Введите название тренировки');
    if (!exercises.length) return toast('Добавьте хотя бы одно упражнение');
    await ctx.db.collection('templates').put({ ...draft, name: draft.name.trim(), exercises: exercises.map(e => ({ ...e, name: e.name.trim() })) });
    toast('Тренировка сохранена');
    onDone();
  }

  render();
  el.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', { class: 'row-gap' }, iconBtn('chevL', 'Назад', onDone), h('h1', null, isNew ? 'Новая тренировка' : 'Редактирование')),
      h('button', { class: 'btn primary', onClick: save }, icon('check', 16), 'Сохранить')),
    name,
    list,
    h('div', { class: 'row-gap' },
      h('button', { class: 'btn', onClick: () => { draft.exercises.push(newExercise()); render(); list.lastElementChild?.querySelector('input')?.focus(); } },
        icon('plus', 16), 'Добавить упражнение'),
      h('button', { class: 'btn', onClick: () => pick(null) }, icon('search', 16), 'Из каталога')),
  );
  if (isNew) name.focus();
}
