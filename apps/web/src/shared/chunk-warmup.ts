/**
 * Докачка кусков сборки до `import()`.
 *
 * Браузер запоминает неудачный `import()`: если на плохой связи оборвался
 * запрос куска или любой его зависимости, все следующие `import()` того же
 * файла до перезагрузки страницы падают сразу, даже не выходя в сеть
 * (проверено в Chromium и WebKit). Повторять сам `import()` бесполезно.
 *
 * Поэтому файлы куска сначала скачиваются обычным `fetch` с повторами — они
 * ложатся в HTTP-кэш (у `/assets/*` `immutable`), и `import()` берёт их уже
 * оттуда. Список файлов каждого куска — `chunks` в `sw-assets.json`
 * (собирается при сборке, `vite.config.ts`).
 */

const ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

type Manifest = Record<string, string[]>;

let manifest: Promise<Manifest | null> | null = null;
const warmed = new Map<string, Promise<boolean>>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Скачивает файл целиком (обрыв посреди тела — тоже неудача) с повторами. */
async function download(url: string): Promise<boolean> {
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (response.ok) {
        await response.arrayBuffer();
        return true;
      }
      // Файла нет (сборка сменилась) — повтор не поможет.
      if (response.status === 404) return false;
    } catch {
      // сеть — пробуем ещё
    }
    if (i < ATTEMPTS) await wait(BASE_DELAY_MS * i);
  }
  return false;
}

async function loadManifest(): Promise<Manifest | null> {
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const response = await fetch("/sw-assets.json", { cache: "no-cache" });
      if (response.ok) {
        const data = (await response.json()) as { chunks?: Manifest };
        return data.chunks ?? null;
      }
      if (response.status === 404) return null;
    } catch {
      // сеть — пробуем ещё
    }
    if (i < ATTEMPTS) await wait(BASE_DELAY_MS * i);
  }
  return null;
}

/**
 * Докачивает файлы куска `module` (путь исходника, как в `LESSON_ENTRY_MODULES`).
 * Не бросает: без списка или при неудаче `import()` просто пойдёт в сеть сам.
 */
export async function warmChunk(module: string): Promise<void> {
  if (import.meta.env.DEV) return;
  manifest ??= loadManifest().then((result) => {
    if (!result) manifest = null; // не удалось — попробуем в следующий раз
    return result;
  });
  const files = (await manifest)?.[module];
  if (!files) return;
  await Promise.all(
    files.map((file) => {
      let pending = warmed.get(file);
      if (!pending) {
        pending = download(file).then((ok) => {
          if (!ok) warmed.delete(file);
          return ok;
        });
        warmed.set(file, pending);
      }
      return pending;
    }),
  );
}
