import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload, Material } from "@school/shared";

const { repoMock, validationMock, schoolSettingsMock } = vi.hoisted(() => ({
  schoolSettingsMock: { getPlatformSchool: vi.fn(), getSchoolName: vi.fn() },
  repoMock: {
    findPublishedMaterialVersion: vi.fn(),
    findMaterialSummariesByIds: vi.fn(),
    listMaterials: vi.fn(),
    findLatestMaterialVersionForEdit: vi.fn(),
    findPublishedMaterialVersionForEdit: vi.fn(),
    updateDraftVersionContent: vi.fn(),
    insertNewVersion: vi.fn(),
    insertMaterial: vi.fn(),
    publishVersion: vi.fn(),
    setMaterialStatus: vi.fn(),
    listMaterialVersions: vi.fn(),
    findMaterialVersionById: vi.fn(),
  },
  validationMock: { validateMaterial: vi.fn() },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("./validation.js", () => validationMock);
vi.mock("../school-settings/service.js", () => schoolSettingsMock);

const {
  listMaterials,
  getMaterialForEdit,
  updateMaterialDraft,
  submitForReview,
  returnToDraft,
  publish,
  listMaterialVersions,
  validateMaterialForEdit,
  createMaterial,
  getMaterialVersion,
  getLatestMaterial,
  getMaterialSummaries,
  assertMaterialInSchool,
  listMaterialSources,
} = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const TEACHER: AccessTokenPayload = { sub: "22222222-2222-2222-2222-222222222222", schoolId: SCHOOL, role: "teacher" };
const ADMIN: AccessTokenPayload = { sub: "33333333-3333-3333-3333-333333333333", schoolId: SCHOOL, role: "admin" };
const METHODIST: AccessTokenPayload = {
  sub: "44444444-4444-4444-4444-444444444444",
  schoolId: SCHOOL,
  role: "methodist",
};

describe("listMaterials (Э9.1, §7.2/§4.2 ТЗ: библиотека, «личная папка» учителя)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMock.listMaterials.mockResolvedValueOnce([]);
  });

  it("учителю (ревизия Э12.7) — в библиотеке только опубликованные материалы", async () => {
    await listMaterials(TEACHER, { status: "draft" });
    expect(repoMock.listMaterials).toHaveBeenCalledWith(
      SCHOOL,
      expect.objectContaining({ status: "published", restrictToOwnerOrPublished: undefined }),
    );
  });

  it.each([
    ["admin", ADMIN],
    ["methodist", METHODIST],
  ] as const)("%s — без ограничения (видит всю библиотеку школы)", async (_label, user) => {
    await listMaterials(user, {});
    expect(repoMock.listMaterials).toHaveBeenCalledWith(
      SCHOOL,
      expect.objectContaining({ restrictToOwnerOrPublished: undefined }),
    );
  });

  it("прокидывает фильтры из query как есть", async () => {
    await listMaterials(ADMIN, { subject: "математика", grade: 8, topic: "Уравнения", q: "квадрат", status: "draft" });
    expect(repoMock.listMaterials).toHaveBeenCalledWith(SCHOOL, {
      subject: "математика",
      grade: 8,
      topic: "Уравнения",
      q: "квадрат",
      status: "draft",
      restrictToOwnerOrPublished: undefined,
    });
  });
});

const VALID_CONTENT: Material = {
  id: "m1",
  schemaVersion: 1,
  title: "Материал",
  subject: "математика",
  grades: [8],
  tags: [],
  groups: [],
  settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1, layout: "slides" },
  blocks: [],
};

/**
 * `versionId`/`currentVersionId` РАВНЫ по умолчанию — «версия уже
 * опубликована, форка над ней нет» (актуально только когда `status:
 * "published""; при `draft`/`review` `currentVersionId` обычно `null`
 * — передавайте явно в тестах, где это важно).
 */
