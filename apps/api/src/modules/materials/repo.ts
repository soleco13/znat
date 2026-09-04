import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { MaterialStatus } from "@school/shared";
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

/** Строка версии вместе с владением/статусом (Э9.2) — `findLatestMaterialVersion` их не отдаёт (нужны только редактору для проверки видимости, activities/service.ts их не спрашивает). */
export interface MaterialForEditRow extends MaterialVersionRow {
  status: MaterialStatus;
  createdBy: string;
}

/** Последняя версия материала + владение/статус — для `GET /materials/:id` (Э9.2, редактор). */
export async function findLatestMaterialVersionForEdit(
  schoolId: string,
  materialId: string,
): Promise<MaterialForEditRow | null> {
  const rows = await db
    .select({ ...versionSelection, status: materials.status, createdBy: materials.createdBy })
    .from(materialVersions)
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .where(and(eq(materials.id, materialId), eq(materials.schoolId, schoolId)))
    .orderBy(desc(materialVersions.version))
    .limit(1);
  return rows[0] ?? null;
}

/** Одна строка библиотеки (Э9.1) — денормализованный кэш `materials`, без содержимого версии. */
export interface MaterialSummaryRow {
  id: string;
  title: string;
  subject: string;
  grades: number[];
  topic: string | null;
  status: MaterialStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const summarySelection = {
  id: materials.id,
  title: materials.title,
  subject: materials.subject,
  grades: materials.grades,
  topic: materials.topic,
  status: materials.status,
  createdBy: materials.createdBy,
  createdAt: materials.createdAt,
  updatedAt: materials.updatedAt,
};

/**
 * Библиотека материалов (Э9.1, §8 ТЗ: `GET /materials?subject=&grade=&q=&status=`
 * + `topic` дерева). `restrictToOwnerOrPublished` — «личная папка» учителя
 * (§4.2 ТЗ): `undefined` для admin/methodist (видят всё), userId учителя —
 * доп. условие `status='published' OR createdBy=userId`. Решение о том,
 * КОГДА подставлять ограничение — в `service.ts` (роль), здесь только
 * сборка SQL из уже разрешённых параметров.
 */
export async function listMaterials(
  schoolId: string,
  filters: {
    subject?: string;
    grade?: number;
    topic?: string;
    q?: string;
    status?: MaterialStatus;
    restrictToOwnerOrPublished?: string;
  },
): Promise<MaterialSummaryRow[]> {
  const conditions = [eq(materials.schoolId, schoolId)];
  if (filters.subject) conditions.push(eq(materials.subject, filters.subject));
  if (filters.topic) conditions.push(eq(materials.topic, filters.topic));
  if (filters.status) conditions.push(eq(materials.status, filters.status));
  if (filters.q) conditions.push(ilike(materials.title, `%${filters.q}%`));
  if (filters.grade !== undefined) {
    conditions.push(sql`${materials.grades} @> ${JSON.stringify([filters.grade])}::jsonb`);
  }
  if (filters.restrictToOwnerOrPublished) {
    conditions.push(
      or(
        eq(materials.status, "published"),
        eq(materials.createdBy, filters.restrictToOwnerOrPublished),
      )!,
    );
  }

  return db
    .select(summarySelection)
    .from(materials)
    .where(and(...conditions))
    .orderBy(desc(materials.updatedAt));
}
