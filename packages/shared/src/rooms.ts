import { z } from "zod";
import { roleSchema, lessonStatusSchema } from "./roles.js";
import { mediaConnectionSchema } from "./media.js";

export const participantPermissionsSchema = z.object({
  canDraw: z.boolean(),
  canSpeak: z.boolean(),
  canShareScreen: z.boolean(),
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
  permissions: participantPermissionsSchema,
  joinedAt: z.string(),
});
export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>;

export const joinLessonResponseSchema = z.object({
  lessonStatus: lessonStatusSchema,
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
  z.object({ type: z.literal("chat_message"), message: chatMessageSchema }),
  z.object({ type: z.literal("lesson_status"), status: lessonStatusSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerRoomMessage = z.infer<typeof serverRoomMessageSchema>;
