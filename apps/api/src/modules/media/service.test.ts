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

describe("createParticipantConnection: источники трека по роли и правам (Э2 + Э5.1 + Э6.1)", () => {
  const startsAt = new Date();

  async function grantOf(
    canSpeak: boolean,
    role: "teacher" | "student" | "admin" = "student",
    canPublishVideo = false,
  ) {
    const media = await createParticipantConnection({
      livekitRoom: "lesson-test-room",
      userId: "user-1",
      fullName: "Тест Тестов",
      role,
      permissions: { canDraw: false, canSpeak, canShareScreen: false, canPublishVideo },
      lessonStartsAt: startsAt,
      lessonDurationMin: 45,
    });
    const payload = decodeJwt(media.token) as { video?: Record<string, unknown>; attributes?: Record<string, string> };
    return { grant: payload.video!, attributes: payload.attributes };
  }

  it("canPublish повторяет право canSpeak участника-ученика", async () => {
    expect((await grantOf(true, "student")).grant.canPublish).toBe(true);
    expect((await grantOf(false, "student")).grant.canPublish).toBe(false);
  });

  it("источник публикации ученика жёстко ограничен микрофоном, даже если canSpeak=true, без canPublishVideo", async () => {
    const { grant } = await grantOf(true, "student");
    expect(grant.canPublishSources).toEqual(["microphone"]);
    expect(grant.canPublishData).toBe(false);
  });

  it("Э6.1: ученик с canPublishVideo получает источник camera и canPublish=true даже при canSpeak=false", async () => {
    const { grant } = await grantOf(false, "student", true);
    expect(grant.canPublish).toBe(true);
    expect(grant.canPublishSources).toEqual(expect.arrayContaining(["microphone", "camera"]));
  });

  it("Э5.1: учитель получает источник camera всегда, независимо от canSpeak", async () => {
    const { grant } = await grantOf(false, "teacher");
    expect(grant.canPublish).toBe(true);
    expect(grant.canPublishSources).toEqual(expect.arrayContaining(["microphone", "camera"]));
  });

  it("Э5.1: admin тоже получает источник camera (роль, не отдельное право)", async () => {
    const { grant } = await grantOf(false, "admin");
    expect(grant.canPublishSources).toEqual(expect.arrayContaining(["microphone", "camera"]));
  });

  it("демонстрация экрана по-прежнему не входит ни в один грант (стоп-лист Э5/Э6, до Э7)", async () => {
    const { grant } = await grantOf(true, "teacher");
    expect(grant.canPublishSources).not.toContain("screen_share");
  });

  it("Э6.1: токен несёт роль в attributes — клиент отличает камеру учителя от камеры ученика", async () => {
    expect((await grantOf(false, "teacher")).attributes).toEqual({ role: "teacher" });
    expect((await grantOf(false, "student")).attributes).toEqual({ role: "student" });
  });
});

describe("updateLivePermissions: живое обновление гранта уже подключённого участника (Э2.5 + Э5.1 + Э6.1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("для ученика отправляет canPublish, равный canSpeak, и жёстко ограничивает источник микрофоном", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await updateLivePermissions(
      "lesson-room",
      "user-1",
      { canDraw: false, canSpeak: true, canShareScreen: false, canPublishVideo: false },
      "student",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.permission.canPublish).toBe(true);
    expect(body.permission.canPublishSources).toEqual(["MICROPHONE"]);
    // proto3 JSON опускает поля со значением по умолчанию (false) — отсутствие тоже означает "не разрешено".
    expect(body.permission.canPublishData ?? false).toBe(false);
  });

  it("для учителя всегда включает источник CAMERA, даже при canSpeak=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await updateLivePermissions(
      "lesson-room",
      "teacher-1",
      { canDraw: true, canSpeak: false, canShareScreen: true, canPublishVideo: true },
      "teacher",
    );

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.permission.canPublish).toBe(true);
    expect(body.permission.canPublishSources).toEqual(expect.arrayContaining(["MICROPHONE", "CAMERA"]));
  });

  it("Э6.1: для ученика с granted canPublishVideo=true включает источник CAMERA", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await updateLivePermissions(
      "lesson-room",
      "user-1",
      { canDraw: false, canSpeak: false, canShareScreen: false, canPublishVideo: true },
      "student",
    );

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.permission.canPublish).toBe(true);
    expect(body.permission.canPublishSources).toEqual(expect.arrayContaining(["MICROPHONE", "CAMERA"]));
  });

  it("Э6.1: отзыв canPublishVideo у ученика убирает CAMERA из источников", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await updateLivePermissions(
      "lesson-room",
      "user-1",
      { canDraw: false, canSpeak: false, canShareScreen: false, canPublishVideo: false },
      "student",
    );

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.permission.canPublishSources).toEqual(["MICROPHONE"]);
  });

  it("молча проглатывает 404 — участник ещё не подключался к LiveKit, обновлять нечего", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "not_found", msg: "not found" })));

    await expect(
      updateLivePermissions(
        "lesson-room",
        "user-1",
        { canDraw: false, canSpeak: false, canShareScreen: false, canPublishVideo: false },
        "student",
      ),
    ).resolves.toBeUndefined();
  });

  it("пробрасывает ошибки, отличные от 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { msg: "internal" })));

    await expect(
      updateLivePermissions(
        "lesson-room",
        "user-1",
        { canDraw: false, canSpeak: true, canShareScreen: false, canPublishVideo: false },
        "student",
      ),
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
