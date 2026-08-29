import type { FastifyInstance } from "fastify";
import { canvasImageUploadResponseSchema } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { assertCanDrawForLesson } from "./hocuspocus.js";
import { uploadCanvasImage } from "./images.js";

/** Э3.10: загрузка изображений на доску урока. Монтируется под /api/v1 (см. server.ts), как и остальные lessons-роуты. */
export default async function canvasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post<{ Params: { id: string } }>("/lessons/:id/canvas-images", async (request, reply) => {
    await assertCanDrawForLesson(request.user, request.params.id);

    const file = await request.file();
    if (!file) {
      throw new AppError(400, "no_file", "Файл не передан");
    }
    const buffer = await file.toBuffer();
    const result = await uploadCanvasImage({
      buffer,
      mimeType: file.mimetype,
      schoolId: request.user.schoolId,
    });
    return reply.send(canvasImageUploadResponseSchema.parse(result));
  });
}
