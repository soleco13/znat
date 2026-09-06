import type { GuestEnterResponse, GuestLessonInfo, GuestSession } from "@school/shared";

import { apiFetch, setGuestMode } from "@/shared/api-client";
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
): Promise<GuestEnterResponse> {
  const res = await apiFetch<GuestEnterResponse>(`/j/${encodeURIComponent(token)}/enter`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  setGuestMode(true);
  useGuestSessionStore.getState().setSession({ ...res, lessonTitle });
  return res;
}

/**
 * Восстановление гостевой личности из куки при перезагрузке страницы урока
 * (`GET /guest/session`). Возвращает `null`, если куки нет или сессия
 * недействительна (истекла / ссылку перевыпустили) — тогда нужен перезаход
 * по ссылке.
 */
export async function restoreGuestSession(): Promise<GuestSession | null> {
  try {
    const session = await apiFetch<GuestSession>("/guest/session");
    setGuestMode(true);
    useGuestSessionStore.getState().setSession(session);
    return session;
  } catch {
    return null;
  }
}
