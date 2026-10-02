import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import errorsPlugin from "./errors.js";
import requestContextPlugin from "./request-context.js";
import { genRequestId, logger, loggerOptions, setLogContext, setRootLogger } from "./logger.js";

function buildApp() {
  const lines: Record<string, unknown>[] = [];
  const stream = { write: (chunk: string) => lines.push(JSON.parse(chunk)) };
  const app = Fastify({
    logger: { ...(loggerOptions() as object), level: "info", stream },
    genReqId: genRequestId,
    requestIdLogLabel: "requestId",
    disableRequestLogging: true,
  });
  setRootLogger(app.log);
  app.register(requestContextPlugin);
  app.register(errorsPlugin);
  app.get("/svc", async () => {
    setLogContext({ userId: "u-1", lessonId: "l-1" });
    // Как сервис: общий логгер, без request.log.
    logger().info({ password: "p", nested: { accessToken: "t" } }, "service line");
    return { ok: true };
  });
  app.get("/boom", async () => {
    throw new Error("kaboom");
  });
  app.get("/j/:token", async () => ({ ok: true }));
  return { app, lines };
}

describe("логгер", () => {
  it("requestId из заголовка браузера и контекст попадают в строки сервиса и запроса; секреты скрыты", async () => {
    const { app, lines } = buildApp();
    const res = await app.inject({
      url: "/svc",
      headers: { "x-request-id": "req-abcdef12", "x-client-session": "sess-12345678" },
    });
    expect(res.headers["x-request-id"]).toBe("req-abcdef12");
    const service = lines.find((l) => l.msg === "service line")!;
    expect(service).toMatchObject({
      requestId: "req-abcdef12",
      clientSessionId: "sess-12345678",
      userId: "u-1",
      lessonId: "l-1",
      password: "[redacted]",
      nested: { accessToken: "[redacted]" },
      service: "api",
    });
    expect(typeof service.time).toBe("string");
    const access = lines.find((l) => l.event === "http_request")!;
    expect(access).toMatchObject({ requestId: "req-abcdef12", statusCode: 200, userId: "u-1" });
  });

  it("мусорный X-Request-Id заменяется UUID", async () => {
    const { app } = buildApp();
    const res = await app.inject({ url: "/svc", headers: { "x-request-id": "bad id with spaces" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("неожиданная ошибка: стек в логе, errorId = requestId в ответе", async () => {
    const { app, lines } = buildApp();
    const res = await app.inject({ url: "/boom", headers: { "x-request-id": "req-boom1234" } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: "internal_error", errorId: "req-boom1234" });
    const failed = lines.find((l) => l.event === "request_failed")!;
    expect(failed).toMatchObject({ requestId: "req-boom1234", errorId: "req-boom1234" });
    expect((failed.err as { stack?: string }).stack).toContain("kaboom");
  });

  it("токен ссылки урока не попадает в строку запроса", async () => {
    const { app, lines } = buildApp();
    await app.inject({ url: "/j/secretjointoken" });
    const access = lines.find((l) => l.event === "http_request")!;
    expect(access.url).toBe("/j/[redacted]");
  });
});
