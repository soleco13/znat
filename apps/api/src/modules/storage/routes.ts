import type { FastifyInstance } from "fastify";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as storageService from "./service.js";

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
      if (env.FILES_VIA_PROXY) {
        let proxyPath: string;
        try {
          proxyPath = storageService.getProxyFilePath(storageKey);
        } catch {
          throw new AppError(404, "not_found", "Файл не найден");
        }
        return reply.header("X-Accel-Redirect", proxyPath).status(200).send();
      }
      const stream = await storageService.openFile(storageKey);
      return reply.header("X-Content-Type-Options", "nosniff").send(stream);
    },
  );
}
