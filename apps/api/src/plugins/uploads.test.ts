import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import errorsPlugin from "./errors.js";
import { openStreamedUpload, uploadsInMemoryBytes, withBufferedUpload } from "./uploads.js";

const LIMIT = 1024;

function multipartBody(size: number) {
  const boundary = "----znat";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    Buffer.alloc(size, 1),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function buildApp() {
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * LIMIT } });
  await app.register(errorsPlugin);
  app.post("/buffered", async (request) =>
    withBufferedUpload(request, LIMIT, async (file) => ({ size: file.buffer.length })),
  );
  app.post("/streamed", async (request) => {
    const file = await openStreamedUpload(request, LIMIT);
    let size = 0;
    for await (const chunk of file.stream) size += (chunk as Buffer).length;
    return { size };
  });
  return app;
}

describe("uploads", () => {
  it("принимает файл в пределах лимита маршрута и освобождает бюджет", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/buffered", ...multipartBody(LIMIT) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ size: LIMIT });
    expect(uploadsInMemoryBytes()).toBe(0);
  });

  it("413 по заявленному Content-Length, не читая тело", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/buffered", ...multipartBody(200 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("file_too_large");
  });

  it("413, если файл больше лимита маршрута (глобальный лимит выше)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/buffered", ...multipartBody(LIMIT + 10) });
    expect(res.statusCode).toBe(413);
    expect(uploadsInMemoryBytes()).toBe(0);
  });

  it("поток рвётся ошибкой 413 на превышении лимита", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/streamed", ...multipartBody(LIMIT + 10) });
    expect(res.statusCode).toBe(413);
  });
});
