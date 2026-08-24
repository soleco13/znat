import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { lessonsServiceMock, usersServiceMock, repoMock, mediaServiceMock, canvasServiceMock } = vi.hoisted(() => ({
  canvasServiceMock: {
    closeCanvasDocument: vi.fn(),
    setDrawPermission: vi.fn(),
  },
  lessonsServiceMock: {
    getLesson: vi.fn(),
    startLesson: vi.fn(),
    endLesson: vi.fn(),
    ensureLivekitRoom: vi.fn(),
    getLessonByLivekitRoom: vi.fn(),
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
  mediaServiceMock: {
    createParticipantConnection: vi.fn().mockResolvedValue({ token: "fake-token", url: "ws://localhost:7880" }),
    updateLivePermissions: vi.fn(),
    muteParticipant: vi.fn(),
    muteMicrophones: vi.fn(),
  },
}));

vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);
vi.mock("./repo.js", () => repoMock);
vi.mock("../media/service.js", () => mediaServiceMock);
vi.mock("../canvas/service.js", () => canvasServiceMock);

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
  lessonsServiceMock.ensureLivekitRoom.mockResolvedValue(`lesson-${LESSON_ID}`);
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

  it("выдача canSpeak синхронизирует уже выданный LiveKit-грант вживую (Э2.5)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");

    await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canSpeak: true });

    expect(mediaServiceMock.updateLivePermissions).toHaveBeenCalledWith(
      `lesson-${LESSON_ID}`,
      STUDENT_ID,
      expect.objectContaining({ canSpeak: true }),
    );
  });

  it("если синхронизация с LiveKit падает, presence не меняется и ученику не начинает казаться замьюченным зря", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");
    mediaServiceMock.updateLivePermissions.mockRejectedValueOnce(new Error("livekit unreachable"));

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canSpeak: true }),
    ).rejects.toThrow("livekit unreachable");

    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === STUDENT_ID)?.permissions.canSpeak).toBe(false);
  });

  it("не пускает пятого одновременно говорящего ученика (лимит §5.2 ТЗ)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);

    const studentIds = [
      STUDENT_ID,
      OTHER_STUDENT_ID,
      "88888888-8888-8888-8888-888888888888",
      "99999999-9999-9999-9999-999999999999",
    ];
    for (const id of studentIds) {
      await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(id), "Ученик");
      await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), id, { canSpeak: true });
    }

    const fifthId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(fifthId), "Пятый ученик");

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), fifthId, { canSpeak: true }),
    ).rejects.toMatchObject({ statusCode: 409, code: "mic_limit_reached" });
  });

  it("лимит не мешает переключить уже говорящего ученика (canSpeak не меняется на true впервые)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);

    const studentIds = [
      STUDENT_ID,
      OTHER_STUDENT_ID,
      "88888888-8888-8888-8888-888888888888",
      "99999999-9999-9999-9999-999999999999",
    ];
    for (const id of studentIds) {
      await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(id), "Ученик");
      await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), id, { canSpeak: true });
    }

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canDraw: true }),
    ).resolves.toBeUndefined();
  });

  it("изменение canDraw пушится в canvas живым обновлением (Э3.8)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");

    await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canDraw: true });

    expect(canvasServiceMock.setDrawPermission).toHaveBeenCalledWith(LESSON_ID, STUDENT_ID, true);
  });

  it("изменение canSpeak НЕ трогает canvas — canDraw не менялся", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");

    await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canSpeak: true });

    expect(canvasServiceMock.setDrawPermission).not.toHaveBeenCalled();
  });
});

