// Редактор тренировки: название и список упражнений.
// Незавершённая новая тренировка сохраняется как черновик (draft: true) — её можно только редактировать.
// Клавиши: Enter — принять поле и перейти к следующему; Esc в поле — отменить ввод и выйти из поля;
// Esc вне полей — окно «Отмена / Сохранить как черновик».

import { openPicker, displayName, suggest } from './catalog.js';

export function openEditor(el, ctx, template, { onDone }) {
  const { h, icon, iconBtn, uid, toast, raw, modal } = ctx.ui;
  const isNew = !template;
  const keepsDraft = isNew || !!template?.draft; // новая тренировка и черновик при выходе без сохранения остаются черновиками
  const draft = structuredClone(template ?? { name: '', exercises: [] });
  if (!draft.exercises.length) draft.exercises.push(newExercise());

  function newExercise() {
    return { id: uid(), name: '', comment: '', sets: 3, warmup: false };
  }

  const name = h('input', { class: 'input big fld', placeholder: 'Название тренировки', value: draft.name, maxlength: '60' });
  name.addEventListener('input', () => (draft.name = name.value));
  {
    let snap;
    name.addEventListener('focus', () => (snap = draft.name));
    name.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); draft.name = snap; name.value = snap; name.blur(); } });
  }
  const list = h('div', { class: 'ex-list' });

  function render() {
    list.replaceChildren(...draft.exercises.map((ex, i) => {
      const exName = h('input', { class: 'input fld', placeholder: 'Название упражнения', value: ex.name, maxlength: '60', autocomplete: 'off' });
      const sug = h('div', { class: 'ex-sug', hidden: true });
      let sugList = [], sugAt = -1, sugToken = 0;
      const hideSug = () => { sugToken++; sugList = []; sugAt = -1; sug.hidden = true; sug.replaceChildren(); };
      const choose = found => { applyPick(ex, found); render(); list.children[i]?.querySelectorAll('.fld')[1]?.focus(); };
      const showSug = async () => {
        const mine = ++sugToken;
        const found = exName.value.trim() ? await suggest(exName.value, 3).catch(() => []) : [];
        if (mine !== sugToken || document.activeElement !== exName) return;
        sugList = found; sugAt = -1;
        sug.hidden = !found.length;
        const lang = ctx.contentLang('exercises');
        sug.replaceChildren(...found.map(f => h('button', { class: 'ex-sug-item', onPointerdown: e => { e.preventDefault(); choose(f); } },
          raw(displayName(f, lang)),
          f.ru && f.n !== displayName(f, lang) ? h('span', { class: 'muted small' }, raw(f.n)) : null)));
      };
      const mark = () => [...sug.children].forEach((b, k) => b.classList.toggle('on', k === sugAt));
      exName.addEventListener('input', () => {
        ex.name = exName.value;
        if (ex.ref && ex.name !== ex.refName) { delete ex.ref; delete ex.refName; } // название изменили вручную — связь с каталогом снимаем
        showSug();
      });
      exName.addEventListener('focus', showSug);
      exName.addEventListener('blur', hideSug);
      exName.addEventListener('keydown', e => {
        if (sugList.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault();
          sugAt = ((sugAt + 1 + (e.key === 'ArrowDown' ? 1 : -1) + sugList.length + 1) % (sugList.length + 1)) - 1; // -1 = ничего не выбрано
          mark();
        } else if (e.key === 'Enter' && sugAt >= 0) {
          e.preventDefault();
          choose(sugList[sugAt]);
        }
      });
      const comment = h('input', { class: 'input fld', placeholder: 'Комментарий (необязательно)', value: ex.comment, maxlength: '120' });
      comment.addEventListener('input', () => (ex.comment = comment.value));

      // Esc в поле возвращает значение, которое было при входе в поле
      const keep = (input, read, write) => {
        let snap;
        input.addEventListener('focus', () => (snap = read()));
        input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); write(snap); input.blur(); } });
      };
      keep(exName, () => [ex.name, ex.ref, ex.refName], ([n, r, rn]) => {
        ex.name = n;
        if (r) { ex.ref = r; ex.refName = rn; } else { delete ex.ref; delete ex.refName; }
        exName.value = n;
      });
      keep(comment, () => ex.comment, v => { ex.comment = v; comment.value = v; });

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
        sug,
        comment,
        h('div', { class: 'ex-opts' },
          h('div', { class: 'stepper' }, h('span', { class: 'muted' }, 'Подходов'),
            h('button', { class: 'icon-btn', onClick: () => step(-1) }, icon('minus', 16)), setsVal,
            h('button', { class: 'icon-btn', onClick: () => step(1) }, icon('plus', 16))),
          h('label', { class: 'check' }, warm, h('span', null, 'Разминочный подход'))));
    }));
  }

  /** Записывает в упражнение выбранное из каталога: название на выбранном языке и связь с каталогом. */
  function applyPick(target, found, lang = ctx.contentLang('exercises')) {
    target.name = displayName(found, lang);
    target.ref = found.id;
    target.refName = target.name;
  }

  /** Подставляет упражнение из каталога в карточку ex (или создаёт новую, если ex не задан). */
  function pick(ex) {
    openPicker(ctx, {
      current: ex?.ref, // уже выбранное из каталога упражнение: окно сразу покажет его карточку, из неё можно вернуться к списку и выбрать другое
      onPick(found, lang) {
        const target = ex ?? newExercise();
        applyPick(target, found, lang);
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

  const cleaned = () => draft.exercises.filter(e => e.name.trim()).map(e => ({ ...e, name: e.name.trim() }));

  let finished = false;
  function done() {
    if (finished) return;
    finished = true;
    dispose();
    onDone();
  }

  async function save() {
    const exercises = cleaned();
    if (!draft.name.trim()) return toast('Введите название тренировки');
    if (!exercises.length) return toast('Добавьте хотя бы одно упражнение');
    const { draft: _flag, ...full } = draft; // полное сохранение снимает пометку черновика
    await ctx.db.collection('templates').put({ ...full, name: draft.name.trim(), exercises });
    toast('Тренировка сохранена');
    done();
  }

  /** Незавершённое — в черновик (если там вообще что-то есть). */
  async function saveDraft() {
    const exercises = cleaned();
    if (draft.name.trim() || exercises.length) {
      await ctx.db.collection('templates').put({ ...draft, draft: true, name: draft.name.trim(), exercises });
      toast('Сохранено как черновик');
    }
    done();
  }

  const leave = () => (keepsDraft ? saveDraft() : done());

  // ---------- горячие клавиши ----------
  const onKey = e => {
    if (!el.isConnected) return dispose();
    const t = e.target;
    if (e.key === 'Enter' && t.classList?.contains('fld') && !e.defaultPrevented) {
      e.preventDefault();
      const all = [...el.querySelectorAll('.fld')], next = all[all.indexOf(t) + 1];
      if (next) next.focus(); else t.blur();
    } else if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.overlay') && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
      askLeave();
    }
  };
  function askLeave() {
    const m = modal({
      title: 'Выйти из редактирования?',
      body: h('p', { class: 'muted' }, keepsDraft ? 'Тренировка не сохранена.' : 'Изменения не сохранены.'),
      actions: [
        h('button', { class: 'btn', onClick: () => m.close() }, 'Отмена'),
        h('button', { class: 'btn primary', onClick: () => { m.close(); leave(); } }, keepsDraft ? 'Сохранить как черновик' : 'Не сохранять'),
      ],
    });
  }
  document.addEventListener('keydown', onKey);
  function dispose() { document.removeEventListener('keydown', onKey); }

  render();
  el.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', { class: 'row-gap' }, iconBtn('chevL', 'Назад', leave), h('h1', null, isNew ? 'Новая тренировка' : 'Редактирование')),
      h('button', { class: 'btn primary', onClick: save }, icon('check', 16), 'Сохранить')),
    name,
    list,
    h('div', { class: 'row-gap' },
      h('button', { class: 'btn', onClick: () => { draft.exercises.push(newExercise()); render(); list.lastElementChild?.querySelector('input')?.focus(); } },
        icon('plus', 16), 'Добавить упражнение'),
      h('button', { class: 'btn', onClick: () => pick(null) }, icon('search', 16), 'Из каталога')),
  );
  if (isNew) name.focus();
  return dispose;
}