function materialRow(
  overrides: Partial<{
    status: "draft" | "review" | "published";
    createdBy: string;
    versionId: string;
    currentVersionId: string | null;
    version: number;
  }> = {},
) {
  return {
    materialId: "m1",
    schoolId: SCHOOL,
    versionId: "v1",
    version: 1,
    content: VALID_CONTENT,
    status: "draft" as const,
    createdBy: TEACHER.sub,
    currentVersionId: null as string | null,
    ...overrides,
  };
}

describe("createMaterial (Э9.10, §8 ТЗ: POST /materials)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["admin", ADMIN],
    ["methodist", METHODIST],
  ] as const)("%s — становится владельцем (createdBy = свой sub)", async (_label, user) => {
    repoMock.insertMaterial.mockResolvedValueOnce({ materialId: "new-m", versionId: "new-v" });
    const result = await createMaterial(user, VALID_CONTENT);
    expect(repoMock.insertMaterial).toHaveBeenCalledWith(SCHOOL, user.sub, VALID_CONTENT);
    expect(result).toEqual({ materialId: "new-m", versionId: "new-v" });
  });

  it("учитель — 403 (ревизия Э12.7: материалы создаёт только admin/methodist)", async () => {
    await expect(createMaterial(TEACHER, VALID_CONTENT)).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.insertMaterial).not.toHaveBeenCalled();
  });
});

describe("getMaterialForEdit (Э9.2/9.8, §7.2 ТЗ: редактор материала)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("404, если материала нет вовсе", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(getMaterialForEdit(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("учителю (ревизия Э12.7) — ВСЕГДА опубликованная версия, даже если latest — чужой черновик", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: TEACHER.sub, status: "draft", versionId: "v2", currentVersionId: "v1" }),
    );
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ status: "published", versionId: "v1", currentVersionId: "v1" }),
    );
    const result = await getMaterialForEdit(TEACHER, "m1");
    expect(result).toMatchObject({ status: "published", versionId: "v1", isCurrent: true });
  });

  it("учителю — 404, если опубликованной версии нет вовсе", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "draft" }),
    );
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(getMaterialForEdit(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("учителю — доступен чужой ОПУБЛИКОВАННЫЙ материал (по currentVersionId, не по последней версии)", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "published", versionId: "v1", currentVersionId: "v1" }),
    );
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "published", versionId: "v1", currentVersionId: "v1" }),
    );
    const result = await getMaterialForEdit(TEACHER, "m1");
    expect(result).toMatchObject({ status: "published", isCurrent: true });
  });

  it("учителю — чужой материал с форком поверх публикации: видит ОПУБЛИКОВАННУЮ версию, не чужой форк", async () => {
    // «latest» — новый непубличный форк (v2) чужого автора; сервис не должен отдать его чужому учителю.
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "published", versionId: "v2", currentVersionId: "v1", version: 2 }),
    );
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "published", versionId: "v1", currentVersionId: "v1", version: 1 }),
    );
    const result = await getMaterialForEdit(TEACHER, "m1");
    expect(result).toMatchObject({ versionId: "v1", version: 1, isCurrent: true });
  });

  it("учителю — 404, если у чужого материала вообще нет опубликованной версии", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "review" }),
    );
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(getMaterialForEdit(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([
    ["admin", ADMIN],
    ["methodist", METHODIST],
  ] as const)("%s — доступен любой чужой черновик, без похода за отдельно опубликованной версией", async (_label, user) => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "draft" }),
    );
    const result = await getMaterialForEdit(user, "m1");
    expect(result.createdBy).toBe("someone-else");
    expect(repoMock.findPublishedMaterialVersionForEdit).not.toHaveBeenCalled();
  });
});

