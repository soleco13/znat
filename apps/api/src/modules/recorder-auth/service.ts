import { SignJWT, jwtVerify } from "jose";
import { recorderTokenPayloadSchema, type RecorderTokenPayload } from "@school/shared";
import { env } from "../../plugins/env.js";

/**
 * Э10.6 — recorder-токен (шаблон записи `/egress`, см. Custom recording
 * templates в LiveKit Egress). Даёт read-only доступ ровно к тому, что
 * нужно для композитинга кадра записи: WS-сигналам стейджа урока
 * (rooms/ws.ts), доске (canvas/hocuspocus.ts, read-only) и агрегированному
 * виду текущего задания (activities/service.ts#getRecorderView, через
 * plugins/recorder-access.ts). Читать построчно (CLAUDE.md «логика прав
 * доступа и выдачи токенов»).
 *
 * Отдельный модуль, а НЕ часть recordings/ (где токен минтится) — граф
 * такой: recordings/service.ts → rooms/service.ts → canvas/service.ts →
 * canvas/hocuspocus.ts. Если бы verifyRecorderToken жил в
 * recordings/service.ts, импорт его из hocuspocus.ts замкнул бы цикл
 * (dependency-cruiser `no-circular`, §4.1.1 ТЗ). Этот модуль ничего не
 * импортирует из других модулей приложения — безопасен для импорта
 * отовсюду, как guests/service.ts.
 */

const recorderSecret = new TextEncoder().encode(env.JWT_RECORDER_SECRET);

/**
 * Запас над максимальной длительностью урока (§5.2 ТЗ: 40–90 мин) — на
 * случай задержки старта egress или урока, идущего дольше обычного. Не
 * влияет на саму запись: `stopEgress`/закрытие комнаты останавливают файл
 * независимо от жизни этого токена.
 */
const RECORDER_TOKEN_TTL_SEC = 6 * 3600;

/** Минтится ОДИН раз в `recordings/service.ts#startLessonRecording`, до вызова `startRoomCompositeEgress`. */
export async function signRecorderToken(lessonId: string, recordingId: string): Promise<string> {
  const issuedAtSec = Math.floor(Date.now() / 1000);
  const payload: RecorderTokenPayload = { typ: "recorder", lessonId, recordingId };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAtSec)
    .setExpirationTime(issuedAtSec + RECORDER_TOKEN_TTL_SEC)
    .sign(recorderSecret);
}

/**
 * `null`, а не throw — каждый вызывающий (canvas/hocuspocus.ts, rooms/ws.ts,
 * plugins/recorder-access.ts) сам решает, что делать дальше (упасть в
 * другую ветку разбора токена или ответить 401/закрыть сокет). Проверяет
 * только подпись/срок/форму payload — не финальный допуск.
 */
export async function verifyRecorderToken(token: string): Promise<RecorderTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, recorderSecret);
    return recorderTokenPayloadSchema.parse(payload);
  } catch {
    return null;
  }
}
