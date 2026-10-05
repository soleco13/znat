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

/** Изменение части полей записи участника; права сливаются по ключам. */
export type PresencePatch = Partial<Omit<PresenceEntry, "permissions">> & {
  permissions?: Partial<ParticipantPermissions>;
};

/** Условие для изменения: запись меняется, только если оно ещё выполняется (зачистка «молчащих»). */
export interface PresenceCondition {
  connected?: boolean;
  /** Запись не трогаем, если участник подал признак жизни позже этого момента. */
  maxLastSeenAt?: number;
}

/** Чистая версия того, что делает `PATCH_PARTICIPANT_SCRIPT` в Redis, — для тестов и in-memory моков. */
export function applyPresencePatch(
  entry: PresenceEntry,
  patch: PresencePatch,
  condition: PresenceCondition = {},
): PresenceEntry | null {
  if (condition.connected !== undefined && entry.connected !== condition.connected) return null;
  if (condition.maxLastSeenAt !== undefined && entry.lastSeenAt > condition.maxLastSeenAt) return null;
  const { permissions, ...rest } = patch;
  return { ...entry, ...rest, permissions: { ...entry.permissions, ...permissions } };
}

/**
 * Атомарное изменение записи участника внутри Redis. Раньше каждый шаг
 * читал JSON целиком, менял поле и записывал обратно — пинг раз в 20 с
 * затирал только что выданное учителем право, а «удалить из урока» могло
 * «воскресить» ученика, если пинг пришёл в тот же момент. Скрипт меняет
 * только переданные поля и не создаёт запись, которой уже нет.
 * Возвращает {старое, новое} или nil (записи нет / условие не выполнено).
 */
const PATCH_PARTICIPANT_SCRIPT = `
local raw = redis.call("HGET", KEYS[1], ARGV[1])
if not raw then return false end
local entry = cjson.decode(raw)
local patch = cjson.decode(ARGV[2])
local cond = cjson.decode(ARGV[3])
if cond.connected ~= nil and entry.connected ~= cond.connected then return false end
if cond.maxLastSeenAt ~= nil and entry.lastSeenAt > cond.maxLastSeenAt then return false end
for k, v in pairs(patch) do
  if k == "permissions" then
    for pk, pv in pairs(v) do entry.permissions[pk] = pv end
  else
    entry[k] = v
  end
end
local out = cjson.encode(entry)
redis.call("HSET", KEYS[1], ARGV[1], out)
return {raw, out}
`;

export async function patchParticipant(
  lessonId: string,
  userId: string,
  patch: PresencePatch,
  condition: PresenceCondition = {},
): Promise<{ before: PresenceEntry; after: PresenceEntry } | null> {
  const result = (await redis.eval(
    PATCH_PARTICIPANT_SCRIPT,
    1,
    key(lessonId),
    userId,
    JSON.stringify(patch),
    JSON.stringify(condition),
  )) as [string, string] | null;
  if (!result) return null;
  return { before: JSON.parse(result[0]) as PresenceEntry, after: JSON.parse(result[1]) as PresenceEntry };
}

const REMOVE_PARTICIPANT_IF_SCRIPT = `
local raw = redis.call("HGET", KEYS[1], ARGV[1])
if not raw then return 0 end
local entry = cjson.decode(raw)
local cond = cjson.decode(ARGV[2])
if cond.connected ~= nil and entry.connected ~= cond.connected then return 0 end
if cond.maxLastSeenAt ~= nil and entry.lastSeenAt > cond.maxLastSeenAt then return 0 end
return redis.call("HDEL", KEYS[1], ARGV[1])
`;

/** Удаляет участника, только если условие ещё выполняется (зачистка не удаляет того, кто только что вернулся). */
export async function removeParticipantIf(
  lessonId: string,
  userId: string,
  condition: PresenceCondition,
): Promise<boolean> {
  const removed = await redis.eval(REMOVE_PARTICIPANT_IF_SCRIPT, 1, key(lessonId), userId, JSON.stringify(condition));
  return removed === 1;
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

/** Уроки, у которых в Redis есть presence-записи. SCAN, а не KEYS — не блокирует Redis. */
export async function listRoomIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "room:*:participants", "COUNT", 200);
    cursor = next;
    for (const k of keys) ids.push(k.slice("room:".length, -":participants".length));
  } while (cursor !== "0");
  return ids;
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

