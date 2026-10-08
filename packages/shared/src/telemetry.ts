import { z } from "zod";

/**
 * Клиентские события урока, которые сервер иначе не видит: подключение к
 * LiveKit, переподключения WebSocket, синхронизация доски, загрузка PDF.
 * Браузер шлёт их пачками в `POST /telemetry`, сервер пишет в общий лог
 * рядом со своими событиями — по сессии вкладки (`X-Client-Session`) и
 * participantId вся цепочка урока одного человека собирается одним фильтром.
 */
export const CLIENT_EVENT_NAMES = [
  "livekit_connection_started",
  "livekit_connected",
  "livekit_connection_failed",
  "livekit_reconnecting",
  "livekit_reconnected",
  "livekit_disconnected",
  /** Подключение к LiveKit висит дольше 15 с (ICE/DTLS не сошлись) — до ошибки или успеха. */
  "livekit_connect_slow",
  /** Выбранная пара ICE: host/srflx/relay, udp/tcp/tls — при подключении и при смене. */
  "media_path",
  /** Safari: медиа не на маршруте по умолчанию (Wi-Fi включился) — перезапуск пути и итог. */
  "media_route_switch",
  /** Раз в минуту: отправка своей камеры (fps/высота/ограничение) и заморозки приёма. */
  "media_quality",
  "websocket_disconnected",
  "websocket_reconnect",
  "whiteboard_sync_started",
  "whiteboard_synced",
  "whiteboard_sync_failed",
  "whiteboard_disconnected",
  "pdf_load_started",
  "pdf_loaded",
  "pdf_load_failed",
  "media_device_failed",
  "client_error",
] as const;
export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

/** Только плоские примитивы — ни объектов, ни длинных строк в лог из браузера. */
export const clientEventFieldValueSchema = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
export type ClientEventFieldValue = z.infer<typeof clientEventFieldValueSchema>;

export const clientEventSchema = z.object({
  event: z.enum(CLIENT_EVENT_NAMES),
  /** Время события в браузере (ISO) — сервер пишет ещё и своё время приёма. */
  ts: z.string().datetime(),
  fields: z
    .record(z.string().max(40), clientEventFieldValueSchema)
    .refine((o) => Object.keys(o).length <= 20, "too many fields")
    .optional(),
});
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const clientEventBatchSchema = z.object({
  /** Сессия вкладки — дублирует X-Client-Session для navigator.sendBeacon, который не умеет заголовки. */
  clientSessionId: z.string().max(64).optional(),
  events: z.array(clientEventSchema).min(1).max(50),
});
export type ClientEventBatch = z.infer<typeof clientEventBatchSchema>;
