import type {
  AccessTokenPayload,
  ChatMessage,
  JoinLessonResponse,
  LessonMode,
  LessonStatus,
  ListChatQuery,
  ParticipantSnapshot,
  ServerRoomMessage,
  UpdateParticipantPermissionsRequest,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as canvasService from "../canvas/service.js";
import type { LessonActor } from "../guests/service.js";
import * as lessonsService from "../lessons/service.js";
import * as mediaService from "../media/service.js";
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
/** §10.8 ТЗ: тот же порог, что Grafana-алерт Э6.6 (80% медиа-бюджета ~750 Мбит/с) — одно число на автоматическую деградацию (Э6.5) и уведомление человека (Э6.6). */
const PLATFORM_TRAFFIC_LIMIT_MBPS = 600;

/** lessonId -> schoolId, для фоновой зачистки и авто-завершения пустых комнат. */
const activeLessons = new Map<string, string>();
const emptyRoomTimers = new Map<string, NodeJS.Timeout>();
let sweepInterval: NodeJS.Timeout | null = null;

function toSnapshot(participantId: string, entry: PresenceEntry): ParticipantSnapshot {
  return {
    userId: participantId,
    fullName: entry.fullName,
    kind: entry.kind,
    role: entry.role,
    connected: entry.connected,
    handRaised: entry.handRaised,
    pinned: entry.pinned,
    permissions: entry.permissions,
    joinedAt: entry.joinedAt,
  };
}

/**
 * Э4.4: мост для других модулей (`decks`) — отправить своё серверное
 * сообщение в тот же WS-канал урока `/ws`. `rooms` владеет этим каналом,
 * поэтому широковещание по уроку — легитимная часть его API. Обратная
 * зависимость `decks → rooms` цикла не создаёт: `rooms` не импортирует `decks`.
 */
export function broadcastToLesson(lessonId: string, message: ServerRoomMessage): void {
  emitRoomEvent(lessonId, message);
}

export async function listParticipantsSnapshot(lessonId: string): Promise<ParticipantSnapshot[]> {
  const participants = await presence.listParticipants(lessonId);
  return [...participants.entries()].map(([id, entry]) => toSnapshot(id, entry));
}

/**
 * Проверяет, что actor имеет право находиться в этом уроке (Э12.4). Читать
 * построчно (§1.2 CLAUDE.md) — это гейт доступа к живому уроку.
 *  - `guest`: гостевая сессия уже проверена `requireLessonAccess` (подпись,
 *    срок, актуальность ссылки) и жёстко привязана к одному `lessonId` —
 *    здесь только сверяем, что это тот же урок, и что урок существует;
 *  - `staff/admin`: любой урок школы;
 *  - `staff/teacher`: только свой урок;
 *  - `staff/methodist`: в комнату урока не допускается (у методиста нет роли
 *    на живом уроке — только библиотека/материалы).
 */
async function assertMembership(actor: LessonActor, lessonId: string) {
  const lesson = await lessonsService.getLesson(actor.schoolId, lessonId);
  if (actor.kind === "guest") {
    if (actor.lessonId !== lessonId) {
      throw new AppError(403, "forbidden", "Гостевая сессия относится к другому уроку");
    }
    return lesson;
  }
  if (actor.role === "admin") return lesson;
  if (actor.role === "teacher") {
    if (lesson.teacherId !== actor.participantId) {
      throw new AppError(403, "forbidden", "Вы не ведёте этот урок");
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

/**
 * Грубая оценка исходящего трафика ОДНОГО урока по режиму и числу
 * участников (Э6.5) — коэффициенты выведены из §5.2/§5.2.1 ТЗ (класс 30:
 * Лекция ~50 Мбит/с — только даунлинк камеры учителя; Обсуждение ~180
 * Мбит/с — плюс 9 видимых учеников). Оба числа линейны по числу
 * подписчиков в исходном расчёте ТЗ, поэтому коэффициент — просто
 * табличное число, делённое на 30. `assignment` («Работа над заданием,
 * любой размер») в таблице §5.2.1 ТЗ ~5 Мбит/с ПЛОСКО, не растёт с числом
 * участников — видео там выключено целиком (Э6.4), остаётся только
 * аудио учителя. `spotlight` ТЗ отдельно не табулирует — приближение по
 * аналогии с `lecture` (тоже один канал видео на подписчика вниз), но
 * потоков не один, а два (учитель + один ученик), коэффициент удвоен.
 * ТЗ прямо предупреждает: настоящие цифры даёт только `livekit-cli
 * load-test` (гейт Э6) — это ОЦЕНКА для решения «пускать ли новую комнату
 * сразу в Обсуждение», а не замена измерению.
 */
export function estimateLessonMbit(mode: LessonMode, participantCount: number): number {
  const CLASS_SIZE = 30;
  switch (mode) {
    case "lecture":
      return (50 / CLASS_SIZE) * participantCount;
    case "discussion":
      return (180 / CLASS_SIZE) * participantCount;
    case "spotlight":
      return (100 / CLASS_SIZE) * participantCount;
    case "assignment":
      return 5;
  }
}

/** Сумма оценок по всем урокам — вынесена отдельно от сбора данных (`activeLessons`/Redis), чтобы саму арифметику можно было проверить юнит-тестом без presence-моков. */
export function estimateTotalTrafficMbit(lessons: { mode: LessonMode; participantCount: number }[]): number {
  return lessons.reduce((sum, l) => sum + estimateLessonMbit(l.mode, l.participantCount), 0);
}

/**
 * Суммарная оценка по ВСЕМ активным урокам, кроме `excludeLessonId`
 * (обычно — только что открываемая комната, которая ещё не должна сама
 * себя учитывать при решении, форсировать ли ей Лекцию). Источник списка
 * уроков — `activeLessons` (тот же in-memory кеш, что уже используют
 * auto-end/sweep — «состояние, которое можно потерять», допустимо по
 * CLAUDE.md); при рестарте `apps/api` он пуст, и до первого нового `join()`
 * ограничитель просто не видит уже идущие уроки — то же ограничение, что
 * уже принято для остального in-memory состояния этого модуля.
 */
async function getLessonTrafficInfo(
  lessonId: string,
): Promise<{ lessonId: string; mode: LessonMode; participantCount: number; estimatedMbit: number }> {
  const [mode, participantCount] = await Promise.all([
    presence.getLessonMode(lessonId),
    presence.countConnected(lessonId),
  ]);
  return { lessonId, mode, participantCount, estimatedMbit: estimateLessonMbit(mode, participantCount) };
}

async function estimatePlatformTrafficMbit(excludeLessonId?: string): Promise<number> {
  const others = [...activeLessons.keys()].filter((id) => id !== excludeLessonId);
  const lessons = await Promise.all(others.map((id) => getLessonTrafficInfo(id)));
  return estimateTotalTrafficMbit(lessons);
}

/**
 * Снимок расчётного трафика по каждому активному уроку (Э6.6, §10.8 ТЗ:
 * «трафик по урокам» в Grafana, «видно, кто ест канал») — экспортируется
 * для `plugins/metrics.ts#lesson_traffic_mbit`, тот же паттерн, что уже
 * есть у `canvas/service.ts#getActiveCanvasDocumentsCount` для
 * `canvas_active_ydocs` (Э3.3): вычисляемая метрика читает состояние
 * модуля напрямую в момент скрейпа, без параллельного счётчика, который
 * мог бы разойтись с реальностью.
 */
/**
 * Сколько участников урока сейчас реально на связи (Э10.5). `recordings`
 * спрашивает это, чтобы отличить «идёт запись живого урока» от «egress
 * жжёт CPU на пустой комнате» — метрика `lesson_recording_no_publishers`
 * и алерт «egress без публикующих». Это ПРОКСИ (кто-то может быть в
 * комнате, но не публиковать ни звук, ни видео — валидный аудио-урок с
 * выключёнными камерами тоже сюда попадёт как «есть участники»), а не
 * прямой подсчёт публикуемых дорожек: точный ответ есть только у самого
 * LiveKit/egress, дёргать его на каждый скрейп Prometheus — дорого.
 */
export async function countConnectedParticipants(lessonId: string): Promise<number> {
  return presence.countConnected(lessonId);
}

export async function getActiveLessonTrafficSnapshot(): Promise<
  { lessonId: string; mode: LessonMode; participantCount: number; estimatedMbit: number }[]
> {
  return Promise.all([...activeLessons.keys()].map((id) => getLessonTrafficInfo(id)));
}

export async function join(actor: LessonActor, lessonId: string): Promise<JoinLessonResponse> {
  const lesson = await assertMembership(actor, lessonId);
  if (lesson.status === "ended" || lesson.status === "cancelled") {
    throw new AppError(409, "lesson_not_joinable", "Урок завершён или отменён");
  }

  const schoolId = actor.schoolId;
  const participantId = actor.participantId;
  const isStaff = actor.kind === "staff";

  activeLessons.set(lessonId, schoolId);
  clearEmptyRoomTimer(lessonId);

  const existing = await presence.getParticipant(lessonId, participantId);
  const entry: PresenceEntry = existing
    ? { ...existing, connected: true, lastSeenAt: Date.now() }
    : {
        fullName: actor.displayName,
        kind: actor.kind,
        role: actor.role,
        connected: true,
        handRaised: false,
        pinned: false,
        permissions: presence.defaultPermissions(actor.kind),
        joinedAt: new Date().toISOString(),
        lastSeenAt: Date.now(),
      };
  await presence.setParticipant(lessonId, participantId, entry);
  if (!existing) {
    await repo.insertJoin({
      lessonId,
      kind: actor.kind,
      userId: isStaff ? participantId : null,
      guestId: isStaff ? null : participantId,
      displayName: isStaff ? null : actor.displayName,
    });
  }

  let lessonStatus: LessonStatus = lesson.status;
  if (lessonStatus === "scheduled" && isStaff && actor.role !== "methodist") {
    const updated = await lessonsService.startLesson(schoolId, lessonId);
    lessonStatus = updated.status;
    emitRoomEvent(lessonId, { type: "lesson_status", status: lessonStatus });

    // Э6.5, §10.8 ТЗ: НОВАЯ комната (только что перешедшая scheduled→live)
    // принудительно открывается в Лекции, если платформа уже перегружена —
    // независимо от того, что могло быть выставлено в режиме этого урока
    // раньше (ephemeral-ключ Redis без TTL, Э6.4). Уже идущие уроки этой
    // проверкой не трогаются — переключить их обратно при превышении
    // порога задача не просит (см. docs/CURRENT_STAGE.md, Э6.5).
    const platformTrafficMbit = await estimatePlatformTrafficMbit(lessonId);
    if (platformTrafficMbit > PLATFORM_TRAFFIC_LIMIT_MBPS) {
      await presence.setLessonMode(lessonId, "lecture");
      emitRoomEvent(lessonId, { type: "lesson_mode", mode: "lecture" });
    }
  }

  const snapshot = toSnapshot(participantId, entry);
  if (existing) {
    emitRoomEvent(lessonId, { type: "presence", participants: await listParticipantsSnapshot(lessonId) });
  } else {
    emitRoomEvent(lessonId, { type: "participant_joined", participant: snapshot });
  }

  const livekitRoom = await lessonsService.ensureLivekitRoom(schoolId, lessonId);
  const media = await mediaService.createParticipantConnection({
    livekitRoom,
    userId: participantId,
    fullName: entry.fullName,
    kind: entry.kind,
    permissions: entry.permissions,
    lessonStartsAt: lesson.startsAt,
    lessonDurationMin: lesson.durationMin,
  });

  const lessonMode = await presence.getLessonMode(lessonId);

  return { lessonStatus, lessonMode, participants: await listParticipantsSnapshot(lessonId), self: snapshot, media };
}

/** Явный выход (кнопка «Выйти»/POST leave) — без grace-периода на переподключение. */
export async function leave(actor: LessonActor, lessonId: string): Promise<void> {
  await presence.removeParticipant(lessonId, actor.participantId);
  await repo.closeOpenSession(lessonId, actor.participantId);
  emitRoomEvent(lessonId, { type: "participant_left", userId: actor.participantId });
  await scheduleAutoEndIfEmpty(actor.schoolId, lessonId);
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
  actor: LessonActor,
  lessonId: string,
  raised: boolean,
): Promise<void> {
  await assertMembership(actor, lessonId);
  const entry = await presence.getParticipant(lessonId, actor.participantId);
  if (!entry) {
    throw new AppError(409, "not_in_room", "Сначала войдите в урок");
  }
  entry.handRaised = raised;
  entry.lastSeenAt = Date.now();
  await presence.setParticipant(lessonId, actor.participantId, entry);
  emitRoomEvent(lessonId, { type: "hand_raised", userId: actor.participantId, raised });
}

/**
 * Учитель закрепляет/открепляет участника в видимой сетке видео (Э6.3,
 * §5.3 ТЗ) — не право (не в `ParticipantPermissions`, участник сам себя
 * закрепить не может), обычное ephemeral-состояние на presence-записи, тот
 * же паттерн, что `setHandRaised`, но выставляет не сам участник, а учитель
 * над кем-то другим — авторизация как у `updatePermissions`/
 * `muteParticipantNow`.
 */
export async function setPinned(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  targetUserId: string,
  pinned: boolean,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может закреплять участников в сетке видео");
  }
  const entry = await presence.getParticipant(lessonId, targetUserId);
  if (!entry) {
    throw new AppError(404, "not_found", "Участник не найден в комнате");
  }
  entry.pinned = pinned;
  await presence.setParticipant(lessonId, targetUserId, entry);
  emitRoomEvent(lessonId, { type: "participant_pinned", userId: targetUserId, pinned });
}

/**
 * Учитель переключает режим урока (Э6.4, §5.3 ТЗ) — управляет медиапрофилем
 * видео (какой видимый набор строит `VideoSubscriptionManager` на клиенте),
 * не правами участников. Хранится в Redis (`presence.ts`), не в Postgres —
 * ephemeral переключатель одного текущего урока, не аудируемая история, тот
 * же характер хранения, что у presence-записей участников.
 */
export async function setLessonMode(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  mode: LessonMode,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может менять режим урока");
  }
  await presence.setLessonMode(lessonId, mode);
  emitRoomEvent(lessonId, { type: "lesson_mode", mode });
}

/** Считает гостей-учеников (не персонал) с уже включённым микрофоном, кроме исключённого — для проверки лимита §5.2 ТЗ. */
async function countActiveStudentMics(lessonId: string, excludeUserId?: string): Promise<number> {
  const participants = await presence.listParticipants(lessonId);
  let count = 0;
  for (const [userId, entry] of participants) {
    if (userId === excludeUserId) continue;
    if (entry.kind === "guest" && entry.permissions.canSpeak) count++;
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

  if (patch.canSpeak === true && entry.kind === "guest" && !entry.permissions.canSpeak) {
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
  await mediaService.updateLivePermissions(livekitRoom, targetUserId, permissions, entry.kind);

  entry.permissions = permissions;
  await presence.setParticipant(lessonId, targetUserId, entry);
  // Э3.8: живой пуш canDraw в canvas — тем же способом (rooms → canvas,
  // не наоборот, см. заметки Э3.2), что closeCanvasDocument. Только когда
  // patch реально трогает canDraw — иначе бессмысленный вызов на каждое
  // изменение canSpeak/canShareScreen.
  if (patch.canDraw !== undefined) {
    canvasService.setDrawPermission(lessonId, targetUserId, permissions.canDraw);
  }
  emitRoomEvent(lessonId, { type: "permissions_updated", userId: targetUserId, permissions: entry.permissions });
}

/**
 * Глобальный тумблер «ученики могут рисовать» (Э3.8) — массово меняет
 * canDraw у всех подключённых учеников разом, учителя/со-учителей не
 * трогает. Не переиспользует `updatePermissions` в цикле: там есть
 * проверка лимита микрофонов и синхронизация LiveKit-гранта — оба
 * нерелевантны для canDraw (право рисования не влияет на аудио-грант).
 */
export async function setDrawForAllStudents(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  canDraw: boolean,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может управлять правом рисования всех участников");
  }
  const participants = await presence.listParticipants(lessonId);
  for (const [userId, entry] of participants) {
    if (entry.kind !== "guest") continue;
    entry.permissions = { ...entry.permissions, canDraw };
    await presence.setParticipant(lessonId, userId, entry);
    canvasService.setDrawPermission(lessonId, userId, canDraw);
  }
  emitRoomEvent(lessonId, { type: "presence", participants: await listParticipantsSnapshot(lessonId) });
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
  const studentIds = [...participants.entries()]
    .filter(([, entry]) => entry.kind === "guest")
    .map(([userId]) => userId);
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

/**
 * LiveKit-вебхук `track_published` для источника SCREEN_SHARE (Э7.2 + Э7.3).
 * Читать построчно (§1.2 CLAUDE.md) — область «не делегировать вслепую»
 * (логика прав + WebRTC): порядок здесь важен, каждый шаг меняет то, что
 * реально видят участники урока.
 *
 * Э7.2, §5.2 ТЗ: «максимум 1 демонстрация одновременно, приоритет
 * учителю». LiveKit сам это не ограничивает (грант лишь разрешает ИСТОЧНИК
 * SCREEN_SHARE, не следит, сколько таких треков уже опубликовано в
 * комнате) — решение принимается здесь, ПОСЛЕ факта публикации, не
 * заранее: WebRTC-негоциацию на клиенте нельзя отменить с сервера ДО того,
 * как трек уже пошёл, можно только замьютить его сразу после.
 *   - Новый публикатор — учитель/админ: гасим ЧУЖИЕ демонстрации (приоритет
 *     учителю — не важно, кто уже делился).
 *   - Новый публикатор — ученик, и кто-то уже делится (не важно, кто): гасим
 *     СВЕЖУЮ демонстрацию сразу — конфликтующие демонстрации учеников не
 *     разрешаются по принципу «кто первый», а мы верны формулировке задачи
 *     («максимум 1»), не изобретаем очередь.
 *
 * Э7.3, §5.3 ТЗ: «автопереход урока в режим Лекция на время демонстрации» —
 * только если демонстрация РЕАЛЬНО состоялась (не была тут же погашена
 * веткой Э7.2 выше). Текущий режим сохраняется в `modeBeforeShare`
 * (`presence.ts`), ТОЛЬКО если он ещё не был сохранён — повторный старт
 * демонстрации (например, вторая от того же участника, пока первая ещё не
 * закончилась) не должен затереть исходный режим значением `lecture`,
 * которое сам же и выставил.
 */
export async function handleScreenShareStartedWebhook(livekitRoom: string, userId: string): Promise<void> {
  const lesson = await lessonsService.getLessonByLivekitRoom(livekitRoom);
  if (!lesson) return;

  const publisher = await presence.getParticipant(lesson.id, userId);
  const isPublisherStaff = publisher?.kind === "staff";
  const others = await mediaService.findOtherActiveScreenShares(livekitRoom, userId);

  if (others.length > 0) {
    if (!isPublisherStaff) {
      // Не учитель, а демонстрация уже идёт — новую гасим, старая продолжается.
      await mediaService.muteScreenShare(livekitRoom, userId);
      return;
    }
    // Учитель — приоритет, гасим все чужие демонстрации.
    await Promise.all(others.map((identity) => mediaService.muteScreenShare(livekitRoom, identity)));
  }

  const currentMode = await presence.getLessonMode(lesson.id);
  if (currentMode !== "lecture") {
    const alreadySaved = await presence.getLessonModeBeforeShare(lesson.id);
    if (alreadySaved === null) {
      await presence.setLessonModeBeforeShare(lesson.id, currentMode);
    }
  }
  await presence.setLessonMode(lesson.id, "lecture");
  emitRoomEvent(lesson.id, { type: "lesson_mode", mode: "lecture" });
}

/**
 * LiveKit-вебхук `track_unpublished` для источника SCREEN_SHARE (Э7.3) —
 * возвращает режим урока, сохранённый `handleScreenShareStartedWebhook` до
 * начала демонстрации. Проверяет через LiveKit (`findOtherActiveScreenShares`
 * без исключения), что демонстраций в комнате больше не осталось вовсе —
 * иначе преждевременно вернул бы режим, пока другая демонстрация (или та
 * же, переподключившаяся) ещё идёт. Если сохранённого режима нет (`null`)
 * — режим уже был `lecture` до демонстрации, восстанавливать нечего.
 */
export async function handleScreenShareStoppedWebhook(livekitRoom: string): Promise<void> {
  const lesson = await lessonsService.getLessonByLivekitRoom(livekitRoom);
  if (!lesson) return;

  const stillSharing = await mediaService.findOtherActiveScreenShares(livekitRoom);
  if (stillSharing.length > 0) return;

  const before = await presence.getLessonModeBeforeShare(lesson.id);
  if (before === null) return;

  await presence.setLessonMode(lesson.id, before);
  await presence.setLessonModeBeforeShare(lesson.id, null);
  emitRoomEvent(lesson.id, { type: "lesson_mode", mode: before });
}

export async function sendChatMessage(
  actor: LessonActor,
  lessonId: string,
  body: string,
): Promise<ChatMessage> {
  await assertMembership(actor, lessonId);
  const entry = await presence.getParticipant(lessonId, actor.participantId);
  if (!entry) {
    throw new AppError(409, "not_in_room", "Сначала войдите в урок");
  }
  const isStaff = actor.kind === "staff";
  const row = await repo.insertChatMessage({
    lessonId,
    userId: isStaff ? actor.participantId : null,
    guestId: isStaff ? null : actor.participantId,
    authorName: entry.fullName,
    body,
  });
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
  actor: LessonActor,
  lessonId: string,
  query: ListChatQuery,
): Promise<ChatMessage[]> {
  await assertMembership(actor, lessonId);
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