export async function clearGrantedPermissions(lessonId: string, userId: string): Promise<void> {
  await redis.hdel(grantsKey(lessonId), userId);
}

const ADMIT_GUEST_SCRIPT = `
if redis.call("HEXISTS", KEYS[1], ARGV[1]) == 1 then return 2 end
local guests = 0
for _, raw in ipairs(redis.call("HVALS", KEYS[1])) do
  local ok, entry = pcall(cjson.decode, raw)
  if ok and entry.kind == "guest" then guests = guests + 1 end
end
if guests >= tonumber(ARGV[3]) then return 0 end
if ARGV[4] == "1" then
  local now = tonumber(ARGV[5])
  local window = tonumber(ARGV[6])
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now - window)
  if redis.call("ZCARD", KEYS[2]) >= tonumber(ARGV[7]) then return 3 end
  redis.call("ZADD", KEYS[2], now, ARGV[1])
  redis.call("PEXPIRE", KEYS[2], window)
end
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
return 1
`;

export type AdmitGuestResult = "admitted" | "exists" | "full" | "throttled";

/**
 * G-06: потолок НОВЫХ гостевых личностей урока за окно. Каждая новая
 * личность — строка журнала посещений навсегда (к ней привязываются ответы,
 * удалять нельзя), а `/enter` выдаёт новую личность на каждый запрос.
 * Вернувшийся ученик (у него уже есть строка) сюда не считается.
 */
export interface NewGuestLimit {
  max: number;
  windowMs: number;
  now?: number;
}

function newGuestsKey(lessonId: string): string {
  return `room:${lessonId}:new-guests`;
}

/**
 * Новый гость в presence — одной атомарной операцией «посчитать гостей и
 * записать». Раньше подсчёт и запись шли двумя командами, и одновременные
 * входы при 49/50 проходили все (аудит 2026-10-05, G-03). Скрипт —
 * миллисекунды на ≤ сотню записей, обычный вход он не задерживает.
 */
export async function admitGuest(
  lessonId: string,
  userId: string,
  entry: PresenceEntry,
  maxGuests: number,
  newGuestLimit?: NewGuestLimit,
): Promise<AdmitGuestResult> {
  const result = await redis.eval(
    ADMIT_GUEST_SCRIPT,
    2,
    key(lessonId),
    newGuestsKey(lessonId),
    userId,
    JSON.stringify(entry),
    maxGuests,
    newGuestLimit ? "1" : "0",
    newGuestLimit?.now ?? Date.now(),
    newGuestLimit?.windowMs ?? 0,
    newGuestLimit?.max ?? 0,
  );
  return result === 1 ? "admitted" : result === 2 ? "exists" : result === 3 ? "throttled" : "full";
}

function leftKey(lessonId: string, userId: string): string {
  return `room:${lessonId}:left:${userId}`;
}

/**
 * Участник сам вышел из урока («Выйти»). Пока жив его медиатокен, отметка
 * велит вебхуку LiveKit выкинуть его, если он подключится к комнате снова в
 * обход `/join` (аудит 2026-10-05, G-01). Новый `/join` её снимает.
 */
export async function markLeft(lessonId: string, userId: string, ttlSeconds: number): Promise<void> {
  await redis.set(leftKey(lessonId, userId), "1", "EX", ttlSeconds);
}

export async function clearLeft(lessonId: string, userId: string): Promise<void> {
  await redis.del(leftKey(lessonId, userId));
}

export async function hasLeft(lessonId: string, userId: string): Promise<boolean> {
  return (await redis.exists(leftKey(lessonId, userId))) === 1;
}

export async function countGuests(lessonId: string): Promise<number> {
  const all = await listParticipants(lessonId);
  let n = 0;
  for (const entry of all.values()) if (entry.kind === "guest") n++;
  return n;
}

function entryLockKey(lessonId: string): string {
  return `room:${lessonId}:entryLocked`;
}

