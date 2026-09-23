import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";
import { env } from "../plugins/env.js";

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
