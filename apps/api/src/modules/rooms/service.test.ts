import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";
import type { LessonActor } from "../guests/service.js";

const { lessonsServiceMock, usersServiceMock, repoMock, mediaServiceMock, canvasServiceMock } = vi.hoisted(() => ({
  canvasServiceMock: {
    closeCanvasDocument: vi.fn(),
    setDrawPermission: vi.fn(),
  },
  lessonsServiceMock: {
    getLesson: vi.fn(),
    ensureLivekitRoom: vi.fn(),
    getLessonByLivekitRoom: vi.fn(),
  },
  usersServiceMock: {
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
    findOtherActiveScreenShares: vi.fn().mockResolvedValue([]),
    muteScreenShare: vi.fn(),
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
  const modes = new Map<string, string>();
  const modesBeforeShare = new Map<string, string>();
  const stages = new Map<string, string>();
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
    // Э6.4: тоже бьёт в реальный Redis в оригинале — тот же in-memory приём, что и выше.
    getLessonMode: vi.fn(async (lessonId: string) => modes.get(lessonId) ?? "lecture"),
    setLessonMode: vi.fn(async (lessonId: string, mode: string) => {
      modes.set(lessonId, mode);
    }),
    // Э7.3: аналогично — сохранённый режим до начала демонстрации экрана.
    getLessonModeBeforeShare: vi.fn(async (lessonId: string) => modesBeforeShare.get(lessonId) ?? null),
    setLessonModeBeforeShare: vi.fn(async (lessonId: string, mode: string | null) => {
      if (mode === null) modesBeforeShare.delete(lessonId);
      else modesBeforeShare.set(lessonId, mode);
    }),
    // Э12 полировка: стейдж урока — тот же приём, что и режим выше.
    getLessonStage: vi.fn(async (lessonId: string) => stages.get(lessonId) ?? "people"),
    setLessonStage: vi.fn(async (lessonId: string, stage: string) => {
      stages.set(lessonId, stage);
    }),
    __clear: () => {
      rooms.clear();
      modes.clear();
      modesBeforeShare.clear();
      stages.clear();
    },
  };
});

const roomsService = await import("./service.js");
const presence = (await import("./presence.js")) as unknown as { __clear: () => void };

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const TEACHER_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_STUDENT_ID = "55555555-5555-5555-5555-555555555555";
const SECOND_LESSON_ID = "77777777-7777-7777-7777-777777777701";

function baseLesson(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LESSON_ID,
    schoolId: SCHOOL_ID,
    teacherId: TEACHER_ID,
    title: "Урок",
    subject: "Математика",
    startsAt: new Date(),
    durationMin: 45,
    livekitRoom: null,
    settings: {},
    ...overrides,
  };
}

function teacherToken(): AccessTokenPayload {
  return { sub: TEACHER_ID, schoolId: SCHOOL_ID, role: "teacher" };
}
/** Э12.9: роли `student` в модели нет — «легаси»-JWT, выданный до деплоя (TTL access-токена ещё не истёк). */
function studentToken(sub = STUDENT_ID): AccessTokenPayload {
  return { sub, schoolId: SCHOOL_ID, role: "student" } as unknown as AccessTokenPayload;
}

