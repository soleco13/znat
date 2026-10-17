import type { GuestEnterResponse, GuestKnockResponse, GuestKnockStatus, GuestLessonInfo, GuestSession } from "@school/shared";

import { ApiError, apiFetch, setGuestMode } from "@/shared/api-client";
import { useGuestSessionStore } from "./guest-session-store.js";

/** Публичная карточка урока по ссылке (`GET /j/:token`) — имя урока + настройки. */
export function fetchGuestLessonInfo(token: string): Promise<GuestLessonInfo> {
  return apiFetch<GuestLessonInfo>(`/j/${encodeURIComponent(token)}`);
}

/**
 * Вход по ссылке под произвольным именем (`POST /j/:token/enter`). Сервер
 * ставит httpOnly-куку с гостевым JWT; в ответе — id урока и личность.
 * `lessonTitle` берём из уже загруженной карточки (гость формы урока не
 * видит), кладём гостевую сессию в стор и взводим guest-режим api-клиента.
 */
export async function enterGuestLesson(
  token: string,
  name: string,
  lessonTitle: string,
  /** Вход закрыт, но учитель впустил по запросу (комната ожидания). */
  knockId?: string,
): Promise<GuestEnterResponse> {
  const res = await apiFetch<GuestEnterResponse>(`/j/${encodeURIComponent(token)}/enter`, {
    method: "POST",
    // Согласие даётся нажатием «Продолжить» (текст под кнопкой на экране входа).
    body: JSON.stringify({ name, personalDataConsent: true, ...(knockId ? { knockId } : {}) }),
  });
  setGuestMode(true);
  useGuestSessionStore.getState().setSession({ ...res, lessonTitle });
  return res;
}

/**
 * Восстановление гостевой личности из куки при перезагрузке страницы урока
 * (`GET /guest/session`). Возвращает `null`, если куки нет или сессия
 * недействительна (истекла / ссылку перевыпустили) — тогда нужен перезаход
 * по ссылке. `"unavailable"` — сервер не ответил (деплой, обрыв сети): раньше
 * это тоже давало `null`, и ученик, обновивший страницу во время деплоя,
 * видел «Нет доступа к уроку».
 */
export async function restoreGuestSession(): Promise<GuestSession | null | "unavailable"> {
  try {
    // `_retry: false` — на 401 не дёргаем staff-`/auth/refresh`: это гостевой
    // эндпоинт, персональный токен ему не поможет, а лишний перезапрос
    // раскручивал бы эффект `RequireRoomAccess` (Э13-правка).
    const session = await apiFetch<GuestSession>("/guest/session", {}, false);
    setGuestMode(true);
    useGuestSessionStore.getState().setSession(session);
    return session;
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) return null;
    return "unavailable";
  }
}

/** Вход закрыт — попросить учителя впустить (комната ожидания, 2026-10-17). */
export function knockGuestLesson(token: string, name: string): Promise<GuestKnockResponse> {
  return apiFetch<GuestKnockResponse>(`/j/${encodeURIComponent(token)}/knock`, {
    method: "POST",
    body: JSON.stringify({ name, personalDataConsent: true }),
  });
}

/** Статус запроса; заодно сервер видит, что страница ещё открыта. */
export function fetchKnockStatus(token: string, knockId: string): Promise<GuestKnockStatus> {
  return apiFetch<GuestKnockStatus>(`/j/${encodeURIComponent(token)}/knock/${encodeURIComponent(knockId)}`, {}, false);
}