describe("глобальный тумблер рисования (Э3.8)", () => {
  it("только учитель этого урока (или админ) может переключить право рисования всем разом", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.setDrawForAllStudents(SCHOOL_ID, LESSON_ID, studentToken(), true),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("выдаёт canDraw всем подключённым ученикам, учителя не трогает", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(OTHER_STUDENT_ID), "Другой ученик");
    await roomsService.join(SCHOOL_ID, LESSON_ID, teacherToken(), "Учитель");

    await roomsService.setDrawForAllStudents(SCHOOL_ID, LESSON_ID, teacherToken(), true);

    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === STUDENT_ID)?.permissions.canDraw).toBe(true);
    expect(snapshot.find((p) => p.userId === OTHER_STUDENT_ID)?.permissions.canDraw).toBe(true);
    expect(snapshot.find((p) => p.userId === TEACHER_ID)?.permissions.canDraw).toBe(true); // уже было true по дефолту, не менялось
    expect(canvasServiceMock.setDrawPermission).toHaveBeenCalledWith(LESSON_ID, STUDENT_ID, true);
    expect(canvasServiceMock.setDrawPermission).toHaveBeenCalledWith(LESSON_ID, OTHER_STUDENT_ID, true);
    expect(canvasServiceMock.setDrawPermission).not.toHaveBeenCalledWith(LESSON_ID, TEACHER_ID, expect.anything());
  });

  it("не синхронизирует LiveKit-грант — canDraw на аудио не влияет", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");

    await roomsService.setDrawForAllStudents(SCHOOL_ID, LESSON_ID, teacherToken(), true);

    expect(mediaServiceMock.updateLivePermissions).not.toHaveBeenCalled();
  });
});

describe("мьют микрофонов учителем (Э2.5)", () => {
  it("только учитель этого урока (или админ) может принудительно заглушить участника", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.muteParticipantNow(SCHOOL_ID, LESSON_ID, studentToken(), STUDENT_ID),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.muteParticipantNow(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID);
    expect(mediaServiceMock.muteParticipant).toHaveBeenCalledWith(`lesson-${LESSON_ID}`, STUDENT_ID);
  });

  it("«мьют всех» глушит только учеников, не трогает учителя", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(), "Ученик");
    await roomsService.join(SCHOOL_ID, LESSON_ID, studentToken(OTHER_STUDENT_ID), "Другой ученик");
    await roomsService.join(SCHOOL_ID, LESSON_ID, teacherToken(), "Учитель");

    await expect(roomsService.muteAllNow(SCHOOL_ID, LESSON_ID, studentToken())).rejects.toMatchObject({
      statusCode: 403,
    });

    await roomsService.muteAllNow(SCHOOL_ID, LESSON_ID, teacherToken());
    expect(mediaServiceMock.muteMicrophones).toHaveBeenCalledTimes(1);
    const [, mutedIds] = mediaServiceMock.muteMicrophones.mock.calls[0] as [string, string[]];
    expect(new Set(mutedIds)).toEqual(new Set([STUDENT_ID, OTHER_STUDENT_ID]));
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
    // Э3.2: финальный снимок доски — closeCanvasDocument закрывает /collab-подключения этого урока.
    expect(canvasServiceMock.closeCanvasDocument).toHaveBeenCalledWith(LESSON_ID);
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

describe("вебхуки LiveKit (Э2.7)", () => {
  const LIVEKIT_ROOM = `lesson-${LESSON_ID}`;

  it("participant_left закрывает открытую сессию посещаемости по имени комнаты", async () => {
    lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(baseLesson());

    await roomsService.handleParticipantLeftWebhook(LIVEKIT_ROOM, STUDENT_ID);

    expect(lessonsServiceMock.getLessonByLivekitRoom).toHaveBeenCalledWith(LIVEKIT_ROOM);
    expect(repoMock.closeOpenSession).toHaveBeenCalledWith(LESSON_ID, STUDENT_ID);
  });

  it("participant_left молча ничего не делает, если комната не сопоставлена ни с одним уроком", async () => {
    lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(null);

    await roomsService.handleParticipantLeftWebhook("unknown-room", STUDENT_ID);

    expect(repoMock.closeOpenSession).not.toHaveBeenCalled();
  });

  it("room_finished завершает ещё живой урок и рассылает lesson_status", async () => {
    lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(baseLesson({ status: "live" }));

    await roomsService.handleRoomFinishedWebhook(LIVEKIT_ROOM);

    expect(lessonsServiceMock.endLesson).toHaveBeenCalledWith(SCHOOL_ID, LESSON_ID);
    expect(canvasServiceMock.closeCanvasDocument).toHaveBeenCalledWith(LESSON_ID);
  });

  it("room_finished не трогает урок, который уже не live (идемпотентность)", async () => {
    lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(baseLesson({ status: "ended" }));

    await roomsService.handleRoomFinishedWebhook(LIVEKIT_ROOM);

    expect(lessonsServiceMock.endLesson).not.toHaveBeenCalled();
    expect(canvasServiceMock.closeCanvasDocument).not.toHaveBeenCalled();
  });
});
