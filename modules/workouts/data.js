// Общие функции модуля «Тренировки».
//
// Коллекции (в пространстве имён workouts/):
//   templates — {id, name, exercises:[{id, name, comment, sets, warmup}]}
//   sessions  — выполненные тренировки:
//               {id, workoutId, name, startedAt, endedAt, durationSec,
//                exercises:[{name, comment, sets:[{kind:'warmup'|'work', kg, reps, restSec}]}]}
//   kv: 'active' — идущая сейчас тренировка (переживает перезагрузку), 'settings' — {rest}

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

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Форматирование с учётом языка модуля (ctx.locale / ctx.t). */
export function makeFmt({ locale, t }) {
  return {
    month: m => cap(new Date(2000, m, 1).toLocaleDateString(locale, { month: 'long' })),
    /** Пн…Вс (неделя с понедельника; 1 января 2024 — понедельник) */
    dayNames: () => Array.from({ length: 7 }, (_, i) => cap(new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }))),
    /** 3900 → «1 ч 05 мин» */
    human(sec) {
      const m = Math.round(sec / 60);
      return m >= 60 ? t('{h} ч {m} мин', { h: Math.floor(m / 60), m: pad(m % 60) }) : t('{m} мин', { m });
    },
    date: ts => new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
    weekday: ts => new Date(ts).toLocaleDateString(locale, { weekday: 'short' }),
    set: s => t('{kg} кг × {reps}', { kg: s.kg ?? 0, reps: s.reps ?? 0 }),
  };
}

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
        ref: ex.ref ?? null,
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
