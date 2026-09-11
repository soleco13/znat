import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { RecorderTokenPayload } from "@school/shared";
import { verifyRecorderToken } from "../modules/recorder-auth/service.js";
import { AppError } from "./errors.js";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Э10.6 — гвард для эндпоинтов шаблона записи (`/egress`): recorder-токен
     * в `Authorization: Bearer`, тот же формат, что у персонала, но своим
     * секретом и своим периметром (`request.recorderActor`, не `request.user`
     * — recorder не персонал и не участник урока, не должен случайно пройти
     * проверки, рассчитанные на `AccessTokenPayload`/`LessonActor`).
     */
    authenticateRecorder: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    recorderActor: RecorderTokenPayload;
  }
}

/**
 * Отдельный от `authenticate.ts` плагин (не переиспользует `app.authenticate`
 * + новую роль): recorder-токен подписан другим секретом и не является
 * `AccessTokenPayload` — смешивание периметров здесь и есть тот класс ошибки,
 * который CLAUDE.md просит не делегировать вслепую («логика прав доступа и
 * выдачи токенов»).
 */
export default fp(async function recorderAccessPlugin(app: FastifyInstance) {
  app.decorate("authenticateRecorder", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "missing_token", "Отсутствует recorder-токен");
    }
    const payload = await verifyRecorderToken(header.slice("Bearer ".length));
    if (!payload) {
      throw new AppError(401, "invalid_token", "Недействительный или просроченный recorder-токен");
    }
    request.recorderActor = payload;
  });
});
