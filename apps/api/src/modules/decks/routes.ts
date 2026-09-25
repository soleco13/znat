import type { FastifyInstance } from "fastify";
import { deckSchema, deckUploadResponseSchema, type Deck } from "@school/shared";
import { z } from "zod";
import { AppError } from "../../plugins/errors.js";
import { UPLOAD_LIMITS, openStreamedUpload } from "../../plugins/uploads.js";
import * as decksService from "./service.js";

const jobStatusResponseSchema = deckSchema.pick({
  status: true,
  progress: true,
  slideCount: true,
  error: true,
});

/**
 * Презентации урока (Э4, §8.1 ТЗ). Монтируется под /api/v1 (см. server.ts).
 * Путь `/jobs/:jobId` живёт здесь же (jobId === deckId), чтобы не заводить
 * зависимость `jobs → decks` (обратная `decks → jobs` уже есть — enqueue).
 */
export default async function decksRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post<{ Params: { id: string } }>("/lessons/:id/uploads", async (request, reply) => {
    const file = await openStreamedUpload(request, UPLOAD_LIMITS.deck);
    const result = await decksService.createDeckFromUpload({
      user: request.user,
      lessonId: request.params.id,
      stream: file.stream,
      filename: file.filename,
      mimeType: file.mimetype,
    });
    return reply.send(deckUploadResponseSchema.parse(result));
  });

  app.get<{ Params: { id: string } }>("/lessons/:id/decks", async (request, reply) => {
    const decks = await decksService.listDecks(request.user, request.params.id);
    return reply.send({ decks: decks.map((d: Deck) => deckSchema.parse(d)) });
  });

  app.delete<{ Params: { id: string; deckId: string } }>(
    "/lessons/:id/decks/:deckId",
    async (request, reply) => {
      await decksService.deleteDeck(request.user, request.params.id, request.params.deckId);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request, reply) => {
    const parsed = z.string().uuid().safeParse(request.params.jobId);
    if (!parsed.success) {
      throw new AppError(400, "bad_job_id", "Некорректный идентификатор задачи");
    }
    const status = await decksService.getDeckStatus(request.user, parsed.data);
    return reply.send(jobStatusResponseSchema.parse(status));
  });
}