describe("updateMaterialDraft (Э9.3/9.8, §8 ТЗ: PUT /materials/:id)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("404, если материала нет вовсе", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(updateMaterialDraft(ADMIN, "m1", VALID_CONTENT)).rejects.toMatchObject({ statusCode: 404 });
    expect(repoMock.updateDraftVersionContent).not.toHaveBeenCalled();
    expect(repoMock.insertNewVersion).not.toHaveBeenCalled();
  });

  it("учитель — 403 (ревизия Э12.7: материалы правит только admin/methodist)", async () => {
    await expect(updateMaterialDraft(TEACHER, "m1", VALID_CONTENT)).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.findLatestMaterialVersionForEdit).not.toHaveBeenCalled();
    expect(repoMock.updateDraftVersionContent).not.toHaveBeenCalled();
  });

  it("черновик (никогда не публиковался) — мутирует на месте, синхронизирует кэш", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: ADMIN.sub, status: "draft" }),
    );
    await updateMaterialDraft(ADMIN, "m1", VALID_CONTENT);
    expect(repoMock.updateDraftVersionContent).toHaveBeenCalledWith("m1", "v1", VALID_CONTENT, true);
    expect(repoMock.insertNewVersion).not.toHaveBeenCalled();
  });

  it("на ревью (никогда не публиковался) — тоже мутирует на месте, синхронизирует кэш", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: ADMIN.sub, status: "review" }),
    );
    await updateMaterialDraft(ADMIN, "m1", VALID_CONTENT);
    expect(repoMock.updateDraftVersionContent).toHaveBeenCalledWith("m1", "v1", VALID_CONTENT, true);
  });

  it("опубликован, форка ЕЩЁ НЕТ (versionId === currentVersionId) — форкает новую версию, кэш НЕ трогает", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: ADMIN.sub, status: "published", versionId: "v1", currentVersionId: "v1" }),
    );
    await updateMaterialDraft(ADMIN, "m1", VALID_CONTENT);
    expect(repoMock.insertNewVersion).toHaveBeenCalledWith("m1", VALID_CONTENT, ADMIN.sub);
    expect(repoMock.updateDraftVersionContent).not.toHaveBeenCalled();
  });

  it("опубликован, форк УЖЕ ЕСТЬ (versionId !== currentVersionId) — мутирует форк на месте, кэш НЕ трогает", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: ADMIN.sub, status: "published", versionId: "v2", currentVersionId: "v1" }),
    );
    await updateMaterialDraft(ADMIN, "m1", VALID_CONTENT);
    expect(repoMock.updateDraftVersionContent).toHaveBeenCalledWith("m1", "v2", VALID_CONTENT, false);
    expect(repoMock.insertNewVersion).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", ADMIN],
    ["methodist", METHODIST],
  ] as const)("%s — правит чужой черновик так же, как свой", async (_label, user) => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "draft" }),
    );
    await updateMaterialDraft(user, "m1", VALID_CONTENT);
    expect(repoMock.updateDraftVersionContent).toHaveBeenCalledWith("m1", "v1", VALID_CONTENT, true);
  });
});

describe("submitForReview (Э9.8, draft → review)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 на несуществующий материал", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(submitForReview(ADMIN, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409, если материал не в статусе draft", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: ADMIN.sub, status: "review" }),
    );
    await expect(submitForReview(ADMIN, "m1")).rejects.toMatchObject({ statusCode: 409 });
    expect(repoMock.setMaterialStatus).not.toHaveBeenCalled();
  });

  it("методист/админ отправляет черновик на ревью", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: METHODIST.sub, status: "draft" }),
    );
    const result = await submitForReview(METHODIST, "m1");
    expect(result).toBe("review");
    expect(repoMock.setMaterialStatus).toHaveBeenCalledWith("m1", "review");
  });

  it("учитель — 403, до похода в БД (ревизия Э12.7)", async () => {
    await expect(submitForReview(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.findLatestMaterialVersionForEdit).not.toHaveBeenCalled();
  });
});