/** Э12.4: нормализованный actor для `join`/`leave`/чата/руки — как его строит `requireLessonAccess`. */
function staffActor(over: Partial<Extract<LessonActor, { kind: "staff" }>> = {}): LessonActor {
  return {
    kind: "staff",
    participantId: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "teacher",
    lessonId: LESSON_ID,
    displayName: "Учитель",
    ...over,
  };
}
function guestActor(participantId = STUDENT_ID, lessonId = LESSON_ID): LessonActor {
  return {
    kind: "guest",
    participantId,
    schoolId: SCHOOL_ID,
    role: null,
    lessonId,
    displayName: "Ученик",
  };
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
  it("Э12.4: гость входит в свой урок (личность = введённое имя + guestId)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    const result = await roomsService.join(guestActor(), LESSON_ID);
    expect(result.self.userId).toBe(STUDENT_ID);
    expect(result.self.kind).toBe("guest");
    expect(result.self.fullName).toBe("Ученик");
  });

  it("Э12.4: гостевая сессия другого урока получает 403", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.join(guestActor(OTHER_STUDENT_ID, SECOND_LESSON_ID), LESSON_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("учитель, не ведущий этот урок, получает 403", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson({ teacherId: "77777777-7777-7777-7777-777777777777" }));

    await expect(roomsService.join(staffActor(), LESSON_ID)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("методист не допускается к участию в уроке", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.join(staffActor({ role: "methodist", participantId: STUDENT_ID }), LESSON_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("Э12: урок постоянный — войти можно всегда, статуса урока больше нет", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    const result = await roomsService.join(guestActor(), LESSON_ID);

    expect(result).toMatchObject({ participants: expect.any(Array) });
    expect(result).not.toHaveProperty("lessonStatus");
  });
});

describe("Э12.4: гость на уроке — журнал, presence, чат, рука", () => {
  beforeEach(() => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
  });

  it("вход гостя пишет строку журнала с guestId и введённым именем, без userId", async () => {
    await roomsService.join(guestActor("guest-1"), LESSON_ID);

    expect(repoMock.insertJoin).toHaveBeenCalledWith({
      lessonId: LESSON_ID,
      kind: "guest",
      userId: null,
      guestId: "guest-1",
      displayName: "Ученик",
    });
  });

  it("гость поднимает руку — presence обновляется по его guestId", async () => {
    await roomsService.join(guestActor("guest-1"), LESSON_ID);

    await roomsService.setHandRaised(guestActor("guest-1"), LESSON_ID, true);

    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === "guest-1")?.handRaised).toBe(true);
  });

  it("сообщение чата от гостя пишется с guestId и authorName, без userId", async () => {
    repoMock.insertChatMessage.mockResolvedValue({
      id: "m1",
      lessonId: LESSON_ID,
      userId: null,
      body: "привет",
      createdAt: new Date(),
    });
    await roomsService.join(guestActor("guest-1"), LESSON_ID);

    const message = await roomsService.sendChatMessage(guestActor("guest-1"), LESSON_ID, "привет");

    expect(repoMock.insertChatMessage).toHaveBeenCalledWith({
      lessonId: LESSON_ID,
      userId: null,
      guestId: "guest-1",
      authorName: "Ученик",
      body: "привет",
    });
    expect(message.userId).toBeNull();
    expect(message.authorName).toBe("Ученик");
  });

  it("явный выход гостя закрывает сессию журнала по participantId", async () => {
    await roomsService.join(guestActor("guest-1"), LESSON_ID);

    await roomsService.leave(guestActor("guest-1"), LESSON_ID);

    expect(repoMock.closeOpenSession).toHaveBeenCalledWith(LESSON_ID, "guest-1");
  });
});

