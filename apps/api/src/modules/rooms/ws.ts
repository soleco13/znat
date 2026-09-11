import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerRoomMessage } from "@school/shared";
import { verifyAccessToken } from "../auth/service.js";
import { GUEST_COOKIE_NAME, verifyGuestToken } from "../guests/service.js";
import { verifyRecorderToken } from "../recorder-auth/service.js";
import * as recordingsService from "../recordings/service.js";
import { roomEvents } from "./events.js";
import * as roomsService from "./service.js";

const PING_INTERVAL_MS = 20_000;

const querySchema = z.object({
  // Э12.4: персонал передаёт access-токен в query; гость-ученик его не
  // имеет (httpOnly-кука) — тогда токен опускается и берётся кука.
  token: z.string().min(1).optional(),
  // Э10.6: recorder шаблона записи — отдельный параметр, не смешивается с
  // `token` (тот разбирается как staff access-токен, recorder подписан
  // другим секретом и не участник урока — см. handleRecorderConnection).
  recorderToken: z.string().min(1).optional(),
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
    const { lessonId, recorderToken } = parsedQuery.data;

    // Э10.6 — recorder шаблона записи: read-only слушатель `roomEvents`
    // (стейдж/задания), НЕ участник урока. Сознательно в обход
    // `attachSocket`/presence ниже — recorder не должен попасть в список
    // участников, посещаемость или лимиты «кто на связи» (§1.2 ТЗ: сбой
    // записи не должен влиять на сам урок, и наоборот — учёт присутствия не
    // должен путать recorder с живым человеком).
    if (recorderToken) {
      const payload = await verifyRecorderToken(recorderToken);
      if (!payload || payload.lessonId !== lessonId) {
        socket.close(4001, "invalid_token");
        return;
      }

      const send = (message: ServerRoomMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };

      // Стейдж сразу при подключении — если запись стартовала при уже
      // открытой доске, recorder не должен ждать следующего stage_changed.
      // «Активность уже идёт» так восстановить нечем (§ докстринг
      // EgressPage.tsx) — тот же пробел, что и у живого участника,
      // подключившегося без initial join().
      send({ type: "stage_changed", stage: await roomsService.getCurrentLessonStage(lessonId) });

      const onEvent = (message: ServerRoomMessage) => send(message);
      roomEvents.on(lessonId, onEvent);

      const pingTimer = setInterval(() => {
        if (socket.readyState === socket.OPEN) socket.ping();
      }, PING_INTERVAL_MS);

      socket.on("close", () => {
        clearInterval(pingTimer);
        roomEvents.off(lessonId, onEvent);
      });
      socket.on("error", (err: Error) => {
        request.log.warn({ err, lessonId }, "recorder ws error");
      });
      return;
    }

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
