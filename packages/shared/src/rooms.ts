import { z } from "zod";
import { roleSchema, lessonStatusSchema } from "./roles.js";
import { mediaConnectionSchema } from "./media.js";
import { deckProgressEventSchema } from "./decks.js";

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
  userId: z.string().uuid(),
  fullName: z.string(),
  role: roleSchema,
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

export const joinLessonResponseSchema = z.object({
  lessonStatus: lessonStatusSchema,
  lessonMode: lessonModeSchema,
  participants: z.array(participantSnapshotSchema),
  self: participantSnapshotSchema,
  media: mediaConnectionSchema,
});
export type JoinLessonResponse = z.infer<typeof joinLessonResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  userId: z.string().uuid(),
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
export type SetDrawForAllRequest = z.infer<typeof setDrawForAllRequestSchema>;

// WS /ws?lessonId=&token= — канал только для пуша от сервера клиенту.
// Действия (поднять руку, чат, права) идут через обычные HTTP-эндпоинты.
export const serverRoomMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presence"), participants: z.array(participantSnapshotSchema) }),
  z.object({ type: z.literal("participant_joined"), participant: participantSnapshotSchema }),
  z.object({ type: z.literal("participant_left"), userId: z.string().uuid() }),
  z.object({
    type: z.literal("permissions_updated"),
    userId: z.string().uuid(),
    permissions: participantPermissionsSchema,
  }),
  z.object({ type: z.literal("hand_raised"), userId: z.string().uuid(), raised: z.boolean() }),
  z.object({ type: z.literal("participant_pinned"), userId: z.string().uuid(), pinned: z.boolean() }),
  z.object({ type: z.literal("chat_message"), message: chatMessageSchema }),
  z.object({ type: z.literal("lesson_status"), status: lessonStatusSchema }),
  z.object({ type: z.literal("lesson_mode"), mode: lessonModeSchema }),
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
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerRoomMessage = z.infer<typeof serverRoomMessageSchema>;
