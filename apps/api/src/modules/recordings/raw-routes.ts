import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  journalPageSchema,
  lessonRecordingModeResponseSchema,
  rawRecordClaimRequestSchema,
  rawRecordFinishedRequestSchema,
  rawRecordHeartbeatRequestSchema,
  rawRecordHeartbeatResponseSchema,
  rawRecordJobSchema,
  rawRecordingDetailSchema,
  rawRenderClaimRequestSchema,
  rawRenderFailedRequestSchema,
  rawRenderFinishedRequestSchema,
  rawRenderHeartbeatRequestSchema,
  rawRenderJobSchema,
  rawReplayDataSchema,
  setLessonRecordingModeRequestSchema,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as recordingsService from "./service.js";

const uuidParam = z.string().uuid();
const journalQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(5000).default(2000),
});

/**
 * Экспериментальная запись (docs/experimental-recording.md):
 *  - `/internal/raw-recorder/*` — рекордер и рендер (сервис
 *    services/raw-recorder), Bearer `RAW_RECORDER_SECRET`. Без секрета —
 *    404, как будто маршрутов нет. Вне лимита запросов: heartbeat каждые
 *    5 с с одного адреса на каждую запись;
 *  - `/raw-recordings/:id/replay` — журнал для страницы кадров рендера,
 *    recorder-токен этой записи;
 *  - `/admin/...` — режим записи урока и состояние экспериментальной записи.
 */
export default async function rawRecordingsRoutes(app: FastifyInstance) {
  await app.register(async (internal) => {
    internal.addHook("onRequest", async (request: FastifyRequest) => {
      if (!recordingsService.verifyInternalSecret(request.headers.authorization)) {
        throw new AppError(404, "not_found", "Not found");
      }
    });
    const noLimit = { config: { rateLimit: false as const } };

    internal.post("/internal/raw-recorder/record/claim", noLimit, async (request, reply) => {
      const body = rawRecordClaimRequestSchema.parse(request.body);
      const job = await recordingsService.claimRecordJob(body.workerId);
      if (!job) return reply.status(204).send();
      return reply.send(rawRecordJobSchema.parse(job));
    });

    internal.post<{ Params: { id: string } }>("/internal/raw-recorder/record/:id/heartbeat", noLimit, async (request, reply) => {
      const body = rawRecordHeartbeatRequestSchema.parse(request.body);
      const result = await recordingsService.recorderHeartbeat(parseId(request.params.id), body.leaseId, body.stats);
      return reply.send(rawRecordHeartbeatResponseSchema.parse(result));
    });

    internal.post<{ Params: { id: string } }>("/internal/raw-recorder/record/:id/finished", noLimit, async (request, reply) => {
      const body = rawRecordFinishedRequestSchema.parse(request.body);
      await recordingsService.recorderFinished(parseId(request.params.id), body.leaseId, body);
      return reply.status(204).send();
    });

    internal.post("/internal/raw-recorder/render/claim", noLimit, async (request, reply) => {
      const body = rawRenderClaimRequestSchema.parse(request.body);
      const job = await recordingsService.claimRenderJob(body.workerId);
      if (!job) return reply.status(204).send();
      return reply.send(rawRenderJobSchema.parse(job));
    });

    internal.post<{ Params: { id: string } }>("/internal/raw-recorder/render/:id/heartbeat", noLimit, async (request, reply) => {
      const body = rawRenderHeartbeatRequestSchema.parse(request.body);
      await recordingsService.renderHeartbeat(parseId(request.params.id), body.leaseId, body.step);
      return reply.status(204).send();
    });

    internal.post<{ Params: { id: string } }>("/internal/raw-recorder/render/:id/finished", noLimit, async (request, reply) => {
      const body = rawRenderFinishedRequestSchema.parse(request.body);
      await recordingsService.renderFinished(parseId(request.params.id), body.leaseId, body);
      return reply.status(204).send();
    });

    internal.post<{ Params: { id: string } }>("/internal/raw-recorder/render/:id/failed", noLimit, async (request, reply) => {
      const body = rawRenderFailedRequestSchema.parse(request.body);
      await recordingsService.renderFailed(parseId(request.params.id), body.leaseId, body);
      return reply.status(204).send();
    });

    internal.get<{ Params: { id: string } }>("/internal/raw-recorder/:id/journal", noLimit, async (request, reply) => {
      const query = journalQuerySchema.parse(request.query);
      const page = await recordingsService.getJournalPage(parseId(request.params.id), query.afterSeq, query.limit);
      return reply.send(journalPageSchema.parse(page));
    });
  });

  // Страница кадров рендера (`/recording-replay`) — recorder-токен этой записи.
  await app.register(async (replay) => {
    replay.addHook("preHandler", replay.authenticateRecorder);
    replay.get<{ Params: { id: string } }>("/raw-recordings/:id/replay", async (request, reply) => {
      const data = await recordingsService.getReplayData(request.recorderActor, parseId(request.params.id));
      return reply.send(rawReplayDataSchema.parse(data));
    });
  });

  await app.register(async (admin) => {
    admin.addHook("preHandler", admin.authenticate);
    admin.addHook("preHandler", admin.requireRole("admin"));

    admin.get<{ Params: { id: string } }>("/admin/lessons/:id/recording-mode", async (request, reply) => {
      const result = await recordingsService.getLessonRecordingMode(request.user, parseId(request.params.id));
      return reply.send(lessonRecordingModeResponseSchema.parse(result));
    });

    admin.put<{ Params: { id: string } }>("/admin/lessons/:id/recording-mode", async (request, reply) => {
      const body = setLessonRecordingModeRequestSchema.parse(request.body);
      const result = await recordingsService.setLessonRecordingMode(request.user, parseId(request.params.id), body.mode);
      return reply.send(lessonRecordingModeResponseSchema.parse(result));
    });

    admin.get<{ Params: { id: string } }>("/admin/raw-recordings/:id", async (request, reply) => {
      const detail = await recordingsService.getRawRecordingDetail(request.user, parseId(request.params.id));
      return reply.send(rawRecordingDetailSchema.parse(detail));
    });

    admin.post<{ Params: { id: string } }>("/admin/raw-recordings/:id/retry-render", async (request, reply) => {
      const detail = await recordingsService.retryRawRender(request.user, parseId(request.params.id));
      return reply.send(rawRecordingDetailSchema.parse(detail));
    });
  });
}

function parseId(raw: string): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "bad_id", "Некорректный идентификатор");
  return parsed.data;
}
