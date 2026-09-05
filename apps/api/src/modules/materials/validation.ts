import type { Material, MaterialValidationIssue } from "@school/shared";
import { validateMaterialContent } from "@school/shared";
import * as mediaRepo from "./media-repo.js";

/**
 * «Битые картинки» (Э9.9, §7.2 ТЗ «Валидация») — единственная проверка
 * валидатора, которая НЕ может быть чистой функцией (`validateMaterialContent`,
 * `packages/shared`): узнать, существует ли файл за `assetId`, можно
 * только походом в БД. Собирает id из `image`/`audio` блоков ОДНИМ
 * запросом (`findMediaAssetsByIds`), не по одному на блок. `video`
 * СОЗНАТЕЛЬНО не проверяется — Э9.7 не даёт для него ни аплоада, ни
 * листинга (`mediaAssetKindEnum` не включает `video`), так что ЛЮБОЙ
 * `video.assetId` был бы неверифицируем и всегда «битым» — вводило бы в
 * заблуждение методиста, у которого нет способа это починить.
 */
export async function checkBrokenAssets(schoolId: string, material: Material): Promise<MaterialValidationIssue[]> {
  const refs = material.blocks.filter(
    (b): b is Extract<typeof b, { type: "image" | "audio" }> => b.type === "image" || b.type === "audio",
  );
  if (refs.length === 0) return [];

  const assetIds = [...new Set(refs.map((b) => b.assetId))];
  const found = await mediaRepo.findMediaAssetsByIds(schoolId, assetIds);
  const foundById = new Map(found.map((row) => [row.id, row]));

  const issues: MaterialValidationIssue[] = [];
  for (const block of refs) {
    const asset = foundById.get(block.assetId);
    if (!asset) {
      issues.push({ blockId: block.id, code: "broken_asset", message: "Файл не найден в медиатеке" });
    } else if (asset.kind !== block.type) {
      // Тот же id мог оказаться переиспользован не по своему типу (аудио вставлено в image-блок и т.п.) — тоже "битая" ссылка с точки зрения этого блока.
      issues.push({ blockId: block.id, code: "broken_asset", message: "Файл в медиатеке другого типа" });
    }
  }
  return issues;
}

/** Полная валидация перед публикацией (Э9.9) — структурные проверки (синхронные) + битые картинки (требуют похода в БД), один список. */
export async function validateMaterial(schoolId: string, material: Material): Promise<MaterialValidationIssue[]> {
  const brokenAssets = await checkBrokenAssets(schoolId, material);
  return [...validateMaterialContent(material), ...brokenAssets];
}
