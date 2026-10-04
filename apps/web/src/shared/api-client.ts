import type { MeResponse } from "@school/shared";
import { useAuthStore } from "./auth-store.js";
import { clientSessionId } from "./telemetry.js";

const API_BASE = "/api/v1";

/**
 * Заголовки корреляции: сессия вкладки и id запроса. Сервер пишет их в каждую
 * строку лога и возвращает X-Request-Id — по нему находится строка ошибки.
 */
function correlationHeaders(headers: Headers): Headers {
  headers.set("X-Client-Session", clientSessionId);
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) headers.set("X-Request-Id", crypto.randomUUID());
  return headers;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Э12.6 — режим гостя-ученика: аккаунта и refresh-токена нет, личность
 * держится httpOnly-кукой `guest_session`. В этом режиме:
 *  - НЕ шлём `Authorization: Bearer` даже если в этой вкладке остался
 *    staff-access-токен (иначе сервер по Bearer сделал бы staff-actor —
 *    `plugins/lesson-access.ts` отдаёт Bearer безусловный приоритет над
 *    гостевой кукой — и ученик оказался бы «сотрудником»);
 *  - на 401 не пытаемся обновить персональный access-токен (`/auth/refresh`
 *    гостю всегда вернёт 401 и зря дёрнет `clearAuth`).
 * Взводится при восстановлении/входе гостевой сессии, снимается при выходе
 * из урока и при заходе сотрудником (`RequireRoomAccess`).
 */
let guestMode = false;
export function setGuestMode(on: boolean): void {
  guestMode = on;
}

/**
 * Сколько ждать ответа API. Без предела запрос на «зависшей» мобильной сети
 * или при недоступном Redis на сервере не завершался никогда: вход в урок
 * висел на «Подключаем звук и видео…» без кнопки «Повторить». Загрузки файлов
 * (`FormData`) не ограничиваем — большой файл на медленной сети идёт дольше.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Таймаут запроса: сервер не ответил за `REQUEST_TIMEOUT_MS`. */
export const TIMEOUT_ERROR_CODE = "timeout";

export type RefreshOutcome = "ok" | "unauthorized" | "unavailable";

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function requestRefresh(): Promise<RefreshOutcome> {
  // Таймаут и разбор тела — внутри try: зависший или оборванный ответ раньше
  // ронял промис, и экраны «Проверяем вход/доступ…» висели навсегда.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: correlationHeaders(new Headers()),
      signal: controller.signal,
    });
    // Выходим только когда сервер точно сказал «сессии нет». 502 во время
    // деплоя, 429 или обрыв сети раньше тоже стирали вход — учителя
    // выбрасывало на страницу логина посреди урока.
    if (res.status === 401 || res.status === 403) {
      useAuthStore.getState().clearAuth();
      return "unauthorized";
    }
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { accessToken: string; user: MeResponse };
    useAuthStore.getState().setAuth(data.accessToken, data.user);
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Обновление access-токена с учётом других вкладок: refresh-кука у них
 * общая, и одновременная ротация одним токеном выглядела для сервера как
 * кража. Web Locks выстраивает вкладки в очередь — следующая идёт уже с
 * новой кукой.
 */
export async function refreshAccessTokenDetailed(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const run: Promise<RefreshOutcome> = (
      locks ? locks.request("auth-refresh", requestRefresh).then((outcome) => outcome) : requestRefresh()
    ).catch((): RefreshOutcome => "unavailable");
    refreshInFlight = run.finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function refreshAccessToken(): Promise<boolean> {
  return (await refreshAccessTokenDetailed()) === "ok";
}

/**
 * Вошёл ли человек в этом браузере: токен в памяти вкладки или живая
 * refresh-кука. Для публичных страниц (вход, ссылка на урок), которые иначе
 * просили бы войти заново при каждой новой вкладке. Сбой сети — «не вошёл»:
 * страница покажет обычную форму, а не зависнет.
 */
export async function hasStaffSession(): Promise<boolean> {
  if (useAuthStore.getState().accessToken) return true;
  return (await refreshAccessTokenDetailed()) === "ok";
}

/** Запас до истечения, при котором токен уже считаем протухшим — переподключение не должно улететь с токеном, истекающим в пути. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

function isExpiring(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 - Date.now() < TOKEN_EXPIRY_MARGIN_MS;
  } catch {
    return true;
  }
}

/**
 * Access-токен для долгоживущих WS (комната, доска): живёт ~15 минут, и
 * переподключение после обрыва или перезапуска сервера с токеном из памяти
 * отвергалось — учитель не мог вернуться в урок без перезагрузки страницы.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const token = useAuthStore.getState().accessToken;
  if (token && !isExpiring(token)) return token;
  await refreshAccessToken();
  return useAuthStore.getState().accessToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  _retry = true,
): Promise<T> {
  const accessToken = guestMode ? null : useAuthStore.getState().accessToken;
  const headers = correlationHeaders(new Headers(options.headers));
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const outer = options.signal;
  const onOuterAbort = () => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener("abort", onOuterAbort, { once: true });
  let timedOut = false;
  const timer =
    options.body instanceof FormData
      ? null
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: controller.signal,
    });

    if (res.status === 401 && _retry && !guestMode) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return await apiFetch<T>(path, options, false);
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "unknown_error", message: res.statusText }));
      throw new ApiError(res.status, body.error ?? "unknown_error", body.message ?? res.statusText);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (timedOut) throw new ApiError(0, TIMEOUT_ERROR_CODE, "Сервер не отвечает — проверьте интернет");
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}