/** Урок постоянный: забытый замок не должен закрыть вход на следующее занятие. */
const ENTRY_LOCK_TTL_SECONDS = 12 * 60 * 60;

export async function isEntryLocked(lessonId: string): Promise<boolean> {
  return (await redis.exists(entryLockKey(lessonId))) === 1;
}

export async function setEntryLocked(lessonId: string, locked: boolean): Promise<void> {
  if (locked) {
    await redis.set(entryLockKey(lessonId), "1", "EX", ENTRY_LOCK_TTL_SECONDS);
  } else {
    await redis.del(entryLockKey(lessonId));
  }
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

/**
 * Идемпотентность отправки в чат (`clientMessageId`). Сетевой стек браузера
 * сам переотправляет POST, если соединение умерло, не дождавшись ответа, а
 * старое соединение после возврата сети ещё доносит первый — в БД оказывалось
 * два одинаковых сообщения (E2E 2026-10-04, обрыв 30 с). Ключ живёт 10 минут:
 * дольше браузер и человек одно и то же сообщение не повторяют.
 */
const CHAT_IDEMPOTENCY_TTL_SECONDS = 10 * 60;
const CHAT_IDEMPOTENCY_PENDING = "pending";

function chatIdempotencyKey(lessonId: string, participantId: string, clientMessageId: string): string {
  return `room:${lessonId}:chat-idem:${participantId}:${clientMessageId}`;
}

/** `true` — ключ наш, сообщение можно создавать; иначе вернуть записанное (`getChatIdempotencyResult`). */
export async function claimChatIdempotency(lessonId: string, participantId: string, clientMessageId: string): Promise<boolean> {
  const result = await redis.set(
    chatIdempotencyKey(lessonId, participantId, clientMessageId),
    CHAT_IDEMPOTENCY_PENDING,
    "EX",
    CHAT_IDEMPOTENCY_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
}

/** Созданное по ключу сообщение (JSON) или `null`, пока первый запрос ещё в работе. */
export async function getChatIdempotencyResult(lessonId: string, participantId: string, clientMessageId: string): Promise<string | null> {
  const raw = await redis.get(chatIdempotencyKey(lessonId, participantId, clientMessageId));
  return raw === null || raw === CHAT_IDEMPOTENCY_PENDING ? null : raw;
}

export async function setChatIdempotencyResult(lessonId: string, participantId: string, clientMessageId: string, messageJson: string): Promise<void> {
  await redis.set(chatIdempotencyKey(lessonId, participantId, clientMessageId), messageJson, "EX", CHAT_IDEMPOTENCY_TTL_SECONDS);
}

/** Первый запрос упал до записи — ключ освобождаем, иначе повтор получал бы 409 десять минут. */
export async function releaseChatIdempotency(lessonId: string, participantId: string, clientMessageId: string): Promise<void> {
  await redis.del(chatIdempotencyKey(lessonId, participantId, clientMessageId));
}

/**
 * G-05: частота чата. Окна фиксированные (INCR + PEXPIRE): на участника и на
 * урок целиком — второе держит БД и рассылку, когда спамят многие личности
 * сразу. Счётчик растёт и на отказанные попытки — флуд не «копит» право на
 * следующее окно, честному ученику это не мешает (до предела он не доходит).
 */
export async function hitChatRate(
  lessonId: string,
  participantId: string | null,
  windowMs: number,
  now = Date.now(),
): Promise<{ participant: number; lesson: number }> {
  const window = Math.floor(now / windowMs);
  const lessonKey = `room:${lessonId}:chat-rate:${window}`;
  const multi = redis.multi().incr(lessonKey).pexpire(lessonKey, windowMs * 2);
  const participantKey = participantId ? `room:${lessonId}:chat-rate:${participantId}:${window}` : null;
  if (participantKey) multi.incr(participantKey).pexpire(participantKey, windowMs * 2);
  const results = await multi.exec();
  const lesson = Number(results?.[0]?.[1] ?? 0);
  const participant = participantKey ? Number(results?.[2]?.[1] ?? 0) : 0;
  return { participant, lesson };
}
