import type { FastifyInstance } from "fastify";
import { canvasImageUploadResponseSchema } from "@school/shared";
import { UPLOAD_LIMITS, withBufferedUpload } from "../../plugins/uploads.js";
import { assertCanDrawForLesson } from "./hocuspocus.js";
import { uploadCanvasImage } from "./images.js";

/** Э3.10: загрузка изображений на доску урока. Монтируется под /api/v1 (см. server.ts), как и остальные lessons-роуты. */
export default async function canvasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post<{ Params: { id: string } }>("/lessons/:id/canvas-images", async (request, reply) => {
    await assertCanDrawForLesson(request.user, request.params.id);

    const result = await withBufferedUpload(request, UPLOAD_LIMITS.canvasImage, (file) =>
      uploadCanvasImage({
        buffer: file.buffer,
        mimeType: file.mimetype,
        schoolId: request.user.schoolId,
      }),
    );
    return reply.send(canvasImageUploadResponseSchema.parse(result));
  });
}
