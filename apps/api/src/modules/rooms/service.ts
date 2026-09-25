import type {
  AccessTokenPayload,
  ChatMessage,
  ClaimScreenShareResponse,
  JoinLessonResponse,
  LessonMode,
  LessonSettings,
  LessonStage,
  ListChatQuery,
  ParticipantPermissions,
  ParticipantSnapshot,
  ServerRoomMessage,
  UpdateParticipantPermissionsRequest,
} from "@school/shared";
import { lessonSettingsSchema } from "@school/shared";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as canvasService from "../canvas/service.js";
import * as guestsService from "../guests/service.js";
import type { LessonActor } from "../guests/service.js";
import * as lessonsService from "../lessons/service.js";
import * as mediaService from "../media/service.js";
import * as schoolSettingsService from "../school-settings/service.js";
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

/**
 * Уроки с живой комнатой — для фоновой зачистки и оценки трафика. Кеш в
 * памяти процесса: после перезапуска его восстанавливает сам sweep по
 * ключам presence в Redis (см. `runPresenceSweepOnce`).
 */
const activeLessons = new Set<string>();
const emptyRoomTimers = new Map<string, NodeJS.Timeout>();
let sweepInterval: NodeJS.Timeout | null = null;

// Доска спрашивает право рисовать у presence (Redis), если в памяти процесса
// его нет — например, после рестарта сервера посреди урока.
canvasService.setDrawPermissionResolver(async (lessonId, participantId) => {
  const entry = await presence.getParticipant(lessonId, participantId);
  return entry ? entry.permissions.canDraw : null;
});

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

/**
 * Э12.5 — «каноническая» строка участника урока (`lesson_participants.id`),
 * к которой привязываются ответы на задания (`responses.participant_id`).
 * Единственная точка входа для модуля `activities` (правило модульности
 * CLAUDE.md — чужой `repo.ts` не импортируют). Идемпотентно: если строки
 * для этой личности в уроке ещё нет (гость открыл задание, не пройдя через
 * `join` — на практике не бывает, но защищаемся), создаёт её.
 */
export async function ensureParticipant(
  actor: LessonActor,
  lessonId: string,
): Promise<{ id: string; displayName: string }> {
  const isStaff = actor.kind === "staff";
  const identity = {
    userId: isStaff ? actor.participantId : null,
    guestId: isStaff ? null : actor.participantId,
  };
  const existing = await repo.findCanonicalParticipant(lessonId, identity);
  if (existing) return { id: existing.id, displayName: existing.displayName };
  const row = await repo.insertJoin({
    lessonId,
    kind: actor.kind,
    userId: identity.userId,
    guestId: identity.guestId,
    displayName: isStaff ? null : actor.displayName,
  });
  return { id: row!.id, displayName: actor.displayName };
}

/** Presence-id участника по его строке журнала — адресовать WS-сообщение урока конкретному ученику. */
export async function getPresenceId(lessonParticipantId: string): Promise<string | null> {
  return repo.findPresenceId(lessonParticipantId);
}

/** Ростер участников урока для учительских панелей заданий (Э12.5). */
export async function listLessonParticipants(
  lessonId: string,
  scope: { around: Date; engagedIds: string[] },
): Promise<{ id: string; kind: "staff" | "guest"; displayName: string }[]> {
  return repo.listCanonicalParticipants(lessonId, scope.around, scope.engagedIds);
}

