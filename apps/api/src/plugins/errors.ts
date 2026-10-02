import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import { reportError } from "./sentry.js";
import { logEvent } from "./logger.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export default fp(async function errorsPlugin(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      // Ожидаемый отказ (нет прав, урок закрыт, не найдено). Раньше в лог не
      // попадал вовсе — «меня не пускает в урок» было не по чему разбирать.
      const level = error.statusCode >= 500 ? "error" : [401, 403, 429].includes(error.statusCode) ? "warn" : "info";
      logEvent("request_rejected", { statusCode: error.statusCode, code: error.code }, level, request.log);
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      // Только пути полей и коды проверок — значения могут быть персональными.
      const issues = error.issues.map((i) => ({ path: i.path.join("."), code: i.code }));
      logEvent("request_rejected", { statusCode: 400, code: "validation_error", issues }, "info", request.log);
      return reply.status(400).send({ error: "validation_error", issues: error.issues });
    }
    const statusCode = error.statusCode ?? 500;
    // errorId = requestId: он же уходит клиенту и в заголовок X-Request-Id —
    // по нему строка с полным стеком находится однозначно.
    logEvent(
      "request_failed",
      { statusCode, errorId: request.id, err: error },
      statusCode >= 500 ? "error" : "warn",
      request.log,
    );
    if (statusCode >= 500) reportError(error);
    return reply.status(statusCode).send({
      error: statusCode === 500 ? "internal_error" : "request_error",
      message: statusCode === 500 ? "Internal server error" : error.message,
      errorId: request.id,
    });
  });
});
