import type {
  AccessTokenPayload,
  ChatMessage,
  JoinLessonResponse,
  LessonStatus,
  ListChatQuery,
  ParticipantSnapshot,
  UpdateParticipantPermissionsRequest,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as canvasService from "../canvas/service.js";
import * as lessonsService from "../lessons/service.js";
import * as mediaService from "../media/service.js";
import * as usersService from "../users/service.js";
import * as presence from "./presence.js";
import type { PresenceEntry } from "./presence.js";
import * as repo from "./repo.js";
import { emitRoomEvent } from "./events.js";

const RECONNECT_GRACE_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const EMPTY_ROOM_AUTOEND_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15_000;
/** §5.2 ТЗ: не более 4 включённых микрофонов учеников одновременно, см. память project-video-platform-media-limits. */
const MAX_SIMULTANEOUS_STUDENT_MICS = 4;

/** lessonId -> schoolId, для фоновой зачистки и авто-завершения пустых комнат. */
const activeLessons = new Map<string, string>();
const emptyRoomTimers = new Map<string, NodeJS.Timeout>();
let sweepInterval: NodeJS.Timeout | null = null;

function toSnapshot(userId: string, entry: PresenceEntry): ParticipantSnapshot {
  return {
    userId,
    fullName: entry.fullName,
    role: entry.role,
    connected: entry.connected,
    handRaised: entry.handRaised,
    permissions: entry.permissions,
    joinedAt: entry.joinedAt,
  };
}

export async function listParticipantsSnapshot(lessonId: string): Promise<ParticipantSnapshot[]> {
  const participants = await presence.listParticipants(lessonId);
  return [...participants.entries()].map(([id, entry]) => toSnapshot(id, entry));
}

/** Проверяет, что пользователь имеет право находиться в этом уроке. Читать построчно (§1.2 CLAUDE.md). */
async function assertMembership(schoolId: string, lessonId: string, user: AccessTokenPayload) {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  if (user.role === "admin") return lesson;
  if (user.role === "teacher") {
    if (lesson.teacherId !== user.sub) {
      throw new AppError(403, "forbidden", "Вы не ведёте этот урок");
    }
    return lesson;
  }
  if (user.role === "student") {
    const isMember = await usersService.isGroupMember(lesson.groupId, user.sub);
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в группе этого урока");
    }
    return lesson;
  }
  throw new AppError(403, "forbidden", "Роль не допускается к участию в уроке");
}

function clearEmptyRoomTimer(lessonId: string): void {
  const timer = emptyRoomTimers.get(lessonId);
  if (timer) {
    clearTimeout(timer);
    emptyRoomTimers.delete(lessonId);
  }
}

async function scheduleAutoEndIfEmpty(schoolId: string, lessonId: string): Promise<void> {
  const participants = await presence.listParticipants(lessonId);
  if (participants.size > 0) {
    clearEmptyRoomTimer(lessonId);
    return;
  }
  if (emptyRoomTimers.has(lessonId)) return;

  const timer = setTimeout(() => {
    emptyRoomTimers.delete(lessonId);
    void (async () => {
      try {
        const stillEmpty = (await presence.listParticipants(lessonId)).size === 0;
        if (!stillEmpty) return;
        const lesson = await lessonsService.getLesson(schoolId, lessonId);
        if (lesson.status !== "live") return;
        await lessonsService.endLesson(schoolId, lessonId);
        canvasService.closeCanvasDocument(lessonId);
        emitRoomEvent(lessonId, { type: "lesson_status", status: "ended" });
        activeLessons.delete(lessonId);
      } catch (err) {
        console.error("rooms: auto-end failed", lessonId, err);
      }
    })();
  }, EMPTY_ROOM_AUTOEND_MS);
  timer.unref?.();
  emptyRoomTimers.set(lessonId, timer);
}

