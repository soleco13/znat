import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@school/shared";
import { verifyAccessToken } from "../modules/auth/service.js";
import {
  GUEST_COOKIE_NAME,
  resolveGuestSession,
  type LessonActor,
} from "../modules/guests/service.js";
import * as usersService from "../modules/users/service.js";
import { AppError } from "./errors.js";

declare module "fastify" {
  interface FastifyInstance {
    requireLessonAccess: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Нормализованный участник урока — заполняется `requireLessonAccess` (Э12.4). */
    lessonActor: LessonActor;
  }
}

/**
 * Э12.4 (§1.6 план-ТЗ) — единый guard для эндпоинтов, доступных и персоналу,
 * и гостю-ученику одного урока. Читать построчно (CLAUDE.md «не делегировать
 * вслепую»): различает два периметра токенов и обязан не перепутать их.
 *
 *  - `Authorization: Bearer <access>` → персонал (`request.user` + `staff`-actor);
 *  - кука `guest_session` → гость (`resolveGuestSession` сверяет подпись,
 *    срок и актуальность ссылки урока), при этом `lessonId` из токена обязан
 *    совпасть с `:id` в пути — гостевая сессия строго одного урока.
 *
 * Авторизацию (admin любой урок / teacher только свой / methodist не в урок)
 * по-прежнему делает сервис `rooms`/`canvas` — здесь только аутентификация и
 * привязка actor к уроку из пути.
 */
export default fp(async function lessonAccessPlugin(app: FastifyInstance) {
  app.decorate("requireLessonAccess", async (request: FastifyRequest) => {
    const lessonId = (request.params as { id?: string }).id;
    if (!lessonId) {
      throw new AppError(400, "missing_lesson_id", "Не указан урок");
    }

    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      let user;
      try {
        user = await verifyAccessToken(header.slice("Bearer ".length));
      } catch {
        throw new AppError(401, "invalid_token", "Недействительный или просроченный access-токен");
      }
      request.user = user;
      const profile = await usersService.getUserForAuth(user.schoolId, user.sub);
      const actor: LessonActor = {
        kind: "staff",
        participantId: user.sub,
        schoolId: user.schoolId,
        role: user.role as Role,
        lessonId,
        displayName: profile?.fullName ?? "Без имени",
      };
      request.lessonActor = actor;
      return;
    }

    const cookie = request.cookies?.[GUEST_COOKIE_NAME];
    if (cookie) {
      const actor = await resolveGuestSession(cookie);
      if (actor.lessonId !== lessonId) {
        throw new AppError(403, "guest_wrong_lesson", "Гостевая сессия относится к другому уроку");
      }
      request.lessonActor = actor;
      return;
    }

    throw new AppError(401, "missing_token", "Требуется вход в урок");
  });
});
