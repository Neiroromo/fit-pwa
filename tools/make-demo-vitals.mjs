// Демо-данные для медицинского раздела модуля «Мониторинг»: три месяца давления, пульса и температуры.
// Запуск: node tools/make-demo-vitals.mjs  →  demo/monitoring-vitals-3-months.json
// Загрузка в приложении: Профиль → «Данные на устройстве» → «Импорт из файла» (импорт только добавляет записи).
// Период — последние 90 дней до дня запуска. Утром и вечером измеряется давление и пульс, по утрам ещё температура;
// около 40-го дня — три дня лёгкой простуды с повышенной температурой и пульсом.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let seed = 20261107;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = amp => (rnd() + rnd() + rnd() - 1.5) * (2 / 3) * amp;
const fix = (v, d = 0) => Number(v.toFixed(d));

const DAYS = 90, SICK = [40, 42];
const end = new Date(); end.setHours(0, 0, 0, 0);
const now = Date.now();
const records = [];

for (let i = 0; i < DAYS; i++) {
  const day = new Date(end); day.setDate(end.getDate() - (DAYS - 1 - i));
  const t = i / (DAYS - 1);
  const sick = i >= SICK[0] && i <= SICK[1];
  // утреннее давление чуть выше вечернего, общий медленный спад (режим, тренировки)
  const baseSys = 133 - 8 * t, baseDia = 87 - 6 * t, basePulse = 72 - 6 * t;
  for (const [hour, minute, part] of [[8, 0, 'am'], [20, 30, 'pm']]) {
    if (rnd() < (part === 'am' ? 0.06 : 0.18)) continue; // иногда пропуск
    const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute + Math.round(noise(25))).getTime();
    const bump = part === 'am' ? 3 : -2;
    const rec = {
      c: 'monitoring/vitals', id: crypto.randomUUID(), ts,
      sys: fix(baseSys + bump + (sick ? 4 : 0) + noise(6)), dia: fix(baseDia + bump / 2 + (sick ? 2 : 0) + noise(4)),
      pulse: fix(basePulse + (part === 'pm' ? 3 : 0) + (sick ? 12 : 0) + noise(4)),
      createdAt: now, updatedAt: now, deleted: false,
    };
    if (part === 'am') rec.temp = fix((sick ? 37.6 + (i - SICK[0]) * -0.2 + noise(0.2) : 36.5 + noise(0.2)), 1);
    records.push(rec);
  }
}

const out = path.join(root, 'demo', 'monitoring-vitals-3-months.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ app: 'fit-pwa', version: 1, exportedAt: new Date().toISOString(), records }, null, 1));
const sys = records.map(r => r.sys);
console.log(`Записей: ${records.length} → ${path.relative(root, out)}; верхнее давление ${Math.min(...sys)}–${Math.max(...sys)}`);
