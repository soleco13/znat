import type { FastifyInstance, FastifyRequest } from "fastify";
import { clientEventBatchSchema } from "@school/shared";
import { verifyAccessToken } from "../auth/service.js";
import { GUEST_COOKIE_NAME, verifyGuestToken } from "../guests/service.js";
import { currentLogContext, safeClientId, setLogContext } from "../../plugins/logger.js";
import * as telemetryService from "./service.js";

/**
 * Личность отправителя — по возможности, без отказа: события «не смог
 * подключиться» шлёт и тот, чья сессия уже недействительна. Только подпись
 * токена (без похода в БД) — эндпоинт дёргается часто.
 */
async function identify(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const user = await verifyAccessToken(header.slice("Bearer ".length));
      setLogContext({ userId: user.sub, schoolId: user.schoolId, participantId: user.sub });
      return;
    } catch {
      // анонимно
    }
  }
  const cookie = request.cookies?.[GUEST_COOKIE_NAME];
  if (cookie) {
    try {
      const guest = await verifyGuestToken(cookie);
      setLogContext({ participantId: guest.guestId, lessonId: guest.lessonId });
    } catch {
      // анонимно
    }
  }
}

export default async function telemetryRoutes(app: FastifyInstance) {
  // G-08: клиент шлёт пачку раз в 5 с (≤ 12 в минуту) и при уходе со
  // страницы — свой лимит запросов с запасом. Без сессии (ключ по IP) —
  // строже: за одним школьным IP сидят и вошедшие ученики, но их запросы
  // считаются по личности, не по IP.
  app.post(
    "/telemetry",
    {
      bodyLimit: 64 * 1024,
      config: {
        rateLimit: {
          max: (_request: FastifyRequest, key: string) => (key.startsWith("ip:") ? 20 : 30),
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = clientEventBatchSchema.parse(request.body);
      if (!currentLogContext()?.clientSessionId) {
        const fromBody = safeClientId(body.clientSessionId);
        if (fromBody) setLogContext({ clientSessionId: fromBody });
      }
      await identify(request);
      telemetryService.logClientEvents(body.events, request.log);
      return reply.status(204).send();
    },
  );
}
