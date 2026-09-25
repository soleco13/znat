import type { FastifyInstance } from "fastify";
import {
  individualRegisterRequestSchema,
  organizationRegisterRequestSchema,
  verifyEmailRequestSchema,
  resendVerificationRequestSchema,
  meResponseSchema,
} from "@school/shared";
import { env } from "../../plugins/env.js";
import * as registrationService from "./service.js";

const REFRESH_COOKIE = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

/**
 * Э14.1 — публичная self-signup регистрация (§ план-ТЗ Э14). Без
 * `app.authenticate`: у регистрирующегося ещё нет аккаунта. Rate limit
 * 20/мин на IP — тот же паттерн, что `guests/routes.ts` (перебор
 * email/токенов, спам писем).
 */
export default async function registrationRoutes(app: FastifyInstance) {
  const rateLimited = {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  };
  // Каждая регистрация — новое пространство и письмо с нашего SMTP: 20 в
  // минуту с одного адреса — это рассылка спама на чужие адреса и порча
  // репутации IP. Человеку хватает пары попыток.
  const registerLimited = {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  };

  app.post("/auth/register/individual", registerLimited, async (request, reply) => {
    const body = individualRegisterRequestSchema.parse(request.body);
    const result = await registrationService.registerIndividual(body);
    return reply.status(201).send(result);
  });

  app.post("/auth/register/organization", registerLimited, async (request, reply) => {
    const body = organizationRegisterRequestSchema.parse(request.body);
    const result = await registrationService.registerOrganization(body);
    return reply.status(201).send(result);
  });

  app.post(
    "/auth/resend-verification",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = resendVerificationRequestSchema.parse(request.body);
      await registrationService.resendVerification(body.email);
      return reply.status(202).send({ ok: true });
    },
  );

  app.post("/auth/verify-email", rateLimited, async (request, reply) => {
    const body = verifyEmailRequestSchema.parse(request.body);
    const session = await registrationService.confirmEmail(body.token);

    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: REFRESH_COOKIE_PATH,
      expires: session.refreshExpiresAt,
      signed: true,
    });

    return reply.send({
      accessToken: session.accessToken,
      user: meResponseSchema.parse({
        id: session.user.id,
        schoolId: session.user.schoolId,
        email: session.user.email,
        fullName: session.user.fullName,
        role: session.user.role,
      }),
    });
  });

  app.get<{ Params: { slug: string } }>("/spaces/:slug", async (request, reply) => {
    const info = await registrationService.getSpacePublicInfo(request.params.slug);
    return reply.send(info);
  });
}
