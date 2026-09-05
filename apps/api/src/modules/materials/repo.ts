import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Material, MaterialStatus } from "@school/shared";
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
 * Создание нового материала (Э9.10, §8 ТЗ `POST /materials`) — до сих пор
 * единственным путём было `db/seed-material.ts` (ручной скрипт в обход
 * repo/service, стоп-лист Э8: «материалы заводятся через seed-скрипт или
 * Postman»). Всегда `status: "draft"` — новый материал не может родиться
 * сразу опубликованным (§4.2 ТЗ, публикует только admin/methodist через
 * `publish`, Э9.8), `currentVersionId` остаётся `NULL` до первой
 * публикации (та же семантика, что и у любого черновика). Денормализованный
 * кэш (`title`/`subject`/`grades`/`topic`) синхронизирован сразу — это
 * ПЕРВАЯ версия, синхронизировать нечему ждать (в отличие от форка поверх
 * публикации, Э9.8, `updateDraftVersionContent(..., syncSummary=false)`).
 */
export async function insertMaterial(
  schoolId: string,
  createdBy: string,
  content: Material,
): Promise<{ materialId: string; versionId: string }> {
  return db.transaction(async (tx) => {
    const [material] = await tx
      .insert(materials)
      .values({
        schoolId,
        createdBy,
        status: "draft",
        title: content.title,
        subject: content.subject,
        grades: content.grades,
        topic: content.topic ?? null,
      })
      .returning({ id: materials.id });
    const [version] = await tx
      .insert(materialVersions)
      .values({ materialId: material!.id, version: 1, content, createdBy })
      .returning({ id: materialVersions.id });
    return { materialId: material!.id, versionId: version!.id };
  });
}

/**
 * Версия, которую реально видит школа/выдаёт учитель (Э9.8,
 * `materials.currentVersionId`) — НЕ просто последняя по `version`: после
 * первой публикации методист может копить правку в НОВОЙ версии поверх
 * (`insertNewVersion` ниже), и пока её не опубликуют повторно, эта функция
 * обязана продолжать отдавать СТАРУЮ, уже опубликованную. `INNER JOIN` по
 * `currentVersionId` — если он `NULL` (материал ещё не публиковался),
 * джойн не даст строк, ровно то поведение и нужно вызывающей стороне
 * (`getLatestMaterial` → назначение материала уроку/дз, Э8.6): учитель не
 * должен получить возможность выдать классу непубликованный черновик.
 * Фильтр по `schoolId` — материалы одной школы не видны другой.
 */
