import type { FastifyInstance } from "fastify";
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  resetPasswordRequestSchema,
} from "@school/shared";
import * as authService from "./service.js";
import { AppError } from "../../plugins/errors.js";
import { env } from "../../plugins/env.js";

const REFRESH_COOKIE = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

function setRefreshCookie(reply: import("fastify").FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
    signed: true,
  });
}

function toMeResponse(user: { id: string; schoolId: string; email: string; fullName: string; role: string }) {
  return meResponseSchema.parse({
    id: user.id,
    schoolId: user.schoolId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  });
}

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);
    const result = await authService.login(body.email, body.password);
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return reply.send({ accessToken: result.accessToken, user: toMeResponse(result.user) });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (!presented) {
      throw new AppError(401, "missing_refresh_token", "Отсутствует refresh-токен");
    }
    const unsigned = request.unsignCookie(presented);
    if (!unsigned.valid || !unsigned.value) {
      throw new AppError(401, "invalid_refresh_token", "Недействительный refresh-токен");
    }
    const result = await authService.refresh(unsigned.value);
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return reply.send({ accessToken: result.accessToken, user: toMeResponse(result.user) });
  });

  app.post("/auth/logout", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (presented) {
      const unsigned = request.unsignCookie(presented);
      if (unsigned.valid && unsigned.value) {
        await authService.logout(unsigned.value);
      }
    }
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.send({ ok: true });
  });

  const passwordLimited = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.post("/auth/password/forgot", passwordLimited, async (request, reply) => {
    const body = forgotPasswordRequestSchema.parse(request.body);
    await authService.requestPasswordReset(body.email);
    return reply.status(202).send({ ok: true });
  });

  app.post("/auth/password/reset", passwordLimited, async (request, reply) => {
    const body = resetPasswordRequestSchema.parse(request.body);
    await authService.resetPassword(body.token, body.password);
    return reply.send({ ok: true });
  });

  app.post(
    "/auth/password/change",
    { preHandler: app.authenticate, ...passwordLimited },
    async (request, reply) => {
      const body = changePasswordRequestSchema.parse(request.body);
      const result = await authService.changePassword(request.user.sub, body.currentPassword, body.newPassword);
      setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
      return reply.send({ accessToken: result.accessToken, user: toMeResponse(result.user) });
    },
  );

  app.get("/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await authService.getUserOrThrow(request.user.sub);
    return reply.send(toMeResponse(user));
  });
}
