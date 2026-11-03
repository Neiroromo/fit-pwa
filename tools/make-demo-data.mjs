// Демо-данные для модуля «Тренировки»: программа из трёх тренировок (пн/ср/пт) и история новичка за 2 месяца (сентябрь–октябрь 2026).
// Запуск: node tools/make-demo-data.mjs  →  demo/novice-3x-2-months.json
// Загрузка в приложении: Профиль → «Данные на устройстве» → «Импорт из файла». Импорт добавляет записи и ничего не стирает.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'modules/workouts/exercises.json'), 'utf8')).exercises;
const byId = new Map(catalog.map(e => [e.id, e]));
const nm = id => {
  const e = byId.get(id);
  if (!e) throw new Error('нет упражнения ' + id);
  return e.ru || e.n;
};

// lo..hi — диапазон повторений; когда во всех подходах набрано hi, вес растёт на step и повторения возвращаются к lo
const PROGRAM = [
  { dow: 1, name: 'Понедельник: грудь, плечи, трицепс', ex: [
    { id: 'fe:Barbell_Bench_Press_-_Medium_Grip', sets: 4, warm: true, w: 30, step: 2.5, lo: 8, hi: 10, rest: 120, note: 'Лопатки сведены, штанга касается груди' },
    { id: 'fe:Incline_Dumbbell_Press', sets: 3, w: 10, step: 1, lo: 8, hi: 12, rest: 90, note: 'Вес указан на одну гантель' },
    { id: 'fe:Butterfly', sets: 3, w: 25, step: 2.5, lo: 10, hi: 12, rest: 75 },
    { id: 'fe:Dumbbell_Shoulder_Press', sets: 3, w: 8, step: 1, lo: 8, hi: 12, rest: 90, note: 'Вес указан на одну гантель' },
    { id: 'fe:Side_Lateral_Raise', sets: 3, w: 4, step: 1, lo: 12, hi: 15, rest: 60 },
    { id: 'fe:Triceps_Pushdown', sets: 3, w: 15, step: 2.5, lo: 10, hi: 12, rest: 60 },
  ] },
  { dow: 3, name: 'Среда: спина, бицепс', ex: [
    { id: 'fe:Wide-Grip_Lat_Pulldown', sets: 4, warm: true, w: 35, step: 2.5, lo: 8, hi: 10, rest: 100, note: 'Тянуть к верху груди, без рывков' },
    { id: 'fe:Bent_Over_Barbell_Row', sets: 3, w: 25, step: 2.5, lo: 8, hi: 10, rest: 105, note: 'Спина прямая, корпус под углом 45°' },
    { id: 'fe:Seated_Cable_Rows', sets: 3, w: 30, step: 2.5, lo: 10, hi: 12, rest: 90 },
    { id: 'fe:One-Arm_Dumbbell_Row', sets: 3, w: 10, step: 1, lo: 8, hi: 12, rest: 75, note: 'Вес указан на одну гантель' },
    { id: 'fe:Face_Pull', sets: 3, w: 12, step: 2.5, lo: 12, hi: 15, rest: 60 },
    { id: 'fe:Barbell_Curl', sets: 3, w: 15, step: 2.5, lo: 8, hi: 12, rest: 75 },
    { id: 'fe:Alternate_Hammer_Curl', sets: 3, w: 6, step: 1, lo: 10, hi: 12, rest: 60, note: 'Вес указан на одну гантель' },
  ] },
  { dow: 5, name: 'Пятница: ноги и пресс', ex: [
    { id: 'fe:Barbell_Squat', sets: 4, warm: true, w: 30, step: 5, lo: 8, hi: 10, rest: 130, note: 'Колени по линии носков, спина прямая' },
    { id: 'fe:Leg_Press', sets: 3, w: 60, step: 10, lo: 10, hi: 12, rest: 105 },
    { id: 'fe:Romanian_Deadlift', sets: 3, w: 30, step: 5, lo: 8, hi: 10, rest: 105, note: 'Штанга близко к ногам, таз назад' },
    { id: 'fe:Lying_Leg_Curls', sets: 3, w: 20, step: 2.5, lo: 10, hi: 12, rest: 75 },
    { id: 'fe:Leg_Extensions', sets: 3, w: 20, step: 2.5, lo: 10, hi: 12, rest: 75 },
    { id: 'fe:Standing_Calf_Raises', sets: 4, w: 30, step: 5, lo: 12, hi: 15, rest: 60 },
    { id: 'fe:Cable_Crunch', sets: 3, w: 20, step: 2.5, lo: 12, hi: 15, rest: 60 },
    { id: 'fe:Hanging_Leg_Raise', sets: 3, w: 0, step: 0, lo: 6, hi: 12, rest: 60 },
  ] },
];

