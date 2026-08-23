import { decodeJwt } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createParticipantConnection,
  muteMicrophones,
  muteParticipant,
  ttlSecondsUntilLessonGraceEnd,
  updateLivePermissions,
} from "./service.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

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

describe("updateLivePermissions: живое обновление гранта уже подключённого участника (Э2.5)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("отправляет canPublish, равный canSpeak, и жёстко ограничивает источник микрофоном", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await updateLivePermissions("lesson-room", "user-1", { canDraw: false, canSpeak: true, canShareScreen: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.permission.canPublish).toBe(true);
    expect(body.permission.canPublishSources).toEqual(["MICROPHONE"]);
    // proto3 JSON опускает поля со значением по умолчанию (false) — отсутствие тоже означает "не разрешено".
    expect(body.permission.canPublishData ?? false).toBe(false);
  });

  it("молча проглатывает 404 — участник ещё не подключался к LiveKit, обновлять нечего", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "not_found", msg: "not found" })));

    await expect(
      updateLivePermissions("lesson-room", "user-1", { canDraw: false, canSpeak: false, canShareScreen: false }),
    ).resolves.toBeUndefined();
  });

  it("пробрасывает ошибки, отличные от 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { msg: "internal" })));

    await expect(
      updateLivePermissions("lesson-room", "user-1", { canDraw: false, canSpeak: true, canShareScreen: false }),
    ).rejects.toThrow();
  });
});

describe("muteParticipant / muteMicrophones: принудительный мьют (Э2.5)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("muteMicrophones с пустым списком не делает сетевых вызовов", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await muteMicrophones("lesson-room", []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("не падает, если участника уже нет в LiveKit (getParticipant 404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "not_found" })));

    await expect(muteParticipant("lesson-room", "user-1")).resolves.toBeUndefined();
  });

  it("ничего не отправляет, если у участника нет опубликованного трека микрофона", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { identity: "user-1", tracks: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await muteParticipant("lesson-room", "user-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("мьютит трек микрофона, если он опубликован", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { identity: "user-1", tracks: [{ sid: "TR_1", source: "MICROPHONE" }] }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { sid: "TR_1", muted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await muteParticipant("lesson-room", "user-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, muteInit] = fetchMock.mock.calls[1] as [unknown, RequestInit];
    const muteBody = JSON.parse(muteInit.body as string);
    expect(muteBody.trackSid).toBe("TR_1");
    expect(muteBody.muted).toBe(true);
  });
});
