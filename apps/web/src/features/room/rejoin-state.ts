/**
 * Перезагрузка вкладки посреди урока (2026-10-04, E2E-тест стабильности):
 * раньше после F5 участник снова попадал на экран проверки устройств и без
 * клика «Присоединиться» в урок не возвращался, а камера ученика (её
 * включают уже в уроке) оставалась выключенной.
 *
 * С чем участник вошёл и что у него сейчас включено, держим в localStorage
 * под ключом урока. ИСКЛЮЧЕНИЕ из правила «без localStorage» (CLAUDE.md) —
 * по решению владельца 2026-10-11: раньше это лежало в query страницы урока
 * (`?in=1&mic=1&micId=<64 hex>…`), и в адресной строке на уроке вместо
 * короткой ссылки `/<код>` висел длинный адрес. Здесь только выбор устройств,
 * флаги и ссылка урока (`/<код>` — пропуск в урок, но он и так лежит в
 * истории браузера); ни access/refresh-токенов, ни других данных урока.
 *
 * Читаем только при перезагрузке ЭТОЙ страницы урока (тип навигации документа
 * `reload` и адрес документа — комната урока или его ссылка): хранилище общее
 * для вкладок, и без проверки адреса F5 на списке уроков и следующий клик в
 * урок пропускали бы проверку устройств. Переход по ссылке по-прежнему
 * показывает проверку устройств. Выход из урока запись стирает; брошенные
 * записи истекают через 12 ч.
 */
export interface RejoinState {
  mic: boolean;
  cam: boolean;
  /** На стейдже было задание — после перезагрузки вернуть его, а не сетку камер. */
  act: boolean;
  micId: string | null;
  camId: string | null;
  spkId: string | null;
}

interface StoredRejoin extends RejoinState {
  /** Участник прошёл проверку устройств и вошёл — только тогда F5 возвращает в урок. */
  inRoom: boolean;
  /** Ссылка урока (`/<код>`), которую комната показывает в адресной строке. */
  joinPath: string | null;
  savedAt: number;
}

const KEY_PREFIX = "matis.room.rejoin.";
const TTL_MS = 12 * 60 * 60 * 1000;

function key(lessonId: string): string {
  return KEY_PREFIX + lessonId;
}

/** Хранилище может бросать (Safari private, встроенные браузеры) — тогда просто без возврата после F5. */
function load(lessonId: string): StoredRejoin | null {
  try {
    const raw = window.localStorage.getItem(key(lessonId));
    if (!raw) return null;
    const rec = JSON.parse(raw) as StoredRejoin;
    if (typeof rec.savedAt !== "number" || Date.now() - rec.savedAt > TTL_MS) {
      window.localStorage.removeItem(key(lessonId));
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

function save(lessonId: string, rec: StoredRejoin) {
  try {
    window.localStorage.setItem(key(lessonId), JSON.stringify({ ...rec, savedAt: Date.now() }));
  } catch {
    // Нет хранилища — после F5 будет обычная проверка устройств.
  }
}

function empty(): StoredRejoin {
  return { inRoom: false, joinPath: null, mic: false, cam: false, act: false, micId: null, camId: null, spkId: null, savedAt: 0 };
}

/** Путь документа, если вкладку перезагрузили; иначе `null`. */
function reloadedPath(): string | null {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== "reload") return null;
  try {
    return new URL(nav.name).pathname;
  } catch {
    return null;
  }
}

function matchesReload(lessonId: string, rec: StoredRejoin): boolean {
  const path = reloadedPath();
  return path !== null && (path === `/lessons/${lessonId}/room` || (rec.joinPath !== null && path === rec.joinPath));
}

export function readRejoinState(lessonId: string | undefined): RejoinState | null {
  if (!lessonId) return null;
  const rec = load(lessonId);
  if (!rec?.inRoom || !matchesReload(lessonId, rec)) return null;
  return { mic: rec.mic, cam: rec.cam, act: rec.act, micId: rec.micId, camId: rec.camId, spkId: rec.spkId };
}

/** Вкладку перезагрузили именно на этом адресе. */
export function isReloadOf(path: string): boolean {
  return reloadedPath() === path;
}

/**
 * Экран входа по ссылке после F5: комната урока `lessonId` уже показывала эту
 * ссылку в адресной строке — вернуть участника в комнату без повторного ввода
 * имени. Пропускать ли там проверку устройств, решает `readRejoinState`
 * (только если он уже входил), как было и с адресом `/lessons/<id>/room`.
 */
export function shouldRejoinViaLink(lessonId: string, linkPath: string): boolean {
  return isReloadOf(linkPath) && load(lessonId)?.joinPath === linkPath;
}

export function writeRejoinState(lessonId: string | undefined, patch: Partial<RejoinState>) {
  if (!lessonId) return;
  const rec = load(lessonId) ?? empty();
  save(lessonId, { ...rec, ...patch, inRoom: true });
}

/** Запомнить ссылку урока (не отмечает «в уроке» — это делает только вход после проверки устройств). */
export function rememberJoinPath(lessonId: string | undefined, joinPath: string) {
  if (!lessonId) return;
  const rec = load(lessonId) ?? empty();
  if (rec.joinPath !== joinPath) save(lessonId, { ...rec, joinPath });
}

/** Участник сам вышел — перезагрузка не должна возвращать его в урок. */
export function clearRejoinState(lessonId: string | undefined) {
  if (!lessonId) return;
  try {
    window.localStorage.removeItem(key(lessonId));
  } catch {
    // нечего чистить
  }
}

/**
 * С чем человек обычно входит — общее для всех уроков на этом устройстве
 * (запрос 2026-10-13: «каждый раз приходится выключать звук сразу после
 * входа»; 2026-10-15: запоминать и выбранные устройства, и что доступ к ним
 * уже дан — чтобы страница проверки не спрашивала каждый раз). То же
 * исключение из правила «без localStorage»: только выбор устройств и флаги.
 */
export interface JoinDefaults {
  mic: boolean;
  cam: boolean;
  micId?: string | null;
  camId?: string | null;
  spkId?: string | null;
  /** Браузер уже давал доступ к микрофону / камере на этом устройстве. */
  micGranted?: boolean;
  camGranted?: boolean;
}

const JOIN_DEFAULTS_KEY = "matis.room.join-defaults";

const optId = (v: unknown) => (typeof v === "string" && v ? v : null);

export function readJoinDefaults(): JoinDefaults | null {
  try {
    const raw = window.localStorage.getItem(JOIN_DEFAULTS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<JoinDefaults>;
    if (typeof v.mic !== "boolean" || typeof v.cam !== "boolean") return null;
    return {
      mic: v.mic,
      cam: v.cam,
      micId: optId(v.micId),
      camId: optId(v.camId),
      spkId: optId(v.spkId),
      micGranted: v.micGranted === true,
      camGranted: v.camGranted === true,
    };
  } catch {
    return null;
  }
}

export function writeJoinDefaults(defaults: JoinDefaults) {
  try {
    const prev = readJoinDefaults();
    // Доступ, однажды выданный, не теряем, если в этот раз устройство не открывали.
    window.localStorage.setItem(
      JOIN_DEFAULTS_KEY,
      JSON.stringify({
        ...defaults,
        micGranted: defaults.micGranted || prev?.micGranted || false,
        camGranted: defaults.camGranted || prev?.camGranted || false,
      }),
    );
  } catch {
    // Нет хранилища — в следующий раз обычные значения по умолчанию.
  }
}
