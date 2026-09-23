const PROBE_TIMEOUT_MS = 2_000;

async function probe(check: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Раньше `/health` всегда отвечал ok — контейнер считался здоровым при
 * лежащей БД или Redis, и деплой/мониторинг этого не видели. Таймаут
 * обязателен: клиент Redis создан без лимита ретраев и при недоступном
 * Redis ждал бы бесконечно.
 */
export async function checkHealth(deps: {
  db: () => Promise<unknown>;
  redis: () => Promise<unknown>;
}): Promise<{ ok: boolean; db: boolean; redis: boolean }> {
  const [db, redis] = await Promise.all([probe(deps.db), probe(deps.redis)]);
  return { ok: db && redis, db, redis };
}
