import type { FastifyInstance } from "fastify";
import { schoolSettingsSchema, updateSchoolSettingsRequestSchema } from "@school/shared";
import * as service from "./service.js";

/** Страница администратора «Параметры» (§10.10 ТЗ, запрос 2026-09-14) — только admin. */
export default async function schoolSettingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", adminApp.requireRole("admin"));

    adminApp.get("/admin/settings", async (request, reply) => {
      const settings = await service.getSettingsForAdmin(request.user);
      return reply.send(schoolSettingsSchema.parse(settings));
    });

    adminApp.patch("/admin/settings", async (request, reply) => {
      const patch = updateSchoolSettingsRequestSchema.parse(request.body);
      const settings = await service.updateSettings(request.user, patch);
      return reply.send(schoolSettingsSchema.parse(settings));
    });
  });
}