export async function join(
  schoolId: string,
  lessonId: string,
  user: AccessTokenPayload,
  fullName: string,
): Promise<JoinLessonResponse> {
  const lesson = await assertMembership(schoolId, lessonId, user);
  if (lesson.status === "ended" || lesson.status === "cancelled") {
    throw new AppError(409, "lesson_not_joinable", "Урок завершён или отменён");
  }

  activeLessons.set(lessonId, schoolId);
  clearEmptyRoomTimer(lessonId);

  const existing = await presence.getParticipant(lessonId, user.sub);
  const entry: PresenceEntry = existing
    ? { ...existing, connected: true, lastSeenAt: Date.now() }
    : {
        fullName,
        role: user.role,
        connected: true,
        handRaised: false,
        permissions: presence.defaultPermissions(user.role),
        joinedAt: new Date().toISOString(),
        lastSeenAt: Date.now(),
      };
  await presence.setParticipant(lessonId, user.sub, entry);
  if (!existing) {
    await repo.insertJoin(lessonId, user.sub);
  }

  let lessonStatus: LessonStatus = lesson.status;
  if (lessonStatus === "scheduled" && (user.role === "teacher" || user.role === "admin")) {
    const updated = await lessonsService.startLesson(schoolId, lessonId);
    lessonStatus = updated.status;
    emitRoomEvent(lessonId, { type: "lesson_status", status: lessonStatus });
  }

  const snapshot = toSnapshot(user.sub, entry);
  if (existing) {
    emitRoomEvent(lessonId, { type: "presence", participants: await listParticipantsSnapshot(lessonId) });
  } else {
    emitRoomEvent(lessonId, { type: "participant_joined", participant: snapshot });
  }

  const livekitRoom = await lessonsService.ensureLivekitRoom(schoolId, lessonId);
  const media = await mediaService.createParticipantConnection({
    livekitRoom,
    userId: user.sub,
    fullName,
    permissions: entry.permissions,
    lessonStartsAt: lesson.startsAt,
    lessonDurationMin: lesson.durationMin,
  });

  return { lessonStatus, participants: await listParticipantsSnapshot(lessonId), self: snapshot, media };
}

/** Явный выход (кнопка «Выйти»/POST leave) — без grace-периода на переподключение. */
export async function leave(schoolId: string, lessonId: string, user: AccessTokenPayload): Promise<void> {
  await presence.removeParticipant(lessonId, user.sub);
  await repo.closeOpenSession(lessonId, user.sub);
  emitRoomEvent(lessonId, { type: "participant_left", userId: user.sub });
  await scheduleAutoEndIfEmpty(schoolId, lessonId);
}

/**
 * Подключение WS к уже созданному через POST /join участнику комнаты.
 * Возвращает null, если участник ещё не входил в урок через HTTP — сокет должен закрыться.
 */
export async function attachSocket(lessonId: string, userId: string): Promise<ParticipantSnapshot | null> {
  const entry = await presence.getParticipant(lessonId, userId);
  if (!entry) return null;
  const wasDisconnected = !entry.connected;
  const updated: PresenceEntry = { ...entry, connected: true, lastSeenAt: Date.now() };
  await presence.setParticipant(lessonId, userId, updated);
  if (wasDisconnected) {
    emitRoomEvent(lessonId, { type: "presence", participants: await listParticipantsSnapshot(lessonId) });
  }
  return toSnapshot(userId, updated);
}

/** Разрыв WS-соединения (не намеренный выход) — даём grace-период на переподключение. */
export async function markDisconnected(lessonId: string, userId: string): Promise<void> {
  const entry = await presence.getParticipant(lessonId, userId);
  if (!entry || !entry.connected) return;
  await presence.setParticipant(lessonId, userId, { ...entry, connected: false, lastSeenAt: Date.now() });
  emitRoomEvent(lessonId, { type: "presence", participants: await listParticipantsSnapshot(lessonId) });
}

export async function touchHeartbeat(lessonId: string, userId: string): Promise<void> {
  const entry = await presence.getParticipant(lessonId, userId);
  if (!entry) return;
  entry.lastSeenAt = Date.now();
  await presence.setParticipant(lessonId, userId, entry);
}

export async function setHandRaised(
  schoolId: string,
  lessonId: string,
  user: AccessTokenPayload,
  raised: boolean,
): Promise<void> {
  await assertMembership(schoolId, lessonId, user);
  const entry = await presence.getParticipant(lessonId, user.sub);
  if (!entry) {
    throw new AppError(409, "not_in_room", "Сначала войдите в урок");
  }
  entry.handRaised = raised;
  entry.lastSeenAt = Date.now();
  await presence.setParticipant(lessonId, user.sub, entry);
  emitRoomEvent(lessonId, { type: "hand_raised", userId: user.sub, raised });
}

