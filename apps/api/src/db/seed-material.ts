/**
 * Заведение учебного материала JSON-ом (Э8, стоп-лист: «материалы заводятся
 * через seed-скрипт или Postman, редактор — Э9»). Не часть рантайма — ручной
 * инструмент для наполнения БД до появления редактора методиста.
 *
 *   pnpm --filter @school/api run seed:material -- ./material.json [schoolId] [userId]
 *
 * Без schoolId/userId берёт первую школу и первого её админа/учителя.
 * С `--material <id>` добавляет НОВУЮ версию к существующему материалу
 * (append-only, Э8.2), иначе создаёт новый материал с версией 1.
 */
import { readFile } from "node:fs/promises";
import { and, desc, eq, inArray } from "drizzle-orm";
import { materialSchema } from "@school/shared";
import { db, pool } from "./client.js";
import { materials, materialVersions, schools, users } from "./schema.js";

const args = process.argv.slice(2);
const materialIdFlagIdx = args.indexOf("--material");
const existingMaterialId = materialIdFlagIdx >= 0 ? args[materialIdFlagIdx + 1] : undefined;
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--material");

const [filePath, schoolArg, userArg] = positional;
if (!filePath) {
  console.error("Укажите путь к JSON-файлу материала.");
  process.exit(1);
}

const raw = JSON.parse(await readFile(filePath, "utf8"));
const content = materialSchema.parse(raw);

const schoolId =
  schoolArg ?? (await db.select({ id: schools.id }).from(schools).orderBy(schools.createdAt).limit(1))[0]?.id;
if (!schoolId) {
  console.error("Не найдено ни одной школы — укажите schoolId явно.");
  process.exit(1);
}

const userId =
  userArg ??
  (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.schoolId, schoolId), inArray(users.role, ["admin", "teacher"])))
      .orderBy(users.createdAt)
      .limit(1)
  )[0]?.id;
if (!userId) {
  console.error("Не найден админ/учитель школы — укажите userId явно.");
  process.exit(1);
}

const result = await db.transaction(async (tx) => {
  let materialId = existingMaterialId;
  let version = 1;

  if (materialId) {
    const [owner] = await tx
      .select({ schoolId: materials.schoolId })
      .from(materials)
      .where(eq(materials.id, materialId));
    if (!owner) throw new Error(`Материал ${materialId} не найден`);
    if (owner.schoolId !== schoolId) throw new Error("Материал принадлежит другой школе");
    const [last] = await tx
      .select({ version: materialVersions.version })
      .from(materialVersions)
      .where(eq(materialVersions.materialId, materialId))
      .orderBy(desc(materialVersions.version))
      .limit(1);
    version = (last?.version ?? 0) + 1;
  } else {
    const [created] = await tx
      .insert(materials)
      .values({ schoolId, createdBy: userId })
      .returning({ id: materials.id });
    materialId = created!.id;
  }

  await tx.insert(materialVersions).values({
    materialId: materialId!,
    version,
    content,
    createdBy: userId,
  });

  return { materialId: materialId!, version };
});

console.log(`Материал ${result.materialId} — версия ${result.version} записана ("${content.title}").`);
await pool.end();
