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
  type MaterialValidationIssue,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";
import { validateMaterial } from "./validation.js";

export { gradeResponse } from "./grading.js";
export { uploadMediaAsset, listMediaAssets, getMediaAssetUrl } from "./media-library.js";
export { importQuestionsFromDocument } from "./document-import.js";

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

/**
 * Опубликованная версия материала школы — то, что учитель запускает в
 * уроке (Э8.6). До Э9.8 это была буквально «последняя версия»; теперь —
 * версия по `materials.currentVersionId`, потому что поверх уже
 * опубликованного может копиться непубличный форк правок
 * (`updateMaterialDraft`/`publish` ниже) — учитель не должен получить
 * возможность выдать классу непроверенный черновик только потому, что у
 * него оказался БОЛЬШИЙ номер версии. Материал, который вообще никогда
 * не публиковался, — 404, как и отсутствующий: `findPublishedMaterialVersion`
 * не даст строк без `currentVersionId`.
 */
export async function getLatestMaterial(schoolId: string, materialId: string): Promise<LoadedMaterial> {
  const row = await repo.findPublishedMaterialVersion(schoolId, materialId);
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
  /** Это версия, которую сейчас видит школа (Э9.8, `materials.currentVersionId`)? См. `materialDetailSchema.isCurrent`, `packages/shared`. */
  isCurrent: boolean;
}

/**
 * Материал для редактора (Э9.2, §7.2 ТЗ «Редактор материала»). Видимость —
 * «личная папка» учителя (§4.2 ТЗ): свой материал — ЛЮБОЙ статус, ВСЕГДА
 * последняя версия (в т.ч. непубличный форк поверх публикации, который
 * сам ещё редактирует). Чужой материал — ТОЛЬКО опубликованная версия,
 * даже если у автора сейчас копится следующий форк (Э9.8: не важно, что
 * `findLatestMaterialVersionForEdit` для него уже вернула бы более новую
 * строку — чужому читателю её показывать нельзя, это чужая непроверенная
 * правка). admin/methodist — без ограничения, всегда последняя версия, им
 * и достаётся публикация/ревью. Отказ — 404, а не 403 (не подтверждаем
 * чужому учителю сам факт существования материала другого учителя).
 */
export async function getMaterialForEdit(
  user: AccessTokenPayload,
  materialId: string,
): Promise<EditableMaterial> {
  const latest = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!latest) throw new AppError(404, "material_not_found", "Материал не найден");

  if (user.role !== "teacher" || latest.createdBy === user.sub) {
    return { ...parseVersion(latest), status: latest.status, createdBy: latest.createdBy, isCurrent: latest.versionId === latest.currentVersionId };
  }

  const published = await repo.findPublishedMaterialVersionForEdit(user.schoolId, materialId);
  if (!published) throw new AppError(404, "material_not_found", "Материал не найден");
  return { ...parseVersion(published), status: "published", createdBy: published.createdBy, isCurrent: true };
}

/**
 * Правка материала (Э9.3 — автосохранение черновика; Э9.8 — распространено
 * на любой статус). Видимость на ЗАПИСЬ строже, чем на чтение
 * (`getMaterialForEdit`): учителю доступен только СВОЙ материал вне
 * зависимости от статуса (в отличие от чтения, где чужой опубликованный
 * виден) — «личная папка» (§4.2 ТЗ) это в первую очередь про запись, право
 * читать чужой опубликованный не даёт права его менять. admin/methodist —
 * без ограничения по владению, как и на чтение. Отказ по владению — 404
 * (тот же принцип, что и в `getMaterialForEdit`, не 403).
 *
 * Три ветки по статусу/наличию форка (§8 ТЗ «правка опубликованного
 * создаёт новую версию»):
 * 1. `draft`/`review` (никогда не публиковался) — мутируем единственную
 *    версию на месте, СИНХРОНИЗИРУЕМ кэш `materials` (библиотека сразу
 *    видит новый заголовок черновика).
 * 2. `published`, и `latest.versionId === currentVersionId` (это ПЕРВАЯ
 *    правка после публикации, форка ещё нет) — форкаем новую версию
 *    (`insertNewVersion`), кэш НЕ трогаем: школа продолжает видеть старое
 *    опубликованное содержимое, пока форк не опубликуют повторно.
 * 3. `published`, и версии РАЗНЫЕ (форк уже существует, правят его дальше
 *    — иначе каждый keystroke автосохранения плодил бы новую версию) —
 *    мутируем ЕГО на месте, кэш всё ещё не трогаем.
 */
