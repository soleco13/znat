import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload, Material } from "@school/shared";

const { repoMock, lessonsServiceMock, usersServiceMock, materialsServiceMock, roomsServiceMock, redisMock } =
  vi.hoisted(() => ({
    repoMock: {
      insertActivity: vi.fn(),
      findActivityById: vi.fn(),
      listActivitiesByLesson: vi.fn(),
      maxAttemptNumber: vi.fn(),
      findResponsesByAttempt: vi.fn(),
      upsertDraftResponse: vi.fn(),
      answeredStatsByActivity: vi.fn(),
      listResponsesByActivity: vi.fn(),
    },
    lessonsServiceMock: { getLesson: vi.fn() },
    usersServiceMock: { isGroupMember: vi.fn(), listGroupStudents: vi.fn() },
    materialsServiceMock: { getLatestMaterial: vi.fn(), getMaterialVersion: vi.fn(), gradeResponse: vi.fn() },
    roomsServiceMock: { broadcastToLesson: vi.fn() },
    redisMock: { set: vi.fn(), get: vi.fn(), mget: vi.fn() },
  }));

vi.mock("./repo.js", () => repoMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);
vi.mock("../materials/service.js", () => materialsServiceMock);
vi.mock("../rooms/service.js", () => roomsServiceMock);
vi.mock("../../db/redis.js", () => ({ redis: redisMock }));

const {
  createActivity,
  getMyActivity,
  listLessonActivities,
  saveResponse,
  getProgress,
  getAnalytics,
  deriveAttemptId,
} = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const OTHER_SCHOOL = "aaaaaaaa-1111-1111-1111-111111111111";
const LESSON = "22222222-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";
const MATERIAL = "44444444-4444-4444-4444-444444444444";
const VERSION = "55555555-5555-5555-5555-555555555555";
const ACTIVITY = "66666666-6666-6666-6666-666666666666";
const STUDENT_A = "77777777-7777-7777-7777-777777777777";
const STUDENT_B = "88888888-8888-8888-8888-888888888888";

const teacher: AccessTokenPayload = { sub: TEACHER, schoolId: SCHOOL, role: "teacher" };
const otherTeacher: AccessTokenPayload = { sub: "99999999-9999-9999-9999-999999999999", schoolId: SCHOOL, role: "teacher" };
const studentA: AccessTokenPayload = { sub: STUDENT_A, schoolId: SCHOOL, role: "student" };
const studentB: AccessTokenPayload = { sub: STUDENT_B, schoolId: SCHOOL, role: "student" };

/** Материал с одним вопросом, у которого есть ключ ответа (`correct`). */
const material: Material = {
  id: "m-1",
  schemaVersion: 1,
  title: "Дроби",
  subject: "Математика",
  grades: [5],
  tags: [],
  settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1 },
  blocks: [
    {
      type: "question",
      id: "q1",
      prompt: { html: "2 + 2 = ?" },
      points: 1,
      interaction: {
        type: "single_choice",
        shuffle: false,
        options: [
          { id: "o1", html: "3", correct: false },
          { id: "o2", html: "4", correct: true },
        ],
      },
    },
  ],
};

const activityRow = {
  id: ACTIVITY,
  lessonId: LESSON,
  materialVersionId: VERSION,
  materialId: MATERIAL,
  materialVersion: 1,
  schoolId: SCHOOL,
  mode: "lesson" as const,
  deadline: new Date("2026-09-05T10:00:00.000Z"),
  timerSeconds: 600,
  createdAt: new Date("2026-09-04T09:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue({
    id: LESSON,
    schoolId: SCHOOL,
    teacherId: TEACHER,
    groupId: "group-1",
    status: "live",
  });
  usersServiceMock.isGroupMember.mockResolvedValue(true);
  materialsServiceMock.getLatestMaterial.mockResolvedValue({
    materialId: MATERIAL,
    versionId: VERSION,
    version: 1,
    material,
  });
  materialsServiceMock.getMaterialVersion.mockResolvedValue({
    materialId: MATERIAL,
    versionId: VERSION,
    version: 1,
    material,
  });
  repoMock.insertActivity.mockResolvedValue(ACTIVITY);
  repoMock.findActivityById.mockResolvedValue(activityRow);
  repoMock.maxAttemptNumber.mockResolvedValue(0);
  repoMock.findResponsesByAttempt.mockResolvedValue([]);
  repoMock.upsertDraftResponse.mockResolvedValue(new Date("2026-09-04T09:31:00.000Z"));
  repoMock.answeredStatsByActivity.mockResolvedValue([]);
  repoMock.listResponsesByActivity.mockResolvedValue([]);
  usersServiceMock.listGroupStudents.mockResolvedValue([]);
  redisMock.set.mockResolvedValue("OK");
  redisMock.get.mockResolvedValue("2026-09-04T09:30:00.000Z");
  redisMock.mget.mockResolvedValue([]);
});

