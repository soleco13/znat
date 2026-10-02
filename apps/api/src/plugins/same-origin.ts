import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "./env.js";
import { AppError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Куки (refresh-токен, гостевая сессия) защищала от CSRF только
 * `SameSite=Lax`. Но «сайт» для SameSite — это хост без порта: любой
 * другой сервис на том же IP/домене (LiveKit, мониторинг) считается своим,
 * и его страница могла бы слать запросы с нашими куками. Изменяющий запрос с
 * куками принимаем только со своего origin. Без заголовка `Origin` (curl,
 * вебхук LiveKit, egress) — пропускаем: браузер на чужой странице его ставит.
 */
export function isAllowedOrigin(origin: string, requestHost: string): boolean {
  if (origin === env.PUBLIC_ORIGIN) return true;
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: Pick<FastifyRequest, "method" | "headers" | "host">): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (!request.headers.cookie) return;
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (!isAllowedOrigin(origin, request.host)) {
    throw new AppError(403, "cross_origin_request", "Запрос с чужого сайта отклонён");
  }
}

export default fp(async function sameOriginPlugin(app: FastifyInstance) {
  // В разработке фронт ходит через прокси Vite с другого порта.
  if (env.NODE_ENV !== "production") return;
  app.addHook("onRequest", async (request) => {
    assertSameOrigin(request);
  });
});