describe("returnToDraft (Э9.8, review → draft, решение ревьюера)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("403 учителю целиком, до похода в БД", async () => {
    await expect(returnToDraft(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.findLatestMaterialVersionForEdit).not.toHaveBeenCalled();
  });

  it("404 на несуществующий материал", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(returnToDraft(ADMIN, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409, если материал не на ревью", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(materialRow({ status: "draft" }));
    await expect(returnToDraft(METHODIST, "m1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("методист/админ возвращает материал на ревью в черновик", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(materialRow({ status: "review" }));
    const result = await returnToDraft(METHODIST, "m1");
    expect(result).toBe("draft");
    expect(repoMock.setMaterialStatus).toHaveBeenCalledWith("m1", "draft");
  });
});

describe("publish (Э9.8, §8 ТЗ: POST /materials/:id/publish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validationMock.validateMaterial.mockResolvedValue([]);
  });

  it("409 и НЕ публикует, если валидатор нашёл проблемы (Э9.9, defense in depth)", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ status: "draft", versionId: "v1", currentVersionId: null, version: 1 }),
    );
    validationMock.validateMaterial.mockResolvedValueOnce([
      { blockId: null, code: "material_empty", message: "В материале нет ни одного блока" },
    ]);
    await expect(publish(METHODIST, "m1")).rejects.toMatchObject({ statusCode: 409, code: "material_invalid" });
    expect(repoMock.publishVersion).not.toHaveBeenCalled();
  });

  it("403 учителю целиком, до похода в БД", async () => {
    await expect(publish(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.findLatestMaterialVersionForEdit).not.toHaveBeenCalled();
  });

  it("404 на несуществующий материал", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(publish(ADMIN, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409, если нечего публиковать (versionId === currentVersionId)", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ status: "published", versionId: "v1", currentVersionId: "v1" }),
    );
    await expect(publish(METHODIST, "m1")).rejects.toMatchObject({ statusCode: 409 });
    expect(repoMock.publishVersion).not.toHaveBeenCalled();
  });

  it("первая публикация черновика", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ status: "draft", versionId: "v1", currentVersionId: null, version: 1 }),
    );
    const result = await publish(METHODIST, "m1");
    expect(result).toEqual({ version: 1, versionId: "v1" });
    expect(repoMock.publishVersion).toHaveBeenCalledWith("m1", "v1", VALID_CONTENT);
  });

  it("публикация форка поверх уже опубликованного (та же операция)", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ status: "published", versionId: "v2", currentVersionId: "v1", version: 2 }),
    );
    const result = await publish(ADMIN, "m1");
    expect(result).toEqual({ version: 2, versionId: "v2" });
    expect(repoMock.publishVersion).toHaveBeenCalledWith("m1", "v2", VALID_CONTENT);
  });
});

describe("listMaterialVersions (Э9.8, §8 ТЗ: GET /materials/:id/versions)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 на несуществующий материал", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(listMaterialVersions(ADMIN, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("учителю — 404 на чужой материал (история версий — не для стороннего читателя)", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(materialRow({ createdBy: "someone-else" }));
    await expect(listMaterialVersions(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("владельцу — список версий из репозитория как есть", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(materialRow({ createdBy: ADMIN.sub }));
    repoMock.listMaterialVersions.mockResolvedValueOnce([]);
    await listMaterialVersions(ADMIN, "m1");
    expect(repoMock.listMaterialVersions).toHaveBeenCalledWith(SCHOOL, "m1");
  });
});

describe("validateMaterialForEdit (Э9.9, §7.2 ТЗ: экран «Валидация»)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("видимость — та же, что у getMaterialForEdit: 404 на чужой черновик", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ createdBy: "someone-else", status: "draft" }),
    );
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(validateMaterialForEdit(TEACHER, "m1")).rejects.toMatchObject({ statusCode: 404 });
    expect(validationMock.validateMaterial).not.toHaveBeenCalled();
  });

  it("прокидывает schoolId и содержимое загруженной версии в validateMaterial, возвращает её результат как есть", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(materialRow({ createdBy: ADMIN.sub }));
    const issues = [{ blockId: "q1", code: "zero_points" as const, message: "За вопрос начисляется 0 баллов" }];
    validationMock.validateMaterial.mockResolvedValueOnce(issues);
    const result = await validateMaterialForEdit(ADMIN, "m1");
    expect(validationMock.validateMaterial).toHaveBeenCalledWith(SCHOOL, VALID_CONTENT);
    expect(result).toBe(issues);
  });
});

