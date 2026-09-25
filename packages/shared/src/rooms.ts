import { z } from "zod";
import { roleSchema, participantKindSchema } from "./roles.js";
import { mediaConnectionSchema } from "./media.js";
import { deckProgressEventSchema } from "./decks.js";
import { clientMediaSettingsSchema } from "./school-settings.js";

export const participantPermissionsSchema = z.object({
  canDraw: z.boolean(),
  canSpeak: z.boolean(),
  canShareScreen: z.boolean(),
  /** Э6.1, §5.2 ТЗ: камера ученика публикуется только по этому праву от учителя, максимум 360p (см. media/service.ts#buildPublishGrant). */
  canPublishVideo: z.boolean(),
});
export type ParticipantPermissions = z.infer<typeof participantPermissionsSchema>;

export const updateParticipantPermissionsRequestSchema = participantPermissionsSchema.partial();
export type UpdateParticipantPermissionsRequest = z.infer<
  typeof updateParticipantPermissionsRequestSchema
>;

export const participantSnapshotSchema = z.object({
  /**
   * Идентичность участника на уроке (Э12.4): для персонала — `users.id`,
   * для гостя-ученика — стабильный `guestId` из гостевой сессии. Совпадает
   * с LiveKit-identity участника. Имя поля историческое (`userId`), но это
   * уже не всегда id из `users`.
   */
  userId: z.string().uuid(),
  fullName: z.string(),
  /** Э12.4: `staff` — персонал с аккаунтом, `guest` — ученик по ссылке. Права на уроке привязаны к этому, а не к `role`. */
  kind: participantKindSchema,
  /** Роль из аккаунта персонала; `null` у гостя (у ученика аккаунта нет). */
  role: roleSchema.nullable(),
  connected: z.boolean(),
  handRaised: z.boolean(),
  /** Э6.3, §5.3 ТЗ: закреплено учителем в видимой сетке видео — ephemeral-состояние, не право (см. participantPermissionsSchema). */
  pinned: z.boolean(),
  permissions: participantPermissionsSchema,
  joinedAt: z.string(),
});
export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>;

/**
 * Э6.4, §5.3 ТЗ: режим урока — управляет медиапрофилем видео, не правами
 * участников. `lecture` — по умолчанию (продуктовый рычаг §5.2 ТЗ: экономит
 * 3–4× трафика, переключение в `discussion` — осознанное действие учителя).
 */
export const lessonModeSchema = z.enum(["lecture", "discussion", "assignment", "spotlight"]);
export type LessonMode = z.infer<typeof lessonModeSchema>;

export const setLessonModeRequestSchema = z.object({ mode: lessonModeSchema });
export type SetLessonModeRequest = z.infer<typeof setLessonModeRequestSchema>;

/**
 * Что показано на стейдже всем участникам урока (Э12 полировка: раньше
 * `stageView` «доска/участники» был локальным стейтом каждого клиента —
 * учитель открывал доску только у себя, остальные должны были нажимать
 * сами). `activity` (выданное задание) сюда не входит — он уже синхронный
 * отдельным сигналом `activity_started`.
 */
export const lessonStageSchema = z.enum(["people", "board"]);
export type LessonStage = z.infer<typeof lessonStageSchema>;

export const setLessonStageRequestSchema = z.object({ stage: lessonStageSchema });
export type SetLessonStageRequest = z.infer<typeof setLessonStageRequestSchema>;

