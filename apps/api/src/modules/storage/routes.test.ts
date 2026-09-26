import { Readable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/env.js", () => ({ env: { FILES_VIA_PROXY: true } }));
vi.mock("./service.js", () => ({
  verifyFileSignature: () => true,
  getProxyFilePath: (key: string) => `/${key}`,
  openFile: async () => Readable.from([Buffer.from("IMAGE-BYTES")]),
}));

const { filesRoutes } = await import("./routes.js");

async function app() {
  const instance = Fastify();
  await instance.register(filesRoutes);
  return instance;
}

describe("GET /files/* — отдача через Caddy или напрямую", () => {
  const url = "/files/school%2Fpic.webp?exp=9999999999&sig=s";

  it("через Caddy (есть X-Forwarded-For) — указание X-Accel-Redirect без тела", async () => {
    const res = await (await app()).inject({ method: "GET", url, headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-accel-redirect"]).toBe("/school/pic.webp");
    expect(res.body).toBe("");
  });

  it("напрямую (запись урока внутри сервера) — сам файл", async () => {
    const res = await (await app()).inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-accel-redirect"]).toBeUndefined();
    expect(res.body).toBe("IMAGE-BYTES");
    expect(res.headers["content-type"]).toBe("image/webp");
  });
});
