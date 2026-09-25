import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import {
  guestTokenPayloadSchema,
  type GuestLessonInfo,
  type GuestSession,
  type GuestTokenPayload,
  type Role,
} from "@school/shared";
import { redis } from "../../db/redis.js";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as lessonsService from "../lessons/service.js";
import * as schoolSettingsService from "../school-settings/service.js";

/**
 * Э12.4 — гостевой вход учеников (§1.6 план-ТЗ). Читать построчно
 * (CLAUDE.md «не делегировать вслепую» — логика прав/токенов): гостевой JWT
 * даёт доступ к живому уроку (аудио, доска, задания), тихая ошибка здесь
 * пустит на урок кого не надо либо не пустит того, кому можно.
 *
 * Инварианты гостевой сессии:
 *  - подписана отдельным секретом `JWT_GUEST_SECRET` (не персональным);
 *  - TTL ~6 ч (`GUEST_SESSION_TTL_HOURS`), без refresh — истекла → перезаход
 *    по ссылке;
 *  - несёт `lessonId` (сессия только одного урока) и `lt` = sha256 текущей
 *    ссылки урока на момент входа: admin перевыпустил ссылку → хеш не
 *    совпал → сессия мгновенно недействительна;
 *  - `guestId` стабилен пока жива кука — ключ привязки ответов на задания
 *    (`responses.participant_id`, Э12.5) и переподключения к presence.
 */

export const GUEST_COOKIE_NAME = "guest_session";

const guestSecret = new TextEncoder().encode(env.JWT_GUEST_SECRET);

/** Нормализованный «кто действует на уроке» — общий тип для rooms/canvas/плагина доступа (Э12.4). */
export type LessonActor =
  | {
      kind: "staff";
      /** `users.id` — он же presence-ключ и LiveKit-identity персонала. */
      participantId: string;
      schoolId: string;
      role: Role;
      lessonId: string;
      displayName: string;
    }
  | {
      kind: "guest";
      /** `guestId` из гостевого JWT — presence-ключ и LiveKit-identity ученика. */
      participantId: string;
      schoolId: string;
      role: null;
      lessonId: string;
      displayName: string;
    };

/** sha256(hex) значения ссылки урока — кладётся в `lt` гостевого JWT и сверяется при каждом гостевом запросе. */
export function hashJoinToken(joinToken: string): string {
  return createHash("sha256").update(joinToken).digest("hex");
}

/** Публичная инфо-карточка урока по ссылке (`GET /j/:token`) — до входа гость видит только имя и настройки. */
export async function getPublicLessonInfo(joinToken: string): Promise<GuestLessonInfo> {
  const lesson = await lessonsService.resolveJoinToken(joinToken);
  return {
    lessonTitle: lesson.title,
    settings: lessonsService.parseLessonSettings(lesson.settings),
  };
}

export interface GuestSessionIssued {
  token: string;
  payload: GuestTokenPayload;
  expiresAt: Date;
  ttlSeconds: number;
}

/**
 * `POST /j/:token/enter` — минт новой гостевой сессии по действующей ссылке
 * и произвольному имени. Каждый вход = новый `guestId` (кука не
 * возобновляется, §1.6 план-ТЗ), поэтому переподключение работает только
 * пока жива та же кука.
 */
export async function enterAsGuest(joinToken: string, name: string): Promise<GuestSessionIssued> {
  const lesson = await lessonsService.resolveJoinToken(joinToken);
  // Параметры школы (§10.10 ТЗ, запрос 2026-09-14): admin может закрыть вход
  // без аккаунта целиком. Карточку урока (`getPublicLessonInfo`) не гейтим —
  // без активного входа она безвредна, а гейт здесь достаточен, чтобы
  // сессию реально нельзя было получить.
  const settings = await schoolSettingsService.getSchoolSettings(lesson.schoolId);
  if (!settings.guestAccessEnabled) {
    throw new AppError(403, "guest_access_disabled", "Вход без аккаунта отключён администратором школы");
  }
  const ttlSeconds = env.GUEST_SESSION_TTL_HOURS * 3600;
  const issuedAtSec = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((issuedAtSec + ttlSeconds) * 1000);

  const payload: GuestTokenPayload = {
    typ: "guest",
    lessonId: lesson.id,
    guestId: randomUUID(),
    name,
    lt: hashJoinToken(lesson.joinToken),
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAtSec)
    .setExpirationTime(issuedAtSec + ttlSeconds)
    .sign(guestSecret);

  return { token, payload, expiresAt, ttlSeconds };
}

