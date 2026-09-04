/**
 * Модуль `materials` (Э8) — по правилу CLAUDE.md наружу торчит только этот
 * файл, реализация движка проверки (Э8.3, читать построчно) — в `grading.ts`.
 */
import {
  materialSchema,
  type AccessTokenPayload,
  type ListMaterialsQuery,
  type Material,
  type MaterialStatus,
} from "@school/shared";
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

/** Полное содержимое версии + владение/статус — то, что грузит редактор (Э9.2). */
export interface EditableMaterial extends LoadedMaterial {
  status: MaterialStatus;
  createdBy: string;
}

/**
 * Материал для редактора (Э9.2, §7.2 ТЗ «Редактор материала»). Видимость —
 * ТА ЖЕ «личная папка» учителя, что и в `listMaterials` (Э9.1, §4.2 ТЗ):
 * учитель открывает свои материалы ЛЮБОГО статуса + чужие только
 * опубликованные, admin/methodist — без ограничения. Отказ — 404, а не 403
 * (как и у `getLatestMaterial` выше) — не подтверждаем чужому учителю сам
 * факт существования материала другого учителя в этой школе.
 */
export async function getMaterialForEdit(
  user: AccessTokenPayload,
  materialId: string,
): Promise<EditableMaterial> {
  const row = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  if (user.role === "teacher" && row.status !== "published" && row.createdBy !== user.sub) {
    throw new AppError(404, "material_not_found", "Материал не найден");
  }
  return { ...parseVersion(row), status: row.status, createdBy: row.createdBy };
}

/**
 * Библиотека материалов (Э9.1, §7.2 ТЗ). Видимость по роли — «личная папка»
 * учителя (§4.2 ТЗ, «учитель создаёт материалы только в личной папке, без
 * публикации в общую библиотеку»): учитель видит свои материалы ЛЮБОГО
 * статуса + чужие ТОЛЬКО опубликованные; admin/methodist видят всё —
 * именно им и достаётся публикация/ревью (Э9.8). Область прав доступа
 * (CLAUDE.md, «не делегировать вслепую») — решение читано и написано
 * построчно, а не сгенерировано.
 */
export async function listMaterials(
  user: AccessTokenPayload,
  query: ListMaterialsQuery,
): Promise<repo.MaterialSummaryRow[]> {
  return repo.listMaterials(user.schoolId, {
    subject: query.subject,
    grade: query.grade,
    topic: query.topic,
    q: query.q,
    status: query.status,
    restrictToOwnerOrPublished: user.role === "teacher" ? user.sub : undefined,
  });
}
