import type { FastifyInstance } from "fastify";
import { createLessonRequestSchema, listLessonsQuerySchema } from "@school/shared";
import * as lessonsService from "./service.js";

export default async function lessonsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/lessons", { preHandler: app.requireRole("admin", "teacher") }, async (request, reply) => {
    const query = listLessonsQuerySchema.parse(request.query);
    const { rows, total } = await lessonsService.listLessons(request.user.schoolId, query);
    return reply.send({ items: rows, total, page: query.page, pageSize: query.pageSize });
  });

  app.post("/lessons", { preHandler: app.requireRole("admin", "teacher") }, async (request, reply) => {
    const body = createLessonRequestSchema.parse(request.body);
    const lesson = await lessonsService.createLesson(request.user.schoolId, body);
    return reply.status(201).send(lesson);
  });

  app.get<{ Params: { id: string } }>("/lessons/:id", async (request, reply) => {
    const lesson = await lessonsService.getLesson(request.user.schoolId, request.params.id);
    return reply.send(lesson);
  });
}
