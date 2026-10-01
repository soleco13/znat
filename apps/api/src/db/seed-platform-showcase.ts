/**
 * Витрина конструкций в библиотеке «Матис»: заливает картинки/аудио/видео витрины
 * в медиатеку служебного пространства, подставляет их id вместо меток
 * `media:<файл>` и публикует материал — новый или новой версией уже
 * заведённого (ищется по названию). Не часть рантайма — ручной инструмент.
 *
 *   pnpm --filter @school/api exec tsx src/db/build-construct-showcase.ts
 *   pnpm --filter @school/api run seed:platform-showcase -- [material.json] [media-dir]
 *
 * По умолчанию — docs/materials/construct-showcase.json и
 * src/db/showcase-media/. Пространство и его админ должны уже быть
 * (`seed:platform`). Файл, уже загруженный в медиатеку Матиса под тем же
 * именем, повторно не грузится. Публикация идёт через сервис материалов,
 * с тем же валидатором, что и кнопка «Опубликовать».
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { materialSchema, type AccessTokenPayload, type Material } from "@school/shared";
import * as materialsService from "../modules/materials/service.js";
import * as schoolSettingsService from "../modules/school-settings/service.js";
import { db, pool } from "./client.js";
import { materials, mediaAssets, users } from "./schema.js";

const MEDIA_PREFIX = "media:";
/** SVG-схемы растрируются в PNG: медиатека принимает только PNG/JPEG/WebP. */
const SVG_DENSITY = 144;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const [jsonArg, mediaArg] = process.argv.slice(2).filter((a) => a !== "--");
const jsonPath = jsonArg ?? path.resolve(here, "../../../../docs/materials/construct-showcase.json");
const mediaDir = mediaArg ?? path.resolve(here, "showcase-media");
/** Промо-ролик лежит не в `showcase-media/`, а рядом с исходниками ролика — второе место поиска. */
const videoDir = path.resolve(here, "../../../../video-marketing/mathis-promo/out");

async function readMedia(file: string): Promise<Buffer> {
  try {
    return await readFile(path.join(mediaDir, file));
  } catch (err) {
    if (!file.endsWith(".mp4")) throw err;
    return readFile(path.join(videoDir, file));
  }
}

const content: Material = materialSchema.parse(JSON.parse(await readFile(jsonPath, "utf8")));

const platform = await schoolSettingsService.getPlatformSchool();
if (!platform) {
  console.error("Пространства «Матис» нет — сначала seed:platform.");
  process.exit(1);
}
const [admin] = await db
  .select({ id: users.id })
  .from(users)
  .where(and(eq(users.schoolId, platform.id), eq(users.role, "admin"), eq(users.isActive, true)))
  .orderBy(asc(users.createdAt))
  .limit(1);
if (!admin) {
  console.error("У пространства «Матис» нет активного админа — seed:platform.");
  process.exit(1);
}
const actor: AccessTokenPayload = { sub: admin.id, schoolId: platform.id, role: "admin" };

/** Файл витрины → id в медиатеке Матиса (по имени загруженного файла). */
async function ensureAsset(file: string): Promise<string> {
  const isSvg = file.endsWith(".svg");
  const uploadName = isSvg ? file.replace(/\.svg$/, ".png") : file;
  const [existing] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.schoolId, platform!.id), eq(mediaAssets.originalName, uploadName)))
    .limit(1);
  if (existing) return existing.id;

  const raw = await readMedia(file);
  const buffer = isSvg ? await sharp(raw, { density: SVG_DENSITY }).png().toBuffer() : raw;
  const mimeType = MIME_BY_EXT[path.extname(uploadName).toLowerCase()];
  if (!mimeType) throw new Error(`Неизвестный тип файла: ${file}`);
  const asset = await materialsService.uploadMediaAsset({
    buffer,
    mimeType,
    originalName: uploadName,
    schoolId: platform!.id,
    uploadedBy: admin!.id,
  });
  console.log(`  загружен ${uploadName}`);
  return asset.id;
}

const assetIds = new Map<string, string>();
for (const block of content.blocks) {
  if (
    (block.type === "image" || block.type === "audio" || block.type === "video") &&
    block.assetId.startsWith(MEDIA_PREFIX)
  ) {
    const file = block.assetId.slice(MEDIA_PREFIX.length);
    if (!assetIds.has(file)) assetIds.set(file, await ensureAsset(file));
    block.assetId = assetIds.get(file)!;
  }
}
console.log(`Медиатека: ${assetIds.size} файлов.`);

const [existingMaterial] = await db
  .select({ id: materials.id })
  .from(materials)
  .where(and(eq(materials.schoolId, platform.id), eq(materials.title, content.title)))
  .limit(1);

let materialId: string;
if (existingMaterial) {
  materialId = existingMaterial.id;
  await materialsService.updateMaterialDraft(actor, materialId, content);
} else {
  ({ materialId } = await materialsService.createMaterial(actor, content));
}
const published = await materialsService.publish(actor, materialId);
console.log(
  `«${content.title}» опубликован в «${platform.name}»: материал ${materialId}, версия ${published.version}, ${content.blocks.length} блоков.`,
);

await pool.end();
// Сервисы могли открыть соединение с Redis — не ждём его закрытия.
process.exit(0);