// детерминированный генератор случайных чисел (mulberry32): одинаковые данные при каждом запуске
let seed = 20260901;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const half = x => Math.round(x * 2) / 2;
const uid = () => crypto.randomUUID();

const records = [];
const base = new Date(2026, 8, 1, 9, 0).getTime();
PROGRAM.forEach((t, i) => {
  t.id = uid();
  records.push({
    c: 'workouts/templates', id: t.id, name: t.name, createdAt: base + i * 60000, updatedAt: base + i * 60000, deleted: false,
    exercises: t.ex.map(e => ({ id: uid(), name: nm(e.id), comment: e.note || '', sets: e.sets, warmup: !!e.warm, ref: e.id, refName: nm(e.id) })),
  });
  t.ex.forEach(e => { e.cw = e.w; e.cr = e.lo; });
});

let count = 0;
for (let d = new Date(2026, 8, 1); d <= new Date(2026, 9, 31); d.setDate(d.getDate() + 1)) {
  const t = PROGRAM.find(p => p.dow === d.getDay());
  if (!t) continue;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 30 + ri(-25, 25)).getTime();
  let restSum = 0, nSets = 0;
  const exercises = t.ex.map((e, ei) => {
    const sets = [];
    if (e.warm) sets.push({ kind: 'warmup', kg: half(e.cw * 0.5), reps: 10, restSec: ri(40, 60) });
    for (let s = 0; s < e.sets; s++) {
      let reps = e.cr;
      if (s === e.sets - 1 && rnd() < 0.5) reps--;
      if (s > 0 && rnd() < 0.15) reps--;
      reps = Math.max(e.lo - 2, reps);
      const last = s === e.sets - 1, lastEx = ei === t.ex.length - 1;
      const restSec = last && lastEx ? ri(10, 40) : e.rest + ri(-10, 20) + (last ? 30 : 0);
      sets.push({ kind: 'work', kg: e.cw, reps, restSec });
    }
    for (const x of sets) restSum += x.restSec;
    nSets += sets.length;
    // двойная прогрессия: чаще всего каждую тренировку +1 повтор, потом +вес
    if (rnd() < 0.88) {
      if (e.cr >= e.hi) { if (e.step > 0) { e.cw = half(e.cw + e.step); e.cr = e.lo; } } else e.cr++;
    }
    return { name: nm(e.id), comment: e.note || '', sets };
  });
  const durationSec = restSum + nSets * 40 + t.ex.length * 60 + ri(0, 300);
  const endedAt = start + durationSec * 1000;
  records.push({ c: 'workouts/sessions', id: uid(), workoutId: t.id, name: t.name, startedAt: start, endedAt, durationSec, exercises, createdAt: endedAt, updatedAt: endedAt, deleted: false });
  count++;
}

const out = path.join(root, 'demo', 'novice-3x-2-months.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ app: 'fit-pwa', version: 1, exportedAt: new Date().toISOString(), records }, null, 1));

const sessions = records.filter(r => r.c === 'workouts/sessions');
const prog = re => sessions.map(s => s.exercises.find(e => re.test(e.name))).filter(Boolean).map(e => { const w = e.sets.filter(x => x.kind === 'work'); return `${w[0].kg}×${w.map(x => x.reps).join('/')}`; }).join('  ');
console.log(`Тренировок в программе: ${PROGRAM.length}, занятий в истории: ${count} → ${path.relative(root, out)}`);
console.log('Жим лёжа:', prog(/Жим штанги лёжа/));
console.log('Приседания:', prog(/Приседания/));
console.log('Тяга верхнего блока:', prog(/верхнего блока к груди/));
