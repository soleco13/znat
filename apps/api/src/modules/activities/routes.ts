import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createActivityRequestSchema,
  gradeManualResponseRequestSchema,
  pushAnswerToBoardRequestSchema,
  saveResponseRequestSchema,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as activitiesService from "./service.js";

const uuidParam = z.string().uuid();

/**
 * Выдача заданий (Э8.6, §8 ТЗ). Монтируется под /api/v1 (см. server.ts).
 * `POST /lessons/:id/activities` — учитель; `GET /activities/:id/my` —
 * ученик получает СВОЮ копию (индивидуальный канал, не Y.Doc).
 */
export default async function activitiesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post<{ Params: { id: string } }>(
    "/lessons/:id/activities",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const lessonId = uuidParam.parse(request.params.id);
      const body = createActivityRequestSchema.parse(request.body);
      const activity = await activitiesService.createActivity(request.user, lessonId, body);
      return reply.status(201).send(activity);
    },
  );

  app.get<{ Params: { id: string } }>("/lessons/:id/activities", async (request, reply) => {
    const lessonId = uuidParam.parse(request.params.id);
    const items = await activitiesService.listLessonActivities(request.user, lessonId);
    return reply.send({ items });
  });

  // Э8.11, §7.3/§8 ТЗ: «домашняя работа вне урока» — учитель задаёт материал
  // прямо группе, без урока (`lessonId` в БД — `null`). Тело то же, что у
  // `POST /lessons/:id/activities`; `mode` внутри игнорируется — сюда всегда
  // пишется "homework" (см. docstring createActivityRequestSchema).
  app.post<{ Params: { id: string } }>(
    "/groups/:id/activities",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const groupId = uuidParam.parse(request.params.id);
      const body = createActivityRequestSchema.parse(request.body);
      const activity = await activitiesService.createHomeworkActivity(request.user, groupId, body);
      return reply.status(201).send(activity);
    },
  );

  // Э8.11: список домашних заданий группы — ученик видит свои, учитель/админ школы видит все группы.
  app.get<{ Params: { id: string } }>("/groups/:id/activities", async (request, reply) => {
    const groupId = uuidParam.parse(request.params.id);
    const items = await activitiesService.listGroupActivities(request.user, groupId);
    return reply.send({ items });
  });

  // Э8.8: живая панель прогресса класса — учителю (опрос раз в несколько секунд).
  app.get<{ Params: { id: string } }>(
    "/activities/:id/progress",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const progress = await activitiesService.getProgress(request.user, parsed.data);
      return reply.send(progress);
    },
  );

  // Э8.9: агрегированная аналитика по вопросам — учителю (гистограмма ответов).
  app.get<{ Params: { id: string } }>(
    "/activities/:id/analytics",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const analytics = await activitiesService.getAnalytics(request.user, parsed.data);
      return reply.send(analytics);
    },
  );

  app.get<{ Params: { id: string } }>("/activities/:id/my", async (request, reply) => {
    const parsed = uuidParam.safeParse(request.params.id);
    if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
    const my = await activitiesService.getMyActivity(request.user, parsed.data);
    return reply.send(my);
  });

  // Э8.7: автосохранение черновика одного ответа (раз в ~5 сек + при потере
  // фокуса). Идемпотентно по (attemptId, questionId) — обрыв связи не теряет
  // ответы, повторная отправка того же не создаёт дублей.
  app.post<{ Params: { id: string } }>("/activities/:id/responses", async (request, reply) => {
    const parsed = uuidParam.safeParse(request.params.id);
    if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
    const body = saveResponseRequestSchema.parse(request.body);
    const result = await activitiesService.saveResponse(request.user, parsed.data, body);
    return reply.send(result);
  });

  // Э8.10: учитель начинает разбор — с этого момента правильные ответы
  // доступны всем участникам урока через GET .../review.
  app.post<{ Params: { id: string } }>(
    "/activities/:id/review",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const result = await activitiesService.startReview(request.user, parsed.data);
      return reply.send(result);
    },
  );

  // Э8.10: полный материал с правильными ответами — ученику и учителю, только после начала разбора.
  app.get<{ Params: { id: string } }>("/activities/:id/review", async (request, reply) => {
    const parsed = uuidParam.safeParse(request.params.id);
    if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
    const review = await activitiesService.getReview(request.user, parsed.data);
    return reply.send(review);
  });

  // Э8.10: ответы класса на один вопрос, с именами — учителю, чтобы выбрать чей вынести на доску.
  app.get<{ Params: { id: string; questionId: string } }>(
    "/activities/:id/review/questions/:questionId/responses",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const responses = await activitiesService.getReviewResponses(
        request.user,
        parsed.data,
        request.params.questionId,
      );
      return reply.send(responses);
    },
  );

  // Э8.10, §7.3 ТЗ: «вынести чей-то ответ на доску» — анонимно или с именем.
  app.post<{ Params: { id: string } }>(
    "/activities/:id/review/board",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const body = pushAnswerToBoardRequestSchema.parse(request.body);
      await activitiesService.pushAnswerToBoard(request.user, parsed.data, body);
      return reply.status(204).send();
    },
  );

  // §8 ТЗ: ученик сдаёт попытку — автопроверяемые вопросы оцениваются сразу,
  // `open_answer` уходит в очередь ручной проверки (Э8.12). После этого
  // вызова `POST /activities/:id/responses` (автосохранение) отказывает.
  app.post<{ Params: { id: string } }>("/activities/:id/submit", async (request, reply) => {
    const parsed = uuidParam.safeParse(request.params.id);
    if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
    const result = await activitiesService.submitActivity(request.user, parsed.data);
    return reply.send(result);
  });

  // Э8.12, §8 ТЗ: очередь ручной проверки — учителю/админу.
  app.get("/grading/queue", { preHandler: app.requireRole("admin", "teacher") }, async (request, reply) => {
    const items = await activitiesService.getGradingQueue(request.user);
    return reply.send({ items });
  });

  // Э8.12, §8 ТЗ: учитель ставит баллы за один ответ ручной проверки.
  app.post<{ Params: { responseId: string } }>(
    "/grading/:responseId",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const responseId = uuidParam.parse(request.params.responseId);
      const body = gradeManualResponseRequestSchema.parse(request.body);
      const result = await activitiesService.gradeManualResponse(request.user, responseId, body);
      return reply.send(result);
    },
  );
}
