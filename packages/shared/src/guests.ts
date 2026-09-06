import { z } from "zod";
import { lessonSettingsSchema } from "./lessons.js";

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
});
export type GuestLessonInfo = z.infer<typeof guestLessonInfoSchema>;

/** Тело `POST /j/:token/enter` — только имя. «Свободный вход»: любое имя, без выбора из списка (решение №3, §2 план-ТЗ). */
export const guestEnterRequestSchema = z.object({
  name: z.string().trim().min(1, "Введите имя").max(80),
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