describe("права участников", () => {
  it("только учитель этого урока (или админ) может менять права", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    await roomsService.join(guestActor(), LESSON_ID);

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
    await roomsService.join(guestActor(), LESSON_ID);

    await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canSpeak: true });

    expect(mediaServiceMock.updateLivePermissions).toHaveBeenCalledWith(
      `lesson-${LESSON_ID}`,
      STUDENT_ID,
      expect.objectContaining({ canSpeak: true }),
      "guest",
    );
  });

  it("если синхронизация с LiveKit падает, presence не меняется и ученику не начинает казаться замьюченным зря", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    await roomsService.join(guestActor(), LESSON_ID);
    mediaServiceMock.updateLivePermissions.mockRejectedValueOnce(new Error("livekit unreachable"));

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canSpeak: true }),
    ).rejects.toThrow("livekit unreachable");

    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === STUDENT_ID)?.permissions.canSpeak).toBe(false);
  });

  it("не пускает пятого одновременно говорящего ученика (лимит §5.2 ТЗ)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    const studentIds = [
      STUDENT_ID,
      OTHER_STUDENT_ID,
      "88888888-8888-8888-8888-888888888888",
      "99999999-9999-9999-9999-999999999999",
    ];
    for (const id of studentIds) {
      await roomsService.join(guestActor(id), LESSON_ID);
      await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), id, { canSpeak: true });
    }

    const fifthId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await roomsService.join(guestActor(fifthId), LESSON_ID);

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), fifthId, { canSpeak: true }),
    ).rejects.toMatchObject({ statusCode: 409, code: "mic_limit_reached" });
  });

  it("лимит не мешает переключить уже говорящего ученика (canSpeak не меняется на true впервые)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    const studentIds = [
      STUDENT_ID,
      OTHER_STUDENT_ID,
      "88888888-8888-8888-8888-888888888888",
      "99999999-9999-9999-9999-999999999999",
    ];
    for (const id of studentIds) {
      await roomsService.join(guestActor(id), LESSON_ID);
      await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), id, { canSpeak: true });
    }

    await expect(
      roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canDraw: true }),
    ).resolves.toBeUndefined();
  });

  it("изменение canDraw пушится в canvas живым обновлением (Э3.8)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    await roomsService.join(guestActor(), LESSON_ID);

    await roomsService.updatePermissions(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, { canDraw: true });

    expect(canvasServiceMock.setDrawPermission).toHaveBeenCalledWith(LESSON_ID, STUDENT_ID, true);
  });

  it("изменение canSpeak НЕ трогает canvas — canDraw не менялся", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    await roomsService.join(guestActor(), LESSON_ID);

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
    await roomsService.join(guestActor(), LESSON_ID);
    await roomsService.join(guestActor(OTHER_STUDENT_ID), LESSON_ID);
    await roomsService.join(staffActor(), LESSON_ID);

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
    await roomsService.join(guestActor(), LESSON_ID);

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
    await roomsService.join(guestActor(), LESSON_ID);
    await roomsService.join(guestActor(OTHER_STUDENT_ID), LESSON_ID);
    await roomsService.join(staffActor(), LESSON_ID);

    await expect(roomsService.muteAllNow(SCHOOL_ID, LESSON_ID, studentToken())).rejects.toMatchObject({
      statusCode: 403,
    });

    await roomsService.muteAllNow(SCHOOL_ID, LESSON_ID, teacherToken());
    expect(mediaServiceMock.muteMicrophones).toHaveBeenCalledTimes(1);
    const [, mutedIds] = mediaServiceMock.muteMicrophones.mock.calls[0] as [string, string[]];
    expect(new Set(mutedIds)).toEqual(new Set([STUDENT_ID, OTHER_STUDENT_ID]));
  });
});

describe("закрепление в сетке видео (Э6.3)", () => {
  it("только учитель этого урока (или админ) может закреплять участников", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    await roomsService.join(guestActor(), LESSON_ID);

    await expect(
      roomsService.setPinned(SCHOOL_ID, LESSON_ID, studentToken(OTHER_STUDENT_ID), STUDENT_ID, true),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.setPinned(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, true);
    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === STUDENT_ID)?.pinned).toBe(true);
  });

  it("открепление возвращает pinned в false", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    await roomsService.join(guestActor(), LESSON_ID);
    await roomsService.setPinned(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, true);

    await roomsService.setPinned(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, false);

    const snapshot = await roomsService.listParticipantsSnapshot(LESSON_ID);
    expect(snapshot.find((p) => p.userId === STUDENT_ID)?.pinned).toBe(false);
  });

  it("404, если участника нет в комнате", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.setPinned(SCHOOL_ID, LESSON_ID, teacherToken(), STUDENT_ID, true),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("режим урока (Э6.4)", () => {
  it("по умолчанию урок в режиме lecture", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    const result = await roomsService.join(guestActor(), LESSON_ID);

    expect(result.lessonMode).toBe("lecture");
  });

  it("только учитель этого урока (или админ) может менять режим", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, studentToken(), "discussion"),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
    const result = await roomsService.join(guestActor(), LESSON_ID);
    expect(result.lessonMode).toBe("discussion");
  });
});

describe("синхронный стейдж урока (Э12 полировка)", () => {
  it("по умолчанию стейдж — «people» (плитки)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    const result = await roomsService.join(guestActor(), LESSON_ID);

    expect(result.stage).toBe("people");
  });

  it("только учитель этого урока (или админ) может переключать стейдж — гость и чужой персонал получают 403", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await expect(
      roomsService.setLessonStage(SCHOOL_ID, LESSON_ID, studentToken(), "board"),
    ).rejects.toMatchObject({ statusCode: 403 });

    await roomsService.setLessonStage(SCHOOL_ID, LESSON_ID, teacherToken(), "board");
    const result = await roomsService.join(guestActor(), LESSON_ID);
    expect(result.stage).toBe("board");
  });

  it("Э10.6: getCurrentLessonStage отдаёт текущий стейдж (recorder читает его сразу при подключении к WS)", async () => {
    expect(await roomsService.getCurrentLessonStage(LESSON_ID)).toBe("people");
    await roomsService.setLessonStage(SCHOOL_ID, LESSON_ID, teacherToken(), "board");
    expect(await roomsService.getCurrentLessonStage(LESSON_ID)).toBe("board");
  });
});

