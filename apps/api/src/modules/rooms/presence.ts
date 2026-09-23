import type { LessonMode, LessonStage, ParticipantKind, ParticipantPermissions, Role } from "@school/shared";
import { redis } from "../../db/redis.js";

/** Э6.4, §5.2 ТЗ: продуктовый рычаг — экономит 3–4× трафика, переключение осознанное действие учителя. */
const DEFAULT_LESSON_MODE: LessonMode = "lecture";

/** Э12 полировка: пока никто не переключал доску — все на «плитках». */
const DEFAULT_LESSON_STAGE: LessonStage = "people";

export interface PresenceEntry {
  fullName: string;
  /** Э12.4: вид участника — права на уроке зависят от него, не от `role`. */
  kind: ParticipantKind;
  /** Роль аккаунта персонала; `null` у гостя-ученика. */
  role: Role | null;
  connected: boolean;
  handRaised: boolean;
  /** Э6.3, §5.3 ТЗ: закреплено учителем в видимой сетке видео — не право, обычное ephemeral-состояние, как handRaised. */
  pinned: boolean;
  permissions: ParticipantPermissions;
  joinedAt: string;
  lastSeenAt: number;
}

/** Персонал (`staff`) по умолчанию управляет комнатой, гость-ученик получает права от учителя. */
export function defaultPermissions(kind: ParticipantKind): ParticipantPermissions {
  const isStaff = kind === "staff";
  return { canDraw: isStaff, canSpeak: isStaff, canShareScreen: isStaff, canPublishVideo: isStaff };
}

function key(lessonId: string): string {
  return `room:${lessonId}:participants`;
}

export async function setParticipant(lessonId: string, userId: string, entry: PresenceEntry): Promise<void> {
  await redis.hset(key(lessonId), userId, JSON.stringify(entry));
}

export async function getParticipant(lessonId: string, userId: string): Promise<PresenceEntry | null> {
  const raw = await redis.hget(key(lessonId), userId);
  return raw ? (JSON.parse(raw) as PresenceEntry) : null;
}

export async function removeParticipant(lessonId: string, userId: string): Promise<void> {
  await redis.hdel(key(lessonId), userId);
}

export async function listParticipants(lessonId: string): Promise<Map<string, PresenceEntry>> {
  const raw = await redis.hgetall(key(lessonId));
  const result = new Map<string, PresenceEntry>();
  for (const [userId, value] of Object.entries(raw)) {
    result.set(userId, JSON.parse(value) as PresenceEntry);
  }
  return result;
}

export async function countConnected(lessonId: string): Promise<number> {
  const all = await listParticipants(lessonId);
  let n = 0;
  for (const entry of all.values()) if (entry.connected) n++;
  return n;
}

function grantsKey(lessonId: string): string {
  return `room:${lessonId}:grants`;
}

/** Гранты учителя переживают перезаход ученика в пределах дня занятий, но не копятся вечно. */
const GRANTS_TTL_SECONDS = 12 * 60 * 60;

/**
 * Права, выданные учителем вручную, — отдельно от presence-записи: sweep
 * удаляет запись заснувшего телефона, и при перезаходе ученик получал права
 * по настройкам урока, теряя выданное (рисовал «в пустоту» после
 * пробуждения).
 */
export async function getGrantedPermissions(
  lessonId: string,
  userId: string,
): Promise<ParticipantPermissions | null> {
  const raw = await redis.hget(grantsKey(lessonId), userId);
  return raw ? (JSON.parse(raw) as ParticipantPermissions) : null;
}

export async function setGrantedPermissions(
  lessonId: string,
  userId: string,
  permissions: ParticipantPermissions,
): Promise<void> {
  await redis.hset(grantsKey(lessonId), userId, JSON.stringify(permissions));
  await redis.expire(grantsKey(lessonId), GRANTS_TTL_SECONDS);
}

function modeKey(lessonId: string): string {
  return `room:${lessonId}:mode`;
}

/** Э6.4: режим урока — ephemeral, не в Postgres (см. rooms/service.ts#setLessonMode). Сбрасывается в дефолт естественно с новым Redis-ключом урока, отдельного TTL/очистки не заводили — тот же режим, в котором уже живёт остальной presence. */
export async function getLessonMode(lessonId: string): Promise<LessonMode> {
  const raw = await redis.get(modeKey(lessonId));
  return (raw as LessonMode | null) ?? DEFAULT_LESSON_MODE;
}

export async function setLessonMode(lessonId: string, mode: LessonMode): Promise<void> {
  await redis.set(modeKey(lessonId), mode);
}

