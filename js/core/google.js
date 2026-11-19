// Подключение к Google: вход (Google Identity Services, token model) и работа с Drive appDataFolder.
// Токен живёт ~1 час; refresh-токена в браузере нет. Токен кладётся в localStorage на время его жизни (перезагрузка страницы
// не требует входа), а после истечения запрашивается заново тихо — первым же нажатием пользователя (браузер не даёт открыть
// окно Google без жеста) — если согласие уже дано. Данные лежат в скрытой папке приложения
// (scope drive.appdata): приложение не видит остальной Диск, а пользователь не может случайно испортить файлы.
//
// Client ID публичный (не секрет). Разрешённые origin заданы в Google Cloud Console.

export const CLIENT_ID = '238703702723-e50dvetph6q7nci560pi4hhbbac7poku.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const HINT_KEY = 'fitpwa-google-linked'; // только флаг «входили раньше»; сам токен не сохраняется
const TOKEN_KEY = 'fitpwa-google-token'; // {t, exp}: access-токен (scope только drive.appdata) на оставшееся время жизни
const USER_KEY = 'fitpwa-google-user';   // {name, email}: показывается в профиле, пока аккаунт подключён

let token = null;
let expiresAt = 0;
try { // токен с прошлой загрузки страницы, если ещё не истёк
  const st = JSON.parse(localStorage.getItem('fitpwa-google-token'));
  if (st?.t && st.exp > Date.now() && localStorage.getItem('fitpwa-google-linked') === '1') { token = st.t; expiresAt = st.exp; }
} catch { /* нет сохранённого токена */ }
let gisLoading = null;
let client = null;
let pending = null; // {resolve, reject} текущего запроса токена

const store = {
  get: () => { try { return localStorage.getItem(HINT_KEY); } catch { return null; } },
  set: v => { try { v ? localStorage.setItem(HINT_KEY, v) : localStorage.removeItem(HINT_KEY); } catch { /* приватный режим */ } },
};

/** Подключённый аккаунт Google ({name, email}) из последней успешной сессии или null. */
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch { return null; }
}
function setUser(u) {
  try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch { /* приватный режим */ }
  window.dispatchEvent(new CustomEvent('fitpwa:google'));
}

/** Аватар Google → маленький data-URL (хранится локально, без повторных запросов к Google); при неудаче — сама ссылка. */
async function loadPhoto(url) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url.replace(/=s\d+(-c)?$/, '=s160-c'), { referrerPolicy: 'no-referrer' })).blob();
    const bmp = await createImageBitmap(blob);
    const c = Object.assign(document.createElement('canvas'), { width: 160, height: 160 });
    c.getContext('2d').drawImage(bmp, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.85);
  } catch { return url; }
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gisLoading = null; reject(new Error('Не удалось загрузить Google (нет сети?)')); };
    document.head.append(s);
  });
  return gisLoading;
}

async function ensureClient() {
  await loadGis();
  client ??= google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: r => {
      const p = pending; pending = null;
      if (r.error) return p?.reject(new Error(r.error_description || r.error));
      token = r.access_token;
      expiresAt = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
      store.set('1');
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: token, exp: expiresAt })); } catch { /* приватный режим */ }
      // имя и почту берём из Drive (about.get) — отдельный scope для профиля не нужен
      api('drive/v3/about?fields=user(displayName,emailAddress,photoLink)')
        .then(async a => setUser({ name: a.user?.displayName || '', email: a.user?.emailAddress || '', photo: await loadPhoto(a.user?.photoLink) }))
        .catch(() => {})
        .finally(() => { window.dispatchEvent(new CustomEvent('fitpwa:google')); p?.resolve(token); }); // интерфейс узнаёт, что сессия активна
    },
    error_callback: e => {
      const p = pending; pending = null;
      p?.reject(new Error(e.type === 'popup_closed' ? 'Окно входа закрыто' : e.type === 'popup_failed_to_open' ? 'Браузер заблокировал окно входа' : (e.message || e.type)));
    },
  });
  return client;
}