/** Считает учеников (не учителей/админов) с уже включённым микрофоном, кроме исключённого — для проверки лимита §5.2 ТЗ. */
async function countActiveStudentMics(lessonId: string, excludeUserId?: string): Promise<number> {
  const participants = await presence.listParticipants(lessonId);
  let count = 0;
  for (const [userId, entry] of participants) {
    if (userId === excludeUserId) continue;
    if (entry.role === "student" && entry.permissions.canSpeak) count++;
  }
  return count;
}

/**
 * Меняет права участника (Э1) и, если это влияет на аудио, синхронизирует уже
 * выданный LiveKit-грант вживую (Э2.5) — токен неизменяем, простое обновление
 * presence само по себе звук не включит/не выключит. Читать построчно (§1.2
 * CLAUDE.md): порядок шагов важен — LiveKit обновляется ДО presence/WS-broadcast,
 * чтобы при сетевом сбое учитель увидел ошибку и не думал, что ученика
 * замьютили, пока тот технически всё ещё может говорить.
 */
export async function updatePermissions(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  targetUserId: string,
  patch: UpdateParticipantPermissionsRequest,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может менять права участников");
  }
  const entry = await presence.getParticipant(lessonId, targetUserId);
  if (!entry) {
    throw new AppError(404, "not_found", "Участник не найден в комнате");
  }

  if (patch.canSpeak === true && entry.role === "student" && !entry.permissions.canSpeak) {
    const activeMics = await countActiveStudentMics(lessonId, targetUserId);
    if (activeMics >= MAX_SIMULTANEOUS_STUDENT_MICS) {
      throw new AppError(
        409,
        "mic_limit_reached",
        `Одновременно могут говорить не более ${MAX_SIMULTANEOUS_STUDENT_MICS} учеников — сначала выключите чей-то микрофон`,
      );
    }
  }

  const permissions = { ...entry.permissions, ...patch };
  const livekitRoom = await lessonsService.ensureLivekitRoom(schoolId, lessonId);
  await mediaService.updateLivePermissions(livekitRoom, targetUserId, permissions);

  entry.permissions = permissions;
  await presence.setParticipant(lessonId, targetUserId, entry);
  emitRoomEvent(lessonId, { type: "permissions_updated", userId: targetUserId, permissions: entry.permissions });
}

/** Учитель принудительно глушит одного ученика (Э2.5) — право говорить не отзывается, ученик может включить микрофон обратно сам. */
export async function muteParticipantNow(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  targetUserId: string,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может глушить микрофоны участников");
  }
  const livekitRoom = await lessonsService.ensureLivekitRoom(schoolId, lessonId);
  await mediaService.muteParticipant(livekitRoom, targetUserId);
}

/** «Мьют всех» (Э2.5) — глушит микрофоны всех подключённых учеников одной кнопкой, учителя не трогает. */
export async function muteAllNow(schoolId: string, lessonId: string, requester: AccessTokenPayload): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может заглушить всех участников");
  }
  const livekitRoom = await lessonsService.ensureLivekitRoom(schoolId, lessonId);
  const participants = await presence.listParticipants(lessonId);
  const studentIds = [...participants.entries()].filter(([, entry]) => entry.role === "student").map(([userId]) => userId);
  await mediaService.muteMicrophones(livekitRoom, studentIds);
}

/**
 * LiveKit-вебхук `participant_left` (Э2.7) — дополнительная страховка для
 * журнала посещаемости, не замена основного пути. Обычный выход (`leave()`)
 * и sweep по heartbeat уже закрывают `lesson_participants.left_at`; этот
 * путь ловит случаи, где ни то, ни другое не сработало вовремя (авария
 * браузера/сети, где WS не успел штатно закрыться). Осознанно НЕ трогает
 * `presence`/WS-бродкаст — вебхук не знает про grace-период на
 * переподключение (`RECONNECT_GRACE_MS`), и его наивное «участник вышел»
 * могло бы конфликтовать с более аккуратной логикой в `markDisconnected`.
 * Идемпотентно (`repo.closeOpenSession` бьёт по `WHERE left_at IS NULL`).
 */
export async function handleParticipantLeftWebhook(livekitRoom: string, userId: string): Promise<void> {
  const lesson = await lessonsService.getLessonByLivekitRoom(livekitRoom);
  if (!lesson) return;
  await repo.closeOpenSession(lesson.id, userId);
}

