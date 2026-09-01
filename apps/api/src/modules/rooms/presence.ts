import type { ParticipantPermissions, Role } from "@school/shared";
import { redis } from "../../db/redis.js";

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

/** Отдельная функция без Redis-эффектов — детерминированное правило зачистки, легко тестируется. */
export function isStaleEntry(entry: PresenceEntry, now: number, graceMs: number, heartbeatTimeoutMs: number): boolean {
  if (!entry.connected) return now - entry.lastSeenAt > graceMs;
  return now - entry.lastSeenAt > heartbeatTimeoutMs;
}