describe("кеш версий материала на уроке", () => {
  beforeEach(() => vi.clearAllMocks());

  it("повторное чтение той же версии не ходит в БД", async () => {
    repoMock.findMaterialVersionById.mockResolvedValue(materialRow({ versionId: "cache-v1" }));

    await getMaterialVersion("cache-v1");
    await getMaterialVersion("cache-v1");

    expect(repoMock.findMaterialVersionById).toHaveBeenCalledTimes(1);
  });

  it("мутация полученного объекта не портит кеш", async () => {
    repoMock.findMaterialVersionById.mockResolvedValue(materialRow({ versionId: "cache-v2" }));

    const first = await getMaterialVersion("cache-v2");
    first.material.title = "испорчено";

    expect((await getMaterialVersion("cache-v2")).material.title).toBe("Материал");
  });

  it("автосохранение черновика сбрасывает запись — дальше читается новое содержимое", async () => {
    repoMock.findMaterialVersionById.mockResolvedValueOnce(
      materialRow({ versionId: "cache-v3", status: "draft", createdBy: ADMIN.sub }),
    );
    await getMaterialVersion("cache-v3");
    const edited = { ...VALID_CONTENT, title: "Новый заголовок" };
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(
      materialRow({ versionId: "cache-v3", status: "draft", createdBy: ADMIN.sub }),
    );
    await updateMaterialDraft(ADMIN, "m1", edited);
    repoMock.findMaterialVersionById.mockResolvedValueOnce({
      ...materialRow({ versionId: "cache-v3", status: "draft", createdBy: ADMIN.sub }),
      content: edited,
    });

    expect((await getMaterialVersion("cache-v3")).material.title).toBe("Новый заголовок");
  });
});

// ─── Материалы сервиса «Матис» (служебное пространство kind = 'platform') ────

