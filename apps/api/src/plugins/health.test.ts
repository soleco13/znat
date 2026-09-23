import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health.js";

describe("checkHealth", () => {
  it("всё отвечает — ok", async () => {
    await expect(checkHealth({ db: async () => 1, redis: async () => "PONG" })).resolves.toEqual({
      ok: true,
      db: true,
      redis: true,
    });
  });

  it("упавшая БД — не ok", async () => {
    const result = await checkHealth({ db: async () => Promise.reject(new Error("down")), redis: async () => "PONG" });
    expect(result).toEqual({ ok: false, db: false, redis: true });
  });

  it("зависший Redis не вешает проверку — таймаут", async () => {
    vi.useFakeTimers();
    const pending = checkHealth({ db: async () => 1, redis: () => new Promise(() => undefined) });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual({ ok: false, db: true, redis: false });
    vi.useRealTimers();
  });
});
