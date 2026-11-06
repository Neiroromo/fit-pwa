// Подключение к Google: вход (Google Identity Services, token model) и работа с Drive appDataFolder.
// Токен живёт ~1 час и хранится только в памяти; refresh-токена в браузере нет — при необходимости
// запрашивается заново (тихо, если пользователь уже дал согласие). Данные лежат в скрытой папке приложения
// (scope drive.appdata): приложение не видит остальной Диск, а пользователь не может случайно испортить файлы.
//
// Client ID публичный (не секрет). Разрешённые origin заданы в Google Cloud Console.

export const CLIENT_ID = '238703702723-e50dvetph6q7nci560pi4hhbbac7poku.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const HINT_KEY = 'fitpwa-google-linked'; // только флаг «входили раньше»; сам токен не сохраняется
const USER_KEY = 'fitpwa-google-user';   // {name, email}: показывается в профиле, пока аккаунт подключён

let token = null;
let expiresAt = 0;
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
      // имя и почту берём из Drive (about.get) — отдельный scope для профиля не нужен
      api('drive/v3/about?fields=user(displayName,emailAddress,photoLink)')
        .then(async a => setUser({ name: a.user?.displayName || '', email: a.user?.emailAddress || '', photo: await loadPhoto(a.user?.photoLink) }))
        .catch(() => {})
        .finally(() => p?.resolve(token));
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

export function signOut() {
  const t = token;
  token = null; expiresAt = 0;
  store.set(null);
  setUser(null);
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
}

async function api(path, { method = 'GET', headers = {}, body, raw = false, retry = true } = {}) {
  const t = isSignedIn() ? token : await signIn({ interactive: false });
  const res = await fetch(`https://www.googleapis.com/${path}`, { method, body, headers: { ...headers, Authorization: `Bearer ${t}` } });
  if (res.status === 401 && retry) { token = null; return api(path, { method, headers, body, raw, retry: false }); }
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
