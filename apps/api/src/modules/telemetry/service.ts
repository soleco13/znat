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
  return event.endsWith("_failed") || event === "client_error" || event === "livekit_reconnecting" ? "warn" : "info";
}

/**
 * Пишет клиентские события в общий лог. Контекст (сессия вкладки, участник,
 * урок) уже в строке из AsyncLocalStorage; `clientTs` — время в браузере
 * (расхождение с `time` строки = задержка отправки или неверные часы).
 */
export function logClientEvents(events: ClientEvent[], log: FastifyBaseLogger): void {
  for (const e of events) {
    logEvent(
      "client_event",
      { source: "client", clientEvent: e.event, clientTs: e.ts, ...sanitizeClientFields(e.fields) },
      levelFor(e.event),
      log,
    );
  }
}
