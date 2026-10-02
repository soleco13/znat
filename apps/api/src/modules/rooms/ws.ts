import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerRoomMessage } from "@school/shared";
import { verifyAccessToken } from "../auth/service.js";
import { GUEST_COOKIE_NAME, resolveGuestSession } from "../guests/service.js";
import { verifyRecorderToken } from "../recorder-auth/service.js";
import * as recordingsService from "../recordings/service.js";
import { roomEvents } from "./events.js";
import * as roomsService from "./service.js";
import { AppError } from "../../plugins/errors.js";
import { logEvent, safeClientId } from "../../plugins/logger.js";

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
  // Корреляция с клиентом: сессия вкладки и номер попытки подключения
  // (0 — первое, дальше — переподключения useRoomSocket).
  cs: z.string().optional(),
  attempt: z.coerce.number().int().min(0).max(100000).optional(),
});

/**
 * Э12.4: presence-ключ (= LiveKit-identity) для WS-канала урока. Персонал —
 * `sub` из access-токена; гость — `guestId` из гостевого JWT в куке, при
 * условии что урок в токене совпадает с запрошенным. Гостевая сессия
 * проверяется полностью, включая актуальность ссылки: после перевыпуска
 * ссылки старая кука не должна снова подключить WS.
 */
async function resolveParticipantId(
  query: z.infer<typeof querySchema>,
  cookieToken: string | undefined,
): Promise<{ participantId: string } | { reason: string }> {
  if (query.token) {
    try {
      const payload = await verifyAccessToken(query.token);
      return { participantId: payload.sub };
    } catch {
      return { reason: "invalid_token" };
    }
  }
  if (cookieToken) {
    // Полная проверка (подпись, срок, отзыв, актуальность ссылки урока):
    // после перевыпуска ссылки старая кука не должна снова подключить WS.
    try {
      const actor = await resolveGuestSession(cookieToken);
      if (actor.lessonId !== query.lessonId) return { reason: "guest_wrong_lesson" };
      await roomsService.assertGuestNotLockedOut(actor.lessonId, actor.participantId);
      return { participantId: actor.participantId };
    } catch (err) {
      return { reason: err instanceof AppError ? err.code : "invalid_guest_session" };
    }
  }
  return { reason: "missing_credentials" };
}

