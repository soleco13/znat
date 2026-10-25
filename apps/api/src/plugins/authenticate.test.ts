import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_LESSON_ID = "22222222-2222-2222-2222-222222222299";
const TEACHER_ID = "33333333-3333-3333-3333-333333333333";
const GUEST_ID = "44444444-4444-4444-4444-444444444444";

const { cohost, verifyAccessToken } = vi.hoisted(() => ({
  cohost: { value: true },
  verifyAccessToken: vi.fn(),
}));

vi.mock("../modules/auth/service.js", () => ({ verifyAccessToken }));
vi.mock("../modules/guests/service.js", () => ({
  GUEST_COOKIE_NAME: "guest_session",
  resolveGuestSession: vi.fn(async () => ({
    kind: "guest",
    participantId: GUEST_ID,
    schoolId: SCHOOL_ID,
    role: null,
    lessonId: LESSON_ID,
    displayName: "Гость",
  })),
}));
vi.mock("../modules/lessons/service.js", () => ({
  getLesson: vi.fn(async () => ({ id: LESSON_ID, teacherId: TEACHER_ID })),
}));
vi.mock("../modules/rooms/service.js", () => ({
  assertGuestNotLockedOut: vi.fn(async () => undefined),
  isLessonCohost: vi.fn(async () => cohost.value),
}));
// Э15.4: блокировки читаются из базы — в этих тестах ничего не заблокировано.
vi.mock("./blocklist.js", () => ({ assertNotBlocked: vi.fn().mockResolvedValue(undefined), isSchoolBlocked: vi.fn().mockResolvedValue(false), invalidateBlocklist: vi.fn() }));

const { default: authenticatePlugin } = await import("./authenticate.js");
const { default: errorsPlugin } = await import("./errors.js");

async function app() {
  const instance = Fastify();
  await instance.register(cookie);
  await instance.register(errorsPlugin);
  await instance.register(authenticatePlugin);
  // Как в server.ts — маршруты под префиксом /api/v1.
  await instance.register(
    async (api) => {
      const echo = { preHandler: api.authenticate };
      api.patch("/lessons/:id/mode", echo, async (request) => request.user);
      api.get("/lessons/:id/attendance", echo, async (request) => request.user);
      api.get("/activities/:id/progress", echo, async (request) => request.user);
    },
    { prefix: "/api/v1" },
  );
  return instance;
}

const guestCookie = { cookie: "guest_session=signed" };

beforeEach(() => {
  cohost.value = true;
  verifyAccessToken.mockReset();
});

describe("app.authenticate: гость с правами учителя", () => {
  it("на маршруте учителя своего урока — действует как учитель урока, в пределах урока", async () => {
    const res = await (await app()).inject({ method: "PATCH", url: `/api/v1/lessons/${LESSON_ID}/mode`, headers: guestCookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: TEACHER_ID, schoolId: SCHOOL_ID, role: "teacher", lessonScope: LESSON_ID });
  });

  it("чужой урок — 403", async () => {
    const res = await (await app()).inject({ method: "PATCH", url: `/api/v1/lessons/${OTHER_LESSON_ID}/mode`, headers: guestCookie });
    expect(res.statusCode).toBe(403);
  });

  it("маршрут не из списка — 401, как без входа", async () => {
    const res = await (await app()).inject({ method: "GET", url: `/api/v1/lessons/${LESSON_ID}/attendance`, headers: guestCookie });
    expect(res.statusCode).toBe(401);
  });

  it("задания — урок сверяет сервис по lessonScope", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/api/v1/activities/a1/progress", headers: guestCookie });
    expect(res.json()).toMatchObject({ lessonScope: LESSON_ID });
  });

  it("права учителя забраны — 403", async () => {
    cohost.value = false;
    const res = await (await app()).inject({ method: "PATCH", url: `/api/v1/lessons/${LESSON_ID}/mode`, headers: guestCookie });
    expect(res.statusCode).toBe(403);
  });

  it("lessonScope в самом JWT не принимается", async () => {
    verifyAccessToken.mockResolvedValue({
      sub: TEACHER_ID,
      schoolId: SCHOOL_ID,
      role: "admin",
      lessonScope: LESSON_ID,
    } satisfies AccessTokenPayload);
    const res = await (await app()).inject({
      method: "PATCH",
      url: `/api/v1/lessons/${LESSON_ID}/mode`,
      headers: { authorization: "Bearer x" },
    });
    expect(res.statusCode).toBe(401);
  });
});
