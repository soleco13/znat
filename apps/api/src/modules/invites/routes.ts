import type { FastifyInstance } from "fastify";
import {
  createInviteRequestSchema,
  createInviteResponseSchema,
  inviteSummarySchema,
  invitePublicInfoSchema,
} from "@school/shared";
import * as service from "./service.js";

/**
 * Э14.2 — приглашения в пространство. `GET /invites/:code` публичный
 * (предпросмотр перед регистрацией по инвайту, rate-limited как
 * `guests/routes.ts`); остальное — только admin, вложенный `adminApp` со
 * своими хуками, чтобы `app.authenticate`/`requireRole` не задели публичный
 * роут (тот же паттерн вложенности, что `school-settings/routes.ts`).
 */
export default async function invitesRoutes(app: FastifyInstance) {
  app.get<{ Params: { code: string } }>(
    "/invites/:code",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const info = await service.getInvitePublicInfo(request.params.code);
      return reply.send(invitePublicInfoSchema.parse(info));
    },
  );

  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", adminApp.authenticate);
    adminApp.addHook("preHandler", adminApp.requireRole("admin"));

    adminApp.post("/invites", async (request, reply) => {
      const body = createInviteRequestSchema.parse(request.body);
      const invite = await service.createInvite(request.user, body);
      return reply.status(201).send(createInviteResponseSchema.parse(invite));
    });

    adminApp.get("/invites", async (request, reply) => {
      const invites = await service.listInvites(request.user);
      return reply.send({ items: invites.map((i) => inviteSummarySchema.parse(i)) });
    });

    adminApp.post<{ Params: { id: string } }>("/invites/:id/revoke", async (request, reply) => {
      await service.revokeInvite(request.user, request.params.id);
      return reply.status(204).send();
    });
  });
}