describe("оценка трафика платформы (Э6.5)", () => {
  it("estimateLessonMbit — коэффициенты §5.2/§5.2.1 ТЗ (класс 30)", () => {
    expect(roomsService.estimateLessonMbit("lecture", 30)).toBeCloseTo(50);
    expect(roomsService.estimateLessonMbit("discussion", 30)).toBeCloseTo(180);
    expect(roomsService.estimateLessonMbit("assignment", 30)).toBe(5);
    expect(roomsService.estimateLessonMbit("assignment", 1)).toBe(5);
  });

  it("estimateTotalTrafficMbit суммирует по всем урокам", () => {
    const total = roomsService.estimateTotalTrafficMbit([
      { mode: "discussion", participantCount: 30 },
      { mode: "lecture", participantCount: 30 },
    ]);
    expect(total).toBeCloseTo(230);
  });

  it("новая комната открывается принудительно в Лекции, если платформа уже перегружена (>600 Мбит/с, §10.8 ТЗ)", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    // "Другой" урок — Обсуждение с большим классом, суммарно > 600 Мбит/с (106 × 6 = 636).
    await roomsService.join(staffActor({ lessonId: SECOND_LESSON_ID }), SECOND_LESSON_ID);
    await roomsService.setLessonMode(SCHOOL_ID, SECOND_LESSON_ID, teacherToken(), "discussion");
    for (let i = 0; i < 105; i++) {
      await roomsService.join(guestActor(`traffic-student-${i}`, SECOND_LESSON_ID), SECOND_LESSON_ID);
    }

    // Новая комната LESSON_ID должна открыться в Лекции, даже если её режим
    // был заранее (или по ошибке) выставлен в discussion.
    await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
    const result = await roomsService.join(staffActor(), LESSON_ID);

    expect(result.lessonMode).toBe("lecture");
  });

  it("не трогает режим новой комнаты, пока платформа не перегружена", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await roomsService.join(staffActor({ lessonId: SECOND_LESSON_ID }), SECOND_LESSON_ID);
    await roomsService.setLessonMode(SCHOOL_ID, SECOND_LESSON_ID, teacherToken(), "discussion");
    // Всего 5 участников в "другом" уроке — далеко не 600 Мбит/с.
    for (let i = 0; i < 5; i++) {
      await roomsService.join(guestActor(`light-student-${i}`, SECOND_LESSON_ID), SECOND_LESSON_ID);
    }

    await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
    const result = await roomsService.join(staffActor(), LESSON_ID);

    expect(result.lessonMode).toBe("discussion");
  });

  it("getActiveLessonTrafficSnapshot (Э6.6) отдаёт оценку по каждому активному уроку — источник данных для lesson_traffic_mbit", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());

    await roomsService.join(staffActor(), LESSON_ID);
    await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
    await roomsService.join(guestActor(), LESSON_ID);

    const snapshot = await roomsService.getActiveLessonTrafficSnapshot();
    const entry = snapshot.find((s) => s.lessonId === LESSON_ID);

    expect(entry).toMatchObject({ mode: "discussion", participantCount: 2 });
    expect(entry?.estimatedMbit).toBeCloseTo(roomsService.estimateLessonMbit("discussion", 2));
  });
});

