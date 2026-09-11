import type { RecorderActivityView } from "@school/shared";

/**
 * Э10.6 — фетч шаблона записи (`/egress`). НЕ `apiFetch` из
 * `shared/api-client.ts`: тот читает access-токен из `useAuthStore`
 * (персонал) и умеет refresh — recorder не персонал, у него свой токен из
 * query-параметра страницы, без куки и без refresh (см. RECORDING_EGRESS_
 * TEMPLATE_URL в recordings/service.ts).
 */
async function recorderFetch<T>(path: string, recorderToken: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${recorderToken}` },
  });
  if (!res.ok) throw new Error(`recorder fetch ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** «Лист с заданиями» для recorder'а — материал без ключей + агрегированный прогресс класса. */
export function getRecorderActivityView(
  activityId: string,
  recorderToken: string,
): Promise<RecorderActivityView> {
  return recorderFetch(`/activities/${activityId}/recorder-view`, recorderToken);
}
