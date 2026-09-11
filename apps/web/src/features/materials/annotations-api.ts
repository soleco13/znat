import type { MaterialAnnotationsResponse, SaveAnnotationsRequest } from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

/**
 * Э13 — пометки учителя поверх материала конкретного ученика на уроке.
 * Одностороннее: учитель пишет (`saveStudentAnnotations`), ученик читает
 * опросом (`getMyAnnotations`) — тот же приём, что опрос прогресса Э8.8, а
 * не Yjs (это не совместный холст).
 */

/** Учитель: пометки, оставленные этому ученику по заданию. */
export function getStudentAnnotations(
  activityId: string,
  participantId: string,
): Promise<MaterialAnnotationsResponse> {
  return apiFetch<MaterialAnnotationsResponse>(
    `/activities/${activityId}/participants/${participantId}/annotations`,
  );
}

/** Учитель: сохранить пометки ученику (автосейв, debounced). */
export function saveStudentAnnotations(
  activityId: string,
  participantId: string,
  body: SaveAnnotationsRequest,
): Promise<MaterialAnnotationsResponse> {
  return apiFetch<MaterialAnnotationsResponse>(
    `/activities/${activityId}/participants/${participantId}/annotations`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

/** Ученик: пометки, которые учитель оставил ему по этому заданию (read-only). */
export function getMyAnnotations(activityId: string): Promise<MaterialAnnotationsResponse> {
  return apiFetch<MaterialAnnotationsResponse>(`/activities/${activityId}/my-annotations`);
}
