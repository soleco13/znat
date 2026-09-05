import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

const { mediaRepoMock, storageServiceMock } = vi.hoisted(() => ({
  mediaRepoMock: {
    insertMediaAsset: vi.fn(),
    listMediaAssetRows: vi.fn(),
    findMediaAssetById: vi.fn(),
  },
  storageServiceMock: {
    uploadFile: vi.fn(),
    getSignedFileUrl: vi.fn(),
  },
}));

vi.mock("./media-repo.js", () => mediaRepoMock);
vi.mock("../storage/service.js", () => storageServiceMock);

const { uploadMediaAsset, listMediaAssets, getMediaAssetUrl } = await import("./media-library.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

/** Читает загруженный поток целиком — тот же приём, что `images.test.ts` (Э3.10): проверяем реальные записанные байты, не мок. */
async function readUploadedStreamAsBuffer(): Promise<Buffer> {
  const call = storageServiceMock.uploadFile.mock.calls[0];
  if (!call) throw new Error("uploadFile was not called");
  const { stream } = call[0] as { stream: NodeJS.ReadableStream };
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function storedRow(overrides: Partial<Awaited<ReturnType<typeof mediaRepoMock.insertMediaAsset>>> = {}) {
  return {
    id: "asset-1",
    schoolId: SCHOOL_ID,
    uploadedBy: USER_ID,
    kind: "image" as const,
    originalName: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    storageKey: `${SCHOOL_ID}/photo.jpg`,
    createdAt: new Date("2026-09-05T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageServiceMock.uploadFile.mockResolvedValue({ storageKey: `${SCHOOL_ID}/fake.jpg`, sizeBytes: 123 });
  storageServiceMock.getSignedFileUrl.mockReturnValue("/files/signed?exp=1&sig=x");
});

describe("uploadMediaAsset (Э9.7, §7.2 ТЗ: медиатека)", () => {
  it("отклоняет неподдерживаемый тип файла до похода в StorageAdapter/БД", async () => {
    await expect(
      uploadMediaAsset({
        buffer: Buffer.from("not media"),
        mimeType: "application/pdf",
        originalName: "doc.pdf",
        schoolId: SCHOOL_ID,
        uploadedBy: USER_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "unsupported_type" });
    expect(storageServiceMock.uploadFile).not.toHaveBeenCalled();
    expect(mediaRepoMock.insertMediaAsset).not.toHaveBeenCalled();
  });

  it("определяет kind='image' по mimeType и ресайзит превышающее 2000px", async () => {
    const oversized = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    mediaRepoMock.insertMediaAsset.mockResolvedValueOnce(storedRow());

    await uploadMediaAsset({
      buffer: oversized,
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
      schoolId: SCHOOL_ID,
      uploadedBy: USER_ID,
    });

    expect(mediaRepoMock.insertMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }));
    const uploadedBuffer = await readUploadedStreamAsBuffer();
    const uploadedMeta = await sharp(uploadedBuffer).metadata();
    expect(uploadedMeta.width).toBe(2000);
    expect(uploadedMeta.height).toBe(1000);
  });

  it("определяет kind='audio' по mimeType и НЕ трогает байты (без ресайза/транскодирования)", async () => {
    const original = Buffer.from("fake mp3 bytes");
    mediaRepoMock.insertMediaAsset.mockResolvedValueOnce(storedRow({ kind: "audio", mimeType: "audio/mpeg" }));

    await uploadMediaAsset({
      buffer: original,
      mimeType: "audio/mpeg",
      originalName: "listening.mp3",
      schoolId: SCHOOL_ID,
      uploadedBy: USER_ID,
    });

    expect(mediaRepoMock.insertMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio" }));
    const uploadedBuffer = await readUploadedStreamAsBuffer();
    expect(uploadedBuffer.equals(original)).toBe(true);
  });

  it("возвращает MediaAsset с подписанной ссылкой из storageKey сохранённой строки", async () => {
    mediaRepoMock.insertMediaAsset.mockResolvedValueOnce(storedRow());
    storageServiceMock.getSignedFileUrl.mockReturnValueOnce("/files/asset-1?exp=1&sig=abc");

    const result = await uploadMediaAsset({
      buffer: await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).jpeg().toBuffer(),
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
      schoolId: SCHOOL_ID,
      uploadedBy: USER_ID,
    });

    expect(result).toMatchObject({
      id: "asset-1",
      kind: "image",
      originalName: "photo.jpg",
      url: "/files/asset-1?exp=1&sig=abc",
    });
  });
});

describe("listMediaAssets (Э9.7)", () => {
  it("прокидывает schoolId и kind в repo как есть", async () => {
    mediaRepoMock.listMediaAssetRows.mockResolvedValueOnce([]);
    await listMediaAssets(SCHOOL_ID, "audio");
    expect(mediaRepoMock.listMediaAssetRows).toHaveBeenCalledWith(SCHOOL_ID, "audio");
  });

  it("без kind — не фильтрует (запрашивает всё)", async () => {
    mediaRepoMock.listMediaAssetRows.mockResolvedValueOnce([]);
    await listMediaAssets(SCHOOL_ID);
    expect(mediaRepoMock.listMediaAssetRows).toHaveBeenCalledWith(SCHOOL_ID, undefined);
  });

  it("маппит строки БД в MediaAsset с подписанной ссылкой", async () => {
    mediaRepoMock.listMediaAssetRows.mockResolvedValueOnce([storedRow(), storedRow({ id: "asset-2", kind: "audio" })]);
    const result = await listMediaAssets(SCHOOL_ID);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "asset-1", kind: "image", url: "/files/signed?exp=1&sig=x" });
    expect(result[1]).toMatchObject({ id: "asset-2", kind: "audio" });
  });
});

describe("getMediaAssetUrl (Э9.7, §8 ТЗ: GET /assets/:id/url, доступен любой роли)", () => {
  it("404, если файла нет вовсе", async () => {
    mediaRepoMock.findMediaAssetById.mockResolvedValueOnce(null);
    await expect(getMediaAssetUrl(SCHOOL_ID, "asset-1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("404 на файл чужой школы — не подтверждаем сам факт существования", async () => {
    mediaRepoMock.findMediaAssetById.mockResolvedValueOnce(storedRow({ schoolId: "other-school" }));
    await expect(getMediaAssetUrl(SCHOOL_ID, "asset-1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("возвращает подписанную ссылку на файл своей школы", async () => {
    mediaRepoMock.findMediaAssetById.mockResolvedValueOnce(storedRow());
    storageServiceMock.getSignedFileUrl.mockReturnValueOnce("/files/photo?exp=1&sig=y");
    const url = await getMediaAssetUrl(SCHOOL_ID, "asset-1");
    expect(url).toBe("/files/photo?exp=1&sig=y");
  });
});