export async function findPublishedMaterialVersion(
  schoolId: string,
  materialId: string,
): Promise<MaterialVersionRow | null> {
  const rows = await db
    .select(versionSelection)
    .from(materials)
    .innerJoin(materialVersions, eq(materialVersions.id, materials.currentVersionId))
    .where(and(eq(materials.id, materialId), eq(materials.schoolId, schoolId)))
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

/**
 * Строка версии вместе с владением/статусом/указателем публикации (Э9.2/9.8)
 * — `findPublishedMaterialVersion` их не отдаёт (нужны только редактору для
 * проверки видимости и веток `updateMaterialDraft`/`publish`,
 * activities/service.ts их не спрашивает). `currentVersionId` — сравнивая
 * его с `versionId` ЭТОЙ строки, вызывающая сторона узнаёт, форк это уже
 * существующий (правят второй раз подряд) или публикуемая версия
 * (`versionId === currentVersionId`, ничего нового нет).
 */
export interface MaterialForEditRow extends MaterialVersionRow {
  status: MaterialStatus;
  createdBy: string;
  currentVersionId: string | null;
}

const versionForEditSelection = {
  ...versionSelection,
  status: materials.status,
  createdBy: materials.createdBy,
  currentVersionId: materials.currentVersionId,
};

/** Последняя версия материала (ЛЮБОГО статуса, включая непубличный форк поверх публикации) + владение/статус — для `GET /materials/:id` своему автору/admin/methodist и для веток записи (Э9.2/9.3/9.8). */
export async function findLatestMaterialVersionForEdit(
  schoolId: string,
  materialId: string,
): Promise<MaterialForEditRow | null> {
  const rows = await db
    .select(versionForEditSelection)
    .from(materialVersions)
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .where(and(eq(materials.id, materialId), eq(materials.schoolId, schoolId)))
    .orderBy(desc(materialVersions.version))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Та же форма строки, что выше, но по указателю `currentVersionId`, а не
 * по последнему номеру версии (Э9.8) — для учителя, который смотрит ЧУЖОЙ
 * материал: если поверх публикации сейчас копится непубличный форк, такой
 * учитель должен продолжать видеть ИМЕННО опубликованное, а не чужую
 * недоделанную правку. `status`/`createdBy` в ответе всё равно берутся с
 * `materials` (та же строка) — `service.ts` переопределяет `status` на
 * `"published"` явно в этой ветке, а не доверяет колонке (материал в
 * целом мог уже начать копить следующий форк).
 */
export async function findPublishedMaterialVersionForEdit(
  schoolId: string,
  materialId: string,
): Promise<MaterialForEditRow | null> {
  const rows = await db
    .select(versionForEditSelection)
    .from(materials)
    .innerJoin(materialVersions, eq(materialVersions.id, materials.currentVersionId))
    .where(and(eq(materials.id, materialId), eq(materials.schoolId, schoolId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Автосохранение (Э9.3/9.8, §8 ТЗ `PUT /materials/:id`: «обновление
 * черновика») — перезаписывает содержимое УКАЗАННОЙ версии на месте (в
 * отличие от `seed-material.ts`, который всегда добавляет новую версию).
 * Годится для ДВУХ разных случаев, различаемых вызывающей стороной
 * (`service.ts#updateMaterialDraft`) по `syncSummary`:
 *
 * 1. Материал ещё никогда не публиковался (`draft`/`review`) — мутируем
 *    его единственную версию, СИНХРОНИЗИРУЕМ денормализованный кэш
 *    `materials` (библиотека должна сразу видеть новый заголовок/предмет
 *    черновика своего автора) — `syncSummary = true`.
 * 2. Материал уже опубликован, и правка попадает в УЖЕ СУЩЕСТВУЮЩИЙ форк
 *    поверх публикации (не первая правка после публикации — та форкает
 *    новую версию через `insertNewVersion`, эта просто продолжает её
 *    редактировать) — кэш `materials` НЕ трогаем: школа продолжает видеть
 *    старое опубликованное название/предмет, пока форк не опубликуют
 *    повторно (`publishVersion`) — `syncSummary = false`.
 */
export async function updateDraftVersionContent(
  materialId: string,
  versionId: string,
  content: Material,
  syncSummary: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(materialVersions).set({ content }).where(eq(materialVersions.id, versionId));
    if (syncSummary) {
      await tx
        .update(materials)
        .set({
          title: content.title,
          subject: content.subject,
          grades: content.grades,
          topic: content.topic ?? null,
          updatedAt: new Date(),
        })
        .where(eq(materials.id, materialId));
    }
  });
}

/**
 * Форк новой версии поверх уже ОПУБЛИКОВАННОГО материала (Э9.8, «правка
 * опубликованного создаёт новую версию») — append-only, как и было
 * задумано в Э8.2, но реально применяется только с этого момента:
 * пока материал не опубликован ни разу, правки мутируют версию на месте
 * (`updateDraftVersionContent` выше). Денормализованный кэш `materials`
 * НЕ трогаем — та же причина, что и в `updateDraftVersionContent(...,
 * syncSummary=false)`: опубликованное содержимое не должно меняться в
 * библиотеке раньше, чем форк реально опубликуют.
 */
export async function insertNewVersion(
  materialId: string,
  content: Material,
  createdBy: string,
): Promise<{ versionId: string; version: number }> {
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ version: materialVersions.version })
      .from(materialVersions)
      .where(eq(materialVersions.materialId, materialId))
      .orderBy(desc(materialVersions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const [inserted] = await tx
      .insert(materialVersions)
      .values({ materialId, version, content, createdBy })
      .returning({ id: materialVersions.id });
    return { versionId: inserted!.id, version };
  });
}

/**
 * Публикация (Э9.8, §8 ТЗ `POST /materials/:id/publish`) — ОДНА и та же
 * операция и для первой публикации черновика, и для повторной публикации
 * форка поверх уже опубликованного: переставляет `currentVersionId` на
 * указанную версию, ставит `status='published'` (для форка — идемпотентно,
 * там он уже был `published`) И ТОЛЬКО ТЕПЕРЬ синхронизирует
 * денормализованный кэш из содержимого этой версии — момент, когда
 * библиотека наконец обязана показать новое название/предмет/классы.
 */
export async function publishVersion(materialId: string, versionId: string, content: Material): Promise<void> {
  await db
    .update(materials)
    .set({
      currentVersionId: versionId,
      status: "published",
      title: content.title,
      subject: content.subject,
      grades: content.grades,
      topic: content.topic ?? null,
      updatedAt: new Date(),
    })
    .where(eq(materials.id, materialId));
}

/** Флип статуса без изменения содержимого/версии (Э9.8: `submitForReview` draft→review, `returnToDraft` review→draft) — кэш `materials` не трогаем, содержимое не менялось. */
export async function setMaterialStatus(materialId: string, status: MaterialStatus): Promise<void> {
  await db.update(materials).set({ status }).where(eq(materials.id, materialId));
}

/** История версий (Э9.8, §8 ТЗ `GET /materials/:id/versions`) — без содержимого, только метаданные + какая версия сейчас опубликована. */
export interface MaterialVersionSummaryRow {
  versionId: string;
  version: number;
  createdBy: string;
  createdAt: Date;
  isCurrent: boolean;
}

export async function listMaterialVersions(schoolId: string, materialId: string): Promise<MaterialVersionSummaryRow[]> {
  const rows = await db
    .select({
      versionId: materialVersions.id,
      version: materialVersions.version,
      createdBy: materialVersions.createdBy,
      createdAt: materialVersions.createdAt,
      currentVersionId: materials.currentVersionId,
    })
    .from(materialVersions)
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .where(and(eq(materials.id, materialId), eq(materials.schoolId, schoolId)))
    .orderBy(desc(materialVersions.version));
  return rows.map((row) => ({
    versionId: row.versionId,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    isCurrent: row.versionId === row.currentVersionId,
  }));
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