export async function updateMaterialDraft(
  user: AccessTokenPayload,
  materialId: string,
  content: Material,
): Promise<void> {
  const row = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  if (user.role === "teacher" && row.createdBy !== user.sub) {
    throw new AppError(404, "material_not_found", "Материал не найден");
  }

  if (row.status !== "published") {
    await repo.updateDraftVersionContent(row.materialId, row.versionId, content, true);
    return;
  }
  if (row.versionId === row.currentVersionId) {
    await repo.insertNewVersion(row.materialId, content, user.sub);
    return;
  }
  await repo.updateDraftVersionContent(row.materialId, row.versionId, content, false);
}

/**
 * draft → review (Э9.8, задел под §8 ТЗ — сам ТЗ называет только
 * `POST /materials/:id/publish`, но без явного шага «отправить на ревью»
 * статус `review` был бы недостижим: `materialStatusSchema` описывает его
 * как «отдан на ревью методисту/админу», значит нужно действие, которое
 * туда переводит). Права — как у `updateMaterialDraft` (владение), не как
 * у `publish` ниже: отправить свой черновик на ревью может и сам автор.
 */
export async function submitForReview(user: AccessTokenPayload, materialId: string): Promise<MaterialStatus> {
  const row = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  if (user.role === "teacher" && row.createdBy !== user.sub) {
    throw new AppError(404, "material_not_found", "Материал не найден");
  }
  if (row.status !== "draft") {
    throw new AppError(409, "material_not_draft", "На ревью можно отправить только черновик");
  }
  await repo.setMaterialStatus(row.materialId, "review");
  return "review";
}

/**
 * review → draft (Э9.8) — решение РЕВЬЮЕРА (методист/админ), не самого
 * автора: в отличие от `submitForReview`, здесь роль жёстко ограничена —
 * учитель не может сам себе «одобрить» возврат, только тот, кто и
 * публикует. 404 на чужой/несуществующий материал (та же видимость, что у
 * `publish` ниже), 403 — отдельно, если это ВООБЩЕ учитель (не про
 * конкретный материал, про роль целиком, как в `createHomeworkActivity`
 * у activities).
 */
export async function returnToDraft(user: AccessTokenPayload, materialId: string): Promise<MaterialStatus> {
  if (user.role === "teacher") {
    throw new AppError(403, "forbidden", "Вернуть материал из ревью может только методист/администратор");
  }
  const row = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  if (row.status !== "review") {
    throw new AppError(409, "material_not_in_review", "Материал не на ревью");
  }
  await repo.setMaterialStatus(row.materialId, "draft");
  return "draft";
}

/**
 * Публикация (Э9.8, §8 ТЗ `POST /materials/:id/publish` → «новая версия» —
 * в ответе, не обязательно новая СТРОКА: если версия уже была форкнута
 * предыдущей правкой (`updateMaterialDraft`), публикация просто
 * переставляет указатель на неё). ОДНА и та же операция для первой
 * публикации черновика И для повторной публикации форка поверх уже
 * опубликованного — различий в коде между этими случаями нет, кроме
 * проверки «есть ли вообще что публиковать» (`versionId === currentVersionId`
 * → 409, нечего). Роль — ТОЛЬКО admin/methodist (§4.2 ТЗ: учитель никогда
 * не публикует, даже свой материал) — 403 на учителя целиком, не 404: это
 * не вопрос видимости конкретного материала.
 *
 * Валидатор (Э9.9, §7.2 ТЗ «Валидация: перед публикацией…») запускается
 * ЗДЕСЬ, на сервере, не только в UI редактора — это defense in depth
 * (CLAUDE.md, «правь корень, а не обходи»): фронт может (и должен) не
 * дать нажать «Опубликовать» при известных проблемах, но именно этот
 * вызов — граница, которую нельзя обойти прямым запросом к API.
 */
