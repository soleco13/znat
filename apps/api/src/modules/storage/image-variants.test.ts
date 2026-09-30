import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { clearImageVariantCache, isImageVariant, renderImageVariant, supportsImageVariant } from "./image-variants.js";

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 60 } } })
    .png()
    .toBuffer();
}

describe("варианты картинок доски", () => {
  beforeEach(() => clearImageVariantCache());

  it("распознаёт только известные варианты и картинки", () => {
    expect(isImageVariant("lite")).toBe(true);
    expect(isImageVariant("web")).toBe(true);
    expect(isImageVariant("huge")).toBe(false);
    expect(isImageVariant(undefined)).toBe(false);
    expect(supportsImageVariant("s/a.png")).toBe(true);
    expect(supportsImageVariant("s/a.webp")).toBe(true);
    expect(supportsImageVariant("s/deck.pdf")).toBe(false);
  });

  it("web: старый PNG отдаётся как WebP того же размера", async () => {
    const out = await renderImageVariant("s/a.png", "web", async () => png(1800, 900));
    const meta = await sharp(out!).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([1800, 900]);
  });

  it("web: WebP не пересжимается — отдаётся исходник", async () => {
    const read = vi.fn(async () => png(10, 10));
    expect(await renderImageVariant("s/a.webp", "web", read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("lite: уменьшает до 1000 px по большей стороне", async () => {
    const out = await renderImageVariant("s/b.png", "lite", async () => png(2000, 1000));
    const meta = await sharp(out!).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([1000, 500]);
  });

  it("одновременные и повторные запросы считаются один раз", async () => {
    const read = vi.fn(async () => png(300, 300));
    const [a, b] = await Promise.all([
      renderImageVariant("s/c.png", "lite", read),
      renderImageVariant("s/c.png", "lite", read),
    ]);
    const c = await renderImageVariant("s/c.png", "lite", read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });
});
