import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AccessTokenPayload } from "@school/shared";
import { verifyAccessToken } from "../modules/auth/service.js";
import { GUEST_COOKIE_NAME, resolveGuestSession } from "../modules/guests/service.js";
import * as lessonsService from "../modules/lessons/service.js";
import * as roomsService from "../modules/rooms/service.js";
import { AppError } from "./errors.js";
import { setLogContext } from "./logger.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AccessTokenPayload;
  }
}

/**
 * Эндпоинты учителя, которые доступны гостю с правами учителя (их выдаёт
 * только администратор, `rooms/service.ts#setCohost`). Читать построчно:
 * это гейт доступа. Список закрытый — всё, чего тут нет (другие уроки,
 * журнал проверки, аккаунт, школа), гостю недоступно.
 *  - пути `/lessons/:id/...` — только урок гостевой сессии (сверка ниже);
 *  - `/activities/:id/...` и `/jobs/:jobId` — урок сверяют сервисы
 *    `activities`/`decks` по `lessonScope`;
 *  - `/materials` — только чтение библиотеки учителя урока: выдать задание.
 */
const DELEGATED_ROUTES = new Set([
  "PATCH /lessons/:id/participants/:userId/permissions",
  "POST /lessons/:id/participants/:userId/mute",
  "POST /lessons/:id/participants/:userId/remove",
  "PATCH /lessons/:id/participants/:userId/pin",
  "PATCH /lessons/:id/entry",
  "GET /lessons/:id/knocks",
  "POST /lessons/:id/knocks/:knockId/admit",
  "POST /lessons/:id/knocks/:knockId/deny",
  "POST /lessons/:id/knocks/admit-all",
  "PATCH /lessons/:id/chat-lock",
  "POST /lessons/:id/hands/lower",
  "POST /lessons/:id/mute-all",
  "PATCH /lessons/:id/mode",
  "PATCH /lessons/:id/stage",
  "POST /lessons/:id/draw-all",
  "DELETE /lessons/:id/chat/:messageId",
  "GET /lessons/:id/recordings",
  "POST /lessons/:id/recordings",
  "POST /lessons/:id/recordings/:recordingId/stop",
  "POST /lessons/:id/uploads",
  "GET /lessons/:id/decks",
  "DELETE /lessons/:id/decks/:deckId",
  "GET /jobs/:jobId",
  "POST /lessons/:id/canvas-images",
  "GET /lessons/:id",
  "GET /lessons/:id/materials",
  "POST /lessons/:id/materials",
  "DELETE /lessons/:id/materials/:materialId",
  "POST /lessons/:id/activities",
  "GET /activities/:id/progress",
  "GET /activities/:id/students/:participantId",
  "GET /activities/:id/participants/:participantId/annotations",
  "PUT /activities/:id/participants/:participantId/annotations",
  "GET /activities/:id/analytics",
  "POST /activities/:id/review",
  "GET /activities/:id/review/questions/:questionId/responses",
  "POST /activities/:id/review/board",
  "GET /materials",
  "GET /materials/sources",
  "GET /materials/:id",
]);

/**
 * Гость с правами учителя → `request.user` учителя урока с `lessonScope`.
 * `null` — запрос не подходит (нет куки, маршрут не из списка): обычный 401.
 */
async function resolveDelegatedTeacher(request: FastifyRequest): Promise<AccessTokenPayload | null> {
  const cookie = request.cookies?.[GUEST_COOKIE_NAME];
  if (!cookie) return null;
  // Маршруты зарегистрированы под префиксом `/api/v1` — сравниваем без него.
  const url = (request.routeOptions.url ?? "").replace(/^\/api\/v1(?=\/)/, "");
  const route = `${request.method} ${url}`;
  if (!DELEGATED_ROUTES.has(route)) return null;

  const guest = await resolveGuestSession(cookie);
  if (route.includes(" /lessons/:id")) {
    const lessonId = (request.params as { id?: string }).id;
    if (lessonId !== guest.lessonId) {
      throw new AppError(403, "guest_wrong_lesson", "Гостевая сессия относится к другому уроку");
    }
  }
  await roomsService.assertGuestNotLockedOut(guest.lessonId, guest.participantId);
  if (!(await roomsService.isLessonCohost(guest.lessonId, guest.participantId))) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
  const lesson = await lessonsService.getLesson(guest.schoolId, guest.lessonId);
  setLogContext({ participantId: guest.participantId, schoolId: guest.schoolId, lessonId: guest.lessonId });
  return { sub: lesson.teacherId, schoolId: guest.schoolId, role: "teacher", lessonScope: guest.lessonId };
}

export default fp(async function authenticatePlugin(app: FastifyInstance) {
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      const delegated = await resolveDelegatedTeacher(request);
      if (delegated) {
        request.user = delegated;
        return;
      }
      throw new AppError(401, "missing_token", "Отсутствует access-токен");
    }
    const token = header.slice("Bearer ".length);
    try {
      request.user = await verifyAccessToken(token);
    } catch {
      throw new AppError(401, "invalid_token", "Недействительный или просроченный access-токен");
    }
    // `lessonScope` выставляет только ветка гостя выше — из JWT не принимаем.
    if (request.user.lessonScope) {
      throw new AppError(401, "invalid_token", "Недействительный или просроченный access-токен");
    }
    setLogContext({ userId: request.user.sub, schoolId: request.user.schoolId });
  });
});
