import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lessonsServiceMock, schoolSettingsServiceMock } = vi.hoisted(() => ({
  lessonsServiceMock: {
    resolveJoinToken: vi.fn(),
    getLessonForGuestSession: vi.fn(),
    parseLessonSettings: vi.fn((raw: unknown) => raw ?? {}),
  },
  schoolSettingsServiceMock: {
    // Параметры школы (запрос 2026-09-14): `guestAccessEnabled` по
    // умолчанию true — сам флаг проверяется отдельным кейсом ниже.
    getSchoolSettings: vi.fn().mockResolvedValue({ guestAccessEnabled: true }),
  },
}));

vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../school-settings/service.js", () => schoolSettingsServiceMock);

const {
  enterAsGuest,
  verifyGuestToken,
  resolveGuestSession,
  hashJoinToken,
  getPublicLessonInfo,
  getGuestSessionInfo,
} = await import("./service.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const JOIN_TOKEN = "a".repeat(64);
const GUEST_SECRET = new TextEncoder().encode("test-guest-secret-at-least-32-characters");

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LESSON_ID,
    schoolId: SCHOOL_ID,
    title: "Постоянный урок",
    joinToken: JOIN_TOKEN,
    settings: { defaultMode: "lecture" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPublicLessonInfo (GET /j/:token)", () => {
  it("отдаёт только имя урока и настройки — ничего лишнего до входа", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());

    const info = await getPublicLessonInfo(JOIN_TOKEN);

    expect(info).toEqual({ lessonTitle: "Постоянный урок", settings: { defaultMode: "lecture" } });
    expect(Object.keys(info)).toEqual(["lessonTitle", "settings"]);
  });
});

describe("enterAsGuest → гостевой JWT (реальная подпись jose)", () => {
  it("минтит токен, который проходит verifyGuestToken, с корректной нагрузкой", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());

    const session = await enterAsGuest(JOIN_TOKEN, "Аня");

    expect(session.ttlSeconds).toBe(6 * 3600);
    const payload = await verifyGuestToken(session.token);
    expect(payload).toMatchObject({
      typ: "guest",
      lessonId: LESSON_ID,
      name: "Аня",
      lt: createHash("sha256").update(JOIN_TOKEN).digest("hex"),
    });
    expect(payload.guestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("каждый вход = новый guestId (кука не возобновляется)", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());

    const a = await enterAsGuest(JOIN_TOKEN, "Аня");
    const b = await enterAsGuest(JOIN_TOKEN, "Аня");

    expect(a.payload.guestId).not.toBe(b.payload.guestId);
  });

  it("guestAccessEnabled=false у школы — отказ 403, сессия не минтится (параметры школы, запрос 2026-09-14)", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());
    schoolSettingsServiceMock.getSchoolSettings.mockResolvedValueOnce({ guestAccessEnabled: false });

    await expect(enterAsGuest(JOIN_TOKEN, "Аня")).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("resolveGuestSession — гейт доступа гостя к уроку", () => {
  it("happy path: возвращает нормализованного guest-actor со школой из урока", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(lessonRow());
    const { token } = await enterAsGuest(JOIN_TOKEN, "Аня");

    const actor = await resolveGuestSession(token);

    expect(actor).toEqual({
      kind: "guest",
      participantId: expect.any(String),
      schoolId: SCHOOL_ID,
      role: null,
      lessonId: LESSON_ID,
      displayName: "Аня",
    });
  });

  it("ротация ссылки урока (admin) мгновенно инвалидирует сессию", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());
    const { token } = await enterAsGuest(JOIN_TOKEN, "Аня");
    // admin перевыпустил ссылку — join_token сменился.
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(
      lessonRow({ joinToken: "b".repeat(64) }),
    );

    await expect(resolveGuestSession(token)).rejects.toMatchObject({
      statusCode: 401,
      code: "guest_link_rotated",
    });
  });

  it("урок удалён — 401", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());
    const { token } = await enterAsGuest(JOIN_TOKEN, "Аня");
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(null);

    await expect(resolveGuestSession(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("истёкший токен — 401", async () => {
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(lessonRow());
    const expired = await new SignJWT({
      typ: "guest",
      lessonId: LESSON_ID,
      guestId: "33333333-3333-3333-3333-333333333333",
      name: "Аня",
      lt: hashJoinToken(JOIN_TOKEN),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(1000)
      .setExpirationTime(2000)
      .sign(GUEST_SECRET);

    await expect(resolveGuestSession(expired)).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_guest_session",
    });
  });

  it("токен, подписанный чужим секретом, — 401", async () => {
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(lessonRow());
    const forged = await new SignJWT({
      typ: "guest",
      lessonId: LESSON_ID,
      guestId: "33333333-3333-3333-3333-333333333333",
      name: "Аня",
      lt: hashJoinToken(JOIN_TOKEN),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("6h")
      .sign(new TextEncoder().encode("some-other-secret-at-least-32-characters!"));

    await expect(resolveGuestSession(forged)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("getGuestSessionInfo (GET /guest/session) — восстановление по куке", () => {
  it("отдаёт личность, срок и имя урока для действующей сессии", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(lessonRow());
    const { token, payload, expiresAt } = await enterAsGuest(JOIN_TOKEN, "Аня");

    const info = await getGuestSessionInfo(token);

    expect(info).toEqual({
      lessonId: LESSON_ID,
      guestId: payload.guestId,
      name: "Аня",
      expiresAt: expiresAt.toISOString(),
      lessonTitle: "Постоянный урок",
    });
  });

  it("ротация ссылки урока инвалидирует восстановление сессии", async () => {
    lessonsServiceMock.resolveJoinToken.mockResolvedValue(lessonRow());
    const { token } = await enterAsGuest(JOIN_TOKEN, "Аня");
    lessonsServiceMock.getLessonForGuestSession.mockResolvedValue(
      lessonRow({ joinToken: "b".repeat(64) }),
    );

    await expect(getGuestSessionInfo(token)).rejects.toMatchObject({
      statusCode: 401,
      code: "guest_link_rotated",
    });
  });
});
