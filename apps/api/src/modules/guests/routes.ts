import type { FastifyInstance } from "fastify";
import { guestEnterRequestSchema, type GuestEnterResponse } from "@school/shared";
import { env } from "../../plugins/env.js";
import { GUEST_COOKIE_NAME } from "./service.js";
import * as guestsService from "./service.js";

/**
 * Э12.4 — гостевой вход ученика (§1.4/§1.6 план-ТЗ). Публичные, без
 * `app.authenticate`: у ученика аккаунта нет. Rate limit 20/мин на IP
 * (`GET /j/:token` перебором токена + `POST .../enter` спамом сессий).
 * Регистрируется под префиксом `/api/v1` рядом с остальными модулями.
 */
export default async function guestsRoutes(app: FastifyInstance) {
  const rateLimited = {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  };

  app.get<{ Params: { token: string } }>("/j/:token", rateLimited, async (request, reply) => {
    const info = await guestsService.getPublicLessonInfo(request.params.token);
    return reply.send(info);
  });

  app.post<{ Params: { token: string } }>(
    "/j/:token/enter",
    rateLimited,
    async (request, reply) => {
      const body = guestEnterRequestSchema.parse(request.body);
      const session = await guestsService.enterAsGuest(request.params.token, body.name);

      reply.setCookie(GUEST_COOKIE_NAME, session.token, {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: session.ttlSeconds,
      });

      const response: GuestEnterResponse = {
        lessonId: session.payload.lessonId,
        guestId: session.payload.guestId,
        name: session.payload.name,
        expiresAt: session.expiresAt.toISOString(),
      };
      return reply.status(201).send(response);
    },
  );
}
