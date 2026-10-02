import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { FastifyBaseLogger, FastifyServerOptions } from "fastify";
import { env } from "./env.js";
import { serializeRequest } from "./log-redact.js";

/**
 * Единый логгер API. Задача — чтобы по жалобе «у ученика пропала доска/видео
 * на уроке» можно было восстановить цепочку без угадывания: браузер (сессия
 * вкладки) → HTTP-запрос (requestId) → сервис → Postgres, и realtime-цепочку
 * join → токен LiveKit → WS-подключения → переподключения → отключение.
 *
 * Логгер — тот pino, который создаёт сам Fastify (отдельной зависимости нет):
 * JSON-строка, время ISO-8601 UTC, service/env, redact секретов. Контекст
 * запроса (requestId, клиентская сессия, пользователь, урок) лежит в
 * AsyncLocalStorage и подмешивается в КАЖДУЮ строку — и из request.log, и из
 * сервисов через `logger()`.
 */

export interface LogContext {
  requestId?: string;
  /** Идентификатор вкладки браузера (заголовок X-Client-Session) — сквозной ключ клиентских событий и запросов. */
  clientSessionId?: string;
  userId?: string;
  schoolId?: string;
  lessonId?: string;
  /** userId персонала или guestId ученика — он же LiveKit identity и presence-ключ. */
  participantId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Дополняет контекст текущего запроса (после аутентификации и т.п.). Вне запроса — no-op. */
export function setLogContext(patch: Partial<LogContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Идентификатор из заголовка клиента — только если похож на id; иначе (мусор, слишком длинный) не берём. */
export function safeClientId(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ID.test(value) ? value : undefined;
}

/** requestId: присланный браузером X-Request-Id (сквозная корреляция с клиентскими событиями) либо новый UUID. */
export function genRequestId(req: IncomingMessage): string {
  return safeClientId(req.headers["x-request-id"]) ?? randomUUID();
}

/** Email в логах — только как короткий необратимый хэш: видно повторные попытки, адрес не раскрывается. */
export function hashForLog(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Секреты не должны попасть в лог, даже если их случайно передадут целиком
 * (тело запроса, объект ошибки SDK). Пути pino redact — точные: верхний
 * уровень и один уровень вложенности.
 */
const SECRET_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "recorderToken",
  "joinToken",
  "authorization",
  "cookie",
  "set-cookie",
  "secret",
];
export const REDACT_PATHS = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

const SERVICE_VERSION = process.env.APP_VERSION ?? "dev";

/**
 * Поток записи: stdout (docker logs) и, если задан LOG_FILE, ещё и файл на
 * томе — логи контейнера пропадают при каждом пересоздании (деплое), а
 * разбирать урок часто приходится на следующий день. Ротация — logrotate
 * хоста (copytruncate), файл открыт на дозапись.
 */
function logStream(): { write(chunk: string): void } | undefined {
  if (!env.LOG_FILE) return undefined;
  const file = createWriteStream(env.LOG_FILE, { flags: "a" });
  let fileBroken = false;
  file.on("error", (err) => {
    if (!fileBroken) process.stderr.write(`log file unavailable: ${err.message}\n`);
    fileBroken = true;
  });
  return {
    write(chunk: string) {
      process.stdout.write(chunk);
      if (!fileBroken) file.write(chunk);
    },
  };
}

export function loggerOptions(): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
    base: { service: "api", env: env.NODE_ENV, version: SERVICE_VERSION },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    // Уровень словом ("warn"), а не числом pino (40): так его ждут Loki/Grafana и люди.
    formatters: { level: (label: string) => ({ level: label }) },
    // requestId уже есть в привязках request.log — не дублируем его ключом из контекста.
    mixin(_merge: object, _level: number, instance?: { bindings?: () => Record<string, unknown> }) {
      const store = storage.getStore();
      if (!store) return {};
      const bound = instance?.bindings?.();
      if (bound && "requestId" in bound) {
        const { requestId: _omit, ...rest } = store;
        return rest;
      }
      return { ...store };
    },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: { req: serializeRequest },
    stream: logStream(),
  } as NonNullable<FastifyServerOptions["logger"]>;
}

// ─── Логгер для сервисов (вне request.log) ──────────────────────────────────

let root: FastifyBaseLogger | null = null;

/** Регистрирует логгер Fastify как общий — вызывается один раз при сборке сервера. */
export function setRootLogger(logger: FastifyBaseLogger): void {
  root = logger;
}

const noop = () => undefined;
const silentLogger: FastifyBaseLogger = {
  level: "silent",
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  debug: noop,
  trace: noop,
  silent: noop,
  child: () => silentLogger,
} as unknown as FastifyBaseLogger;

/**
 * Логгер для кода вне обработчика запроса (сервисы, фоновые задачи, WS).
 * До сборки сервера (тесты, скрипты) молчит — сервисы не зависят от Fastify.
 */
export function logger(): FastifyBaseLogger {
  return root ?? silentLogger;
}

/**
 * Значимые события для разбора урока. Имя события — в поле `event` (по нему
 * фильтруется лог), сообщение строки совпадает с ним.
 */
export type LogEventName =
  | "auth_success"
  | "auth_failure"
  | "lesson_join_started"
  | "lesson_join_success"
  | "lesson_join_failed"
  | "livekit_token_created"
  | "livekit_participant_joined"
  | "livekit_participant_left"
  | "livekit_room_finished"
  | "websocket_connected"
  | "websocket_disconnected"
  | "websocket_rejected"
  | "websocket_reconnect"
  | "whiteboard_sync_started"
  | "whiteboard_sync_failed"
  | "whiteboard_store_failed"
  | "whiteboard_update_rejected"
  | "db_query_slow"
  | "db_query_failed"
  | "db_pool_error"
  | "request_rejected"
  | "request_failed"
  | "http_request"
  | "client_event"
  | "background_task_failed"
  | "process_unhandled_rejection"
  | "process_uncaught_exception";

type Level = "debug" | "info" | "warn" | "error" | "fatal";

export function logEvent(
  event: LogEventName,
  fields: Record<string, unknown> = {},
  level: Level = "info",
  log: FastifyBaseLogger = logger(),
): void {
  log[level]({ event, ...fields }, event);
}

/** Сбой фоновой задачи (sweep, ретеншн, очередь) — со стеком и именем задачи. */
export function logTaskFailure(task: string, err: unknown, fields: Record<string, unknown> = {}): void {
  logEvent("background_task_failed", { task, err, ...fields }, "error");
}
