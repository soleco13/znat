import type { ClientEvent, ClientEventFieldValue, ClientEventName } from "@school/shared";
import { useAuthStore } from "./auth-store.js";

/**
 * Клиентские события урока — в серверный лог (POST /api/v1/telemetry).
 * Подключение к LiveKit, переподключения WebSocket, синхронизация доски,
 * загрузка PDF случаются только здесь, в браузере; без этого «у ученика
 * пропала доска» нечем было разобрать.
 *
 * `clientSessionId` — id этой вкладки (только в памяти: localStorage в
 * проекте запрещён). Он же уходит заголовком X-Client-Session со всеми
 * запросами API и параметром `cs` в WebSocket — один фильтр по нему в логе
 * собирает всю историю урока одного человека.
 *
 * Пользователю ничего не показываем и ничего не ломаем: сбой отправки
 * молча теряет события.
 */
export const clientSessionId: string =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ENDPOINT = "/api/v1/telemetry";
const FLUSH_DELAY_MS = 5_000;
const MAX_BATCH = 50;
/** Защита от цикла переподключений, шлющего событие раз в секунду часами. */
const MAX_EVENTS_PER_MINUTE = 60;

let queue: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let windowStart = 0;
let windowCount = 0;

function send(events: ClientEvent[], beacon: boolean): void {
  const body = JSON.stringify({ clientSessionId, events });
  if (beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Client-Session": clientSessionId };
  const token = useAuthStore.getState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  fetch(ENDPOINT, { method: "POST", body, headers, credentials: "include", keepalive: true }).catch(() => undefined);
}

function flush(beacon = false): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (queue.length > 0) send(queue.splice(0, MAX_BATCH), beacon);
}

export function track(event: ClientEventName, fields: Record<string, ClientEventFieldValue | undefined> = {}): void {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > MAX_EVENTS_PER_MINUTE) return;
  const clean: Record<string, ClientEventFieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    clean[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  queue.push({ event, ts: new Date(now).toISOString(), fields: clean });
  if (queue.length >= MAX_BATCH) flush();
  else if (!flushTimer) flushTimer = setTimeout(() => flush(), FLUSH_DELAY_MS);
}

/** Имя и сообщение ошибки без стека и без объектов — то, что уместно в событии. */
export function errorFields(err: unknown): { errorName: string; errorMessage: string } {
  if (err instanceof Error) return { errorName: err.name, errorMessage: err.message.slice(0, 200) };
  return { errorName: typeof err, errorMessage: String(err).slice(0, 200) };
}

/** Путь страницы без токена ссылки урока (`/j/<token>` — сам по себе пропуск в урок). */
function safePath(): string {
  return location.pathname.replace(/\/j\/[^/]+/, "/j/[redacted]");
}

if (typeof window !== "undefined") {
  // Необработанные ошибки страницы: без них «доска побелела» не с чем сопоставить.
  window.addEventListener("error", (e) => {
    track("client_error", { area: "window", ...errorFields(e.error ?? e.message), path: safePath() });
  });
  window.addEventListener("unhandledrejection", (e) => {
    track("client_error", { area: "promise", ...errorFields(e.reason), path: safePath() });
  });
  // Вкладку закрывают или уводят в фон — дослать накопленное.
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}
