import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assetUrlSchema,
  createMaterialResultSchema,
  importedQuestionsResultSchema,
  listMaterialsQuerySchema,
  listMediaAssetsQuerySchema,
  materialDetailSchema,
  materialSchema,
  materialStatusResultSchema,
  materialSummarySchema,
  materialValidationIssueSchema,
  materialVersionSummarySchema,
  mediaAssetSchema,
  publishMaterialResultSchema,
  updateMaterialResultSchema,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { UPLOAD_LIMITS, withBufferedUpload } from "../../plugins/uploads.js";
import * as materialsService from "./service.js";

const uuidParam = z.string().uuid();

/**
 * Библиотека материалов (Э9.1, §7.2/§8 ТЗ; ревизия Э12.7).
 * Создают и редактируют материалы ТОЛЬКО admin/methodist. Учитель —
 * читатель: смотрит библиотеку (опубликованные), открывает материал на
 * просмотр в ЛК и выбирает его для урока (`/lessons/:id/materials`). Ученик
 * библиотеку не листает вовсе — материал доходит через выдачу (`activities`).
 */
export default async function materialsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  // admin/methodist — авторы (создают/правят/публикуют).
  const authorOnly = { preHandler: app.requireRole("admin", "methodist") };
  // + учитель на чтение (библиотека, просмотр материала).
  const anyStaff = { preHandler: app.requireRole("admin", "methodist", "teacher") };

  app.get("/materials", anyStaff, async (request, reply) => {
      const query = listMaterialsQuerySchema.parse(request.query);
      const rows = await materialsService.listMaterials(request.user, query);
      const items = rows.map((row) =>
        materialSummarySchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      );
      return reply.send({ items });
    },
  );

  // Создание материала (Э9.10, §8 ТЗ) — задел на шаблоны/пустой материал;
  // тело — валидный `Material` целиком (тот же контракт, что и PUT ниже).
  app.post("/materials", authorOnly, async (request, reply) => {
    const content = materialSchema.parse(request.body);
    const result = await materialsService.createMaterial(request.user, content);
    return reply.status(201).send(createMaterialResultSchema.parse({ materialId: result.materialId }));
  });

  app.get<{ Params: { id: string } }>(
    "/materials/:id",
    anyStaff,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const loaded = await materialsService.getMaterialForEdit(request.user, parsed.data);
      return reply.send(
        materialDetailSchema.parse({
          materialId: loaded.materialId,
          versionId: loaded.versionId,
          version: loaded.version,
          status: loaded.status,
          createdBy: loaded.createdBy,
          material: loaded.material,
          isCurrent: loaded.isCurrent,
        }),
      );
    },
  );

  app.put<{ Params: { id: string } }>(
    "/materials/:id",
    authorOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const content = materialSchema.parse(request.body);
      await materialsService.updateMaterialDraft(request.user, parsed.data, content);
      return reply.send(updateMaterialResultSchema.parse({ savedAt: new Date().toISOString() }));
    },
  );

  // Версионирование и публикация (Э9.8, §8 ТЗ).
  app.post<{ Params: { id: string } }>(
    "/materials/:id/submit-review",
    authorOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const status = await materialsService.submitForReview(request.user, parsed.data);
      return reply.send(materialStatusResultSchema.parse({ status }));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/materials/:id/return-to-draft",
    authorOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const status = await materialsService.returnToDraft(request.user, parsed.data);
      return reply.send(materialStatusResultSchema.parse({ status }));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/materials/:id/publish",
    authorOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const result = await materialsService.publish(request.user, parsed.data);
      return reply.send(publishMaterialResultSchema.parse(result));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/materials/:id/versions",
    anyStaff,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const rows = await materialsService.listMaterialVersions(request.user, parsed.data);
      const items = rows.map((row) => materialVersionSummarySchema.parse({ ...row, createdAt: row.createdAt.toISOString() }));
      return reply.send({ items });
    },
  );

  // Валидатор перед публикацией (Э9.9, §7.2 ТЗ «Валидация»).
  app.get<{ Params: { id: string } }>(
    "/materials/:id/validate",
    authorOnly,
    async (request, reply) => {
      const parsed = uuidParam.safeParse(request.params.id);
      if (!parsed.success) throw new AppError(400, "bad_material_id", "Некорректный идентификатор материала");
      const issues = await materialsService.validateMaterialForEdit(request.user, parsed.data);
      return reply.send({ items: issues.map((issue) => materialValidationIssueSchema.parse(issue)) });
    },
  );

  // Полуавтоматический импорт из Word/PDF (Э9.11, §7 ТЗ) — та же видимость,
  // что у создания/правки материала: чистое преобразование «файл → блоки»,
  // не привязано к конкретному materialId (методист добавляет полученные
  // блоки в открытый в редакторе черновик отдельным действием на клиенте).
  app.post(
    "/materials/import",
    authorOnly,
    async (request, reply) => {
      const result = await withBufferedUpload(request, UPLOAD_LIMITS.documentImport, (file) =>
        materialsService.importQuestionsFromDocument(file.buffer, file.mimetype),
      );
      return reply.send(importedQuestionsResultSchema.parse(result));
    },
  );

  // Медиатека (Э9.7) — та же видимость роли, что и у остальной библиотеки материалов;
  // без ограничения по загрузившему: смысл в переиспользовании МЕЖДУ авторами.
  app.get("/materials/media", authorOnly, async (request, reply) => {
    const query = listMediaAssetsQuerySchema.parse(request.query);
    const items = await materialsService.listMediaAssets(request.user.schoolId, query.kind);
    return reply.send({ items: items.map((item) => mediaAssetSchema.parse(item)) });
  });

  app.post(
    "/materials/media",
    authorOnly,
    async (request, reply) => {
      const asset = await withBufferedUpload(request, UPLOAD_LIMITS.mediaAsset, (file) =>
        materialsService.uploadMediaAsset({
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalName: file.filename,
          schoolId: request.user.schoolId,
          uploadedBy: request.user.sub,
        }),
      );
      return reply.send(mediaAssetSchema.parse(asset));
    },
  );

  // §8 ТЗ: `GET /assets/:id/url` — БЕЗ requireRole (в отличие от /materials/media
  // выше): блок image/audio внутри материала виден и ученику (через выдачу,
  // Э8.6), значит и ссылку на файл ученик должен уметь получить — только
  // базовая аутентификация, доступ к самому материалу проверен раньше в цепочке.
  app.get<{ Params: { id: string } }>("/assets/:id/url", async (request, reply) => {
    const parsed = uuidParam.safeParse(request.params.id);
    if (!parsed.success) throw new AppError(400, "bad_asset_id", "Некорректный идентификатор файла");
    const url = await materialsService.getMediaAssetUrl(request.user.schoolId, parsed.data);
    return reply.send(assetUrlSchema.parse({ url }));
  });
}
