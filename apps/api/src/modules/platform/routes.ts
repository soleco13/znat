import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  platformBlockRequestSchema,
  platformExtendRequestSchema,
  platformLibraryResponseSchema,
  platformListQuerySchema,
  platformOverviewSchema,
  platformPaymentSchema,
  platformSchoolDetailSchema,
  platformSchoolSchema,
  platformUserSchema,
} from "@school/shared";
import * as service from "./service.js";

/** Раздел «Платформа» — только супер-админ (`SUPER_ADMIN_EMAILS`). */
export default async function platformRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", async (request) => {
    await service.requireSuperAdmin(request.user);
  });

  app.get("/platform/access", async () => ({ ok: true }));

  app.get("/platform/overview", async () => platformOverviewSchema.parse(await service.overview()));

  app.get("/platform/schools", async () => z.array(platformSchoolSchema).parse(await service.listSchools()));

  app.get("/platform/schools/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return platformSchoolDetailSchema.parse(await service.schoolDetail(id));
  });

  app.post("/platform/schools/:id/extend", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.extend(request.user, id, platformExtendRequestSchema.parse(request.body));
    return platformSchoolDetailSchema.parse(await service.schoolDetail(id));
  });

  app.post("/platform/schools/:id/block", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.blockSchool(id, platformBlockRequestSchema.parse(request.body).blocked);
    return platformSchoolDetailSchema.parse(await service.schoolDetail(id));
  });

  app.post("/platform/library", async () => platformLibraryResponseSchema.parse(await service.library()));

  app.post("/platform/users/:id/block", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.blockUser(request.user, id, platformBlockRequestSchema.parse(request.body).blocked);
    return { ok: true };
  });

  app.get("/platform/users", async (request) => {
    const q = platformListQuerySchema.parse(request.query);
    return z.array(platformUserSchema).parse(await service.listUsers(q));
  });

  app.get("/platform/payments", async (request) => {
    const q = platformListQuerySchema.parse(request.query);
    return z.array(platformPaymentSchema).parse(await service.listPayments({ limit: q.limit }));
  });
}
