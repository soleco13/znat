import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { logEvent, runWithLogContext, safeClientId } from "./logger.js";
import { redactUrl } from "./log-redact.js";

/** Служебные пути, которые дёргаются раз в несколько секунд: в info они только шумят. */
const QUIET_PATHS = ["/health", "/metrics"];

/**
 * Контекст корреляции на каждый запрос: requestId (присланный браузером или
 * новый), сессия вкладки из X-Client-Session. Дальше его дополняют
 * аутентификация (userId) и доступ к уроку (lessonId, participantId), и всё
 * это попадает в каждую строку лога, включая логи сервисов и Postgres.
 * requestId возвращается клиенту заголовком — по нему поддержка находит
 * строку ошибки.
 */
export default fp(async function requestContextPlugin(app: FastifyInstance) {
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    runWithLogContext(
      { requestId: request.id, clientSessionId: safeClientId(request.headers["x-client-session"]) },
      done,
    );
  });

  // Одна строка на запрос (вместо «incoming request» + «request completed»).
  app.addHook("onResponse", async (request, reply) => {
    const quiet = QUIET_PATHS.some((p) => request.url.startsWith(p));
    const statusCode = reply.statusCode;
    logEvent(
      "http_request",
      {
        method: request.method,
        route: request.routeOptions.url ?? null,
        url: redactUrl(request.url),
        statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ip: request.ip,
      },
      quiet ? "debug" : statusCode >= 500 ? "error" : "info",
      request.log,
    );
  });
});
