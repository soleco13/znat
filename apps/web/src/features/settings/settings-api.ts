import type { SchoolSettings, UpdateSchoolSettingsRequest } from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

/** Параметры школы (§10.10 ТЗ, запрос 2026-09-14) — только admin. */
export function getSchoolSettings(): Promise<SchoolSettings> {
  return apiFetch<SchoolSettings>("/admin/settings");
}

export function updateSchoolSettings(patch: UpdateSchoolSettingsRequest): Promise<SchoolSettings> {
  return apiFetch<SchoolSettings>("/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
