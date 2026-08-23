import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { lessonsServiceMock, usersServiceMock, repoMock } = vi.hoisted(() => ({
  lessonsServiceMock: {
    getLesson: vi.fn(),
    startLesson: vi.fn(),
    endLesson: vi.fn(),
  },
  usersServiceMock: {
    isGroupMember: vi.fn(),
    getUserForAuth: vi.fn(),
  },
  repoMock: {
    insertJoin: vi.fn(),
    closeOpenSession: vi.fn(),
    insertChatMessage: vi.fn(),
    listChatMessages: vi.fn(),
    softDeleteChatMessage: vi.fn(),
    countOpenSessions: vi.fn(),
    findChatAuthor: vi.fn(),
  },
}));

vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);
vi.mock("./repo.js", () => repoMock);

// presence.ts общается с реальным Redis — подменяем на in-memory реализацию,
// оставляя чистые функции (defaultPermissions, isStaleEntry) настоящими.
vi.mock("./presence.js", async () => {
  const actual = await vi.importActual<typeof import("./presence.js")>("./presence.js");
  const rooms = new Map<string, Map<string, unknown>>();
  const roomMap = (lessonId: string) => {
    let m = rooms.get(lessonId);
    if (!m) {
      m = new Map();
      rooms.set(lessonId, m);
    }
    return m;
  };
  return {
    ...actual,
    setParticipant: vi.fn(async (lessonId: string, userId: string, entry: unknown) => {
      roomMap(lessonId).set(userId, entry);
    }),
    getParticipant: vi.fn(async (lessonId: string, userId: string) => roomMap(lessonId).get(userId) ?? null),
    removeParticipant: vi.fn(async (lessonId: string, userId: string) => {
      roomMap(lessonId).delete(userId);
    }),
    listParticipants: vi.fn(async (lessonId: string) => new Map(roomMap(lessonId))),
    countConnected: vi.fn(
      async (lessonId: string) =>
        [...roomMap(lessonId).values()].filter((e) => (e as { connected: boolean }).connected).length,
    ),
    __clear: () => rooms.clear(),
  };
});

const roomsService = await import("./service.js");
const presence = (await import("./presence.js")) as unknown as { __clear: () => void };

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const TEACHER_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_STUDENT_ID = "55555555-5555-5555-5555-555555555555";
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
    status: "scheduled" as const,
    livekitRoom: null,
    startedAt: null,
    endedAt: null,
    settings: {},
    ...overrides,
  };
}

function teacherToken(): AccessTokenPayload {
  return { sub: TEACHER_ID, schoolId: SCHOOL_ID, role: "teacher" };
}
function studentToken(sub = STUDENT_ID): AccessTokenPayload {
  return { sub, schoolId: SCHOOL_ID, role: "student" };
}

beforeEach(() => {
  vi.clearAllMocks();
  presence.__clear();
});

afterEach(() => {
  roomsService.stopPresenceSweep();
});

describe("join: контроль доступа", () => {
  it("ученик из группы урока может войти", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);

    const result = await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");
    expect(result.self.userId).toBe(STUDENT_ID);
    expect(usersServiceMock.isGroupMember).toHaveBeenCalledWith(GROUP_ID, STUDENT_ID);
  });

  it("ученик НЕ из группы урока получает 403", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(false);

    await expect(roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(OTHER_STUDENT_ID), "Чужой"))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("учитель, не ведущий этот урок, получает 403", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson({ teacherId: "77777777-7777-7777-7777-777777777777" }));

    await expect(roomsService.join(SCHOOL_ID, LESSON_ID, teacherToken(), "Другой учитель")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("методист не допускается к участию в уроке", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    const methodistToken: AccessTokenPayload = { sub: STUDENT_ID, schoolId: SCHOOL_ID, role: "methodist" };

    await expect(roomsService.join(SCHOOL_ID, LESSON_ID, methodistToken, "Методист")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("нельзя войти в завершённый или отменённый урок", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson({ status: "ended" }));
    usersServiceMock.isGroupMember.mockResolvedValue(true);

    await expect(roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("вход учителя переводит урок в live, вход ученика — нет", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson({ status: "scheduled" }));
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    lessonsServiceMock.startLesson.mockResolvedValue(baseLesson({ status: "live" }));

    const studentJoin = await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");
    expect(studentJoin.lessonStatus).toBe("scheduled");
    expect(lessonsServiceMock.startLesson).not.toHaveBeenCalled();

    const teacherJoin = await roomsService.join(SCHOOL_ID, LESSON_ID, teacherToken(), "Учитель");
    expect(teacherJoin.lessonStatus).toBe("live");
    expect(lessonsServiceMock.startLesson).toHaveBeenCalledWith(SCHOOL_ID, LESSON_ID);
  });
});

describe("права участников", () => {
  it("только учитель этого урока (или админ) может менять права", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, studentToken(OTHER_STUDENT_ID), STUDENT_ID, {
        canSpeak: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canSpeak: true });
    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === STUDENT_ID)?.permissions.canSpeak).toBe(true);
  });
});

describe("модерация чата и завершение урока", () => {
  it("только учитель этого урока может завершить урок", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson({ status: "live" }));

    await expect(
      roomsService.endLessonNow(SCHOOL_ID, LESSON_ID, studentToken()),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.endLessonNow(SCHOOL_ID, LESSON_ID, teacherToken());
    expect(lessonsServiceMock.endLesson).toHaveBeenCalledWith(SCHOOL_ID, LESSON_ID);
  });

  it("только учитель этого урока может удалить сообщение чата", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    repoMock.softDeleteChatMessage.mockResolvedValue({ id: "msg-1" });

    await expect(
      roomsService.deleteChatMessage(SCHOOL_ID, LESSON_ID, studentToken(), "msg-1"),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.deleteChatMessage(SCHOOL_ID, LESSON_ID, teacherToken(), "msg-1");
    expect(repoMock.softDeleteChatMessage).toHaveBeenCalledWith(LESSON_ID, "msg-1", TEACHER_ID);
  });
});
