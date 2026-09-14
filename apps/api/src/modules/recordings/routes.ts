import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  adminRecordingDetailResponseSchema,
  adminRecordingsListResponseSchema,
  lessonRecordingsResponseSchema,
  recordingExternalLinkResponseSchema,
  recordingSummarySchema,
  storageUsageResponseSchema,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as recordingsService from "./service.js";

const adminListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const externalLinkQuerySchema = z.object({
  ttlSeconds: z.coerce.number().int().positive().optional(),
});

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

  // Страница администратора «Записи» (§10.10 ТЗ) — весь архив школы, место
  // на диске, внешние ссылки, ручное удаление. Инфраструктурная страница,
  // не «мои уроки» — доступ строго `admin` (проверяется и в сервисе).
  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", adminApp.requireRole("admin"));

    adminApp.get("/admin/recordings", async (request, reply) => {
      const query = adminListQuerySchema.parse(request.query);
      const result = await recordingsService.listAllRecordings(request.user, query);
      return reply.send(adminRecordingsListResponseSchema.parse(result));
    });

    adminApp.get("/admin/recordings/storage-usage", async (request, reply) => {
      const usage = await recordingsService.getStorageUsage(request.user);
      return reply.send(storageUsageResponseSchema.parse(usage));
    });

    // Страница просмотра одной записи (§10.10 ТЗ, запрос 2026-09-14).
    adminApp.get<{ Params: { id: string } }>("/admin/recordings/:id", async (request, reply) => {
      const recordingId = parseRecordingId(request.params.id);
      const item = await recordingsService.getRecordingDetail(request.user, recordingId);
      return reply.send(adminRecordingDetailResponseSchema.parse(item));
    });

    adminApp.get<{ Params: { id: string } }>(
      "/admin/recordings/:id/external-link",
      async (request, reply) => {
        const recordingId = parseRecordingId(request.params.id);
        const query = externalLinkQuerySchema.parse(request.query);
        const link = await recordingsService.createExternalDownloadLink(
          request.user,
          recordingId,
          query.ttlSeconds,
        );
        return reply.send(recordingExternalLinkResponseSchema.parse(link));
      },
    );

    adminApp.delete<{ Params: { id: string } }>(
      "/admin/recordings/:id",
      async (request, reply) => {
        const recordingId = parseRecordingId(request.params.id);
        await recordingsService.adminDeleteRecording(request.user, recordingId);
        return reply.status(204).send();
      },
    );
  });
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
