import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerRoomMessage } from "@school/shared";
import { verifyAccessToken } from "../auth/service.js";
import { GUEST_COOKIE_NAME, verifyGuestToken } from "../guests/service.js";
import * as recordingsService from "../recordings/service.js";
import { roomEvents } from "./events.js";
import * as roomsService from "./service.js";

const PING_INTERVAL_MS = 20_000;

const querySchema = z.object({
  // Э12.4: персонал передаёт access-токен в query; гость-ученик его не
  // имеет (httpOnly-кука) — тогда токен опускается и берётся кука.
  token: z.string().min(1).optional(),
  lessonId: z.string().uuid(),
});

/**
 * Э12.4: presence-ключ (= LiveKit-identity) для WS-канала урока. Персонал —
 * `sub` из access-токена; гость — `guestId` из гостевого JWT в куке, при
 * условии что урок в токене совпадает с запрошенным. Проверяется только
 * подпись+срок гостевого токена (актуальность ссылки не сверяем — вход
 * через `POST /join` это уже сделал, а обрывать живой WS при ротации
 * ссылки не нужно).
 */
async function resolveParticipantId(
  query: z.infer<typeof querySchema>,
  cookieToken: string | undefined,
): Promise<string | null> {
  if (query.token) {
    try {
      const payload = await verifyAccessToken(query.token);
      return payload.sub;
    } catch {
      return null;
    }
  }
  if (cookieToken) {
    try {
      const payload = await verifyGuestToken(cookieToken);
      return payload.lessonId === query.lessonId ? payload.guestId : null;
    } catch {
      return null;
    }
  }
  return null;
}

export default async function roomsWsRoutes(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, async (socket, request) => {
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      socket.close(4000, "invalid_query");
      return;
    }
    const { lessonId } = parsedQuery.data;

    const userId = await resolveParticipantId(
      parsedQuery.data,
      request.cookies?.[GUEST_COOKIE_NAME],
    );
    if (!userId) {
      socket.close(4001, "invalid_token");
      return;
    }

    const self = await roomsService.attachSocket(lessonId, userId);
    if (!self) {
      socket.close(4003, "not_joined");
      return;
    }

    const send = (message: ServerRoomMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    send({ type: "presence", participants: (await roomsService.listParticipantsSnapshot(lessonId)) });

    // Э10.3, 152-ФЗ: зашли в уже идущий урок, где запись уже стартовала —
    // сразу показать баннер согласия, не дожидаясь следующего старта/стопа.
    if (await recordingsService.isLessonRecordingActive(lessonId)) {
      send({ type: "recording_status", active: true });
    }

    const onEvent = (message: ServerRoomMessage) => send(message);
    roomEvents.on(lessonId, onEvent);

    const pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_INTERVAL_MS);

    socket.on("pong", () => {
      void roomsService.touchHeartbeat(lessonId, userId);
    });

    socket.on("close", () => {
      clearInterval(pingTimer);
      roomEvents.off(lessonId, onEvent);
      void roomsService.markDisconnected(lessonId, userId);
    });

    socket.on("error", (err: Error) => {
      request.log.warn({ err, lessonId, userId }, "room ws error");
    });
  });
}
