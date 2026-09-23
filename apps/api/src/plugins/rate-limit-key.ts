import type { FastifyRequest } from "fastify";
import { verifyAccessToken } from "../modules/auth/service.js";
import { GUEST_COOKIE_NAME, verifyGuestToken } from "../modules/guests/service.js";

/** Запросов в минуту на одного вошедшего человека — с запасом на опросы и автосохранение во время задания. */
export const IDENTITY_RATE_LIMIT_PER_MINUTE = 300;
/** Анонимные запросы (лендинг, логин) — по IP. */
export const ANONYMOUS_RATE_LIMIT_PER_MINUTE = 100;

/**
 * Ключ лимита — личность, а не IP: класс за школьным роутером, семья или
 * мобильные абоненты за CGNAT выходят с одного адреса, и лимит «на IP»
 * выбивал учеников с 429 уже на входе в урок. Подпись проверяется: иначе
 * поддельный токен давал бы новый счётчик на каждый запрос.
 */
export async function rateLimitKey(request: FastifyRequest): Promise<string> {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      return `staff:${(await verifyAccessToken(header.slice("Bearer ".length))).sub}`;
    } catch {
      // просроченный или чужой токен — считаем как анонимный запрос
    }
  }
  const guestCookie = request.cookies?.[GUEST_COOKIE_NAME];
  if (guestCookie) {
    try {
      return `guest:${(await verifyGuestToken(guestCookie)).guestId}`;
    } catch {
      // протухшая гостевая кука — тоже анонимно
    }
  }
  return `ip:${request.ip}`;
}

export function rateLimitMax(_request: FastifyRequest, key: string): number {
  return key.startsWith("ip:") ? ANONYMOUS_RATE_LIMIT_PER_MINUTE : IDENTITY_RATE_LIMIT_PER_MINUTE;
}
