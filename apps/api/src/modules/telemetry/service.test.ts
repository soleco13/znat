import { describe, expect, it, vi } from "vitest";
import { clientEventBatchSchema } from "@school/shared";
import type { FastifyBaseLogger } from "fastify";
import { logClientEvents, sanitizeClientFields } from "./service.js";

describe("sanitizeClientFields", () => {
  it("отбрасывает поля, похожие на секреты и персональные данные", () => {
    expect(
      sanitizeClientFields({ reason: "timeout", accessToken: "x", userEmail: "a@b.c", attempt: 2, lessonId: "l" }),
    ).toEqual({ reason: "timeout", attempt: 2, lessonId: "l" });
  });
});

describe("clientEventBatchSchema", () => {
  it("принимает пачку событий с плоскими полями", () => {
    const parsed = clientEventBatchSchema.parse({
      events: [{ event: "livekit_connection_failed", ts: "2026-10-02T10:00:00.000Z", fields: { reason: "x" } }],
    });
    expect(parsed.events).toHaveLength(1);
  });

  it("не принимает неизвестное событие и вложенные объекты", () => {
    expect(() =>
      clientEventBatchSchema.parse({ events: [{ event: "anything", ts: "2026-10-02T10:00:00.000Z" }] }),
    ).toThrow();
    expect(() =>
      clientEventBatchSchema.parse({
        events: [{ event: "client_error", ts: "2026-10-02T10:00:00.000Z", fields: { nested: { a: 1 } } }],
      }),
    ).toThrow();
  });
});

describe("logClientEvents", () => {
  it("сбои пишет warn, остальное info, с событием в поле clientEvent", () => {
    const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;
    logClientEvents(
      [
        { event: "whiteboard_synced", ts: "2026-10-02T10:00:00.000Z", fields: { durationMs: 120 } },
        { event: "pdf_load_failed", ts: "2026-10-02T10:00:01.000Z", fields: { reason: "network" } },
      ],
      log,
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "client_event", clientEvent: "whiteboard_synced", durationMs: 120 }),
      "client_event",
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ clientEvent: "pdf_load_failed", reason: "network" }),
      "client_event",
    );
  });
});