export const joinLessonResponseSchema = z.object({
  lessonMode: lessonModeSchema,
  stage: lessonStageSchema,
  participants: z.array(participantSnapshotSchema),
  self: participantSnapshotSchema,
  media: mediaConnectionSchema,
  /** Параметры школы (§10.10 ТЗ, запрос 2026-09-14) — мягкие дефолты качества + флаги демонстрации/PiP. */
  clientMediaSettings: clientMediaSettingsSchema,
  /** Учитель закрыл вход: новые ученики по ссылке не попадут, вернуться может только тот, кто уже был. */
  entryLocked: z.boolean(),
});
export type JoinLessonResponse = z.infer<typeof joinLessonResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  /** Э12.4: `null` у сообщения гостя-ученика (аккаунта нет) — имя в `authorName`. */
  userId: z.string().uuid().nullable(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const sendChatMessageRequestSchema = z.object({
  body: z.string().min(1).max(2000),
});
export type SendChatMessageRequest = z.infer<typeof sendChatMessageRequestSchema>;

export const listChatQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListChatQuery = z.infer<typeof listChatQuerySchema>;

export const handRaiseRequestSchema = z.object({ raised: z.boolean() });
export type HandRaiseRequest = z.infer<typeof handRaiseRequestSchema>;

/** Э6.3, §5.3 ТЗ: учитель закрепляет ученика в видимой сетке видео. */
export const pinParticipantRequestSchema = z.object({ pinned: z.boolean() });
export type PinParticipantRequest = z.infer<typeof pinParticipantRequestSchema>;

/** Э3.8: глобальный тумблер «ученики могут рисовать» — массово меняет canDraw у всех учеников урока разом. */
export const setDrawForAllRequestSchema = z.object({ canDraw: z.boolean() });

export const setEntryLockedRequestSchema = z.object({ locked: z.boolean() });
export type SetEntryLockedRequest = z.infer<typeof setEntryLockedRequestSchema>;
export type SetDrawForAllRequest = z.infer<typeof setDrawForAllRequestSchema>;

// WS /ws?lessonId=&token= — канал только для пуша от сервера клиенту.
// Действия (поднять руку, чат, права) идут через обычные HTTP-эндпоинты.
export const serverRoomMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presence"), participants: z.array(participantSnapshotSchema) }),
  z.object({ type: z.literal("participant_joined"), participant: participantSnapshotSchema }),
  z.object({ type: z.literal("participant_left"), userId: z.string().uuid() }),
  /** Учитель удалил ученика из урока — остальные убирают плитку, сам ученик видит экран «вас удалили». */
  z.object({ type: z.literal("participant_removed"), userId: z.string().uuid() }),
  z.object({ type: z.literal("entry_locked"), locked: z.boolean() }),
  z.object({
    type: z.literal("permissions_updated"),
    userId: z.string().uuid(),
    permissions: participantPermissionsSchema,
  }),
  z.object({ type: z.literal("hand_raised"), userId: z.string().uuid(), raised: z.boolean() }),
  z.object({ type: z.literal("participant_pinned"), userId: z.string().uuid(), pinned: z.boolean() }),
  z.object({ type: z.literal("chat_message"), message: chatMessageSchema }),
  z.object({ type: z.literal("lesson_mode"), mode: lessonModeSchema }),
  // Э12 полировка: учитель переключил доску/плитки — стейдж меняется у всех.
  z.object({ type: z.literal("stage_changed"), stage: lessonStageSchema }),
  // Э4.4: прогресс конвертации презентации — по одному сообщению на каждую
  // смену статуса/шаг рендера. Канал `/ws` уже per-lesson, deckId хватает.
  z.object({ type: z.literal("deck_status"), deck: deckProgressEventSchema }),
  // Э8.6: учитель запустил задание для класса. Это только СИГНАЛ «открой
  // задание» — сам материал и ответы идут индивидуально по HTTP
  // (`GET /activities/:id/my`), НЕ через этот канал и НЕ через Y.Doc урока.
  z.object({ type: z.literal("activity_started"), activityId: z.string().uuid() }),
  // Э8.10: учитель начал разбор задания. Тоже только СИГНАЛ — полный
  // материал (с правильными ответами) идёт отдельным HTTP-запросом
  // (`GET /activities/:id/review`), не через этот канал.
  z.object({ type: z.literal("activity_reviewed"), activityId: z.string().uuid() }),
  // Э10.3, §7.9/§10.10 ТЗ (152-ФЗ): идёт ли запись урока прямо сейчас.
  // Сигнал для баннера согласия — его видят ВСЕ участники, включая
  // учеников (которым сам список записей недоступен). Шлётся при
  // старте/остановке записи и при подключении сокета к идущему уроку.
  z.object({ type: z.literal("recording_status"), active: z.boolean() }),
  // Пользовательский баг (2026-09-14): учитель/админ перехватил лок демонстрации
  // (POST /lessons/:id/screen-share/claim) у уже делившегося участника — тот
  // должен сам остановить СВОЙ трек локально (`userId` === его же id).
  z.object({ type: z.literal("screen_share_preempted"), userId: z.string().uuid() }),
  // Учитель изменил пометки ученику `userId` (presence-id) по заданию — тот
  // перечитывает их сразу, вместо опроса каждые 3 с всем классом.
  z.object({ type: z.literal("annotations_updated"), userId: z.string().uuid(), activityId: z.string().uuid() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerRoomMessage = z.infer<typeof serverRoomMessageSchema>;

/**
 * Пользовательский баг (2026-09-14): «2 демонстрации разом ломают сетку» —
 * клиент СНАЧАЛА просит разрешение (атомарный Redis-лок,
 * `presence.ts#claimScreenShare`), и только при `granted: true` реально
 * публикует трек (`setScreenShareEnabled`). Раньше сервер гасил лишнюю
 * демонстрацию уже ПОСЛЕ публикации (вебхуком) — окно гонки между двумя
 * почти одновременными нажатиями давало на миг 2 живых трека.
 */
export const claimScreenShareResponseSchema = z.object({
  granted: z.boolean(),
  /** Кто уже делится, если отказано (`granted: false`) — для сообщения пользователю. */
  holderName: z.string().nullable(),
});
export type ClaimScreenShareResponse = z.infer<typeof claimScreenShareResponseSchema>;