describe("материалы «Матис»: чтение для всех пространств, запись — только своим", () => {
  const PLATFORM = "99999999-9999-9999-9999-999999999999";
  const PLATFORM_ADMIN: AccessTokenPayload = { sub: "88888888-8888-8888-8888-888888888888", schoolId: PLATFORM, role: "admin" };

  function versionRow(overrides: Record<string, unknown> = {}) {
    return {
      materialId: "pm1",
      versionId: "pv1",
      version: 1,
      content: VALID_CONTENT,
      status: "published",
      createdBy: PLATFORM_ADMIN.sub,
      currentVersionId: "pv1",
      ...overrides,
    };
  }
  function summary(id: string, status: "draft" | "review" | "published") {
    return { id, title: id, subject: "алгебра", grades: [8], topic: null, status, createdBy: "x", createdAt: new Date(), updatedAt: new Date() };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    schoolSettingsMock.getPlatformSchool.mockResolvedValue({ id: PLATFORM, name: "Матис" });
  });

  it("список source=platform — только опубликованное служебного пространства, для любой роли", async () => {
    repoMock.listMaterials.mockResolvedValueOnce([]);
    await listMaterials(ADMIN, { source: "platform", status: "draft" });
    expect(repoMock.listMaterials).toHaveBeenCalledWith(PLATFORM, expect.objectContaining({ status: "published" }));
  });

  it("список source=platform без служебного пространства — пусто, в БД не ходим", async () => {
    schoolSettingsMock.getPlatformSchool.mockResolvedValueOnce(null);
    expect(await listMaterials(TEACHER, { source: "platform" })).toEqual([]);
    expect(repoMock.listMaterials).not.toHaveBeenCalled();
  });

  it("просмотр: не своей школы — опубликованная версия Матиса, только чтение", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(versionRow());
    const loaded = await getMaterialForEdit(ADMIN, "pm1");
    expect(repoMock.findPublishedMaterialVersionForEdit).toHaveBeenCalledWith(PLATFORM, "pm1");
    expect(loaded).toMatchObject({ status: "published", isCurrent: true });
  });

  it("просмотр: черновик Матиса (нет опубликованной версии) — 404", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValueOnce(null);
    repoMock.findPublishedMaterialVersionForEdit.mockResolvedValueOnce(null);
    await expect(getMaterialForEdit(TEACHER, "pm-draft")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("правка/публикация/версии материала Матиса чужим админом — 404: запись ищет строго в своей школе", async () => {
    repoMock.findLatestMaterialVersionForEdit.mockResolvedValue(null);
    const content = VALID_CONTENT;
    await expect(updateMaterialDraft(ADMIN, "pm1", content)).rejects.toMatchObject({ statusCode: 404 });
    await expect(publish(ADMIN, "pm1")).rejects.toMatchObject({ statusCode: 404 });
    await expect(listMaterialVersions(ADMIN, "pm1")).rejects.toMatchObject({ statusCode: 404 });
    for (const call of repoMock.findLatestMaterialVersionForEdit.mock.calls) expect(call[0]).toBe(SCHOOL);
    repoMock.findLatestMaterialVersionForEdit.mockReset();
  });

  it("запуск задания: опубликованная версия Матиса, если в своей школе материала нет", async () => {
    repoMock.findPublishedMaterialVersion.mockResolvedValueOnce(null).mockResolvedValueOnce(versionRow());
    const loaded = await getLatestMaterial(SCHOOL, "pm1");
    expect(repoMock.findPublishedMaterialVersion).toHaveBeenNthCalledWith(2, PLATFORM, "pm1");
    expect(loaded.versionId).toBe("pv1");
  });

  it("материалы урока: свои — любые, Матиса — только опубликованные", async () => {
    repoMock.findMaterialSummariesByIds
      .mockResolvedValueOnce([summary("own", "draft")])
      .mockResolvedValueOnce([summary("p-pub", "published"), summary("p-draft", "draft")]);
    const rows = await getMaterialSummaries(SCHOOL, ["own", "p-pub", "p-draft"]);
    expect(repoMock.findMaterialSummariesByIds).toHaveBeenNthCalledWith(2, PLATFORM, ["p-pub", "p-draft"]);
    expect(rows.map((r) => r.id)).toEqual(["own", "p-pub"]);
  });

  it("назначение на урок черновика Матиса — 404", async () => {
    repoMock.findMaterialSummariesByIds.mockResolvedValueOnce([]).mockResolvedValueOnce([summary("p-draft", "draft")]);
    await expect(assertMaterialInSchool(SCHOOL, "p-draft")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("для самого служебного пространства Матис не «чужой»: второй раз в БД не ходим", async () => {
    repoMock.findPublishedMaterialVersion.mockResolvedValueOnce(null);
    await expect(getLatestMaterial(PLATFORM, "nope")).rejects.toMatchObject({ statusCode: 404 });
    expect(repoMock.findPublishedMaterialVersion).toHaveBeenCalledTimes(1);
  });

  it("вкладки: «Матис» + своё пространство, если там есть видимые материалы", async () => {
    repoMock.listMaterials.mockResolvedValueOnce([summary("p1", "published")]).mockResolvedValueOnce([summary("o1", "published")]);
    schoolSettingsMock.getSchoolName.mockResolvedValueOnce("Лицей №1");
    const res = await listMaterialSources(TEACHER);
    expect(res.items).toEqual([
      { source: "platform", label: "Матис", count: 1 },
      { source: "school", label: "Лицей №1", count: 1 },
    ]);
  });

  it("вкладки: своё пространство без материалов — вкладки нет", async () => {
    repoMock.listMaterials.mockResolvedValueOnce([summary("p1", "published")]).mockResolvedValueOnce([]);
    const res = await listMaterialSources(TEACHER);
    expect(res.items.map((i) => i.source)).toEqual(["platform"]);
  });
});
