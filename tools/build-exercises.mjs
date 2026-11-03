// Собирает modules/workouts/exercises.json из двух открытых источников:
//   • free-exercise-db (public domain): основа — фото, мышцы, инвентарь, техника (EN)
//   • wger.de (CC-BY-SA): дополнительные упражнения, фото и русские переводы там, где они есть
// Запуск: node tools/build-exercises.mjs
import { writeFile, readFile } from 'node:fs/promises';
import { overlay } from './translation.mjs';

const FEDB = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const FEDB_IMG = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';
const WGER = 'https://wger.de/api/v2/exerciseinfo/?format=json&limit=100';
const RU = 5, EN = 2;

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const text = html => (html ?? '').replace(/<\/(li|p)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const steps = html => text(html).split('\n').map(s => s.trim()).filter(Boolean);

const MUSCLE_GROUP = {
  abdominals: 'abs', abductors: 'legs', adductors: 'legs', biceps: 'arms', calves: 'legs', chest: 'chest', forearms: 'arms',
  glutes: 'glutes', hamstrings: 'legs', lats: 'back', 'lower back': 'back', 'middle back': 'back', neck: 'neck',
  quadriceps: 'legs', shoulders: 'shoulders', traps: 'back', triceps: 'arms',
};
const WGER_GROUP = { Abs: 'abs', Arms: 'arms', Back: 'back', Calves: 'legs', Cardio: 'cardio', Chest: 'chest', Legs: 'legs', Shoulders: 'shoulders' };
const WGER_EQUIP = {
  'none (bodyweight exercise)': 'body only', 'Gym mat': 'mat', 'Swiss Ball': 'exercise ball', 'Pull-up bar': 'pull-up bar',
  Bench: 'bench', 'Incline bench': 'bench', 'SZ-Bar': 'e-z curl bar', Barbell: 'barbell', Dumbbell: 'dumbbell', Kettlebell: 'kettlebells',
};
const HOME_EQUIP = new Set(['body only', 'bands', 'mat', 'exercise ball', 'foam roll', 'pull-up bar']);

const isHome = (equip, category) => (equip.length ? equip.every(e => HOME_EQUIP.has(e)) : category === 'stretching');
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length) && v !== ''));

const fedb = await (await fetch(FEDB)).json();
const out = [];
const seen = new Map();

for (const e of fedb) {
  const equip = e.equipment ? [e.equipment] : [];
  const groups = [...new Set(e.primaryMuscles.map(m => MUSCLE_GROUP[m]).filter(Boolean))];
  if (e.category === 'cardio') groups.push('cardio');
  const rec = clean({
    id: 'fe:' + (e.id ?? norm(e.name)), n: e.name, g: groups, m: e.primaryMuscles, s: e.secondaryMuscles, e: equip,
    l: e.level, c: e.category, h: isHome(equip, e.category) ? 1 : 0, d: e.instructions,
    img: (e.images ?? []).map(p => FEDB_IMG + p),
  });
  seen.set(norm(e.name), rec);
  out.push(rec);
}

// wger: постранично
const wger = [];
for (let url = WGER; url;) {
  const page = await (await fetch(url)).json();
  wger.push(...page.results);
  url = page.next;
}

let merged = 0, added = 0;
for (const w of wger) {
  const en = w.translations.find(t => t.language === EN);
  const ru = w.translations.find(t => t.language === RU);
  if (!en) continue;
  const images = w.images.map(i => i.image);
  const credit = `wger.de, ${w.license.short_name}${w.license_author ? ', ' + w.license_author : ''}`;
  const match = seen.get(norm(en.name));
  if (match) {
    // совпало по английскому названию с free-exercise-db — добавляем русский перевод
    if (ru) { match.ru = ru.name; const d = steps(ru.description); if (d.length) match.dr = d; match.cr = credit; merged++; }
    continue;
  }
  const desc = steps(en.description);
  const dru = ru ? steps(ru.description) : [];
  if (!desc.length && !dru.length && !images.length) continue; // пустые карточки не нужны
  const equip = [...new Set(w.equipment.map(q => WGER_EQUIP[q.name] ?? q.name.toLowerCase()))];
  const groups = [WGER_GROUP[w.category?.name]].filter(Boolean);
  const rec = clean({
    id: 'wg:' + w.id, n: en.name, ru: ru?.name, g: groups,
    m: w.muscles.map(m => m.name_en || m.name), s: w.muscles_secondary.map(m => m.name_en || m.name), e: equip,
    h: isHome(equip) ? 1 : 0, d: desc, dr: dru, img: images, cr: credit,
  });
  out.push(rec);
  added++;
}

out.sort((a, b) => a.n.localeCompare(b.n));
// накопленные русские переводы (translation/ru.json) накладываются поверх — пересборка их не теряет
const ruStore = JSON.parse(await readFile(new URL('../translation/ru.json', import.meta.url), 'utf8').catch(() => '{}'));
overlay(out, ruStore);
await writeFile(new URL('../modules/workouts/exercises.json', import.meta.url), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  sources: [
    { name: 'free-exercise-db', url: 'https://github.com/yuhonas/free-exercise-db', license: 'Unlicense (public domain)' },
    { name: 'wger', url: 'https://wger.de', license: 'CC-BY-SA 3.0/4.0, CC0' },
  ],
  exercises: out,
}));
console.log({ total: out.length, fromFedb: fedb.length, wgerMerged: merged, wgerAdded: added, ru: out.filter(x => x.ru).length });
