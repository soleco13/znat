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
 * Выдача заданий на уроке (Э8.6 → Э12.5, §8 ТЗ). Монтируется под /api/v1
 * (см. server.ts). Э12.5 — два периметра:
 *  - **персонал** (`app.authenticate` + роль): запуск задания, прогресс,
 *    аналитика, разбор, вынос на доску, очередь ручной проверки;
 *  - **персонал ∪ гость-ученик этого урока** (`resolveLessonActor` /
 *    `requireLessonAccess` → `request.lessonActor`): своя копия задания,
 *    автосохранение, сабмит, чтение разбора, список заданий урока.
 */
export default async function activitiesRoutes(app: FastifyInstance) {
  /** Периметр «только персонал»: аутентификация + одна из ролей. */
  const staffOnly = { preHandler: [app.authenticate, app.requireRole("admin", "teacher")] };

  app.post<{ Params: { id: string } }>(
    "/lessons/:id/activities",
    staffOnly,
    async (request, reply) => {
      const lessonId = uuidParam.parse(request.params.id);
      const body = createActivityRequestSchema.parse(request.body);
      const activity = await activitiesService.createActivity(request.user, lessonId, body);
      return reply.status(201).send(activity);
    },
  );

  // Список выдач урока — фолбэк-поллинг ученику, если WS-сигнал `activity_started` пропущен.
  app.get<{ Params: { id: string } }>(
    "/lessons/:id/activities",
    { preHandler: app.requireLessonAccess },
    async (request, reply) => {
      const lessonId = uuidParam.parse(request.params.id);
      const items = await activitiesService.listLessonActivities(request.lessonActor, lessonId);
      return reply.send({ items });
    },
  );

  // Э8.8: живая панель прогресса класса — учителю (опрос раз в несколько секунд).
  app.get<{ Params: { id: string } }>(
    "/activities/:id/progress",
    staffOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const progress = await activitiesService.getProgress(request.user, parsed.data);
      return reply.send(progress);
    },
  );

  // §7.3 ТЗ: полная попытка одного ученика — учителю урока, «открыть материал
  // ученика, который он выполняет прямо сейчас».
  app.get<{ Params: { id: string; participantId: string } }>(
    "/activities/:id/students/:participantId",
    staffOnly,
    async (request, reply) => {
      const activityId = uuidParam.parse(request.params.id);
      const participantId = uuidParam.parse(request.params.participantId);
      const attempt = await activitiesService.getStudentAttempt(
        request.user,
        activityId,
        participantId,
      );
      return reply.send(attempt);
    },
  );

  // Э8.9: агрегированная аналитика по вопросам — учителю (гистограмма ответов).
  app.get<{ Params: { id: string } }>(
    "/activities/:id/analytics",
    staffOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const analytics = await activitiesService.getAnalytics(request.user, parsed.data);
      return reply.send(analytics);
    },
  );

  // Э12.5: ученик получает СВОЮ копию (индивидуальный канал, не Y.Doc). Гость — по куке сессии урока.
  app.get<{ Params: { id: string } }>(
    "/activities/:id/my",
    { preHandler: app.resolveLessonActor },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const my = await activitiesService.getMyActivity(request.lessonActor, parsed.data);
      return reply.send(my);
    },
  );

  // Э8.7: автосохранение черновика одного ответа (раз в ~5 сек + при потере
  // фокуса). Идемпотентно по (attemptId, questionId).
  app.post<{ Params: { id: string } }>(
    "/activities/:id/responses",
    { preHandler: app.resolveLessonActor },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const body = saveResponseRequestSchema.parse(request.body);
      const result = await activitiesService.saveResponse(request.lessonActor, parsed.data, body);
      return reply.send(result);
    },
  );

  // Э8.10: учитель начинает разбор — с этого момента правильные ответы
  // доступны всем участникам урока через GET .../review.
  app.post<{ Params: { id: string } }>(
    "/activities/:id/review",
    staffOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const result = await activitiesService.startReview(request.user, parsed.data);
      return reply.send(result);
    },
  );

  // Э8.10: полный материал с правильными ответами — ученику и учителю, только после начала разбора.
  app.get<{ Params: { id: string } }>(
    "/activities/:id/review",
    { preHandler: app.resolveLessonActor },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const review = await activitiesService.getReview(request.lessonActor, parsed.data);
      return reply.send(review);
    },
  );

  // Э8.10: ответы класса на один вопрос, с именами — учителю, чтобы выбрать чей вынести на доску.
  app.get<{ Params: { id: string; questionId: string } }>(
    "/activities/:id/review/questions/:questionId/responses",
    staffOnly,
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
    staffOnly,
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
  app.post<{ Params: { id: string } }>(
    "/activities/:id/submit",
    { preHandler: app.resolveLessonActor },
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_activity_id", "Некорректный идентификатор задания");
      const result = await activitiesService.submitActivity(request.lessonActor, parsed.data);
      return reply.send(result);
    },
  );

  // Э8.12, §8 ТЗ: очередь ручной проверки — учителю/админу.
  app.get(
    "/grading/queue",
    staffOnly,
    async (request, reply) => {
      const items = await activitiesService.getGradingQueue(request.user);
      return reply.send({ items });
    },
  );

  // Э8.12, §8 ТЗ: учитель ставит баллы за один ответ ручной проверки.
  app.post<{ Params: { responseId: string } }>(
    "/grading/:responseId",
    staffOnly,
    async (request, reply) => {
      const responseId = uuidParam.parse(request.params.responseId);
      const body = gradeManualResponseRequestSchema.parse(request.body);
      const result = await activitiesService.gradeManualResponse(request.user, responseId, body);
      return reply.send(result);
    },
  );
}
