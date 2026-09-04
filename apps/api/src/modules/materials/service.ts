/**
 * Модуль `materials` (Э8) — по правилу CLAUDE.md наружу торчит только этот
 * файл, реализация движка проверки (Э8.3, читать построчно) — в `grading.ts`.
 */
import { materialSchema, type Material } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

export { gradeResponse } from "./grading.js";

/** Версия материала с уже разобранным (`materialSchema`) содержимым. */
export interface LoadedMaterial {
  materialId: string;
  versionId: string;
  version: number;
  material: Material;
}

/**
 * Содержимое `material_versions.content` — `jsonb`, на запись валидируется
 * (seed-скрипт), но на чтение это внешняя по отношению к коду граница:
 * разбираем `materialSchema` здесь, а не доверяем форме из БД. `.parse`
 * заодно применяет `.default()` (shuffle/showFeedback/attemptsAllowed).
 */
function parseVersion(row: repo.MaterialVersionRow): LoadedMaterial {
  const parsed = materialSchema.safeParse(row.content);
  if (!parsed.success) {
    throw new AppError(
      500,
      "material_content_invalid",
      "Содержимое версии материала не соответствует формату",
    );
  }
  return {
    materialId: row.materialId,
    versionId: row.versionId,
    version: row.version,
    material: parsed.data,
  };
}

/** Последняя версия материала школы — то, что учитель запускает в уроке (Э8.6). */
export async function getLatestMaterial(schoolId: string, materialId: string): Promise<LoadedMaterial> {
  const row = await repo.findLatestMaterialVersion(schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  return parseVersion(row);
}

/** Конкретная закреплённая версия — то, что реально видел ученик (Э8.6/8.10). */
export async function getMaterialVersion(versionId: string): Promise<LoadedMaterial> {
  const row = await repo.findMaterialVersionById(versionId);
  if (!row) throw new AppError(404, "material_not_found", "Версия материала не найдена");
  return parseVersion(row);
}
