// Демо-данные для модуля «Мониторинг»: три месяца записей новичка, который худеет и набирает мышечную массу.
// Запуск: node tools/make-demo-monitoring.mjs  →  demo/monitoring-3-months.json
// Загрузка в приложении: Профиль → «Данные на устройстве» → «Импорт из файла». Импорт добавляет записи и ничего не стирает,
// кроме настроек модуля (рост 178 см, руки раздельно): они заменяются настройками из файла.
// Период — последние 90 дней до дня запуска скрипта.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// детерминированный генератор (mulberry32): одинаковые «случайные» колебания при каждом запуске
let seed = 20261106;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = amp => (rnd() + rnd() + rnd() - 1.5) * (2 / 3) * amp; // примерно нормальное, в пределах ±amp
const round = (v, step) => Math.round(v / step) * step;
const fix = (v, digits = 1) => Number(v.toFixed(digits));

const DAYS = 90;
const end = new Date(); end.setHours(0, 0, 0, 0);
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Траектории: начало → конец за 90 дней (прогресс чуть замедляется к концу)
const lerp = (a, b, t) => a + (b - a) * Math.pow(t, 0.9);
const M = {
  neck: [38, 38.5], shoulders: [118, 120], chest: [101, 103.5], waist: [96, 89], hips: [102, 100],
  'biceps.r': [34, 36.5], 'biceps.l': [33.5, 36], 'forearm.r': [29, 30], 'forearm.l': [28.5, 29.5],
  thigh: [59, 61], calf: [38, 39],
};

const now = Date.now();
const records = [];
let weights = 0, fats = 0, measures = 0;
for (let i = 0; i < DAYS; i++) {
  const d = new Date(end); d.setDate(end.getDate() - (DAYS - 1 - i));
  const t = i / (DAYS - 1);
  const rec = { c: 'monitoring/entries', id: dayKey(d), date: dayKey(d), createdAt: now, updatedAt: now, deleted: false };
  let any = false;

  // вес: почти каждое утро (пропуски ~15 %), в понедельник после выходных чуть больше
  if (rnd() > 0.15 || i === DAYS - 1) {
    const monday = d.getDay() === 1 ? 0.4 : 0;
    rec.weight = fix(round(lerp(88, 81.4, t) + monday + noise(0.55), 0.1)); any = true; weights++;
  }
  // процент жира: раз в неделю по весам-анализаторам
  if (i % 7 === 0 || i === DAYS - 1) {
    rec.fat = fix(round(lerp(24.6, 20.9, t) + noise(0.35), 0.1)); any = true; fats++;
  }
  // замеры: раз в две недели и в последний день, с точностью до 0,5 см
  if (i % 14 === 0 || i === DAYS - 1) {
    rec.m = {};
    for (const [k, [a, b]] of Object.entries(M)) rec.m[k] = fix(round(lerp(a, b, t) + noise(0.25), 0.5));
    any = true; measures++;
  }
  if (any) records.push(rec);
}

// настройки модуля: рост нужен для оценки процента жира; руки — раздельно (правая и левая), ноги — вместе
records.push({ c: 'monitoring/_kv', id: 'settings', value: { height: 178, split: { arms: true, legs: false }, hidden: [] }, createdAt: now, updatedAt: now, deleted: false });

const out = path.join(root, 'demo', 'monitoring-3-months.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ app: 'fit-pwa', version: 1, exportedAt: new Date().toISOString(), records }, null, 1));

const first = records.find(r => r.weight != null), last = [...records].reverse().find(r => r.weight != null);
console.log(`Записей: ${records.length - 1} (веса: ${weights}, жира: ${fats}, замеров: ${measures}) → ${path.relative(root, out)}`);
console.log(`Период: ${records[0].date} … ${last.date}; вес ${first.weight} → ${last.weight} кг`);