function modeBeforeShareKey(lessonId: string): string {
  return `room:${lessonId}:modeBeforeShare`;
}

/**
 * Режим урока ДО начала демонстрации экрана (Э7.3, §5.3 ТЗ: автопереход в
 * Лекцию на время демонстрации) — чтобы вернуть его обратно, когда
 * демонстрация закончится. `null` означает «сейчас не сохранён» (либо
 * демонстрации нет, либо режим и так уже был `lecture` до неё — сохранять
 * тогда нечего и не нужно откатывать). Отдельный ключ, не переиспользование
 * `modeKey`, — оба значения нужны одновременно: текущий (уже `lecture` на
 * время демонстрации) и тот, к которому нужно будет вернуться.
 */
export async function getLessonModeBeforeShare(lessonId: string): Promise<LessonMode | null> {
  const raw = await redis.get(modeBeforeShareKey(lessonId));
  return (raw as LessonMode | null) ?? null;
}

export async function setLessonModeBeforeShare(lessonId: string, mode: LessonMode | null): Promise<void> {
  if (mode === null) {
    await redis.del(modeBeforeShareKey(lessonId));
  } else {
    await redis.set(modeBeforeShareKey(lessonId), mode);
  }
}

function stageKey(lessonId: string): string {
  return `room:${lessonId}:stage`;
}

/** Стейдж урока (плитки/доска) — тот же характер хранения, что и режим урока выше: ephemeral, без TTL. */
export async function getLessonStage(lessonId: string): Promise<LessonStage> {
  const raw = await redis.get(stageKey(lessonId));
  return (raw as LessonStage | null) ?? DEFAULT_LESSON_STAGE;
}

export async function setLessonStage(lessonId: string, stage: LessonStage): Promise<void> {
  await redis.set(stageKey(lessonId), stage);
}

/** Отдельная функция без Redis-эффектов — детерминированное правило зачистки, легко тестируется. */
export function isStaleEntry(entry: PresenceEntry, now: number, graceMs: number, heartbeatTimeoutMs: number): boolean {
  if (!entry.connected) return now - entry.lastSeenAt > graceMs;
  return now - entry.lastSeenAt > heartbeatTimeoutMs;
}

function screenShareKey(lessonId: string): string {
  return `room:${lessonId}:screenShare`;
}

/**
 * Пользовательский баг (2026-09-14): 2 участника почти одновременно жмут
 * «Демонстрация» → оба трека реально публикуются (сервер гасил ВТОРОГО
 * только ПОСЛЕ публикации, вебхуком — окно гонки между «уже опубликовано»
 * и «уже погашено» приводило к тому, что клиент на миг видел 2 демонстрации
 * разом и что-то в рендере ломалось). Этот лок — превентивный: клиент
 * теперь СНАЧАЛА спрашивает разрешение (`POST /lessons/:id/screen-share/
 * claim`) и только при `granted: true` реально вызывает
 * `setScreenShareEnabled`, гонки между двумя такими запросами больше нет —
 * `SET NX` в Redis атомарен, выигрывает ровно один. TTL — подстраховка на
 * случай, если ни один путь освобождения (явный `release`, вебхук
 * `track_unpublished`) не сработает (вебхуки иногда не доставляются, см.
 * `failed to send webhook` в логах LiveKit) — лок не должен пережить урок.
 */
const SCREEN_SHARE_LOCK_TTL_SECONDS = 6 * 60 * 60;

/** Атомарный захват права демонстрации — `NX` гарантирует, что при одновременном вызове выиграет ровно один. */
export async function claimScreenShare(lessonId: string, participantId: string): Promise<boolean> {
  const result = await redis.set(
    screenShareKey(lessonId),
    participantId,
    "EX",
    SCREEN_SHARE_LOCK_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
}

/** Без `NX` — учитель/админ перехватывает лок безусловно (приоритет, Э7.2). */
export async function forceClaimScreenShare(lessonId: string, participantId: string): Promise<void> {
  await redis.set(screenShareKey(lessonId), participantId, "EX", SCREEN_SHARE_LOCK_TTL_SECONDS);
}

export async function getScreenShareHolder(lessonId: string): Promise<string | null> {
  return redis.get(screenShareKey(lessonId));
}

const RELEASE_SCREEN_SHARE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/** Compare-and-delete через Lua (атомарно) — снимает лок, только если он всё ещё принадлежит ЭТОМУ участнику, иначе чужой уже перехваченный лок случайно не погасить. */
export async function releaseScreenShare(lessonId: string, participantId: string): Promise<void> {
  await redis.eval(RELEASE_SCREEN_SHARE_SCRIPT, 1, screenShareKey(lessonId), participantId);
}
