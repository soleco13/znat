import type { FastifyRequest } from "fastify";
import { verifyAccessToken } from "../modules/auth/service.js";
import { GUEST_COOKIE_NAME, verifyGuestToken } from "../modules/guests/service.js";
import { verifyRecorderToken } from "../modules/recorder-auth/service.js";
import { env } from "./env.js";

/** Запросов в минуту на одного вошедшего человека — с запасом на опросы и автосохранение во время задания. */
export const IDENTITY_RATE_LIMIT_PER_MINUTE = 300;
/** Анонимные запросы (лендинг, логин) — по IP. */
export const ANONYMOUS_RATE_LIMIT_PER_MINUTE = env.RATE_LIMIT_ANONYMOUS_PER_MINUTE;

/**
 * Ключ лимита — личность, а не IP: класс за школьным роутером, семья или
 * мобильные абоненты за CGNAT выходят с одного адреса, и лимит «на IP»
 * выбивал учеников с 429 уже на входе в урок. Подпись проверяется: иначе
 * поддельный токен давал бы новый счётчик на каждый запрос.
 */
export async function rateLimitKey(request: FastifyRequest): Promise<string> {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    try {
      return `staff:${(await verifyAccessToken(token)).sub}`;
    } catch {
      // просроченный или чужой токен — считаем как анонимный запрос
    }
    // Страница записи урока (egress, REST recorder-view) — свой токен и свой
    // счётчик на урок. Раньше она шла «по IP»: headless Chrome записи ходит в
    // app напрямую (127.0.0.1:3000), и все записи вместе с вебхуками LiveKit
    // делили один счётчик шлюза Docker (172.19.0.1) — 429 уже на 1–2 уроках
    // по 30 человек (нагрузочный тест 2026-10-11).
    const recorder = await verifyRecorderToken(token);
    if (recorder) return `recorder:${recorder.lessonId}`;
  }
  // WS урока для записи: `/ws?recorderToken=…` (заголовков у браузерного WS нет).
  const recorderQuery = (request.query as { recorderToken?: unknown } | undefined)?.recorderToken;
  if (typeof recorderQuery === "string" && recorderQuery) {
    const recorder = await verifyRecorderToken(recorderQuery);
    if (recorder) return `recorder:${recorder.lessonId}`;
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

/**
 * Статика приложения (файлы сборки, страницы SPA, шрифты, звуки) — вне
 * лимита. Все такие запросы идут без токена, то есть по IP, а после разбиения
 * фронта на куски одно открытие урока — 50–70 файлов: учитель и ученик за
 * одним школьным IP за пару перезагрузок упирались в лимит анонимных
 * запросов (429), вход сбрасывался, соединения урока не поднимались
 * (2026-09-26). Лимит остаётся на API, файлах, WebSocket урока и доски.
 */
const LIMITED_PREFIXES = ["/api/", "/files/", "/ws", "/collab", "/webhooks/", "/metrics"];

export function isStaticAppRequest(request: Pick<FastifyRequest, "method" | "url">): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return !LIMITED_PREFIXES.some((prefix) => request.url.startsWith(prefix));
}
