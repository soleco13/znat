import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  lessonRecordingsResponseSchema,
  recordingSummarySchema,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as recordingsService from "./service.js";

const uuidParam = z.string().uuid();

/**
 * Э10.3/10.4 — управление записью урока и доступ к готовым файлам (§10.4/
 * §10.10 ТЗ). Ученик сюда не ходит вообще (проверка роли в сервисе:
 * `assertRecordingAccess`). Скачивание — только presigned-ссылкой из
 * ответа, прямых путей к файлам здесь нет.
 */
export default async function recordingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string } }>(
    "/lessons/:id/recordings",
    { preHandler: app.requireRole("admin", "methodist", "teacher") },
    async (request, reply) => {
      const lessonId = parseLessonId(request.params.id);
      const result = await recordingsService.getLessonRecordings(request.user, lessonId);
      return reply.send(lessonRecordingsResponseSchema.parse(result));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/lessons/:id/recordings",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const lessonId = parseLessonId(request.params.id);
      const recording = await recordingsService.startLessonRecording(request.user, lessonId);
      return reply.status(201).send(recordingSummarySchema.parse(recording));
    },
  );

  app.post<{ Params: { id: string; recordingId: string } }>(
    "/lessons/:id/recordings/:recordingId/stop",
    { preHandler: app.requireRole("admin", "teacher") },
    async (request, reply) => {
      const lessonId = parseLessonId(request.params.id);
      const recordingId = parseRecordingId(request.params.recordingId);
      const recording = await recordingsService.stopLessonRecording(
        request.user,
        lessonId,
        recordingId,
      );
      return reply.send(recordingSummarySchema.parse(recording));
    },
  );
}

function parseLessonId(raw: string): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "bad_lesson_id", "Некорректный идентификатор урока");
  return parsed.data;
}

function parseRecordingId(raw: string): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "bad_recording_id", "Некорректный идентификатор записи");
  return parsed.data;
}
