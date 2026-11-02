// Общие функции модуля «Тренировки».
//
// Коллекции (в пространстве имён workouts/):
//   templates — {id, name, exercises:[{id, name, comment, sets, warmup}]}
//   sessions  — выполненные тренировки:
//               {id, workoutId, name, startedAt, endedAt, durationSec,
//                exercises:[{name, comment, sets:[{kind:'warmup'|'work', kg, reps, restSec}]}]}
//   kv: 'active' — идущая сейчас тренировка (переживает перезагрузку), 'settings' — {rest}

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const DEFAULT_REST = 90;

const pad = n => String(n).padStart(2, '0');

export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** 75 → «1:15», 3700 → «1:01:40» */
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

/** 3900 → «1 ч 05 мин» */
export function fmtHuman(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${pad(m % 60)} мин` : `${m} мин`;
}

export const fmtDate = ts => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
export const fmtWeekday = ts => new Date(ts).toLocaleDateString('ru-RU', { weekday: 'short' });

export const fmtSet = s => `${s.kg ?? 0} кг × ${s.reps ?? 0}`;

export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Map<'YYYY-MM-DD', session[]> */
export function groupByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return map;
}

/** Данные прошлых тренировок: последнее выполнение упражнения по названию. */
function lastByExercise(sessions) {
  const map = new Map();
  for (const s of [...sessions].sort((a, b) => b.startedAt - a.startedAt)) {
    for (const ex of s.exercises) {
      const key = ex.name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, ex.sets);
    }
  }
  return map;
}

/** Собирает состояние запускаемой тренировки из шаблона. */
export function buildActive(template, sessions) {
  const prev = lastByExercise(sessions);
  return {
    workoutId: template.id,
    name: template.name,
    startedAt: Date.now(),
    rest: null,
    exercises: template.exercises.map(ex => {
      const old = prev.get(ex.name.trim().toLowerCase()) ?? [];
      const oldWarm = old.filter(s => s.kind === 'warmup');
      const oldWork = old.filter(s => s.kind === 'work');
      // prev* — что было в прошлый раз; kg/reps — предзаполнение (для нового подхода берём последний известный)
      const mk = (kind, p, base = p) => ({ kind, prevKg: p?.kg ?? null, prevReps: p?.reps ?? null, kg: base?.kg ?? 0, reps: base?.reps ?? 0, done: false, restSec: null });
      return {
        name: ex.name,
        comment: ex.comment ?? '',
        sets: [
          ...(ex.warmup ? [mk('warmup', oldWarm[0])] : []),
          ...Array.from({ length: ex.sets }, (_, i) => mk('work', oldWork[i], oldWork[i] ?? oldWork.at(-1))),
        ],
      };
    }),
  };
}

export function sessionTotals(sessions) {
  return { count: sessions.length, sec: sessions.reduce((a, s) => a + (s.durationSec ?? 0), 0) };
}

/** Короткий сигнал окончания отдыха. */
export function beep() {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ac.currentTime + 0.25);
    setTimeout(() => ac.close(), 500);
  } catch { /* звук недоступен */ }
  navigator.vibrate?.([200, 100, 200]);
}
