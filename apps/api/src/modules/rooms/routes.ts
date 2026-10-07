import type { FastifyInstance } from "fastify";
import {
  handRaiseRequestSchema,
  lowerHandsRequestSchema,
  listChatQuerySchema,
  pinParticipantRequestSchema,
  sendChatMessageRequestSchema,
  setDrawForAllRequestSchema,
  setEntryLockedRequestSchema,
  setLessonModeRequestSchema,
  setLessonStageRequestSchema,
  updateParticipantPermissionsRequestSchema,
} from "@school/shared";
import * as roomsService from "./service.js";
import { AppError } from "../../plugins/errors.js";
import { logEvent } from "../../plugins/logger.js";

/**
 * Э12.4: эндпоинты урока делятся на два периметра.
 *  - Доступны и персоналу, и гостю-ученику одного урока (`requireLessonAccess`
 *    → `request.lessonActor`): вход/выход, поднять руку, чат.
 *  - Только персонал (`app.authenticate` + проверка роли в сервисе): режим
 *    урока, права участников, мьют, закрепление, модерация чата.
 */
export default async function roomsRoutes(app: FastifyInstance) {
  // ─── Периметр «персонал ∪ гость этого урока» ───────────────────────────────
  const lessonAccess = { preHandler: app.requireLessonAccess };

  app.post<{ Params: { id: string } }>("/lessons/:id/join", lessonAccess, async (request, reply) => {
    const actor = request.lessonActor;
    const started = performance.now();
    logEvent("lesson_join_started", { kind: actor.kind }, "info", request.log);
    let result;
    try {
      result = await roomsService.join(actor, request.params.id);
    } catch (err) {
      const reason = err instanceof AppError ? err.code : "internal_error";
      logEvent(
        "lesson_join_failed",
        { kind: actor.kind, reason, durationMs: Math.round(performance.now() - started) },
        reason === "internal_error" ? "error" : "warn",
        request.log,
      );
      throw err;
    }
    logEvent(
      "lesson_join_success",
      {
        kind: actor.kind,
        durationMs: Math.round(performance.now() - started),
        participants: result.participants.length,
        lessonMode: result.lessonMode,
        entryLocked: result.entryLocked,
      },
      "info",
      request.log,
    );
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/leave", lessonAccess, async (request, reply) => {
    await roomsService.leave(request.lessonActor, request.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/lessons/:id/hand-raise",
    lessonAccess,
    async (request, reply) => {
      const body = handRaiseRequestSchema.parse(request.body);
      await roomsService.setHandRaised(request.lessonActor, request.params.id, body.raised);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string } }>("/lessons/:id/chat", lessonAccess, async (request, reply) => {
    const query = listChatQuerySchema.parse(request.query);
    const messages = await roomsService.listChatHistory(request.lessonActor, request.params.id, query);
    return reply.send({ items: messages });
  });

  // Пользовательский баг (2026-09-14): «2 демонстрации разом ломают сетку»
  // — клиент теперь СНАЧАЛА спрашивает разрешение здесь, публикует трек
  // только при `granted: true` (см. докстринг `roomsService.claimScreenShare`).
  app.post<{ Params: { id: string } }>(
    "/lessons/:id/screen-share/claim",
    lessonAccess,
    async (request, reply) => {
      const result = await roomsService.claimScreenShare(request.lessonActor, request.params.id);
      return reply.send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/lessons/:id/screen-share/release",
    lessonAccess,
    async (request, reply) => {
      await roomsService.releaseScreenShareClaim(request.lessonActor, request.params.id);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>("/lessons/:id/chat", lessonAccess, async (request, reply) => {
    const body = sendChatMessageRequestSchema.parse(request.body);
    const message = await roomsService.sendChatMessage(
      request.lessonActor,
      request.params.id,
      body.body,
      body.clientMessageId,
    );
    return reply.status(201).send(message);
  });

  // ─── Периметр «только персонал» ────────────────────────────────────────────
  const staff = { preHandler: app.authenticate };

  // Э12 полировка — «сколько человек в уроке сейчас» для списка уроков
  // (LessonsListPage). Статический путь, Fastify не спутает его с
  // «/lessons/:id/...» ниже.
  app.get<{ Querystring: { ids?: string } }>(
    "/lessons/presence-counts",
    staff,
    async (request, reply) => {
      const ids = (request.query.ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const counts = await roomsService.getPresenceCounts(request.user.schoolId, ids);
      return reply.send({ counts });
    },
  );

  app.patch<{ Params: { id: string; userId: string } }>(
    "/lessons/:id/participants/:userId/permissions",
    staff,
    async (request, reply) => {
      const body = updateParticipantPermissionsRequestSchema.parse(request.body);
      await roomsService.updatePermissions(
        request.user.schoolId,
        request.params.id,
        request.user,
        request.params.userId,
        body,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string; userId: string } }>(
    "/lessons/:id/participants/:userId/mute",
    staff,
    async (request, reply) => {
      await roomsService.muteParticipantNow(
        request.user.schoolId,
        request.params.id,
        request.user,
        request.params.userId,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string; userId: string } }>(
    "/lessons/:id/participants/:userId/remove",
    staff,
    async (request, reply) => {
      await roomsService.removeParticipant(
        request.user.schoolId,
        request.params.id,
        request.user,
        request.params.userId,
      );
      return reply.status(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>("/lessons/:id/entry", staff, async (request, reply) => {
    const body = setEntryLockedRequestSchema.parse(request.body);
    await roomsService.setEntryLocked(request.user.schoolId, request.params.id, request.user, body.locked);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/hands/lower", staff, async (request, reply) => {
    const body = lowerHandsRequestSchema.parse(request.body ?? {});
    await roomsService.lowerHands(request.user.schoolId, request.params.id, request.user, body.userId);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/mute-all", staff, async (request, reply) => {
    await roomsService.muteAllNow(request.user.schoolId, request.params.id, request.user);
    return reply.status(204).send();
  });

  app.patch<{ Params: { id: string; userId: string } }>(
    "/lessons/:id/participants/:userId/pin",
    staff,
    async (request, reply) => {
      const body = pinParticipantRequestSchema.parse(request.body);
      await roomsService.setPinned(
        request.user.schoolId,
        request.params.id,
        request.user,
        request.params.userId,
        body.pinned,
      );
      return reply.status(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>("/lessons/:id/mode", staff, async (request, reply) => {
    const body = setLessonModeRequestSchema.parse(request.body);
    await roomsService.setLessonMode(request.user.schoolId, request.params.id, request.user, body.mode);
    return reply.status(204).send();
  });

  app.patch<{ Params: { id: string } }>("/lessons/:id/stage", staff, async (request, reply) => {
    const body = setLessonStageRequestSchema.parse(request.body);
    await roomsService.setLessonStage(request.user.schoolId, request.params.id, request.user, body.stage);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/draw-all", staff, async (request, reply) => {
    const body = setDrawForAllRequestSchema.parse(request.body);
    await roomsService.setDrawForAllStudents(
      request.user.schoolId,
      request.params.id,
      request.user,
      body.canDraw,
    );
    return reply.status(204).send();
  });

  app.delete<{ Params: { id: string; messageId: string } }>(
    "/lessons/:id/chat/:messageId",
    staff,
    async (request, reply) => {
      await roomsService.deleteChatMessage(
        request.user.schoolId,
        request.params.id,
        request.user,
        request.params.messageId,
      );
      return reply.status(204).send();
    },
  );
}
