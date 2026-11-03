// Языки. Исходный язык приложения — русский: ключ словаря — это сама русская строка,
// а нет перевода — показывается она же. Язык задаётся независимо:
//   • для приложения целиком (оболочка, профиль) — settings.app;
//   • для каждого модуля отдельно (Хаб тоже модуль) — settings.modules[id]: 'auto' = как в приложении;
//   • для контента модуля (например, названия и техника упражнений) — settings.content['<модуль>.<контент>']:
//     'auto' = как язык самого модуля.
// Словари: ядро и Хаб — js/core/lang/<язык>.js, модуль — modules/<id>/i18n.<язык>.json (скачивается вместе с модулем).

export const LANGS = { ru: 'Русский', en: 'English' };
const LOCALES = { ru: 'ru-RU', en: 'en-GB' };
const KEY = 'app/lang';

let settings = { app: 'ru', modules: {}, content: {} };
const dicts = new Map(); // 'scope:lang' → словарь (после загрузки)
const loading = new Map();

const scopeOfDict = scope => (scope === 'hub' ? 'app' : scope);

const ruPlural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
};

export const getSettings = () => structuredClone(settings);

/** Язык интерфейса для области: 'app', 'hub' или id модуля. */
export function langOf(scope) {
  if (scope === 'app') return settings.app;
  const v = settings.modules[scope];
  return v && v !== 'auto' ? v : settings.app;
}

/** Язык контента модуля (например, 'workouts', 'exercises'). */
export function contentLang(scope, id) {
  const v = settings.content[`${scope}.${id}`];
  return v && v !== 'auto' ? v : langOf(scope);
}

function loadDict(scope, lang) {
  if (lang === 'ru') return Promise.resolve({});
  const s = scopeOfDict(scope), key = `${s}:${lang}`;
  if (!loading.has(key)) {
    const p = (s === 'app'
      ? import(`./lang/${lang}.js`).then(m => m.default)
      : fetch(new URL(`modules/${s}/i18n.${lang}.json`, document.baseURI)).then(r => (r.ok ? r.json() : {})))
      .catch(() => ({}))
      .then(d => { dicts.set(key, d); return d; });
    loading.set(key, p);
  }
  return loading.get(key);
}

/** Грузит словари для всех используемых сочетаний «область — язык». */
export async function preload(moduleIds = []) {
  const langs = new Set([settings.app, ...Object.values(settings.modules), ...Object.values(settings.content)].filter(l => l && l !== 'auto'));
  const scopes = ['app', 'hub', ...moduleIds];
  await Promise.all(scopes.flatMap(s => [...langs].map(l => loadDict(s, l))));
}

export async function initI18n(db, moduleIds) {
  const saved = await db.kv.get(KEY, null);
  settings = { app: 'ru', modules: {}, content: {}, ...saved };
  await preload(moduleIds);
}

export async function saveSettings(db, next) {
  settings = next;
  await db.kv.set(KEY, next);
}

/** Переводчик области. lang можно задать явно (например, Хаб переводит названия виджетов модуля на язык Хаба). */
export function translator(scope, lang = langOf(scope)) {
  const dict = () => dicts.get(`${scopeOfDict(scope)}:${lang}`) ?? {};
  const fill = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '') : s);
  const tr = s => (lang === 'ru' ? s : dict()[s] ?? s);
  return {
    scope, lang, locale: LOCALES[lang] ?? lang,
    tr,
    /** Перевод строки с подстановками: t('Найдено: {n}', { n: 5 }). */
    t: (s, params) => fill(tr(s), params),
    /** Форма слова по числу. Для не-русского берётся пара «один|много» из словаря по ключу «одно|несколько|много». */
    plural(n, one, few, many) {
      if (lang === 'ru') return ruPlural(n, one, few, many);
      const pair = dict()[`${one}|${few}|${many}`];
      if (!pair) return ruPlural(n, one, few, many);
      const [s, p] = pair.split('|');
      return n === 1 ? s : p;
    },
  };
}