/**
 * LiveKit-вебхук `room_finished` (Э2.7) — авторитетный сигнал от самого
 * медиасервера, что комната реально закрылась (краш процесса, ручное
 * `deleteRoom`, истёкший `emptyTimeout`), независимо от нашего собственного
 * 15-минутного таймера пустой комнаты. Идемпотентно: если урок уже не
 * `live`, ничего не делает.
 */
export async function handleRoomFinishedWebhook(livekitRoom: string): Promise<void> {
  const lesson = await lessonsService.getLessonByLivekitRoom(livekitRoom);
  if (!lesson || lesson.status !== "live") return;
  clearEmptyRoomTimer(lesson.id);
  await lessonsService.endLesson(lesson.schoolId, lesson.id);
  canvasService.closeCanvasDocument(lesson.id);
  emitRoomEvent(lesson.id, { type: "lesson_status", status: "ended" });
  activeLessons.delete(lesson.id);
}

export async function sendChatMessage(
  schoolId: string,
  lessonId: string,
  user: AccessTokenPayload,
  body: string,
): Promise<ChatMessage> {
  await assertMembership(schoolId, lessonId, user);
  const entry = await presence.getParticipant(lessonId, user.sub);
  if (!entry) {
    throw new AppError(409, "not_in_room", "Сначала войдите в урок");
  }
  const row = await repo.insertChatMessage(lessonId, user.sub, body);
  const message: ChatMessage = {
    id: row.id,
    lessonId: row.lessonId,
    userId: row.userId,
    authorName: entry.fullName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
  emitRoomEvent(lessonId, { type: "chat_message", message });
  return message;
}

export async function listChatHistory(
  schoolId: string,
  lessonId: string,
  user: AccessTokenPayload,
  query: ListChatQuery,
): Promise<ChatMessage[]> {
  await assertMembership(schoolId, lessonId, user);
  const rows = await repo.listChatMessages(lessonId, query.before ? new Date(query.before) : undefined, query.limit);
  return rows.map((row) => ({
    id: row.id,
    lessonId: row.lessonId,
    userId: row.userId,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function deleteChatMessage(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  messageId: string,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может модерировать чат");
  }
  const row = await repo.softDeleteChatMessage(lessonId, messageId, requester.sub);
  if (!row) {
    throw new AppError(404, "not_found", "Сообщение не найдено");
  }
}

export async function endLessonNow(schoolId: string, lessonId: string, requester: AccessTokenPayload): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может завершить урок");
  }
  clearEmptyRoomTimer(lessonId);
  await lessonsService.endLesson(schoolId, lessonId);
  canvasService.closeCanvasDocument(lessonId);
  emitRoomEvent(lessonId, { type: "lesson_status", status: "ended" });
  activeLessons.delete(lessonId);
}

/** Правило зачистки без сайд-эффектов — вынесено для юнит-тестов. */
export function isStaleEntry(entry: PresenceEntry, now: number): boolean {
  return presence.isStaleEntry(entry, now, RECONNECT_GRACE_MS, HEARTBEAT_TIMEOUT_MS);
}

async function sweepRoom(schoolId: string, lessonId: string): Promise<void> {
  const now = Date.now();
  const participants = await presence.listParticipants(lessonId);
  let changed = false;
  for (const [userId, entry] of participants) {
    if (!isStaleEntry(entry, now)) continue;
    if (entry.connected) {
      await presence.setParticipant(lessonId, userId, { ...entry, connected: false, lastSeenAt: now });
      emitRoomEvent(lessonId, { type: "presence", participants: await listParticipantsSnapshot(lessonId) });
    } else {
      await presence.removeParticipant(lessonId, userId);
      await repo.closeOpenSession(lessonId, userId);
      emitRoomEvent(lessonId, { type: "participant_left", userId });
    }
    changed = true;
  }
  if (changed) {
    await scheduleAutoEndIfEmpty(schoolId, lessonId);
  }
}

export function startPresenceSweep(): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    for (const [lessonId, schoolId] of activeLessons) {
      sweepRoom(schoolId, lessonId).catch((err) => console.error("rooms: sweep failed", lessonId, err));
    }
  }, SWEEP_INTERVAL_MS);
  sweepInterval.unref?.();
}

export function stopPresenceSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}
