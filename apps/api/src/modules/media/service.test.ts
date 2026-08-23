import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createParticipantConnection, ttlSecondsUntilLessonGraceEnd } from "./service.js";

describe("ttlSecondsUntilLessonGraceEnd", () => {
  it("длится до конца урока плюс 15-минутный грейс", () => {
    const now = new Date("2026-08-23T10:00:00Z");
    vi.setSystemTime(now);
    const startsAt = new Date("2026-08-23T10:00:00Z");
    const ttl = ttlSecondsUntilLessonGraceEnd(startsAt, 45);
    expect(ttl).toBe((45 + 15) * 60);
    vi.useRealTimers();
  });

  it("не уходит ниже минимального TTL, если урок уже должен был закончиться", () => {
    const now = new Date("2026-08-23T12:00:00Z");
    vi.setSystemTime(now);
    const startsAt = new Date("2026-08-23T10:00:00Z");
    const ttl = ttlSecondsUntilLessonGraceEnd(startsAt, 45);
    expect(ttl).toBe(60);
    vi.useRealTimers();
  });
});

describe("createParticipantConnection: токен ограничен аудио (стоп-лист Э2)", () => {
  const startsAt = new Date();

  async function grantOf(canSpeak: boolean) {
    const media = await createParticipantConnection({
      livekitRoom: "lesson-test-room",
      userId: "user-1",
      fullName: "Тест Тестов",
      permissions: { canDraw: false, canSpeak, canShareScreen: false },
      lessonStartsAt: startsAt,
      lessonDurationMin: 45,
    });
    const payload = decodeJwt(media.token) as { video?: Record<string, unknown> };
    return payload.video!;
  }

  it("canPublish повторяет право canSpeak участника", async () => {
    expect((await grantOf(true)).canPublish).toBe(true);
    expect((await grantOf(false)).canPublish).toBe(false);
  });

  it("источник публикации жёстко ограничен микрофоном, даже если canSpeak=true", async () => {
    const grant = await grantOf(true);
    expect(grant.canPublishSources).toEqual(["microphone"]);
    expect(grant.canPublishData).toBe(false);
  });
});
