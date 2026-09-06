import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Material } from "@school/shared";

const { mediaRepoMock } = vi.hoisted(() => ({
  mediaRepoMock: { findMediaAssetsByIds: vi.fn() },
}));

vi.mock("./media-repo.js", () => mediaRepoMock);

const { checkBrokenAssets, validateMaterial } = await import("./validation.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";

function materialWith(blocks: Material["blocks"]): Material {
  return {
    id: "m1",
    schemaVersion: 1,
    title: "Материал",
    subject: "математика",
    grades: [8],
    tags: [],
    groups: [],
    settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1 },
    blocks,
  };
}

function assetRow(overrides: Partial<{ id: string; kind: "image" | "audio" }> = {}) {
  return {
    id: "asset-1",
    schoolId: SCHOOL,
    uploadedBy: "u1",
    kind: "image" as const,
    originalName: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    storageKey: `${SCHOOL}/photo.jpg`,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("checkBrokenAssets (Э9.9, §7.2 ТЗ: «битые картинки»)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("материал без image/audio блоков — не ходит в БД вовсе", async () => {
    const issues = await checkBrokenAssets(SCHOOL, materialWith([{ type: "rich_text", id: "b1", html: "<p>ok</p>" }]));
    expect(issues).toEqual([]);
    expect(mediaRepoMock.findMediaAssetsByIds).not.toHaveBeenCalled();
  });

  it("assetId не найден в медиатеке — broken_asset", async () => {
    mediaRepoMock.findMediaAssetsByIds.mockResolvedValueOnce([]);
    const issues = await checkBrokenAssets(
      SCHOOL,
      materialWith([{ type: "image", id: "b1", assetId: "missing", zoomable: false }]),
    );
    expect(issues).toEqual([{ blockId: "b1", code: "broken_asset", message: expect.any(String) }]);
  });

  it("assetId найден, но другого типа (аудио вставлено в image-блок) — broken_asset", async () => {
    mediaRepoMock.findMediaAssetsByIds.mockResolvedValueOnce([assetRow({ id: "a1", kind: "audio" })]);
    const issues = await checkBrokenAssets(
      SCHOOL,
      materialWith([{ type: "image", id: "b1", assetId: "a1", zoomable: false }]),
    );
    expect(issues).toEqual([{ blockId: "b1", code: "broken_asset", message: expect.any(String) }]);
  });

  it("assetId найден и того же типа — валиден", async () => {
    mediaRepoMock.findMediaAssetsByIds.mockResolvedValueOnce([assetRow({ id: "a1", kind: "image" })]);
    const issues = await checkBrokenAssets(
      SCHOOL,
      materialWith([{ type: "image", id: "b1", assetId: "a1", zoomable: false }]),
    );
    expect(issues).toEqual([]);
  });

  it("один и тот же assetId в нескольких блоках — запрашивает БД ОДИН раз по уникальным id", async () => {
    mediaRepoMock.findMediaAssetsByIds.mockResolvedValueOnce([assetRow({ id: "a1", kind: "image" })]);
    const issues = await checkBrokenAssets(
      SCHOOL,
      materialWith([
        { type: "image", id: "b1", assetId: "a1", zoomable: false },
        { type: "image", id: "b2", assetId: "a1", zoomable: false },
      ]),
    );
    expect(issues).toEqual([]);
    expect(mediaRepoMock.findMediaAssetsByIds).toHaveBeenCalledWith(SCHOOL, ["a1"]);
  });

  it("video-блок НЕ проверяется (нет аплоада/листинга для video, Э9.7)", async () => {
    const issues = await checkBrokenAssets(
      SCHOOL,
      materialWith([{ type: "video", id: "b1", assetId: "whatever" }]),
    );
    expect(issues).toEqual([]);
    expect(mediaRepoMock.findMediaAssetsByIds).not.toHaveBeenCalled();
  });
});

describe("validateMaterial (Э9.9) — объединяет структурные проверки и битые картинки", () => {
  beforeEach(() => vi.clearAllMocks());

  it("копит проблемы из ОБОИХ источников в один список", async () => {
    mediaRepoMock.findMediaAssetsByIds.mockResolvedValueOnce([]);
    const issues = await validateMaterial(
      SCHOOL,
      materialWith([
        { type: "rich_text", id: "b1", html: "" },
        { type: "image", id: "b2", assetId: "missing", zoomable: false },
      ]),
    );
    expect(issues.map((i) => i.code).sort()).toEqual(["broken_asset", "empty_content"]);
  });
});
