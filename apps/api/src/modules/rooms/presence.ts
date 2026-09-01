import type { LessonMode, ParticipantPermissions, Role } from "@school/shared";
import { redis } from "../../db/redis.js";

/** Э6.4, §5.2 ТЗ: продуктовый рычаг — экономит 3–4× трафика, переключение осознанное действие учителя. */
const DEFAULT_LESSON_MODE: LessonMode = "lecture";

export interface PresenceEntry {
  fullName: string;
  role: Role;
  connected: boolean;
  handRaised: boolean;
  /** Э6.3, §5.3 ТЗ: закреплено учителем в видимой сетке видео — не право, обычное ephemeral-состояние, как handRaised. */
  pinned: boolean;
  permissions: ParticipantPermissions;
  joinedAt: string;
  lastSeenAt: number;
}

/** Учитель и админ по умолчанию управляют комнатой, ученик получает права от учителя. */
export function defaultPermissions(role: Role): ParticipantPermissions {
  const isStaff = role === "teacher" || role === "admin";
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

/** Отдельная функция без Redis-эффектов — детерминированное правило зачистки, легко тестируется. */
export function isStaleEntry(entry: PresenceEntry, now: number, graceMs: number, heartbeatTimeoutMs: number): boolean {
  if (!entry.connected) return now - entry.lastSeenAt > graceMs;
  return now - entry.lastSeenAt > heartbeatTimeoutMs;
}
