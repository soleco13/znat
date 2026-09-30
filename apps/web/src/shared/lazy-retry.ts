import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Загрузка куска сборки с повторами: на мобильной сети с потерями запрос
 * куска может оборваться, и без повтора `lazy` уронил бы страницу в ошибку.
 */
export function withRetry<T>(load: () => Promise<T>, attempts = 4, delayMs = 1500): () => Promise<T> {
  return async () => {
    for (let i = 1; ; i++) {
      try {
        return await load();
      } catch (err) {
        if (i >= attempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, delayMs * i));
      }
    }
  };
}

/** `lazy` для именованного экспорта, с повторами загрузки. */
export function lazyNamed<P extends object, K extends string>(
  load: () => Promise<{ [key in K]: ComponentType<P> }>,
  name: K,
): LazyExoticComponent<ComponentType<P>> {
  const loadWithRetry = withRetry(load);
  return lazy(async () => ({ default: (await loadWithRetry())[name] }));
}
