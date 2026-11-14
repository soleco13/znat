import { CLIENT_EVENT_MAX_FIELDS, type ClientEvent, type ClientEventFieldValue, type ClientEventName } from "@school/shared";
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
 * Пользователю ничего не показываем и ничего не ломаем: при сбое отправки
 * события ждут в очереди и уходят позже.
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

/**
 * Сбой отправки — события возвращаются в очередь и уходят позже. Раньше они
 * молча терялись, а сеть рвётся как раз тогда, когда события важнее всего:
 * обрыв связи, переподключение, смена сети. Время события (`ts`) ставится
 * при записи, поздняя доставка его не искажает. Очередь ограничена: при
 * долгом обрыве остаются самые ранние события — начало происшествия.
 */
const MAX_QUEUE = 400;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

let queue: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let windowStart = 0;
let windowCount = 0;
let sending = false;
let failures = 0;
let lostEvents = 0;

function schedule(delayMs: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, delayMs);
}

function requeue(events: ClientEvent[]): void {
  queue = [...events, ...queue];
  if (queue.length > MAX_QUEUE) {
    lostEvents += queue.length - MAX_QUEUE;
    queue.length = MAX_QUEUE;
  }
}

/** Повторять есть смысл при обрыве сети, ошибке сервера и отказе по частоте; отказ по содержимому (400) повтор не исправит. */
function retriable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function post(events: ClientEvent[]): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Client-Session": clientSessionId };
  const token = useAuthStore.getState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ clientSessionId, events }),
      headers,
      credentials: "include",
      keepalive: true,
    });
    return res.ok || !retriable(res.status);
  } catch {
    return false;
  }
}

function flush(beacon = false): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    // Страницу закрывают: ответа не дождаться, очередь отдаём браузеру.
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_BATCH);
      const body = new Blob([JSON.stringify({ clientSessionId, events })], { type: "application/json" });
      if (!navigator.sendBeacon(ENDPOINT, body)) {
        requeue(events);
        break;
      }
    }
    if (queue.length === 0) return;
  }
  if (sending || queue.length === 0) return;
  sending = true;
  const events = queue.splice(0, MAX_BATCH);
  void post(events).then((delivered) => {
    sending = false;
    if (delivered) {
      failures = 0;
      if (queue.length > 0) flush();
      return;
    }
    requeue(events);
    schedule(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]!);
    failures += 1;
  });
}

export function track(event: ClientEventName, fields: Record<string, ClientEventFieldValue | undefined> = {}): void {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > MAX_EVENTS_PER_MINUTE) return;
  const clean: Record<string, ClientEventFieldValue> = {};
  const entries = Object.entries(fields).filter((e): e is [string, ClientEventFieldValue] => e[1] !== undefined);
  // Лишнее поле в одном событии — и сервер отклоняет весь пакет (урок 2026-10-20:
  // media_quality с 26 полями, сутки без качества связи). Режем здесь и помечаем.
  const fit = entries.length > CLIENT_EVENT_MAX_FIELDS ? CLIENT_EVENT_MAX_FIELDS - 1 : entries.length;
  for (const [key, value] of entries.slice(0, fit)) {
    clean[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  if (fit < entries.length) clean.fieldsDropped = entries.length - fit;
  if (queue.length >= MAX_QUEUE) {
    lostEvents += 1;
    return;
  }
  // Сколько событий не поместилось в очередь за время обрыва — видно в журнале.
  if (lostEvents > 0 && Object.keys(clean).length < CLIENT_EVENT_MAX_FIELDS) {
    clean.telemetryLost = lostEvents;
    lostEvents = 0;
  }
  queue.push({ event, ts: new Date(now).toISOString(), fields: clean });
  // Пока идут повторы после сбоя, новые события не сбивают их расписание.
  if (queue.length >= MAX_BATCH && failures === 0) flush();
  else schedule(FLUSH_DELAY_MS);
}

/** Имя и сообщение ошибки без стека и без объектов — то, что уместно в событии. */
export function errorFields(err: unknown): { errorName: string; errorMessage: string } {
  if (err instanceof Error) return { errorName: err.name, errorMessage: err.message.slice(0, 200) };
  return { errorName: typeof err, errorMessage: String(err).slice(0, 200) };
}

/**
 * Путь страницы без токена ссылки урока: `/j/<token>` и короткая `/<код>`
 * (lessonJoinCodeSchema) — сами по себе пропуск в урок.
 */
export function safePath(): string {
  return location.pathname
    .replace(/\/j\/[^/]+/, "/j/[redacted]")
    .replace(/^\/[a-z0-9]{12}(?=\/|$)/, "/[redacted]");
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
  // Сеть вернулась — не ждать очередного повтора.
  window.addEventListener("online", () => {
    if (queue.length > 0) flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}