describe("модерация чата", () => {
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

  it("room_finished освобождает ресурсы закрывшейся комнаты (Э12.9: урок постоянный, «завершать» нечего)", async () => {
    lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(baseLesson());

    await roomsService.handleRoomFinishedWebhook(LIVEKIT_ROOM);

    // Э3.2: финальный снимок доски — closeCanvasDocument закрывает /collab-подключения этого урока.
    expect(canvasServiceMock.closeCanvasDocument).toHaveBeenCalledWith(LESSON_ID);
  });

  it("room_finished молча ничего не делает, если комната не сопоставлена ни с одним уроком", async () => {
    lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(null);

    await roomsService.handleRoomFinishedWebhook("unknown-room");

    expect(canvasServiceMock.closeCanvasDocument).not.toHaveBeenCalled();
  });

  describe("демонстрация экрана: track_published/track_unpublished SCREEN_SHARE (Э7.2 + Э7.3)", () => {
    beforeEach(() => {
      lessonsServiceMock.getLessonByLivekitRoom.mockResolvedValue(baseLesson());
      lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
    });

    it("учитель начинает демонстрацию — переводит урок в lecture, никого не гасит (конфликтов нет)", async () => {
      await roomsService.join(staffActor(), LESSON_ID);
      await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");

      await roomsService.handleScreenShareStartedWebhook(LIVEKIT_ROOM, TEACHER_ID);

      expect(mediaServiceMock.muteScreenShare).not.toHaveBeenCalled();
      const snapshot = await roomsService.join(staffActor(), LESSON_ID);
      expect(snapshot.lessonMode).toBe("lecture");
    });

    it("учитель начинает демонстрацию, пока ученик уже делится — гасит демонстрацию ученика (приоритет учителю)", async () => {
      await roomsService.join(staffActor(), LESSON_ID);
      mediaServiceMock.findOtherActiveScreenShares.mockResolvedValueOnce([STUDENT_ID]);

      await roomsService.handleScreenShareStartedWebhook(LIVEKIT_ROOM, TEACHER_ID);

      expect(mediaServiceMock.muteScreenShare).toHaveBeenCalledWith(LIVEKIT_ROOM, STUDENT_ID);
    });

    it("ученик пытается начать демонстрацию, пока кто-то уже делится — гасит СВОЮ новую демонстрацию, режим не трогает", async () => {
      await roomsService.join(guestActor(), LESSON_ID);
      await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
      mediaServiceMock.findOtherActiveScreenShares.mockResolvedValueOnce([TEACHER_ID]);

      await roomsService.handleScreenShareStartedWebhook(LIVEKIT_ROOM, STUDENT_ID);

      expect(mediaServiceMock.muteScreenShare).toHaveBeenCalledWith(LIVEKIT_ROOM, STUDENT_ID);
      const snapshot = await roomsService.join(guestActor(), LESSON_ID);
      expect(snapshot.lessonMode).toBe("discussion");
    });

    it("демонстрация окончена и других не осталось — возвращает сохранённый режим", async () => {
      await roomsService.join(staffActor(), LESSON_ID);
      await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
      await roomsService.handleScreenShareStartedWebhook(LIVEKIT_ROOM, TEACHER_ID);

      await roomsService.handleScreenShareStoppedWebhook(LIVEKIT_ROOM);

      const snapshot = await roomsService.join(staffActor(), LESSON_ID);
      expect(snapshot.lessonMode).toBe("discussion");
    });

    it("демонстрация окончена, но другая ещё идёт — режим пока не возвращает", async () => {
      await roomsService.join(staffActor(), LESSON_ID);
      await roomsService.setLessonMode(SCHOOL_ID, LESSON_ID, teacherToken(), "discussion");
      await roomsService.handleScreenShareStartedWebhook(LIVEKIT_ROOM, TEACHER_ID);
      mediaServiceMock.findOtherActiveScreenShares.mockResolvedValueOnce([STUDENT_ID]);

      await roomsService.handleScreenShareStoppedWebhook(LIVEKIT_ROOM);

      const snapshot = await roomsService.join(staffActor(), LESSON_ID);
      expect(snapshot.lessonMode).toBe("lecture");
    });

    it("режим уже был lecture до демонстрации — после окончания ничего не меняет", async () => {
      await roomsService.join(staffActor(), LESSON_ID);
      await roomsService.handleScreenShareStartedWebhook(LIVEKIT_ROOM, TEACHER_ID);

      await roomsService.handleScreenShareStoppedWebhook(LIVEKIT_ROOM);

      const snapshot = await roomsService.join(staffActor(), LESSON_ID);
      expect(snapshot.lessonMode).toBe("lecture");
    });
  });
});
