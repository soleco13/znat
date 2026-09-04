import type { ListMaterialsQuery, MaterialDetail, MaterialSummary } from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

/** Библиотека материалов (Э9.1, §8 ТЗ). admin/methodist/teacher — ученик библиотеку не листает. */
export function listMaterials(query: ListMaterialsQuery = {}): Promise<{ items: MaterialSummary[] }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return apiFetch<{ items: MaterialSummary[] }>(`/materials${qs ? `?${qs}` : ""}`);
}

/** Материал целиком для редактора (Э9.2), с ключами ответов — только для admin/methodist/teacher-владельца. */
export function getMaterial(id: string): Promise<MaterialDetail> {
  return apiFetch<MaterialDetail>(`/materials/${id}`);
}
