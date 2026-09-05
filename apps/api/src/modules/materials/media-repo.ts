import { and, desc, eq, inArray } from "drizzle-orm";
import type { MediaAssetKind } from "@school/shared";
import { db } from "../../db/client.js";
import { mediaAssets } from "../../db/schema.js";

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

export async function insertMediaAsset(input: {
  schoolId: string;
  uploadedBy: string;
  kind: MediaAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}): Promise<MediaAssetRow> {
  const [row] = await db.insert(mediaAssets).values(input).returning();
  return row!;
}

/** Вся школа (не только свои загрузки) — смысл медиатеки в переиспользовании МЕЖДУ авторами (Э9.7, `service.ts` решает видимость по роли на уровне роута). */
export async function listMediaAssetRows(schoolId: string, kind?: MediaAssetKind): Promise<MediaAssetRow[]> {
  const conditions = [eq(mediaAssets.schoolId, schoolId)];
  if (kind) conditions.push(eq(mediaAssets.kind, kind));
  return db
    .select()
    .from(mediaAssets)
    .where(and(...conditions))
    .orderBy(desc(mediaAssets.createdAt));
}

export async function findMediaAssetById(id: string): Promise<MediaAssetRow | null> {
  const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Пакетный поиск по id (Э9.9, «битые картинки» — валидатор перед
 * публикацией): один запрос на весь материал, а не по одному на каждый
 * `image`/`audio` блок. `schoolId` в условии — тот же принцип видимости,
 * что и у остальных методов модуля: id из чужой школы не должен
 * ложно засчитаться «найденным» только потому, что запись физически
 * существует в БД у другой школы.
 */
export async function findMediaAssetsByIds(schoolId: string, ids: string[]): Promise<MediaAssetRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.schoolId, schoolId), inArray(mediaAssets.id, ids)));
}
