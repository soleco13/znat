import { Redis } from "ioredis";
import { env } from "../plugins/env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Отдельное подключение для счётчиков лимита запросов: основное ждёт Redis
 * бесконечно (`maxRetriesPerRequest: null`), и при его недоступности зависли
 * бы все HTTP-запросы. Здесь команда падает быстро, и лимит пропускает
 * запрос (`skipOnError` в server.ts).
 */
export const rateLimitRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 500,
});
