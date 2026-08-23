import type { FastifyInstance } from "fastify";
import { AppError } from "../../plugins/errors.js";
import * as storageService from "./service.js";

/** Монтируется под /api/v1 — требует аутентификации. */
export async function assetsRoutes(app: FastifyInstance) {
  app.post("/assets", { preHandler: app.authenticate }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, "no_file", "Файл не передан");
    }
    const { storageKey, sizeBytes } = await storageService.uploadFile({
      stream: file.file,
      suggestedName: file.filename,
      schoolId: request.user.schoolId,
    });
    return reply.send({ storageKey, sizeBytes, url: storageService.getSignedFileUrl(storageKey) });
  });
}

/** Монтируется на верхнем уровне как /files/* (§4.1 ТЗ) — доступ по HMAC-подписи, без JWT. */
export async function filesRoutes(app: FastifyInstance) {
  app.get<{ Params: { "*": string }; Querystring: { exp: string; sig: string } }>(
    "/files/*",
    async (request, reply) => {
      const storageKey = decodeURIComponent(request.params["*"]);
      const exp = Number(request.query.exp);
      const sig = request.query.sig;
      if (!sig || !Number.isFinite(exp) || !storageService.verifyFileSignature(storageKey, exp, sig)) {
        throw new AppError(403, "invalid_signature", "Ссылка недействительна или истекла");
      }
      const stream = await storageService.openFile(storageKey);
      return reply.send(stream);
    },
  );
}
