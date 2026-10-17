import type { FastifyInstance } from "fastify";
import {
  guestEnterRequestSchema,
  guestKnockRequestSchema,
  type GuestEnterResponse,
  type GuestKnockResponse,
  type GuestKnockStatus,
} from "@school/shared";
import { env } from "../../plugins/env.js";
import { GUEST_COOKIE_NAME, GUEST_NAME_COOKIE, GUEST_NAME_COOKIE_MAX_AGE_S, readRememberedName } from "./service.js";
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
/** «Ученик N»: наименьший номер, которого нет у тех, кто сейчас в уроке (в постоянной комнате номера не растут). */
async function autoStudentName(lessonId: string): Promise<string> {
  const taken = new Set<number>();
  for (const p of await roomsService.listParticipantsSnapshot(lessonId)) {
    const m = /^Ученик (\d+)$/.exec(p.fullName);
    if (m) taken.add(Number(m[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `Ученик ${n}`;
}

export default async function guestsRoutes(app: FastifyInstance) {
  const rateLimited = {
    config: { rateLimit: { max: env.RATE_LIMIT_GUEST_ENTRY_PER_MINUTE, timeWindow: "1 minute" } },
  };

  app.get<{ Params: { token: string } }>("/j/:token", rateLimited, async (request, reply) => {
    const info = await guestsService.getPublicLessonInfo(request.params.token);
    // Ответ зависит от куки браузера — не кешировать.
    reply.header("cache-control", "no-store");
    return reply.send({ ...info, rememberedName: readRememberedName(request.cookies?.[GUEST_NAME_COOKIE]) });
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
        let admitted: { guestId: string; name: string } | null = null;
        session = await guestsService.enterAsGuest(
          request.params.token,
          body.name,
          async (lessonId) => {
            // Вход закрыт, но учитель впустил по запросу — личность из запроса.
            if (body.knockId) {
              admitted = await roomsService.admittedKnock(lessonId, body.knockId);
              if (admitted) return admitted.guestId;
            }
            if (!previousActor || previousActor.lessonId !== lessonId) return null;
            return (await roomsService.isParticipantConnected(lessonId, previousActor.participantId))
              ? null
              : previousActor.participantId;
          },
          // Имя не ввели (2026-10-15: имя необязательно) — впущенному из
          // комнаты ожидания имя из запроса, вернувшемуся гостю его прежнее,
          // новому — «Ученик N».
          async (lessonId, reusedGuestId) => {
            if (admitted && reusedGuestId === admitted.guestId) return admitted.name;
            if (reusedGuestId && previousActor?.participantId === reusedGuestId) return previousActor.displayName;
            return autoStudentName(lessonId);
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
      // Имя, которое ученик ввёл сам, — запомнить для следующих входов
      // (любой урок). Автоматическое «Ученик N» не запоминаем: номер — на один урок.
      if (body.name) {
        reply.setCookie(GUEST_NAME_COOKIE, encodeURIComponent(body.name), {
          httpOnly: true,
          secure: env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: GUEST_NAME_COOKIE_MAX_AGE_S,
        });
      }

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
   * Комната ожидания (2026-10-17): вход закрыт — ученик просит войти. Учитель
   * видит плашку (`GET /lessons/:id/knocks`) и впускает; страница ученика
   * опрашивает статус и, когда впустили, входит `POST /j/:token/enter` с `knockId`.
   */
  app.post<{ Params: { token: string } }>("/j/:token/knock", rateLimited, async (request, reply) => {
    const body = guestKnockRequestSchema.parse(request.body);
    const lesson = await guestsService.resolveLessonForGuestEntry(request.params.token);
    const name = body.name || readRememberedName(request.cookies?.[GUEST_NAME_COOKIE]) || (await autoStudentName(lesson.id));
    if (body.name) {
      reply.setCookie(GUEST_NAME_COOKIE, encodeURIComponent(body.name), {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: GUEST_NAME_COOKIE_MAX_AGE_S,
      });
    }
    const knockId = await roomsService.createKnock(lesson.id, name);
    logEvent("lesson_knock", { lessonId: lesson.id }, "info", request.log);
    const response: GuestKnockResponse = { knockId };
    return reply.status(201).send(response);
  });

  // Страница ожидающего спрашивает раз в ~2 с — у класса за одним роутером
  // это десятки запросов в минуту, поэтому отдельный, более щедрый лимит.
  app.get<{ Params: { token: string; knockId: string } }>(
    "/j/:token/knock/:knockId",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const lesson = await guestsService.resolveLessonForGuestEntry(request.params.token);
      const status = await roomsService.getKnockStatus(lesson.id, request.params.knockId);
      if (!status) throw new AppError(404, "not_found", "Запрос на вход не найден");
      reply.header("cache-control", "no-store");
      const response: GuestKnockStatus = { status };
      return reply.send(response);
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
