import type { FastifyInstance } from "fastify";
import { guestEnterRequestSchema, type GuestEnterResponse } from "@school/shared";
import { env } from "../../plugins/env.js";
import { GUEST_COOKIE_NAME } from "./service.js";
import * as guestsService from "./service.js";
import * as roomsService from "../rooms/service.js";
import { AppError } from "../../plugins/errors.js";
import { logEvent, setLogContext } from "../../plugins/logger.js";

/**
 * Э12.4 — гостевой вход ученика (§1.4/§1.6 план-ТЗ). Публичные, без
 * `app.authenticate`: у ученика аккаунта нет. Регистрируется под префиксом
 * `/api/v1` рядом с остальными модулями.
 *
 * Вход по ссылке считается по IP, и лимит рассчитан на класс за одним
 * роутером: 30 учеников × (превью + вход + сессия) ≈ 90 запросов в минуту
 * (было 20 — выбивало 429 с 7-го ученика). Перебор ссылки лимит не
 * сдерживает и не должен: токен — 32 случайных байта.
 */
export default async function guestsRoutes(app: FastifyInstance) {
  const rateLimited = {
    config: { rateLimit: { max: env.RATE_LIMIT_GUEST_ENTRY_PER_MINUTE, timeWindow: "1 minute" } },
  };

  app.get<{ Params: { token: string } }>("/j/:token", rateLimited, async (request, reply) => {
    const info = await guestsService.getPublicLessonInfo(request.params.token);
    return reply.send(info);
  });

  /** Ссылка ученика, открытая сотрудником с действующим входом: его ли это урок. */
  app.get<{ Params: { token: string } }>(
    "/j/:token/staff",
    { ...rateLimited, preHandler: app.authenticate },
    async (request, reply) => {
      const lessonId = await guestsService.resolveStaffLessonByLink(request.params.token, request.user);
      if (!lessonId) {
        throw new AppError(403, "forbidden", "Урок по ссылке не ваш — вход как ученик");
      }
      return reply.send({ lessonId });
    },
  );

  app.post<{ Params: { token: string } }>(
    "/j/:token/enter",
    rateLimited,
    async (request, reply) => {
      const body = guestEnterRequestSchema.parse(request.body);
      let session;
      try {
        // Ученик вышел и вошёл по ссылке снова — прежняя личность (права,
        // права учителя, чат, посещаемость), а не новый человек «Юля2»
        // (урок 2026-10-13). Только если прежняя сейчас не в уроке: вторая
        // вкладка того же браузера должна быть отдельным участником, иначе
        // она выбила бы первую.
        const previous = request.cookies?.[GUEST_COOKIE_NAME];
        const previousActor = previous ? await guestsService.resolveGuestSession(previous).catch(() => null) : null;
        session = await guestsService.enterAsGuest(
          request.params.token,
          body.name,
          async (lessonId) => {
            if (!previousActor || previousActor.lessonId !== lessonId) return null;
            return (await roomsService.isParticipantConnected(lessonId, previousActor.participantId))
              ? null
              : previousActor.participantId;
          },
          // Имя не ввели (2026-10-15: имя необязательно) — вернувшемуся гостю
          // его прежнее имя, новому — «Ученик N»: наименьший номер, которого
          // нет у тех, кто сейчас в уроке (в постоянной комнате номера не растут).
          async (lessonId, reusedGuestId) => {
            if (reusedGuestId && previousActor?.participantId === reusedGuestId) return previousActor.displayName;
            const taken = new Set<number>();
            for (const p of await roomsService.listParticipantsSnapshot(lessonId)) {
              const m = /^Ученик (\d+)$/.exec(p.fullName);
              if (m) taken.add(Number(m[1]));
            }
            let n = 1;
            while (taken.has(n)) n++;
            return `Ученик ${n}`;
          },
        );
        setLogContext({ lessonId: session.payload.lessonId, participantId: session.payload.guestId });
        // Новый гость в уроке ещё не был — при закрытом входе куку не выдаём.
        await roomsService.assertGuestNotLockedOut(session.payload.lessonId, session.payload.guestId);
      } catch (err) {
        const reason = err instanceof AppError ? err.code : "internal_error";
        logEvent("auth_failure", { method: "guest_link", reason }, "warn", request.log);
        throw err;
      }
      logEvent("auth_success", { method: "guest_link" }, "info", request.log);

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

  /**
   * Э12.6 — восстановление гостевой личности из httpOnly-куки при
   * перезагрузке страницы урока. Не под `:token` (чтобы не коллизировать
   * с `GET /j/:token`) и без rate-limit-цели «перебор токена» — но общий
   * лимит держим, вызов дешёвый и редкий.
   */
  app.get("/guest/session", rateLimited, async (request, reply) => {
    const cookie = request.cookies?.[GUEST_COOKIE_NAME];
    if (!cookie) {
      return reply
        .status(401)
        .send({ error: "no_guest_session", message: "Гостевая сессия не найдена" });
    }
    const info = await guestsService.getGuestSessionInfo(cookie);
    return reply.send(info);
  });
}
