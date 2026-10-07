import type { ClientEvent, ClientEventFieldValue } from "@school/shared";
import type { FastifyBaseLogger } from "fastify";
import { logEvent } from "../../plugins/logger.js";

/** Ключи, похожие на секреты или персональные данные, из браузера в лог не пишем. */
const UNSAFE_FIELD_KEY = /token|password|secret|cookie|authorization|email|phone/i;

export function sanitizeClientFields(
  fields: Record<string, ClientEventFieldValue> | undefined,
): Record<string, ClientEventFieldValue> {
  const safe: Record<string, ClientEventFieldValue> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!UNSAFE_FIELD_KEY.test(key)) safe[key] = value;
  }
  return safe;
}

function levelFor(event: ClientEvent["event"]): "info" | "warn" {
  return event.endsWith("_failed") ||
    event === "client_error" ||
    event === "livekit_reconnecting" ||
    event === "livekit_connect_slow"
    ? "warn"
    : "info";
}

/**
 * G-08: потолок клиентских событий в лог на процесс. Телеметрию шлют и без
 * сессии (сбой входа), поэтому лимит запросов — по IP, и распределённый
 * источник обходил его, превращая анонимный эндпоинт в запись на диск.
 * Обычный класс: клиент сам режет до 60 событий в минуту (shared/telemetry),
 * 50 учеников — не больше 3000; потолок вдвое выше. Сверх — события не
 * пишутся, раз в минуту одна строка со счётчиком.
 */
export const CLIENT_EVENTS_PER_MINUTE = 6000;
const BUDGET_WINDOW_MS = 60_000;
let budgetWindowStart = 0;
let budgetUsed = 0;
let budgetDropped = 0;

/** Можно ли записать ещё одно клиентское событие (в том числе смену связи из `/ping`). */
export function admitClientEvent(now = Date.now()): boolean {
  if (now - budgetWindowStart >= BUDGET_WINDOW_MS) {
    if (budgetDropped > 0) {
      logEvent("client_events_dropped", { dropped: budgetDropped, limitPerMinute: CLIENT_EVENTS_PER_MINUTE }, "warn");
    }
    budgetWindowStart = now;
    budgetUsed = 0;
    budgetDropped = 0;
  }
  if (budgetUsed >= CLIENT_EVENTS_PER_MINUTE) {
    budgetDropped += 1;
    return false;
  }
  budgetUsed += 1;
  return true;
}

/** Для тестов. */
export function resetClientEventBudget(): void {
  budgetWindowStart = 0;
  budgetUsed = 0;
  budgetDropped = 0;
}

/**
 * Пишет клиентские события в общий лог. Контекст (сессия вкладки, участник,
 * урок) уже в строке из AsyncLocalStorage; `clientTs` — время в браузере
 * (расхождение с `time` строки = задержка отправки или неверные часы).
 */
export function logClientEvents(events: ClientEvent[], log: FastifyBaseLogger, now = Date.now()): void {
  for (const e of events) {
    if (!admitClientEvent(now)) continue;
    logEvent(
      "client_event",
      { source: "client", clientEvent: e.event, clientTs: e.ts, ...sanitizeClientFields(e.fields) },
      levelFor(e.event),
      log,
    );
  }
}
