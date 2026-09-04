import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { materials, materialVersions } from "../../db/schema.js";

/**
 * Строка версии материала вместе с идентичностью/владением из `materials`
 * (Э8.2 сознательно не дублирует `schoolId` в `material_versions` — берём
 * его джойном).
 */
export interface MaterialVersionRow {
  materialId: string;
  schoolId: string;
  versionId: string;
  version: number;
  content: unknown;
}

const versionSelection = {
  materialId: materials.id,
  schoolId: materials.schoolId,
  versionId: materialVersions.id,
  version: materialVersions.version,
  content: materialVersions.content,
};

/**
 * «Текущая» версия материала — просто последняя по `version` (Э8.2: без
 * отдельного указателя `currentVersionId`, workflow публикации — Э9.8).
 * Фильтр по `schoolId` — материалы одной школы не видны другой.
 */
export async function findLatestMaterialVersion(
  schoolId: string,
  materialId: string,
): Promise<MaterialVersionRow | null> {
  const rows = await db
    .select(versionSelection)
    .from(materialVersions)
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .where(and(eq(materials.id, materialId), eq(materials.schoolId, schoolId)))
    .orderBy(desc(materialVersions.version))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Конкретная версия по её id — активность (Э8.6) закрепляет `materialVersionId`,
 * чтобы разбор/пересчёт баллов после публикации новой версии сверялся ровно
 * с тем содержимым, которое видел ученик (Э8.2, §7.1.4 ТЗ).
 */
export async function findMaterialVersionById(
  versionId: string,
): Promise<MaterialVersionRow | null> {
  const rows = await db
    .select(versionSelection)
    .from(materialVersions)
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .where(eq(materialVersions.id, versionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Seed-скрипт (Э8, материалы заводятся JSON-ом — стоп-лист Э8). */
export async function insertMaterialWithVersion(input: {
  schoolId: string;
  createdBy: string;
  content: unknown;
}): Promise<MaterialVersionRow> {
  return db.transaction(async (tx) => {
    const [material] = await tx
      .insert(materials)
      .values({ schoolId: input.schoolId, createdBy: input.createdBy })
      .returning();
    const [version] = await tx
      .insert(materialVersions)
      .values({
        materialId: material!.id,
        version: 1,
        content: input.content,
        createdBy: input.createdBy,
      })
      .returning();
    return {
      materialId: material!.id,
      schoolId: material!.schoolId,
      versionId: version!.id,
      version: version!.version,
      content: version!.content,
    };
  });
}
