import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

const { storageServiceMock } = vi.hoisted(() => ({
  storageServiceMock: {
    uploadFile: vi.fn(),
    getSignedFileUrl: vi.fn(),
  },
}));

vi.mock("../storage/service.js", () => storageServiceMock);

const { uploadCanvasImage } = await import("./images.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";

/** Читает загруженный поток целиком — тем же приёмом, что «декодировать реальный артефакт, не мокать SDK» (Э2.2/Э3.2). */
async function readUploadedStreamAsBuffer(): Promise<Buffer> {
  const call = storageServiceMock.uploadFile.mock.calls[0];
  if (!call) throw new Error("uploadFile was not called");
  const { stream } = call[0] as { stream: NodeJS.ReadableStream };
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

beforeEach(() => {
  vi.clearAllMocks();
  storageServiceMock.uploadFile.mockResolvedValue({ storageKey: `${SCHOOL_ID}/fake.jpg`, sizeBytes: 123 });
  storageServiceMock.getSignedFileUrl.mockReturnValue("/files/signed?exp=1&sig=x");
});

describe("uploadCanvasImage (Э3.10, §3.3 ТЗ)", () => {
  it("отклоняет неподдерживаемый тип файла до похода в StorageAdapter", async () => {
    await expect(
      uploadCanvasImage({ buffer: Buffer.from("not an image"), mimeType: "application/pdf", schoolId: SCHOOL_ID }),
    ).rejects.toMatchObject({ statusCode: 400, code: "unsupported_type" });
    expect(storageServiceMock.uploadFile).not.toHaveBeenCalled();
  });

  it("уменьшает изображение, превышающее 2000px по большей стороне, сохраняя пропорции", async () => {
    const oversized = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    const result = await uploadCanvasImage({ buffer: oversized, mimeType: "image/jpeg", schoolId: SCHOOL_ID });

    expect(result.width).toBe(2000);
    expect(result.height).toBe(1000);
    expect(result.mimeType).toBe("image/jpeg");

    // Сверка не по метаданным ответа, а по факту записанных байт — реальный
    // sharp декодирует то, что реально ушло в StorageAdapter.
    const uploadedBuffer = await readUploadedStreamAsBuffer();
    const uploadedMeta = await sharp(uploadedBuffer).metadata();
    expect(uploadedMeta.width).toBe(2000);
    expect(uploadedMeta.height).toBe(1000);
  });

  it("НЕ увеличивает изображение меньше 2000px (withoutEnlargement)", async () => {
    const small = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const result = await uploadCanvasImage({ buffer: small, mimeType: "image/png", schoolId: SCHOOL_ID });

    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it("авто-поворачивает изображение по EXIF Orientation перед ресайзом (важно для фото с камеры телефона)", async () => {
    // Сырые пиксели 200x100 (альбомная ориентация), но EXIF Orientation=6
    // ("повернуть на 90° по часовой") говорит декодеру показать её как
    // портретную. .rotate() (Э3.10, images.ts) обязан это применить — тогда
    // итоговые размеры именно 100x200, а не 200x100 сырых пикселей.
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await uploadCanvasImage({ buffer: rotated, mimeType: "image/jpeg", schoolId: SCHOOL_ID });

    expect(result.width).toBe(100);
    expect(result.height).toBe(200);
  });

  it("вызывает getSignedFileUrl с долгим TTL (не общим часовым default), т.к. ссылка вшивается в Y.Doc надолго", async () => {
    const small = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    await uploadCanvasImage({ buffer: small, mimeType: "image/png", schoolId: SCHOOL_ID });

    expect(storageServiceMock.getSignedFileUrl).toHaveBeenCalledWith(
      `${SCHOOL_ID}/fake.jpg`,
      60 * 60 * 24 * 30,
    );
  });

  it("передаёт schoolId дальше в StorageAdapter без изменений", async () => {
    const small = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .webp()
      .toBuffer();

    await uploadCanvasImage({ buffer: small, mimeType: "image/webp", schoolId: SCHOOL_ID });

    expect(storageServiceMock.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL_ID, suggestedName: "board.webp" }),
    );
  });
});