describe("deriveAttemptId", () => {
  it("детерминирован и валидный UUID v5", () => {
    const a = deriveAttemptId(ACTIVITY, STUDENT_A, 1);
    const b = deriveAttemptId(ACTIVITY, STUDENT_A, 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("разный для разных учеников и разных попыток", () => {
    expect(deriveAttemptId(ACTIVITY, STUDENT_A, 1)).not.toBe(deriveAttemptId(ACTIVITY, STUDENT_B, 1));
    expect(deriveAttemptId(ACTIVITY, STUDENT_A, 1)).not.toBe(deriveAttemptId(ACTIVITY, STUDENT_A, 2));
  });
});

describe("createActivity (Э8.6)", () => {
  it("учитель-хозяин: закрепляет версию, шлёт activity_started, возвращает dto", async () => {
    const dto = await createActivity(teacher, LESSON, {
      materialId: MATERIAL,
      mode: "lesson",
      deadline: "2026-09-05T10:00:00.000Z",
      timerSeconds: 600,
    });

    expect(repoMock.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ materialVersionId: VERSION, lessonId: LESSON, assignedBy: TEACHER }),
    );
    expect(roomsServiceMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "activity_started",
      activityId: ACTIVITY,
    });
    expect(dto).toMatchObject({ id: ACTIVITY, materialId: MATERIAL, materialVersion: 1, mode: "lesson" });
    expect(dto.deadline).toBe("2026-09-05T10:00:00.000Z");
  });

  it("чужой учитель не может запустить задание", async () => {
    await expect(
      createActivity(otherTeacher, LESSON, { materialId: MATERIAL, mode: "lesson" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.insertActivity).not.toHaveBeenCalled();
  });

  it("нельзя выдать задание в завершённый урок", async () => {
    lessonsServiceMock.getLesson.mockResolvedValue({
      id: LESSON,
      schoolId: SCHOOL,
      teacherId: TEACHER,
      groupId: "group-1",
      status: "ended",
    });
    await expect(
      createActivity(teacher, LESSON, { materialId: MATERIAL, mode: "lesson" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("getMyActivity (Э8.6) — индивидуальный канал", () => {
  it("ученик-участник: материал без ключей ответов, свой attemptId", async () => {
    const my = await getMyActivity(studentA, ACTIVITY);

    expect(my.attemptId).toBe(deriveAttemptId(ACTIVITY, STUDENT_A, 1));
    expect(my.attemptNumber).toBe(1);
    expect(my.deadline).toBe("2026-09-05T10:00:00.000Z");
    expect(my.timerSeconds).toBe(600);
    expect(my.startedAt).toBe("2026-09-04T09:30:00.000Z");

    const question = my.material.blocks.find((b) => b.type === "question");
    expect(question).toBeDefined();
    // Ключ ответа не должен просочиться.
    expect(JSON.stringify(my.material)).not.toContain("correct");
  });

  it("два ученика получают разные attemptId (порядок вариантов/ответы не пересекаются)", async () => {
    const a = await getMyActivity(studentA, ACTIVITY);
    const b = await getMyActivity(studentB, ACTIVITY);
    expect(a.attemptId).not.toBe(b.attemptId);
  });

  it("отдаёт ранее сохранённые черновики только своей попытки", async () => {
    const attemptId = deriveAttemptId(ACTIVITY, STUDENT_A, 1);
    repoMock.findResponsesByAttempt.mockImplementation((id: string) =>
      Promise.resolve(
        id === attemptId
          ? [{ questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } }]
          : [],
      ),
    );

    const a = await getMyActivity(studentA, ACTIVITY);
    expect(a.savedResponses.q1).toEqual({ type: "single_choice", selectedOptionId: "o2" });

    const b = await getMyActivity(studentB, ACTIVITY);
    expect(b.savedResponses).toEqual({});
    expect(repoMock.findResponsesByAttempt).toHaveBeenCalledWith(deriveAttemptId(ACTIVITY, STUDENT_B, 1));
  });

  it("ученик не из группы урока — 403", async () => {
    usersServiceMock.isGroupMember.mockResolvedValue(false);
    await expect(getMyActivity(studentA, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("задание другой школы — 404 (существование не подтверждаем)", async () => {
    repoMock.findActivityById.mockResolvedValue({ ...activityRow, schoolId: OTHER_SCHOOL });
    await expect(getMyActivity(studentA, ACTIVITY)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("возобновляет вторую попытку, если по первой уже есть ответы", async () => {
    repoMock.maxAttemptNumber.mockResolvedValue(1);
    const my = await getMyActivity(studentA, ACTIVITY);
    expect(my.attemptNumber).toBe(1);
    // maxAttemptNumber=1 → текущая всё ещё 1 (submit создаёт следующую, Э8.7+).
    expect(my.attemptId).toBe(deriveAttemptId(ACTIVITY, STUDENT_A, 1));
  });
});

describe("saveResponse (Э8.7) — автосохранение черновика", () => {
  const draft = { type: "single_choice" as const, selectedOptionId: "o2" };

  it("ученик-участник: upsert по своему attemptId, { saved: true }", async () => {
    const res = await saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft });

    expect(res).toEqual({ saved: true, savedAt: "2026-09-04T09:31:00.000Z" });
    expect(repoMock.upsertDraftResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: deriveAttemptId(ACTIVITY, STUDENT_A, 1),
        attemptNumber: 1,
        activityId: ACTIVITY,
        materialId: MATERIAL,
        lessonId: LESSON,
        userId: STUDENT_A,
        questionId: "q1",
        response: draft,
      }),
    );
  });

  it("идемпотентно: повторная отправка того же — снова upsert, не падает", async () => {
    await saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft });
    await saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft });
    expect(repoMock.upsertDraftResponse).toHaveBeenCalledTimes(2);
  });

  it("два ученика пишут в РАЗНЫЕ attemptId (ответы не пересекаются)", async () => {
    await saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft });
    await saveResponse(studentB, ACTIVITY, { questionId: "q1", response: draft });
    const [a] = repoMock.upsertDraftResponse.mock.calls[0]!;
    const [b] = repoMock.upsertDraftResponse.mock.calls[1]!;
    expect(a.attemptId).not.toBe(b.attemptId);
  });

  it("не ученик (учитель) не сохраняет ответы — 403", async () => {
    await expect(
      saveResponse(teacher, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.upsertDraftResponse).not.toHaveBeenCalled();
  });

  it("дедлайн прошёл — 409, ответ не пишется", async () => {
    repoMock.findActivityById.mockResolvedValue({ ...activityRow, deadline: new Date("2020-01-01T00:00:00.000Z") });
    await expect(
      saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(repoMock.upsertDraftResponse).not.toHaveBeenCalled();
  });

  it("вопроса нет в материале — 404", async () => {
    await expect(
      saveResponse(studentA, ACTIVITY, { questionId: "нет-такого", response: draft }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("тип ответа не совпадает с типом вопроса — 400", async () => {
    await expect(
      saveResponse(studentA, ACTIVITY, {
        questionId: "q1",
        response: { type: "true_false", value: true },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("ученик не из группы — 403", async () => {
    usersServiceMock.isGroupMember.mockResolvedValue(false);
    await expect(
      saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("getProgress (Э8.8) — панель прогресса класса", () => {
  const twoQuestionMaterial: Material = {
    ...material,
    blocks: [
      material.blocks[0]!,
      { ...(material.blocks[0] as Extract<Material["blocks"][number], { type: "question" }>), id: "q2" },
    ],
  };

  beforeEach(() => {
    materialsServiceMock.getMaterialVersion.mockResolvedValue({
      materialId: MATERIAL,
      versionId: VERSION,
      version: 1,
      material: twoQuestionMaterial,
    });
    usersServiceMock.listGroupStudents.mockResolvedValue([
      { id: STUDENT_A, fullName: "Аня" },
      { id: STUDENT_B, fullName: "Боря" },
      { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", fullName: "Витя" },
    ]);
  });

  it("классифицирует not_started / in_progress / stuck", async () => {
    // Аня ответила на оба — in_progress; Боря открыл, ответил 1 и давно молчит — stuck; Витя не открывал.
    repoMock.answeredStatsByActivity.mockResolvedValue([
      { userId: STUDENT_A, answered: 2, lastAt: new Date().toISOString() },
      { userId: STUDENT_B, answered: 1, lastAt: "2020-01-01T00:00:00.000Z" },
    ]);
    redisMock.mget.mockResolvedValue(["2026-09-04T09:00:00.000Z", "2026-09-04T09:00:00.000Z", null]);

    const progress = await getProgress(teacher, ACTIVITY);

    expect(progress.total).toBe(2);
    const byName = Object.fromEntries(progress.students.map((s) => [s.fullName, s]));
    expect(byName["Аня"]).toMatchObject({ status: "in_progress", answered: 2 });
    expect(byName["Боря"]).toMatchObject({ status: "stuck", answered: 1 });
    expect(byName["Витя"]).toMatchObject({ status: "not_started", answered: 0, lastActivityAt: null });
  });

  it("ученик открыл, но ещё не отвечал — in_progress, не not_started", async () => {
    repoMock.answeredStatsByActivity.mockResolvedValue([]);
    redisMock.mget.mockResolvedValue(["2026-09-04T09:00:00.000Z", null, null]);
    const progress = await getProgress(teacher, ACTIVITY);
    const anya = progress.students.find((s) => s.fullName === "Аня")!;
    expect(anya.status).toBe("in_progress");
  });

  it("чужой учитель не видит прогресс — 403", async () => {
    await expect(getProgress(otherTeacher, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("getAnalytics (Э8.9) — гистограмма ответов", () => {
  it("учителю: по одному разбору на вопрос + число ответивших", async () => {
    repoMock.listResponsesByActivity.mockResolvedValue([
      { userId: STUDENT_A, questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
      { userId: STUDENT_B, questionId: "q1", response: { type: "single_choice", selectedOptionId: "o1" } },
    ]);

    const analytics = await getAnalytics(teacher, ACTIVITY);

    expect(analytics.respondents).toBe(2);
    expect(analytics.questions).toHaveLength(1);
    const q = analytics.questions[0]!;
    expect(q).toMatchObject({ questionId: "q1", interactionType: "single_choice", totalAnswered: 2 });
    expect(q.distribution).toEqual({
      kind: "choice",
      bars: [
        { key: "o1", label: "3", count: 1, correct: false },
        { key: "o2", label: "4", count: 1, correct: true },
      ],
    });
  });

  it("чужой учитель — 403", async () => {
    await expect(getAnalytics(otherTeacher, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("listLessonActivities (Э8.6)", () => {
  it("участнику урока — список выдач", async () => {
    repoMock.listActivitiesByLesson.mockResolvedValue([activityRow]);
    const items = await listLessonActivities(studentA, LESSON);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: ACTIVITY, materialId: MATERIAL });
  });

  it("не участнику — 403", async () => {
    usersServiceMock.isGroupMember.mockResolvedValue(false);
    await expect(listLessonActivities(studentA, LESSON)).rejects.toMatchObject({ statusCode: 403 });
  });
});
