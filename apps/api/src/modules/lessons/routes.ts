import type { FastifyInstance } from "fastify";
import {
  adminCreateLessonRequestSchema,
  assignLessonMaterialRequestSchema,
  updateLessonRequestSchema,
} from "@school/shared";
import * as lessonsService from "./service.js";

/**
 * Э12 (§1.4 план-ТЗ). Урок создаёт только admin; постоянный, без
 * расписания и статус-машины. `start`/`end`/`summary` убраны (авто-очистка
 * пустой комнаты осталась внутренним sweep-ом `rooms`). Гостевой вход
 * `/j/:token` — отдельный модуль (Э12.4).
 */
export default async function lessonsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  const staff = { preHandler: app.requireRole("admin", "methodist", "teacher") };
  const adminOnly = { preHandler: app.requireRole("admin") };

  app.get("/lessons", staff, async (request, reply) => {
    const items = await lessonsService.listLessons(request.user.schoolId, request.user);
    return reply.send({ items });
  });

  app.post("/lessons", adminOnly, async (request, reply) => {
    const body = adminCreateLessonRequestSchema.parse(request.body);
    const lesson = await lessonsService.createLesson(request.user.schoolId, body);
    return reply.status(201).send(lesson);
  });

  app.get<{ Params: { id: string } }>("/lessons/:id", staff, async (request, reply) => {
    const lesson = await lessonsService.getLessonSummary(request.user.schoolId, request.params.id);
    return reply.send(lesson);
  });

  app.patch<{ Params: { id: string } }>("/lessons/:id", adminOnly, async (request, reply) => {
    const body = updateLessonRequestSchema.parse(request.body);
    const lesson = await lessonsService.updateLesson(request.user.schoolId, request.params.id, body);
    return reply.send(lesson);
  });

  app.delete<{ Params: { id: string } }>("/lessons/:id", adminOnly, async (request, reply) => {
    await lessonsService.deleteLesson(request.user.schoolId, request.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/lessons/:id/link/rotate",
    adminOnly,
    async (request, reply) => {
      const link = await lessonsService.rotateJoinLink(request.user.schoolId, request.params.id);
      return reply.send(link);
    },
  );

  app.get<{ Params: { id: string } }>("/lessons/:id/attendance", staff, async (request, reply) => {
    const attendance = await lessonsService.getAttendance(request.user.schoolId, request.params.id);
    return reply.send(attendance);
  });

  // ─── Материалы урока («домашка» — список, без сдачи ответов) ────────────────

  app.get<{ Params: { id: string } }>("/lessons/:id/materials", staff, async (request, reply) => {
    const items = await lessonsService.listLessonMaterials(
      request.user.schoolId,
      request.params.id,
    );
    return reply.send({ items });
  });

  app.post<{ Params: { id: string } }>("/lessons/:id/materials", staff, async (request, reply) => {
    const body = assignLessonMaterialRequestSchema.parse(request.body);
    await lessonsService.assignLessonMaterial(
      request.user.schoolId,
      request.params.id,
      body.materialId,
      request.user.sub,
    );
    const items = await lessonsService.listLessonMaterials(
      request.user.schoolId,
      request.params.id,
    );
    return reply.status(201).send({ items });
  });

  app.delete<{ Params: { id: string; materialId: string } }>(
    "/lessons/:id/materials/:materialId",
    staff,
    async (request, reply) => {
      await lessonsService.unassignLessonMaterial(
        request.user.schoolId,
        request.params.id,
        request.params.materialId,
      );
      return reply.status(204).send();
    },
  );
}
