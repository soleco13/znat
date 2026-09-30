import path from "node:path";
import type { FastifyInstance } from "fastify";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as storageService from "./service.js";
import { isImageVariant, renderImageVariant, supportsImageVariant } from "./image-variants.js";

/**
 * Тип содержимого при отдаче файла напрямую (без Caddy, который ставит его сам
 * по расширению): с `nosniff` и без типа браузер не обязан угадывать формат.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
};

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Монтируется на верхнем уровне как /files/* (§4.1 ТЗ) — доступ по HMAC-подписи, без JWT. */
export async function filesRoutes(app: FastifyInstance) {
  app.get<{ Params: { "*": string }; Querystring: { exp: string; sig: string; v?: string } }>(
    "/files/*",
    async (request, reply) => {
      const storageKey = decodeURIComponent(request.params["*"]);
      const exp = Number(request.query.exp);
      const sig = request.query.sig;
      if (!sig || !Number.isFinite(exp) || !storageService.verifyFileSignature(storageKey, exp, sig)) {
        throw new AppError(403, "invalid_signature", "Ссылка недействительна или истекла");
      }
      // Облегчённый вариант картинки доски (image-variants.ts): подпись та же,
      // `v` — только способ отдачи того же файла.
      const variant = request.query.v;
      if (isImageVariant(variant) && supportsImageVariant(storageKey)) {
        let data: Buffer | null;
        try {
          data = await renderImageVariant(storageKey, variant, async () =>
            readAll(await storageService.openFile(storageKey)),
          );
        } catch {
          throw new AppError(404, "not_found", "Файл не найден");
        }
        if (data) {
          return reply.header("Content-Type", "image/webp").header("X-Content-Type-Options", "nosniff").send(data);
        }
      }
      // Отдачу через Caddy (X-Accel-Redirect) — только запросам, которые через
      // него и пришли (он всегда ставит X-Forwarded-For). Запись урока
      // (headless Chrome внутри egress) ходит к приложению напрямую, минуя
      // Caddy: ей ответ-указание приходил пустым, и картинки доски в записи не
      // отображались (2026-09-26). Напрямую к приложению можно только с
      // самого сервера — порт открыт на 127.0.0.1.
      if (env.FILES_VIA_PROXY && request.headers["x-forwarded-for"] !== undefined) {
        let proxyPath: string;
        try {
          proxyPath = storageService.getProxyFilePath(storageKey);
        } catch {
          throw new AppError(404, "not_found", "Файл не найден");
        }
        return reply.header("X-Accel-Redirect", proxyPath).status(200).send();
      }
      const stream = await storageService.openFile(storageKey);
      const contentType = CONTENT_TYPES[path.extname(storageKey).toLowerCase()];
      if (contentType) reply.header("Content-Type", contentType);
      return reply.header("X-Content-Type-Options", "nosniff").send(stream);
    },
  );
}
