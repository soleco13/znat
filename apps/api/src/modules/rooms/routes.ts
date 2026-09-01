import type { FastifyInstance } from "fastify";
import {
  handRaiseRequestSchema,
  listChatQuerySchema,
  pinParticipantRequestSchema,
  sendChatMessageRequestSchema,
  setDrawForAllRequestSchema,
  updateParticipantPermissionsRequestSchema,
} from "@school/shared";
import * as usersService from "../users/service.js";
import * as roomsService from "./service.js";

export default async function roomsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post<{ Params: { id: string } }>("/lessons/:id/join", async (request, reply) => {
    const user = request.user;
    const me = await usersService.getUserForAuth(user.schoolId, user.sub);
    const fullName = me?.fullName ?? "Без имени";
    const result = await roomsService.join(user.schoolId, request.params.id, user, fullName);
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/leave", async (request, reply) => {
    await roomsService.leave(request.user.schoolId, request.params.id, request.user);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/end", async (request, reply) => {
    await roomsService.endLessonNow(request.user.schoolId, request.params.id, request.user);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/hand-raise", async (request, reply) => {
    const body = handRaiseRequestSchema.parse(request.body);
    await roomsService.setHandRaised(request.user.schoolId, request.params.id, request.user, body.raised);
    return reply.status(204).send();
  });

  app.patch<{ Params: { id: string; userId: string } }>(
    "/lessons/:id/participants/:userId/permissions",
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
    async (request, reply) => {
      await roomsService.muteParticipantNow(request.user.schoolId, request.params.id, request.user, request.params.userId);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>("/lessons/:id/mute-all", async (request, reply) => {
    await roomsService.muteAllNow(request.user.schoolId, request.params.id, request.user);
    return reply.status(204).send();
  });

  app.patch<{ Params: { id: string; userId: string } }>(
    "/lessons/:id/participants/:userId/pin",
    async (request, reply) => {
      const body = pinParticipantRequestSchema.parse(request.body);
      await roomsService.setPinned(request.user.schoolId, request.params.id, request.user, request.params.userId, body.pinned);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>("/lessons/:id/draw-all", async (request, reply) => {
    const body = setDrawForAllRequestSchema.parse(request.body);
    await roomsService.setDrawForAllStudents(request.user.schoolId, request.params.id, request.user, body.canDraw);
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/lessons/:id/chat", async (request, reply) => {
    const query = listChatQuerySchema.parse(request.query);
    const messages = await roomsService.listChatHistory(request.user.schoolId, request.params.id, request.user, query);
    return reply.send({ items: messages });
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/chat", async (request, reply) => {
    const body = sendChatMessageRequestSchema.parse(request.body);
    const message = await roomsService.sendChatMessage(request.user.schoolId, request.params.id, request.user, body.body);
    return reply.status(201).send(message);
  });

  app.delete<{ Params: { id: string; messageId: string } }>(
    "/lessons/:id/chat/:messageId",
    async (request, reply) => {
      await roomsService.deleteChatMessage(request.user.schoolId, request.params.id, request.user, request.params.messageId);
      return reply.status(204).send();
    },
  );
}
