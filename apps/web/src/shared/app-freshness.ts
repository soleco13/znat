import { useEffect } from "react";
import { track } from "./telemetry.js";

/**
 * Старая сборка приложения на входе в урок. Вкладка кабинета живёт неделями,
 * а service worker при медленной сети отдаёт сохранённую страницу — и человек
 * входит в урок с кодом месячной давности: исправления связи до него не
 * доходят. Урок 2026-11-14: планшет на Android вошёл со сборкой до 17.10
 * (livekit-client 2.22.3 при 2.23.0 на сервере), то же 08.11.
 *
 * Проверка — до входа, пока терять нечего: файл страницы (`index-<хеш>.js`)
 * сверяется со списком текущей сборки (`/sw-assets.json`, его же читает
 * service worker). Не совпал — страница перезагружается, один раз: если и
 * после перезагрузки сборка старая (сеть не отдала новую), входим как есть.
 * Сервер не ответил или ответил не то — ничего не делаем.
 */
const CHECK_TIMEOUT_MS = 3000;
let checked = false;

function entryPath(): string | null {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return entry ? new URL(entry.src).pathname : null;
}

/** Хеш сборки из имени файла страницы — в журнал (`device_profile`); в разработке `null`. */
export function appBuild(): string | null {
  return entryPath()?.match(/index-([^./]+)\.js$/)?.[1] ?? null;
}

/** Страница открыта перезагрузкой: вторая подряд перезагрузка ничего не даст. */
function loadedByReload(): boolean {
  const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return nav?.type === "reload";
}

export async function reloadIfStale(): Promise<void> {
  if (checked) return;
  checked = true;
  const entry = entryPath();
  if (!entry) return;
  try {
    const response = await fetch("/sw-assets.json", { cache: "no-store", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!response.ok) return;
    const body: unknown = await response.json();
    const assets = (body as { assets?: unknown }).assets;
    if (!Array.isArray(assets) || assets.length === 0 || assets.includes(entry)) return;
    const reload = !loadedByReload();
    track("app_stale", { build: appBuild(), reload });
    // Событие уходит при выгрузке страницы (`pagehide` в telemetry.ts).
    if (reload) location.reload();
  } catch {
    // нет сети или сервер перезапускается — входим как есть
  }
}

/** Проверить сборку при открытии экрана входа в урок. `enabled: false` — человек уже входит, перезагружать поздно. */
export function useFreshApp(enabled = true): void {
  useEffect(() => {
    if (enabled) void reloadIfStale();
  }, [enabled]);
}