function revokedKey(guestId: string): string {
  return `guest:${guestId}:revoked`;
}

/**
 * Учитель удалил ученика из урока — его гостевая сессия больше не пускает
 * ни в урок, ни на доску, ни в задания. JWT не отозвать, поэтому отметка
 * живёт в Redis ровно столько, сколько мог бы прожить сам токен. Вернуться
 * по ссылке с новым именем ученик может — от этого защищает «закрыть вход».
 */
export async function revokeGuestSession(guestId: string): Promise<void> {
  await redis.set(revokedKey(guestId), "1", "EX", env.GUEST_SESSION_TTL_HOURS * 3600);
}

export async function isGuestSessionRevoked(guestId: string): Promise<boolean> {
  return (await redis.exists(revokedKey(guestId))) === 1;
}

export const REMOVED_FROM_LESSON_MESSAGE = "Учитель удалил вас из урока";

/** Только подпись + срок (без похода в БД) — для мест, где актуальность ссылки проверять не нужно (WS-переподключение). */
export async function verifyGuestToken(token: string): Promise<GuestTokenPayload> {
  const { payload } = await jwtVerify(token, guestSecret);
  return guestTokenPayloadSchema.parse(payload);
}

/**
 * Полная проверка гостевой сессии для доступа к уроку: подпись/срок +
 * актуальность ссылки урока (ротация admin → мгновенно недействительна) +
 * что урок вообще существует. Возвращает нормализованного `LessonActor`.
 */
export async function resolveGuestSession(token: string): Promise<Extract<LessonActor, { kind: "guest" }>> {
  let payload: GuestTokenPayload;
  try {
    payload = await verifyGuestToken(token);
  } catch {
    throw new AppError(401, "invalid_guest_session", "Гостевая сессия недействительна или истекла");
  }

  const lesson = await lessonsService.getLessonForGuestSession(payload.lessonId);
  if (!lesson) {
    throw new AppError(401, "invalid_guest_session", "Урок недоступен");
  }
  // Ссылку проверяем раньше отзыва: при перевыпуске ссылки гостей тоже
  // отзывают (ради LiveKit), и ученик должен увидеть «ссылка изменилась»,
  // а не «вас удалили».
  if (hashJoinToken(lesson.joinToken) !== payload.lt) {
    throw new AppError(
      401,
      "guest_link_rotated",
      "Ссылка на урок была перевыпущена — войдите заново по новой ссылке",
    );
  }
  if (await isGuestSessionRevoked(payload.guestId)) {
    throw new AppError(403, "removed_from_lesson", REMOVED_FROM_LESSON_MESSAGE);
  }

  return {
    kind: "guest",
    participantId: payload.guestId,
    schoolId: lesson.schoolId,
    role: null,
    lessonId: payload.lessonId,
    displayName: payload.name,
  };
}

/**
 * `GET /guest/session` (Э12.6) — восстановление гостевой личности из куки
 * после перезагрузки страницы. Полная проверка (`resolveGuestSession`:
 * подпись + срок + актуальность ссылки + существование урока) плюс `exp`
 * из токена и имя урока для экрана. Нового токена не выдаёт — истечёт,
 * значит нужен перезаход по ссылке (§1.6 план-ТЗ, без refresh).
 */
export async function getGuestSessionInfo(token: string): Promise<GuestSession> {
  const actor = await resolveGuestSession(token);
  const { payload } = await jwtVerify(token, guestSecret);
  const lesson = await lessonsService.getLessonForGuestSession(actor.lessonId);
  return {
    lessonId: actor.lessonId,
    guestId: actor.participantId,
    name: actor.displayName,
    expiresAt: new Date((payload.exp as number) * 1000).toISOString(),
    lessonTitle: lesson?.title ?? "Урок",
  };
}