export default async function roomsWsRoutes(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, async (socket, request) => {
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      socket.close(4000, "invalid_query");
      return;
    }
    const { lessonId, recorderToken, cs, attempt = 0 } = parsedQuery.data;
    const connectedAt = Date.now();
    const clientSessionId = safeClientId(cs);
    let wsLog = request.log.child({
      connId: randomUUID(),
      channel: recorderToken ? "recorder" : "room",
      lessonId,
      ...(clientSessionId ? { clientSessionId } : {}),
    });
    const logClose = (code: number, reason: Buffer) => {
      logEvent(
        "websocket_disconnected",
        { closeCode: code, closeReason: reason.toString().slice(0, 100) || null, durationMs: Date.now() - connectedAt },
        "info",
        wsLog,
      );
    };

    // Э10.6 — recorder шаблона записи: read-only слушатель `roomEvents`
    // (стейдж/задания), НЕ участник урока. Сознательно в обход
    // `attachSocket`/presence ниже — recorder не должен попасть в список
    // участников, посещаемость или лимиты «кто на связи» (§1.2 ТЗ: сбой
    // записи не должен влиять на сам урок, и наоборот — учёт присутствия не
    // должен путать recorder с живым человеком).
    if (recorderToken) {
      const payload = await verifyRecorderToken(recorderToken);
      if (!payload || payload.lessonId !== lessonId) {
        logEvent("websocket_rejected", { reason: "invalid_recorder_token", closeCode: 4001 }, "warn", wsLog);
        socket.close(4001, "invalid_token");
        return;
      }
      logEvent("websocket_connected", { attempt }, "info", wsLog);

      const send = (message: ServerRoomMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };

      // Стейдж сразу при подключении — если запись стартовала при уже
      // открытой доске, recorder не должен ждать следующего stage_changed.
      // «Активность уже идёт» так восстановить нечем (§ докстринг
      // EgressPage.tsx) — тот же пробел, что и у живого участника,
      // подключившегося без initial join().
      send({ type: "stage_changed", stage: await roomsService.getCurrentLessonStage(lessonId) });
      // Presence сразу при подключении — recorder должен видеть уже
      // сидящих в уроке участников (лента камер в EgressPage.tsx), а не
      // ждать их participant_joined (тот шлётся только НОВЫМ входам). Тот
      // же снимок, что получает живой участник сразу после attachSocket
      // ниже.
      send({ type: "presence", participants: await roomsService.listParticipantsSnapshot(lessonId) });

      const onEvent = (message: ServerRoomMessage) => send(message);
      roomEvents.on(lessonId, onEvent);

      const pingTimer = setInterval(() => {
        if (socket.readyState === socket.OPEN) socket.ping();
      }, PING_INTERVAL_MS);

      socket.on("close", (code: number, reason: Buffer) => {
        clearInterval(pingTimer);
        roomEvents.off(lessonId, onEvent);
        logClose(code, reason);
      });
      socket.on("error", (err: Error) => {
        wsLog.warn({ err }, "recorder ws error");
      });
      return;
    }

    const resolved = await resolveParticipantId(
      parsedQuery.data,
      request.cookies?.[GUEST_COOKIE_NAME],
    );
    if ("reason" in resolved) {
      logEvent("websocket_rejected", { reason: resolved.reason, closeCode: 4001, attempt }, "warn", wsLog);
      socket.close(4001, "invalid_token");
      return;
    }
    const userId = resolved.participantId;
    wsLog = wsLog.child({ participantId: userId });

    const self = await roomsService.attachSocket(lessonId, userId);
    if (!self) {
      // Нет в presence: join не делался или участника уже вывели по таймауту.
      logEvent("websocket_rejected", { reason: "not_joined", closeCode: 4003, attempt }, "warn", wsLog);
      socket.close(4003, "not_joined");
      return;
    }
    logEvent("websocket_connected", { attempt }, "info", wsLog);
    if (attempt > 0) logEvent("websocket_reconnect", { attempt }, "info", wsLog);

    const send = (message: ServerRoomMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    send({ type: "presence", participants: (await roomsService.listParticipantsSnapshot(lessonId)) });

    // Э10.3, 152-ФЗ: зашли в уже идущий урок, где запись уже стартовала —
    // сразу показать баннер согласия, не дожидаясь следующего старта/стопа.
    if (await recordingsService.isLessonRecordingActive(lessonId)) {
      send({ type: "recording_status", active: true });
    }

    const onEvent = (message: ServerRoomMessage) => {
      send(message);
      if (message.type === "participant_removed" && message.userId === userId) {
        socket.close(4005, "removed_from_lesson");
      }
    };
    roomEvents.on(lessonId, onEvent);

    const pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_INTERVAL_MS);

    socket.on("pong", () => {
      roomsService
        .touchHeartbeat(lessonId, userId)
        .then((present) => {
          if (!present) {
            logEvent("websocket_rejected", { reason: "presence_lost", closeCode: 4003 }, "warn", wsLog);
            socket.close(4003, "not_joined");
          }
        })
        .catch((err: unknown) => wsLog.warn({ err }, "room heartbeat failed"));
    });

    socket.on("close", (code: number, reason: Buffer) => {
      clearInterval(pingTimer);
      roomEvents.off(lessonId, onEvent);
      logClose(code, reason);
      void roomsService.markDisconnected(lessonId, userId);
    });

    socket.on("error", (err: Error) => {
      wsLog.warn({ err }, "room ws error");
    });
  });
}