/** Был ли уже вход на этом устройстве (для автоматического тихого входа). */
export const wasLinked = () => store.get() === '1';
export const isSignedIn = () => !!token && Date.now() < expiresAt;

/**
 * Получить токен. interactive=true нужно вызывать из обработчика нажатия (иначе браузер заблокирует окно).
 * interactive=false — тихая попытка: удаётся только если согласие уже дано и сессия Google жива.
 */
export async function signIn({ interactive = true } = {}) {
  if (isSignedIn()) return token;
  const c = await ensureClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt: interactive ? (wasLinked() ? '' : 'consent') : 'none' });
  });
}

/**
 * После перезагрузки страницы токена в памяти нет, хотя вход был: пробуем восстановить сессию тихо (без окна), если согласие уже дано.
 * Не получилось (например, закончилась сессия Google) — ничего страшного: в профиле будет «Нужно войти заново».
 */
export function restoreSession() {
  if (!wasLinked() || isSignedIn()) return;
  const events = ['pointerdown', 'keydown'];
  const go = () => {
    events.forEach(e => removeEventListener(e, go, true));
    if (isSignedIn()) return;
    signIn({ interactive: false }).catch(() => { /* нужен интерактивный вход: в профиле будет «Нужно войти заново» */ });
  };
  events.forEach(e => addEventListener(e, go, { capture: true })); // окно Google можно открыть только из жеста пользователя
}

export function signOut() {
  const t = token;
  token = null; expiresAt = 0;
  store.set(null);
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ничего */ }
  setUser(null);
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
}

async function api(path, { method = 'GET', headers = {}, body, raw = false, retry = true } = {}) {
  const t = isSignedIn() ? token : await signIn({ interactive: false });
  const res = await fetch(`https://www.googleapis.com/${path}`, { method, body, headers: { ...headers, Authorization: `Bearer ${t}` } });
  if (res.status === 401 && retry) { token = null; try { localStorage.removeItem(TOKEN_KEY); } catch { /* ничего */ } return api(path, { method, headers, body, raw, retry: false }); }
  if (!res.ok) throw new Error(`Google Drive: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return raw ? res : res.json();
}

/** Найти файл в appDataFolder по имени → {id, modifiedTime, md5Checksum, headRevisionId, size} или null. */
export async function findFile(name) {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
  const r = await api(`drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,md5Checksum,headRevisionId,size)&pageSize=1`);
  return r.files[0] ?? null;
}

export async function listFiles() {
  const r = await api('drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)&pageSize=100');
  return r.files;
}

/** Записать JSON в файл (создаёт или обновляет). Возвращает метаданные файла. */
export async function putJson(name, data) {
  const existing = await findFile(name);
  const boundary = 'fitpwa' + Math.random().toString(36).slice(2);
  const meta = existing ? { name } : { name, parents: ['appDataFolder'] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const fields = 'id,name,modifiedTime,md5Checksum,headRevisionId';
  return api(
    existing
      ? `upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=${fields}`
      : `upload/drive/v3/files?uploadType=multipart&fields=${fields}`,
    { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
  );
}

/** Прочитать JSON из файла; null, если файла нет. */
export async function getJson(name) {
  const f = await findFile(name);
  if (!f) return null;
  return (await api(`drive/v3/files/${f.id}?alt=media`, { raw: true })).json();
}

export async function deleteFile(name) {
  const f = await findFile(name);
  if (f) await api(`drive/v3/files/${f.id}`, { method: 'DELETE', raw: true });
}

/** Удалить ВСЕ файлы приложения в appDataFolder. Возвращает число удалённых файлов. */
export async function deleteAllFiles() {
  const files = await listFiles();
  for (const f of files) await api(`drive/v3/files/${f.id}`, { method: 'DELETE', raw: true });
  return files.length;
}

/** Файлы приложения в appDataFolder: [{id, name, modifiedTime}] */
export const listAppFiles = listFiles;
export async function getJsonById(id) { return (await api(`drive/v3/files/${id}?alt=media`, { raw: true })).json(); }
