import { useAuthStore } from "./auth-store.js";

const API_BASE = "/api/v1";

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

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        useAuthStore.getState().clearAuth();
        return false;
      }
      const data = await res.json();
      useAuthStore.getState().setAuth(data.accessToken, data.user);
      return true;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  _retry = true,
): Promise<T> {
  const accessToken = guestMode ? null : useAuthStore.getState().accessToken;
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && _retry && !guestMode) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, options, false);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown_error", message: res.statusText }));
    throw new ApiError(res.status, body.error ?? "unknown_error", body.message ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
