import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema.js";
import { env } from "../plugins/env.js";
import { currentLogContext, logEvent, runWithLogContext, type LogContext } from "../plugins/logger.js";

/**
 * Без таймаутов одна подвисшая транзакция или короткий сбой БД держали
 * запросы урока бесконечно — вход, чат, автосохранение просто «висели».
 * Теперь запрос падает с ошибкой, соединение возвращается в пул. Миграции
 * ходят через свой пул без этих ограничений (`migrate.ts`).
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 15_000,
});
export const db = drizzle(pool, { schema });

// Простаивающее соединение может получить ошибку (рестарт Postgres, обрыв
// сети). Без слушателя 'error' пул бросал её как необработанное событие и
// ронял весь процесс — вместе с идущими уроками.
pool.on("error", (err) => {
  logEvent("db_pool_error", { err }, "error");
});

/** Текст запроса без параметров (значения в лог не попадают), обрезанный. */
function sqlText(arg: unknown): string | null {
  const text = typeof arg === "string" ? arg : (arg as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text.replace(/\s+/g, " ").slice(0, 300) : null;
}

function report(started: number, arg: unknown, err: unknown, context: LogContext | undefined): void {
  if (context) {
    runWithLogContext(context, () => report(started, arg, err, undefined));
    return;
  }
  const durationMs = Math.round(performance.now() - started);
  if (err) {
    // Нарушение ограничения (23xxx) и конфликт сериализации — ожидаемые,
    // их разбирает код; остальное — сбой.
    const code = (err as { code?: string }).code;
    const expected = typeof code === "string" && (code.startsWith("23") || code === "40001");
    logEvent("db_query_failed", { durationMs, sql: sqlText(arg), pgCode: code ?? null, err }, expected ? "warn" : "error");
  } else if (durationMs >= env.DB_SLOW_QUERY_MS) {
    logEvent("db_query_slow", { durationMs, sql: sqlText(arg) }, "warn");
  }
}

/**
 * Длительность и ошибки каждого запроса — с контекстом текущего HTTP-запроса
 * (requestId, урок, пользователь из AsyncLocalStorage): медленный вход в урок
 * сводится к конкретному SQL. Оборачивается каждое соединение пула, поэтому
 * покрыты и транзакции; pool.query внутри зовёт client.query с колбэком.
 */
function instrument(client: PoolClient): void {
  const original = client.query.bind(client) as (...args: unknown[]) => unknown;
  (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const started = performance.now();
    // Колбэк pg вызывается из события сокета — контекст запроса там уже потерян.
    const context = currentLogContext();
    const last = args[args.length - 1];
    if (typeof last === "function") {
      args[args.length - 1] = (err: unknown, res: unknown) => {
        report(started, args[0], err, context);
        (last as (err: unknown, res: unknown) => void)(err, res);
      };
      return original(...args);
    }
    const result = original(...args);
    if (!(result instanceof Promise)) return result;
    return result.then(
      (res) => {
        report(started, args[0], null, context);
        return res;
      },
      (err: unknown) => {
        report(started, args[0], err, context);
        throw err;
      },
    );
  };
}
pool.on("connect", instrument);