export async function publish(
  user: AccessTokenPayload,
  materialId: string,
): Promise<{ version: number; versionId: string }> {
  if (user.role === "teacher") {
    throw new AppError(403, "forbidden", "Публиковать материалы может только методист/администратор");
  }
  const row = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  if (row.versionId === row.currentVersionId) {
    throw new AppError(409, "nothing_to_publish", "Нет новых изменений для публикации");
  }
  const { material } = parseVersion(row);
  const issues = await validateMaterial(user.schoolId, material);
  if (issues.length > 0) {
    throw new AppError(
      409,
      "material_invalid",
      `Материал не прошёл валидацию (проблем: ${issues.length}) — откройте вкладку «Валидация»`,
    );
  }
  await repo.publishVersion(row.materialId, row.versionId, material);
  return { version: row.version, versionId: row.versionId };
}

/**
 * Отдельный запрос списка проблем (Э9.9, §7.2 ТЗ, экран «Валидация») —
 * чтобы редактор мог показать их ДО попытки публикации, не только через
 * отказ `publish` выше. Видимость — ТА ЖЕ, что у чтения материала для
 * редактора (`getMaterialForEdit`): валидность — атрибут содержимого,
 * которое пользователь и так имеет право видеть, отдельного ограничения
 * не требует.
 */
export async function validateMaterialForEdit(
  user: AccessTokenPayload,
  materialId: string,
): Promise<MaterialValidationIssue[]> {
  const loaded = await getMaterialForEdit(user, materialId);
  return validateMaterial(user.schoolId, loaded.material);
}

/**
 * История версий (Э9.8, §8 ТЗ `GET /materials/:id/versions`). Видимость —
 * ТА ЖЕ, что у права РЕДАКТИРОВАТЬ (`updateMaterialDraft`), не у права
 * читать текущее содержимое (`getMaterialForEdit`): версии — рабочий
 * инструмент того, кто материалом управляет (свой автор или admin/
 * methodist), а не то, что нужно стороннему читателю чужого опубликованного.
 */
export async function listMaterialVersions(
  user: AccessTokenPayload,
  materialId: string,
): Promise<repo.MaterialVersionSummaryRow[]> {
  const row = await repo.findLatestMaterialVersionForEdit(user.schoolId, materialId);
  if (!row) throw new AppError(404, "material_not_found", "Материал не найден");
  if (user.role === "teacher" && row.createdBy !== user.sub) {
    throw new AppError(404, "material_not_found", "Материал не найден");
  }
  return repo.listMaterialVersions(user.schoolId, materialId);
}

/**
 * Создание нового материала (Э9.10, §8 ТЗ `POST /materials`) — задел на
 * шаблоны/пустой материал (§7.1 ТЗ п.5 «методист не начинает с чистого
 * листа»): фронт уже присылает валидный `Material` целиком (шаблон
 * собран на клиенте, `material-templates.ts`), здесь только владение —
 * `createdBy = user.sub` ВСЕГДА, роль не влияет на то, чьим он станет
 * (учитель, admin, methodist — каждый заводит материал в СВОЕЙ личной
 * папке, §4.2 ТЗ). Статус всегда `draft`, что бы ни было в присланном
 * содержимом — `materialSchema` вообще не несёт поля статуса, оно
 * атрибут таблицы `materials`, не JSON-содержимого версии.
 */
export async function createMaterial(
  user: AccessTokenPayload,
  content: Material,
): Promise<{ materialId: string; versionId: string }> {
  return repo.insertMaterial(user.schoolId, user.sub, content);
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
