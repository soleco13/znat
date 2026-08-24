import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { authServiceMock, lessonsServiceMock, usersServiceMock } = vi.hoisted(() => ({
  authServiceMock: {
    verifyAccessToken: vi.fn(),
  },
  lessonsServiceMock: {
    getLesson: vi.fn(),
  },
  usersServiceMock: {
    isGroupMember: vi.fn(),
  },
}));

vi.mock("../auth/service.js", () => authServiceMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);

const { authenticateCanvasConnection } = await import("./hocuspocus.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const TEACHER_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_ID = "44444444-4444-4444-4444-444444444444";
const GROUP_ID = "66666666-6666-6666-6666-666666666666";

function baseLesson(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LESSON_ID,
    schoolId: SCHOOL_ID,
    groupId: GROUP_ID,
    teacherId: TEACHER_ID,
    title: "Урок",
    subject: "Математика",
    startsAt: new Date(),
    durationMin: 45,
    status: "live" as const,
    livekitRoom: null,
    startedAt: null,
    endedAt: null,
    settings: {},
    ...overrides,
  };
}

function tokenFor(payload: Partial<AccessTokenPayload>): AccessTokenPayload {
  return { sub: TEACHER_ID, schoolId: SCHOOL_ID, role: "teacher", ...payload };
}

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
});

describe("authenticateCanvasConnection", () => {
  it("некорректный documentName (не UUID) отклоняется до похода в БД", async () => {
    await expect(
      authenticateCanvasConnection({ token: "t", documentName: "not-a-uuid" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(lessonsServiceMock.getLesson).not.toHaveBeenCalled();
  });

  it("админ подключается к любому уроку своей школы", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "admin", sub: "admin-1" }));

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID });
    expect(result).toEqual({ userId: "admin-1", role: "admin" });
  });

  it("учитель, ведущий этот урок, подключается", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "teacher", sub: TEACHER_ID }));

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID });
    expect(result).toEqual({ userId: TEACHER_ID, role: "teacher" });
  });

  it("учитель, НЕ ведущий этот урок, отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(
      tokenFor({ role: "teacher", sub: "77777777-7777-7777-7777-777777777777" }),
    );

    await expect(authenticateCanvasConnection({ token: "t", documentName: LESSON_ID })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("ученик из группы урока подключается", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "student", sub: STUDENT_ID }));
    usersServiceMock.isGroupMember.mockResolvedValue(true);

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID });
    expect(result).toEqual({ userId: STUDENT_ID, role: "student" });
    expect(usersServiceMock.isGroupMember).toHaveBeenCalledWith(GROUP_ID, STUDENT_ID);
  });

  it("ученик НЕ из группы урока (чужой урок) отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "student", sub: STUDENT_ID }));
    usersServiceMock.isGroupMember.mockResolvedValue(false);

    await expect(authenticateCanvasConnection({ token: "t", documentName: LESSON_ID })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("methodist к уроку не допускается", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "methodist", sub: "88888888-8888-8888-8888-888888888888" }));

    await expect(authenticateCanvasConnection({ token: "t", documentName: LESSON_ID })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("невалидный токен отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockRejectedValue(new Error("bad token"));

    await expect(authenticateCanvasConnection({ token: "bad", documentName: LESSON_ID })).rejects.toThrow();
  });
});
