import { z } from "zod";
import { lessonSettingsSchema } from "./lessons.js";
import { personalDataConsentSchema } from "./auth.js";

/**
 * Э12 — гостевой вход учеников (§1.6 план-ТЗ). Ученик не имеет аккаунта:
 * открывает прямую ссылку урока `/j/:token`, вводит произвольное имя и
 * получает httpOnly-cookie с гостевым JWT. Личность на уроке = введённое
 * имя + стабильный `guestId` (пока жива кука — переподключение не теряет
 * ответы на задания).
 *
 * Схемы здесь — контракт для фронта (экран «Представьтесь») и бэка
 * (`GET /j/:token`, `POST /j/:token/enter`, проверка гостевого JWT). Ключей
 * ответов и никакой бизнес-логики — только формы запросов/ответов.
 */

/**
 * Полезная нагрузка гостевого JWT (§1.6 план-ТЗ: `{ typ:"guest", lessonId,
 * guestId, name }`, TTL ~6 ч, без refresh). `iat`/`exp` навешивает
 * библиотека подписи, здесь только прикладные поля. `guestId` стабилен в
 * пределах жизни куки — ключ привязки ответов (`responses.participant_id`).
 */
export const guestTokenPayloadSchema = z.object({
  typ: z.literal("guest"),
  lessonId: z.string().uuid(),
  guestId: z.string().uuid(),
  name: z.string().min(1).max(80),
  /**
   * sha256(hex) значения `lessons.join_token` на момент входа. Проверяется
   * при каждом гостевом запросе к уроку: admin перевыпустил ссылку
   * (`POST /lessons/:id/link/rotate`) → хеш перестал совпадать → сессия
   * недействительна, нужен перезаход по новой ссылке (§1.6 план-ТЗ:
   * «старый мгновенно недействителен»).
   */
  lt: z.string().length(64),
});
export type GuestTokenPayload = z.infer<typeof guestTokenPayloadSchema>;

/**
 * Ответ `GET /j/:token` (§1.4 план-ТЗ) — публичный, rate-limited. Ровно
 * столько, сколько нужно экрану входа: имя урока и настройки (по ним фронт
 * решает, спрашивать ли разрешение на камеру/микрофон). Ни `id` урока, ни
 * учителя, ни журнала — до входа гость ничего этого не видит.
 */
export const guestLessonInfoSchema = z.object({
  lessonTitle: z.string(),
  settings: lessonSettingsSchema,
  /**
   * Имя, под которым ученик входил раньше с этого браузера (в любой урок) —
   * подставляется в поле, чтобы не вводить заново (2026-10-15). Из httpOnly-
   * куки `guest_name`; `null` — не входил или вводил пустое.
   */
  rememberedName: z.string().nullable().optional(),
});
export type GuestLessonInfo = z.infer<typeof guestLessonInfoSchema>;

/**
 * Тело `POST /j/:token/enter` — только имя. «Свободный вход»: любое имя, без
 * выбора из списка (решение №3, §2 план-ТЗ). Имя необязательно (решение
 * владельца 2026-10-15): пустое — сервер подпишет «Ученик N».
 */
export const guestEnterRequestSchema = z.object({
  name: z.string().trim().max(80).default(""),
  personalDataConsent: personalDataConsentSchema,
  /** Вход закрыт, но учитель впустил по запросу (`POST /j/:token/knock`). */
  knockId: z.string().uuid().optional(),
});
export type GuestEnterRequest = z.infer<typeof guestEnterRequestSchema>;

/**
 * Ответ `POST /j/:token/enter`. Сам JWT уходит в httpOnly-cookie (клиент
 * его не читает); в теле — только то, что нужно фронту показать и по чему
 * маршрутизировать: id урока для перехода в комнату и гостевая личность.
 */
export const guestEnterResponseSchema = z.object({
  lessonId: z.string().uuid(),
  guestId: z.string().uuid(),
  name: z.string(),
  /** До какого момента жива сессия (ISO). Истекла → перезаход по ссылке. */
  expiresAt: z.string(),
});
export type GuestEnterResponse = z.infer<typeof guestEnterResponseSchema>;

/**
 * Ответ `GET /guest/session` (Э12.6) — восстановление гостевой личности из
 * httpOnly-куки при перезагрузке страницы урока (аналог `POST /auth/refresh`
 * для персонала, но без выдачи нового токена — кука не возобновляется).
 * Добавляет `lessonTitle`, чтобы экран урока не делал отдельный запрос:
 * форму `LessonSummary` гость не видит никогда (§1.4 план-ТЗ).
 */
export const guestSessionSchema = guestEnterResponseSchema.extend({
  lessonTitle: z.string(),
});
export type GuestSession = z.infer<typeof guestSessionSchema>;

/**
 * Э12.6 — маркер в поле `token` Yjs-подключения к доске (`/collab`) для
 * гостя-ученика. `HocuspocusProvider` не отправляет auth-сообщение при
 * пустом токене, а настоящий гостевой JWT лежит в httpOnly-куке и клиенту
 * недоступен; сервер по этому маркеру берёт личность из куки
 * (`canvas/hocuspocus.ts`). Staff-токен — всегда JWT, не пересекается.
 */
export const GUEST_CANVAS_TOKEN_MARKER = "guest";

/** `POST /j/:token/knock` — попросить войти, когда вход закрыт (комната ожидания, 2026-10-17). */
export const guestKnockRequestSchema = z.object({
  name: z.string().trim().max(80).default(""),
  personalDataConsent: personalDataConsentSchema,
});
export type GuestKnockRequest = z.infer<typeof guestKnockRequestSchema>;

export const guestKnockResponseSchema = z.object({ knockId: z.string().uuid() });
export type GuestKnockResponse = z.infer<typeof guestKnockResponseSchema>;

/** `GET /j/:token/knock/:knockId` — заодно отметка «я ещё жду» (страница открыта). */
export const guestKnockStatusSchema = z.object({ status: z.enum(["pending", "admitted", "denied"]) });
export type GuestKnockStatus = z.infer<typeof guestKnockStatusSchema>;