/** Имена участников по id строк `lesson_participants` (Э12.5) — для очереди ручной проверки. */
export async function getParticipantNames(
  ids: string[],
): Promise<Map<string, { displayName: string; kind: "staff" | "guest" }>> {
  return repo.findParticipantNames(ids);
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

/**
 * Э12 (§0 план-ТЗ): урок постоянный, без статус-машины. Когда комната
 * пустеет, урок НЕ «завершается» — он остаётся доступен по ссылке всегда.
 * Освобождаем только эфемерные ресурсы: выгружаем Y.Doc холста и снимаем
 * урок с учёта активного трафика. Название функции историческое.
 */
async function scheduleAutoEndIfEmpty(lessonId: string): Promise<void> {
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
        canvasService.closeCanvasDocument(lessonId);
        // Урок постоянный: закрытый вход не переносится на следующее занятие.
        await presence.setEntryLocked(lessonId, false);
        activeLessons.delete(lessonId);
      } catch (err) {
        console.error("rooms: room cleanup failed", lessonId, err);
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

/**
 * Сколько человек сейчас в каждом из перечисленных уроков (Э12 полировка —
 * список уроков в админке/учителя показывает присутствие, не только
 * расписание). `lessonsService.getLesson` заодно проверяет, что урок
 * действительно принадлежит школе запрашивающего — чужой id молча не
 * попадает в ответ, без отдельной ошибки на весь список.
 */
export async function getPresenceCounts(
  schoolId: string,
  lessonIds: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  await Promise.all(
    lessonIds.map(async (id) => {
      try {
        await lessonsService.getLesson(schoolId, id);
      } catch {
        return;
      }
      result[id] = await presence.countConnected(id);
    }),
  );
  return result;
}

export async function getActiveLessonTrafficSnapshot(): Promise<
  { lessonId: string; mode: LessonMode; participantCount: number; estimatedMbit: number }[]
> {
  return Promise.all([...activeLessons.keys()].map((id) => getLessonTrafficInfo(id)));
}

/**
 * Права гостя-ученика при входе в урок — из настроек урока (`lesson.settings`,
 * §1.4 план-ТЗ). Учитель поверх этого может выдать/забрать право конкретному
 * ученику живым грантом (`updateParticipantPermissions`). `settings` —
 * внешняя граница (jsonb в БД), парсим схемой и не доверяем форме.
 */
function guestPermissionsFromSettings(rawSettings: unknown): ParticipantPermissions {
  const parsed = lessonSettingsSchema.safeParse(rawSettings ?? {});
  const s: LessonSettings = parsed.success ? parsed.data : lessonSettingsSchema.parse({});
  return {
    canDraw: s.studentsCanDraw,
    canSpeak: s.studentsCanSpeak,
    canShareScreen: s.studentsCanShareScreen,
    canPublishVideo: s.studentsCanPublishVideo,
  };
}

/**
 * Новый гость (его нет в presence) — два гейта от утёкшей ссылки:
 *  - учитель закрыл вход → пускаем только того, кто уже был на этом уроке
 *    (заснувший телефон, перезагрузка страницы), а не нового человека;
 *  - потолок учеников в уроке (`LESSON_MAX_GUESTS`).
 * Гонка двух одновременных входов может превысить потолок на единицы — это
 * защита от сотен фейковых гостей, а не точный счётчик.
 */
async function assertGuestCanEnter(lessonId: string, guestId: string): Promise<void> {
  if (await presence.isEntryLocked(lessonId)) {
    const wasHere = await repo.findCanonicalParticipant(lessonId, { userId: null, guestId });
    if (!wasHere) {
      throw new AppError(403, "lesson_entry_locked", "Учитель закрыл вход в урок");
    }
  }
  if ((await presence.countGuests(lessonId)) >= env.LESSON_MAX_GUESTS) {
    throw new AppError(403, "lesson_full", `В уроке уже ${env.LESSON_MAX_GUESTS} учеников — это максимум`);
  }
}

export async function join(actor: LessonActor, lessonId: string): Promise<JoinLessonResponse> {
  const lesson = await assertMembership(actor, lessonId);
  // Э12 (§0 план-ТЗ): урок постоянный, без статуса — войти можно всегда,
  // проверка `ended`/`cancelled` убрана.

  const schoolId = actor.schoolId;
  const participantId = actor.participantId;
  const isStaff = actor.kind === "staff";

  activeLessons.add(lessonId);
  clearEmptyRoomTimer(lessonId);

  // Э12.9: раньше «новую» комнату распознавали по переходу урока
  // scheduled→live. Статуса больше нет (урок постоянный), поэтому признак
  // «комната только что открылась» — в ней ещё никого не было.
  const roomWasEmpty = (await presence.countConnected(lessonId)) === 0;

  const existing = (
    await presence.patchParticipant(lessonId, participantId, { connected: true, lastSeenAt: Date.now() })
  )?.after;
  if (!existing && !isStaff) await assertGuestCanEnter(lessonId, participantId);
  const granted = existing || isStaff ? null : await presence.getGrantedPermissions(lessonId, participantId);
  const entry: PresenceEntry = existing
    ? existing
    : {
        fullName: actor.displayName,
        kind: actor.kind,
        role: actor.role,
        connected: true,
        handRaised: false,
        pinned: false,
        // Персонал — всё разрешено по роли. Гость-ученик — по настройкам
        // урока (`lesson.settings`, §1.4 план-ТЗ: «права гостя выводятся
        // отсюда + из живых грантов учителя»). Раньше настройки урока сюда
        // не доходили вовсе — гость всегда получал `defaultPermissions`
        // (всё запрещено), а чекбоксы «ученики включают камеру/экран» в
        // диалоге урока ни на что не влияли. Живой грант учителя
        // (`togglePermission`) поверх этого работает как и работал.
        permissions:
          actor.kind === "staff"
            ? presence.defaultPermissions("staff")
            : (granted ?? guestPermissionsFromSettings(lesson.settings)),
        joinedAt: new Date().toISOString(),
        lastSeenAt: Date.now(),
      };
  if (!existing) await presence.setParticipant(lessonId, participantId, entry);
  // Без явного пуша доска знает только дефолт по роли (гость — read-only), а
  // presence гостя берёт canDraw из настроек урока или сохранённого гранта —
  // клиент рисует, а сервер доски молча отбрасывает штрихи.
  canvasService.setDrawPermission(lessonId, participantId, entry.permissions.canDraw);
  if (!existing) {
    await repo.insertJoin({
      lessonId,
      kind: actor.kind,
      userId: isStaff ? participantId : null,
      guestId: isStaff ? null : participantId,
      displayName: isStaff ? null : actor.displayName,
    });
  }

  if (roomWasEmpty && isStaff && actor.role !== "methodist") {
    // Э6.5, §10.8 ТЗ: НОВАЯ комната (её открывает первым персонал, кроме
    // методиста) принудительно стартует в Лекции, если платформа уже
    // перегружена — независимо от того, что могло быть выставлено в режиме
    // этого урока раньше (ephemeral-ключ Redis без TTL, Э6.4). Уже идущие
    // уроки этой проверкой не трогаются — переключить их обратно при
    // превышении порога задача не просит (см. docs/CURRENT_STAGE.md, Э6.5).
    const platformTrafficMbit = await estimatePlatformTrafficMbit(lessonId);
    if (platformTrafficMbit > PLATFORM_TRAFFIC_LIMIT_MBPS) {
      await presence.setLessonMode(lessonId, "lecture");
      emitRoomEvent(lessonId, { type: "lesson_mode", mode: "lecture" });
    }
  }

  const snapshot = toSnapshot(participantId, entry);
  if (existing) {
    emitRoomEvent(lessonId, { type: "participant_updated", participant: snapshot });
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
  });

  const lessonMode = await presence.getLessonMode(lessonId);
  const stage = await presence.getLessonStage(lessonId);
  const entryLocked = await presence.isEntryLocked(lessonId);
  // Параметры школы (§10.10 ТЗ, запрос 2026-09-14) — мягкие дефолты
  // качества медиа + флаги демонстрации/PiP, и staff, и гостю.
  const clientMediaSettings = await schoolSettingsService.getClientMediaSettings(schoolId);

  return {
    lessonMode,
    stage,
    participants: await listParticipantsSnapshot(lessonId),
    self: snapshot,
    media,
    clientMediaSettings,
    entryLocked,
  };
}

/** Явный выход (кнопка «Выйти»/POST leave) — без grace-периода на переподключение. */
export async function leave(actor: LessonActor, lessonId: string): Promise<void> {
  await presence.removeParticipant(lessonId, actor.participantId);
  await repo.closeOpenSession(lessonId, actor.participantId);
  await presence.releaseScreenShare(lessonId, actor.participantId);
  emitRoomEvent(lessonId, { type: "participant_left", userId: actor.participantId });
  await scheduleAutoEndIfEmpty(lessonId);
}

/**
 * Пользовательский баг (2026-09-14): «2 демонстрации разом ломают сетку камер».
 * Раньше клиент публиковал трек сразу, а сервер разруливал конфликт УЖЕ
 * ПОСЛЕ публикации, вебхуком (`handleScreenShareStartedWebhook`) — окно
 * гонки между «оба трека уже летят» и «вебхук погасил лишний» давало на
 * клиенте на миг 2 живых демонстрации разом (что-то в рендере/подписке на
 * них ломалось). Теперь клиент СНАЧАЛА спрашивает разрешение здесь и
 * публикует трек, только если `granted: true` — гонки между двумя claim'ами
 * не бывает, `SET NX` в Redis атомарен.
 *
 * Не-персонал (гость/ученик): отказ, если лок уже занят кем угодно —
 * значит кто-то уже делится, показываем чьё имя.
 * Персонал (учитель/админ): безусловный перехват (приоритет, Э7.2, как и
 * раньше) — если лок был занят другим участником, тот получает
 * `screen_share_preempted` по WS и обязан сам остановить свой трек
 * локально (см. `RoomPage.tsx`) — сервер его трек не публикует и не может
 * заставить браузер прекратить захват экрана без участия клиента.
 */
export async function claimScreenShare(
  actor: LessonActor,
  lessonId: string,
): Promise<ClaimScreenShareResponse> {
  await assertMembership(actor, lessonId);

  if (actor.kind === "staff") {
    const previousHolder = await presence.getScreenShareHolder(lessonId);
    await presence.forceClaimScreenShare(lessonId, actor.participantId);
    if (previousHolder && previousHolder !== actor.participantId) {
      emitRoomEvent(lessonId, { type: "screen_share_preempted", userId: previousHolder });
    }
    return { granted: true, holderName: null };
  }

  const granted = await presence.claimScreenShare(lessonId, actor.participantId);
  if (granted) return { granted: true, holderName: null };

  const holderId = await presence.getScreenShareHolder(lessonId);
  const holder = holderId ? await presence.getParticipant(lessonId, holderId) : null;
  return { granted: false, holderName: holder?.fullName ?? null };
}

/** Явный отказ от лока — по клику «Стоп» (до/без ожидания вебхука `track_unpublished`, тот освободит и сам — подстраховка на разрыв связи). */
export async function releaseScreenShareClaim(actor: LessonActor, lessonId: string): Promise<void> {
  await presence.releaseScreenShare(lessonId, actor.participantId);
}

/**
 * Подключение WS к уже созданному через POST /join участнику комнаты.
 * Возвращает null, если участник ещё не входил в урок через HTTP — сокет должен закрыться.
 */
export async function attachSocket(lessonId: string, userId: string): Promise<ParticipantSnapshot | null> {
  const result = await presence.patchParticipant(lessonId, userId, { connected: true, lastSeenAt: Date.now() });
  if (!result) return null;
  if (!result.before.connected) {
    emitRoomEvent(lessonId, { type: "participant_updated", participant: toSnapshot(userId, result.after) });
  }
  return toSnapshot(userId, result.after);
}

/** Разрыв WS-соединения (не намеренный выход) — даём grace-период на переподключение. */
export async function markDisconnected(lessonId: string, userId: string): Promise<void> {
  const result = await presence.patchParticipant(
    lessonId,
    userId,
    { connected: false, lastSeenAt: Date.now() },
    { connected: true },
  );
  if (!result) return;
  emitRoomEvent(lessonId, { type: "participant_updated", participant: toSnapshot(userId, result.after) });
}

/**
 * Pong живого сокета. Возвращает `false`, если участника в комнате уже нет
 * (sweep удалил после долгого молчания) — сокет тогда нужно закрыть, чтобы
 * клиент вошёл заново, иначе он висит «на связи», невидимый для остальных.
 */
export async function touchHeartbeat(lessonId: string, userId: string): Promise<boolean> {
  const result = await presence.patchParticipant(lessonId, userId, { connected: true, lastSeenAt: Date.now() });
  if (!result) return false;
  // Sweep мог снять `connected` за пропуск pong-ов (короткий обрыв сети), а
  // сокет при этом выжил — без восстановления участник остаётся скрытым из
  // сетки камер до перезагрузки страницы.
  if (!result.before.connected) {
    emitRoomEvent(lessonId, { type: "participant_updated", participant: toSnapshot(userId, result.after) });
  }
  return true;
}

export async function setHandRaised(
  actor: LessonActor,
  lessonId: string,
  raised: boolean,
): Promise<void> {
  await assertMembership(actor, lessonId);
  const result = await presence.patchParticipant(lessonId, actor.participantId, {
    handRaised: raised,
    lastSeenAt: Date.now(),
  });
  if (!result) {
    throw new AppError(409, "not_in_room", "Сначала войдите в урок");
  }
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
  const result = await presence.patchParticipant(lessonId, targetUserId, { pinned });
  if (!result) {
    throw new AppError(404, "not_found", "Участник не найден в комнате");
  }
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

/**
 * Учитель переключает стейдж урока (доска/плитки) — тот же результат
 * должны увидеть все участники, не только он сам (Э12 полировка «синхрон
 * открытия доски у всех»). Право то же, что у `setLessonMode` выше: только
 * admin или сам учитель этого урока — не методист (наблюдатель) и не гость.
 */
/**
 * Э10.6 — текущий стейдж без похода в БД/авторизации персонала: recorder
 * шаблона записи (`rooms/ws.ts`) шлёт его сразу при подключении, чтобы не
 * ждать следующего `stage_changed`, если запись стартовала уже при открытой
 * доске. Сам факт «какой сейчас стейдж» не секрет (см. `isLessonRecordingActive`
 * — тот же принцип, recordings/service.ts).
 */
export async function getCurrentLessonStage(lessonId: string): Promise<LessonStage> {
  return presence.getLessonStage(lessonId);
}

export async function setLessonStage(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  stage: LessonStage,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", "Только учитель урока может переключать стейдж");
  }
  await presence.setLessonStage(lessonId, stage);
  emitRoomEvent(lessonId, { type: "stage_changed", stage });
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

  const result = await presence.patchParticipant(lessonId, targetUserId, { permissions });
  if (!result) {
    throw new AppError(404, "not_found", "Участник не найден в комнате");
  }
  if (entry.kind === "guest") await presence.setGrantedPermissions(lessonId, targetUserId, permissions);
  // Э3.8: живой пуш canDraw в canvas — тем же способом (rooms → canvas,
  // не наоборот, см. заметки Э3.2), что closeCanvasDocument. Только когда
  // patch реально трогает canDraw — иначе бессмысленный вызов на каждое
  // изменение canSpeak/canShareScreen.
  if (patch.canDraw !== undefined) {
    canvasService.setDrawPermission(lessonId, targetUserId, permissions.canDraw);
  }
  emitRoomEvent(lessonId, { type: "permissions_updated", userId: targetUserId, permissions: result.after.permissions });
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
    const result = await presence.patchParticipant(lessonId, userId, { permissions: { canDraw } });
    if (!result) continue;
    await presence.setGrantedPermissions(lessonId, userId, result.after.permissions);
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

async function assertLessonTeacher(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  message: string,
): Promise<void> {
  const lesson = await lessonsService.getLesson(schoolId, lessonId);
  const isOwnerTeacher = requester.role === "teacher" && lesson.teacherId === requester.sub;
  if (requester.role !== "admin" && !isOwnerTeacher) {
    throw new AppError(403, "forbidden", message);
  }
}

/**
 * «Удалить из урока» — только ученика (гостя). Читать построчно: это гейт
 * доступа. Гостевая сессия отзывается первой — после этого ученик не пройдёт
 * ни `POST /join`, ни WS, ни доску, ни задания, даже если какой-то шаг ниже
 * упадёт. Дальше — выкинуть из presence, LiveKit и доски. Вернуться по ссылке
 * с новым именем он может, пока вход не закрыт (`setEntryLocked`).
 */
export async function removeParticipant(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  targetUserId: string,
): Promise<void> {
  await assertLessonTeacher(schoolId, lessonId, requester, "Только учитель урока может удалять участников");
  const entry = await presence.getParticipant(lessonId, targetUserId);
  if (!entry) {
    throw new AppError(404, "not_found", "Участник не найден в комнате");
  }
  if (entry.kind !== "guest") {
    throw new AppError(409, "cannot_remove_staff", "Из урока можно удалить только ученика");
  }

  await guestsService.revokeGuestSession(targetUserId);
  await evictGuest(schoolId, lessonId, targetUserId, "removed");
  await scheduleAutoEndIfEmpty(lessonId);
}

/** Убрать гостя из presence, WS, доски и LiveKit. Доступ к уроку уже отозван вызывающим. */
async function evictGuest(
  schoolId: string,
  lessonId: string,
  guestId: string,
  reason: "removed" | "link_rotated",
): Promise<void> {
  await presence.removeParticipant(lessonId, guestId);
  await presence.clearGrantedPermissions(lessonId, guestId);
  await presence.releaseScreenShare(lessonId, guestId);
  await repo.closeOpenSession(lessonId, guestId);
  // Сначала сообщение: WS удалённого закрывается по нему (rooms/ws.ts), и
  // клиент показывает «вас удалили», а не переподключается.
  emitRoomEvent(lessonId, { type: "participant_removed", userId: guestId, reason });
  canvasService.disconnectCanvasParticipant(lessonId, guestId);
  const livekitRoom = await lessonsService.ensureLivekitRoom(schoolId, lessonId);
  await mediaService.removeParticipant(livekitRoom, guestId);
}

/**
 * Ссылка урока перевыпущена — все гости выходят: их сессии и так больше не
 * проходят проверку (хеш ссылки в токене не совпадает), но уже открытые WS,
 * доска и медиа жили дальше. Персонал остаётся.
 */
async function evictAllGuestsAfterLinkRotation(lessonId: string): Promise<void> {
  const participants = await presence.listParticipants(lessonId);
  const guests = [...participants.entries()].filter(([, e]) => e.kind === "guest").map(([id]) => id);
  if (guests.length === 0) return;
  const lesson = await lessonsService.getLessonForGuestSession(lessonId);
  if (!lesson) return;
  for (const guestId of guests) {
    // Отзыв нужен ради медиа: LiveKit-токен гостя живёт до конца его сессии,
    // и вебхук participant_joined выкидывает только отозванных.
    await guestsService.revokeGuestSession(guestId);
    await evictGuest(lesson.schoolId, lessonId, guestId, "link_rotated").catch((err: unknown) =>
      console.error("rooms: не удалось вывести гостя после перевыпуска ссылки", lessonId, guestId, err),
    );
  }
  await scheduleAutoEndIfEmpty(lessonId);
}

lessonsService.onJoinLinkRotated(evictAllGuestsAfterLinkRotation);

/** «Закрыть вход» — новые ученики по ссылке не попадут, уже бывшие на уроке вернуться могут. */
export async function setEntryLocked(
  schoolId: string,
  lessonId: string,
  requester: AccessTokenPayload,
  locked: boolean,
): Promise<void> {
  await assertLessonTeacher(schoolId, lessonId, requester, "Только учитель урока может закрывать вход");
  await presence.setEntryLocked(lessonId, locked);
  emitRoomEvent(lessonId, { type: "entry_locked", locked });
}

/**
 * LiveKit-вебхук `participant_joined`: медиа-токен гостя живёт до конца его
 * сессии, и удалённый ученик мог бы подключиться к комнате им напрямую, в
 * обход приложения. Выкидываем такого сразу после входа.
 */
export async function handleParticipantJoinedWebhook(livekitRoom: string, userId: string): Promise<void> {
  if (!(await guestsService.isGuestSessionRevoked(userId))) return;
  await mediaService.removeParticipant(livekitRoom, userId);
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
  // Подстраховка на разрыв связи без явного leave()/track_unpublished (см. releaseScreenShare выше).
  await presence.releaseScreenShare(lesson.id, userId);
}

/**
 * LiveKit-вебхук `room_finished` (Э2.7) — авторитетный сигнал от самого
 * медиасервера, что комната реально закрылась (краш процесса, ручное
 * `deleteRoom`, истёкший `emptyTimeout`), независимо от нашего собственного
 * 15-минутного таймера пустой комнаты.
 *
 * Э12.9: урок постоянный, «завершать» его больше нечем — вебхук освобождает
 * ресурсы закрывшейся комнаты (таймер, Y.Doc, отметка активности) и на этом
 * всё. Идемпотентно: повторный вызов на уже убранной комнате безвреден.
 */
export async function handleRoomFinishedWebhook(livekitRoom: string): Promise<void> {
  const lesson = await lessonsService.getLessonByLivekitRoom(livekitRoom);
  if (!lesson) return;
  clearEmptyRoomTimer(lesson.id);
  canvasService.closeCanvasDocument(lesson.id);
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
export async function handleScreenShareStoppedWebhook(livekitRoom: string, userId?: string): Promise<void> {
  const lesson = await lessonsService.getLessonByLivekitRoom(livekitRoom);
  if (!lesson) return;

  // Подстраховка на случай, если клиент не успел/не смог сам вызвать
  // release (обрыв связи, закрытая вкладка) — реальное состояние LiveKit
  // надёжнее клиентского вызова. `releaseScreenShare` — compare-and-delete,
  // чужой уже перехваченный лок не тронет.
  if (userId) await presence.releaseScreenShare(lesson.id, userId);

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

/** Правило зачистки без сайд-эффектов — вынесено для юнит-тестов. */
export function isStaleEntry(entry: PresenceEntry, now: number): boolean {
  return presence.isStaleEntry(entry, now, RECONNECT_GRACE_MS, HEARTBEAT_TIMEOUT_MS);
}

async function sweepRoom(lessonId: string): Promise<void> {
  const now = Date.now();
  const participants = await presence.listParticipants(lessonId);
  let changed = false;
  for (const [userId, entry] of participants) {
    if (!isStaleEntry(entry, now)) continue;
    // Условие на lastSeenAt: пока sweep думал, участник мог прислать pong —
    // тогда его не трогаем (раньше запись перетиралась устаревшей копией).
    const stillStale = { connected: entry.connected, maxLastSeenAt: entry.lastSeenAt };
    if (entry.connected) {
      const result = await presence.patchParticipant(
        lessonId,
        userId,
        { connected: false, lastSeenAt: now },
        stillStale,
      );
      if (!result) continue;
      emitRoomEvent(lessonId, { type: "participant_updated", participant: toSnapshot(userId, result.after) });
    } else {
      if (!(await presence.removeParticipantIf(lessonId, userId, stillStale))) continue;
      await repo.closeOpenSession(lessonId, userId);
      emitRoomEvent(lessonId, { type: "participant_left", userId });
    }
    changed = true;
  }
  if (changed) {
    await scheduleAutoEndIfEmpty(lessonId);
  }
}

/**
 * Один проход зачистки. Комнаты берём не только из `activeLessons`: тот
 * пополняется лишь через POST /join, а после перезапуска сервера участники
 * возвращаются переподключением сокета, без join — зачистка для их урока
 * не работала вовсе, и ушедшие навсегда оставались «на связи» пустыми
 * плитками (на стенде нашлась запись 17-часовой давности).
 */
export async function runPresenceSweepOnce(): Promise<void> {
  for (const lessonId of await presence.listRoomIds()) activeLessons.add(lessonId);
  await Promise.all(
    [...activeLessons].map((lessonId) =>
      sweepRoom(lessonId).catch((err) => console.error("rooms: sweep failed", lessonId, err)),
    ),
  );
}

export function startPresenceSweep(): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    runPresenceSweepOnce().catch((err) => console.error("rooms: sweep failed", err));
  }, SWEEP_INTERVAL_MS);
  sweepInterval.unref?.();
}

export function stopPresenceSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

const CHAT_RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let chatRetentionTimer: NodeJS.Timeout | null = null;

/** Удаляет сообщения чата старше `CHAT_RETENTION_DAYS`. */
export async function runChatRetentionOnce(now = new Date()): Promise<number> {
  return repo.deleteChatMessagesBefore(new Date(now.getTime() - env.CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000));
}

export function startChatRetentionSweep(): void {
  if (chatRetentionTimer) return;
  chatRetentionTimer = setInterval(() => {
    runChatRetentionOnce().catch((err) => console.error("rooms: chat retention failed", err));
  }, CHAT_RETENTION_SWEEP_INTERVAL_MS);
  chatRetentionTimer.unref?.();
}

export function stopChatRetentionSweep(): void {
  if (chatRetentionTimer) {
    clearInterval(chatRetentionTimer);
    chatRetentionTimer = null;
  }
}
