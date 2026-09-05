import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload, Material } from "@school/shared";

const {
  repoMock,
  lessonsServiceMock,
  usersServiceMock,
  materialsServiceMock,
  roomsServiceMock,
  canvasServiceMock,
  redisMock,
} = vi.hoisted(() => ({
  repoMock: {
    insertActivity: vi.fn(),
    findActivityById: vi.fn(),
    listActivitiesByLesson: vi.fn(),
    listHomeworkActivitiesByGroup: vi.fn(),
    maxAttemptNumber: vi.fn(),
    findResponsesByAttempt: vi.fn(),
    upsertDraftResponse: vi.fn(),
    answeredStatsByActivity: vi.fn(),
    listResponsesByActivity: vi.fn(),
    markReviewed: vi.fn(),
    attemptSubmittedAt: vi.fn(),
    upsertGradedResponse: vi.fn(),
    listPendingManualGrading: vi.fn(),
    findResponseForGrading: vi.fn(),
    persistManualGrade: vi.fn(),
  },
  lessonsServiceMock: { getLesson: vi.fn() },
  usersServiceMock: { isGroupMember: vi.fn(), listGroupStudents: vi.fn(), getGroupOrThrow: vi.fn() },
  materialsServiceMock: { getLatestMaterial: vi.fn(), getMaterialVersion: vi.fn(), gradeResponse: vi.fn() },
  roomsServiceMock: { broadcastToLesson: vi.fn() },
  canvasServiceMock: { postAnswerToBoard: vi.fn() },
  redisMock: { set: vi.fn(), get: vi.fn(), mget: vi.fn() },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);
vi.mock("../materials/service.js", () => materialsServiceMock);
vi.mock("../rooms/service.js", () => roomsServiceMock);
vi.mock("../canvas/service.js", () => canvasServiceMock);
vi.mock("../../db/redis.js", () => ({ redis: redisMock }));

const {
  createActivity,
  getMyActivity,
  listLessonActivities,
  createHomeworkActivity,
  listGroupActivities,
  saveResponse,
  getProgress,
  getAnalytics,
  startReview,
  getReview,
  getReviewResponses,
  pushAnswerToBoard,
  deriveAttemptId,
  submitActivity,
  getGradingQueue,
  gradeManualResponse,
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
const GROUP = "group-1";
const HOMEWORK_ACTIVITY = "aabbaabb-aabb-aabb-aabb-aabbaabbaabb";

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
  groupId: GROUP,
  materialVersionId: VERSION,
  materialId: MATERIAL,
  materialVersion: 1,
  schoolId: SCHOOL,
  mode: "lesson" as const,
  assignedBy: TEACHER,
  // Относительный дедлайн (неделя вперёд) — не фиксированная дата: submitActivity
  // сравнивает его с `Date.now()`, фиксированный «2026-09-05» стал бы time-bomb'ом,
  // который зеленел утром и падал вечером того же дня.
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  timerSeconds: 600,
  createdAt: new Date("2026-09-04T09:00:00.000Z"),
  reviewedAt: null,
};

/** Домашняя выдача (Э8.11) — `lessonId: null`, вне зависимости от `activityRow` выше. */
const homeworkRow = {
  ...activityRow,
  id: HOMEWORK_ACTIVITY,
  lessonId: null,
  mode: "homework" as const,
  deadline: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue({
    id: LESSON,
    schoolId: SCHOOL,
    teacherId: TEACHER,
    groupId: GROUP,
    status: "live",
  });
  usersServiceMock.isGroupMember.mockResolvedValue(true);
  usersServiceMock.getGroupOrThrow.mockResolvedValue({ id: GROUP, schoolId: SCHOOL, name: "5А", grade: 5, academicYear: "2026" });
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
  repoMock.listHomeworkActivitiesByGroup.mockResolvedValue([]);
  repoMock.maxAttemptNumber.mockResolvedValue(0);
  repoMock.findResponsesByAttempt.mockResolvedValue([]);
  repoMock.upsertDraftResponse.mockResolvedValue(new Date("2026-09-04T09:31:00.000Z"));
  repoMock.answeredStatsByActivity.mockResolvedValue([]);
  repoMock.listResponsesByActivity.mockResolvedValue([]);
  repoMock.markReviewed.mockResolvedValue(new Date("2026-09-04T09:40:00.000Z"));
  repoMock.attemptSubmittedAt.mockResolvedValue(null);
  repoMock.upsertGradedResponse.mockResolvedValue(undefined);
  repoMock.listPendingManualGrading.mockResolvedValue([]);
  repoMock.findResponseForGrading.mockResolvedValue(null);
  repoMock.persistManualGrade.mockResolvedValue(new Date("2026-09-04T09:50:00.000Z"));
  canvasServiceMock.postAnswerToBoard.mockResolvedValue(undefined);
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
    expect(dto.deadline).toBe(activityRow.deadline!.toISOString());
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
    expect(my.deadline).toBe(activityRow.deadline!.toISOString());
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

  it("работа уже сдана (Э8.12) — 409, черновик не пишется", async () => {
    repoMock.attemptSubmittedAt.mockResolvedValue(new Date("2026-09-04T09:35:00.000Z"));
    await expect(
      saveResponse(studentA, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 409, code: "already_submitted" });
    expect(repoMock.upsertDraftResponse).not.toHaveBeenCalled();
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

describe("startReview / getReview (Э8.10) — разбор", () => {
  it("учитель начинает разбор: помечает, шлёт activity_reviewed", async () => {
    const result = await startReview(teacher, ACTIVITY);
    expect(repoMock.markReviewed).toHaveBeenCalledWith(ACTIVITY);
    expect(roomsServiceMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "activity_reviewed",
      activityId: ACTIVITY,
    });
    expect(result).toEqual({ activityId: ACTIVITY, reviewedAt: "2026-09-04T09:40:00.000Z" });
  });

  it("чужой учитель не может начать разбор — 403", async () => {
    await expect(startReview(otherTeacher, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.markReviewed).not.toHaveBeenCalled();
  });

  it("до начала разбора — 409, ключи ответов не отдаются", async () => {
    await expect(getReview(studentA, ACTIVITY)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("после начала разбора — ПОЛНЫЙ материал (с ключом ответа), доступен и ученику", async () => {
    repoMock.findActivityById.mockResolvedValue({ ...activityRow, reviewedAt: new Date("2026-09-04T09:40:00.000Z") });
    const review = await getReview(studentA, ACTIVITY);
    expect(review.reviewedAt).toBe("2026-09-04T09:40:00.000Z");
    expect(JSON.stringify(review.material)).toContain("correct");
  });
});

describe("getReviewResponses / pushAnswerToBoard (Э8.10) — вынести ответ на доску", () => {
  const reviewedRow = { ...activityRow, reviewedAt: new Date("2026-09-04T09:40:00.000Z") };

  beforeEach(() => {
    repoMock.findActivityById.mockResolvedValue(reviewedRow);
    usersServiceMock.listGroupStudents.mockResolvedValue([
      { id: STUDENT_A, fullName: "Аня" },
      { id: STUDENT_B, fullName: "Боря" },
    ]);
    repoMock.listResponsesByActivity.mockResolvedValue([
      { userId: STUDENT_A, questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
    ]);
  });

  it("до начала разбора — 409", async () => {
    repoMock.findActivityById.mockResolvedValue(activityRow);
    await expect(getReviewResponses(teacher, ACTIVITY, "q1")).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", userId: STUDENT_A, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("getReviewResponses: только ответившие, с именами", async () => {
    const result = await getReviewResponses(teacher, ACTIVITY, "q1");
    expect(result).toEqual({
      questionId: "q1",
      responses: [{ userId: STUDENT_A, fullName: "Аня", response: { type: "single_choice", selectedOptionId: "o2" } }],
    });
  });

  it("ученику аналитика по именам недоступна — 403", async () => {
    await expect(getReviewResponses(studentA, ACTIVITY, "q1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("pushAnswerToBoard: анонимно — без имени, текст ответа читаемый", async () => {
    await pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", userId: STUDENT_A, anonymous: true });
    expect(canvasServiceMock.postAnswerToBoard).toHaveBeenCalledWith(LESSON, "Ответ ученика:\n4");
  });

  it("pushAnswerToBoard: с именем — подпись ученика", async () => {
    await pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", userId: STUDENT_A, anonymous: false });
    expect(canvasServiceMock.postAnswerToBoard).toHaveBeenCalledWith(LESSON, "Аня:\n4");
  });

  it("у ученика нет ответа на вопрос — 404", async () => {
    await expect(
      pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", userId: STUDENT_B, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(canvasServiceMock.postAnswerToBoard).not.toHaveBeenCalled();
  });

  it("ученик не может выносить ответы на доску — 403", async () => {
    await expect(
      pushAnswerToBoard(studentA, ACTIVITY, { questionId: "q1", userId: STUDENT_A, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 403 });
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

describe("createHomeworkActivity / listGroupActivities (Э8.11) — «ученик заходит и делает»", () => {
  it("учитель задаёт домашнюю работу группе: lessonId null, groupId группы, mode homework", async () => {
    repoMock.insertActivity.mockResolvedValue(HOMEWORK_ACTIVITY);
    repoMock.findActivityById.mockResolvedValue(homeworkRow);

    const dto = await createHomeworkActivity(teacher, GROUP, { materialId: MATERIAL, mode: "lesson" });

    expect(usersServiceMock.getGroupOrThrow).toHaveBeenCalledWith(SCHOOL, GROUP);
    expect(repoMock.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ lessonId: null, groupId: GROUP, mode: "homework", assignedBy: TEACHER }),
    );
    // `mode: "lesson"` в теле ИГНОРИРУЕТСЯ — это эндпоинт домашней работы, режим определяет URL.
    expect(dto).toMatchObject({ id: HOMEWORK_ACTIVITY, lessonId: null, groupId: GROUP, mode: "homework" });
  });

  it("ученик не может задать домашнюю работу — 403", async () => {
    await expect(
      createHomeworkActivity(studentA, GROUP, { materialId: MATERIAL, mode: "lesson" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.insertActivity).not.toHaveBeenCalled();
  });

  it("группа другой школы — 404 (getGroupOrThrow сам проверяет школу)", async () => {
    usersServiceMock.getGroupOrThrow.mockRejectedValue(
      Object.assign(new Error("not_found"), { statusCode: 404 }),
    );
    await expect(
      createHomeworkActivity(teacher, GROUP, { materialId: MATERIAL, mode: "lesson" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("listGroupActivities: ученик из группы — список её домашних заданий", async () => {
    repoMock.listHomeworkActivitiesByGroup.mockResolvedValue([homeworkRow]);
    const items = await listGroupActivities(studentA, GROUP);
    expect(repoMock.listHomeworkActivitiesByGroup).toHaveBeenCalledWith(GROUP);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: HOMEWORK_ACTIVITY, mode: "homework" });
  });

  it("listGroupActivities: ученик НЕ из группы — 403", async () => {
    usersServiceMock.isGroupMember.mockResolvedValue(false);
    await expect(listGroupActivities(studentA, GROUP)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("listGroupActivities: любой учитель школы видит список без проверки членства", async () => {
    repoMock.listHomeworkActivitiesByGroup.mockResolvedValue([homeworkRow]);
    const items = await listGroupActivities(otherTeacher, GROUP);
    expect(usersServiceMock.isGroupMember).not.toHaveBeenCalled();
    expect(items).toHaveLength(1);
  });
});

describe("Домашняя работа (Э8.11) через общие эндпоинты — getMyActivity/saveResponse/getProgress/getAnalytics/startReview/getReview", () => {
  const draft = { type: "single_choice" as const, selectedOptionId: "o2" };

  beforeEach(() => {
    repoMock.findActivityById.mockResolvedValue(homeworkRow);
  });

  it("getMyActivity: ученик группы получает свою копию БЕЗ привязки к уроку", async () => {
    const my = await getMyActivity(studentA, HOMEWORK_ACTIVITY);
    expect(my.mode).toBe("homework");
    expect(usersServiceMock.isGroupMember).toHaveBeenCalledWith(GROUP, STUDENT_A);
  });

  it("getMyActivity: ученик НЕ из группы — 403", async () => {
    usersServiceMock.isGroupMember.mockResolvedValue(false);
    await expect(getMyActivity(studentA, HOMEWORK_ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("saveResponse: ученик группы сохраняет черновик домашней работы", async () => {
    const res = await saveResponse(studentA, HOMEWORK_ACTIVITY, { questionId: "q1", response: draft });
    expect(res).toEqual({ saved: true, savedAt: "2026-09-04T09:31:00.000Z" });
    expect(repoMock.upsertDraftResponse).toHaveBeenCalledWith(expect.objectContaining({ lessonId: null }));
  });

  it("getProgress/getAnalytics: тот, кто выдал домашку, видит прогресс и аналитику", async () => {
    usersServiceMock.listGroupStudents.mockResolvedValue([{ id: STUDENT_A, fullName: "Аня" }]);
    await expect(getProgress(teacher, HOMEWORK_ACTIVITY)).resolves.toMatchObject({ activityId: HOMEWORK_ACTIVITY });
    expect(usersServiceMock.listGroupStudents).toHaveBeenCalledWith(GROUP);
    await expect(getAnalytics(teacher, HOMEWORK_ACTIVITY)).resolves.toMatchObject({ activityId: HOMEWORK_ACTIVITY });
  });

  it("getProgress: учитель, который НЕ выдавал эту домашку — 403 (у группы нет своего «хозяина», владеет только assignedBy)", async () => {
    await expect(getProgress(otherTeacher, HOMEWORK_ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("startReview/getReview: работают для домашки, WS-сигнал НЕ шлётся (нет урока/канала)", async () => {
    repoMock.markReviewed.mockResolvedValue(new Date("2026-09-04T09:40:00.000Z"));
    await startReview(teacher, HOMEWORK_ACTIVITY);
    expect(roomsServiceMock.broadcastToLesson).not.toHaveBeenCalled();

    repoMock.findActivityById.mockResolvedValue({ ...homeworkRow, reviewedAt: new Date("2026-09-04T09:40:00.000Z") });
    const review = await getReview(studentA, HOMEWORK_ACTIVITY);
    expect(review.reviewedAt).toBe("2026-09-04T09:40:00.000Z");
  });

  it("pushAnswerToBoard: у домашки нет доски — 409, даже для того, кто её выдал", async () => {
    repoMock.findActivityById.mockResolvedValue({ ...homeworkRow, reviewedAt: new Date("2026-09-04T09:40:00.000Z") });
    await expect(
      pushAnswerToBoard(teacher, HOMEWORK_ACTIVITY, { questionId: "q1", userId: STUDENT_A, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 409, code: "activity_not_in_lesson" });
    expect(canvasServiceMock.postAnswerToBoard).not.toHaveBeenCalled();
  });
});

/** Материал с одним автопроверяемым вопросом (q1, single_choice, 1 балл) и одним ручным (q2, open_answer, 2 балла) — под submit/grading queue тесты. */
const openAnswerBlock = {
  type: "question" as const,
  id: "q2",
  prompt: { html: "Объясните, почему 2 + 2 = 4" },
  points: 2,
  interaction: {
    type: "open_answer" as const,
    maxLength: 2000,
    allowAttachments: false,
    rubric: [
      { id: "c1", label: "Верно объяснил", points: 1 },
      { id: "c2", label: "Без ошибок", points: 1 },
    ],
  },
};
const materialWithOpenAnswer: Material = {
  ...material,
  blocks: [material.blocks[0]!, openAnswerBlock],
};

/** Движок проверки замокан детерминированно: single_choice верен при "o2", open_answer всегда «ждёт проверки». */
function mockGradeResponseEngine() {
  materialsServiceMock.gradeResponse.mockImplementation(
    (interaction: { type: string }, response: { type: string; selectedOptionId?: string | null }, points: number) => {
      if (interaction.type === "single_choice") {
        const correct = response.selectedOptionId === "o2";
        return { score: correct ? points : 0, maxScore: points, correct, autoGraded: true };
      }
      if (interaction.type === "open_answer") {
        return { score: 0, maxScore: points, correct: null, autoGraded: false };
      }
      throw new Error(`неожиданный тип в тесте: ${interaction.type}`);
    },
  );
}

describe("submitActivity (Э8.12, §8 ТЗ: POST /activities/:id/submit)", () => {
  beforeEach(() => {
    mockGradeResponseEngine();
    materialsServiceMock.getMaterialVersion.mockResolvedValue({
      materialId: MATERIAL,
      versionId: VERSION,
      version: 1,
      material: materialWithOpenAnswer,
    });
  });

  it("считает score/maxScore только по автопроверяемым, ручной вопрос уходит с score:0/correct:null", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([
      { questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
      { questionId: "q2", response: { type: "open_answer", text: "потому что", attachmentIds: [] } },
    ]);

    const result = await submitActivity(studentA, ACTIVITY);

    expect(result.score).toBe(1); // только q1 (1 балл), q2 ждёт учителя
    expect(result.maxScore).toBe(3); // 1 + 2 — оба вопроса учтены в потолке
    expect(result.feedback).toEqual([
      { questionId: "q1", score: 1, maxScore: 1, correct: true, autoGraded: true },
      { questionId: "q2", score: 0, maxScore: 2, correct: null, autoGraded: false },
    ]);
  });

  it("неотвеченный вопрос — пустой ответ своего типа, 0 баллов, но НЕ пропуск (тот же движок)", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([]); // ни один вопрос не сохранён черновиком

    const result = await submitActivity(studentA, ACTIVITY);

    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(3);
    expect(materialsServiceMock.gradeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ type: "single_choice" }),
      { type: "single_choice", selectedOptionId: null },
      1,
    );
  });

  it("пишет каждый вопрос через repo.upsertGradedResponse с attemptId/attemptNumber попытки", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([]);
    await submitActivity(studentA, ACTIVITY);

    expect(repoMock.upsertGradedResponse).toHaveBeenCalledTimes(2);
    expect(repoMock.upsertGradedResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: deriveAttemptId(ACTIVITY, STUDENT_A, 1),
        attemptNumber: 1,
        activityId: ACTIVITY,
        materialId: MATERIAL,
        questionId: "q1",
      }),
    );
  });

  it("не ученик (учитель) не сдаёт работу — 403", async () => {
    await expect(submitActivity(teacher, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.upsertGradedResponse).not.toHaveBeenCalled();
  });

  it("дедлайн прошёл — 409, сабмита не происходит", async () => {
    repoMock.findActivityById.mockResolvedValue({ ...activityRow, deadline: new Date("2020-01-01T00:00:00.000Z") });
    await expect(submitActivity(studentA, ACTIVITY)).rejects.toMatchObject({ statusCode: 409 });
    expect(repoMock.upsertGradedResponse).not.toHaveBeenCalled();
  });

  it("ученик не из группы — 403", async () => {
    usersServiceMock.isGroupMember.mockResolvedValue(false);
    await expect(submitActivity(studentA, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("идемпотентна: повторный вызов пересчитывает те же баллы, не падает", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([
      { questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
    ]);
    const first = await submitActivity(studentA, ACTIVITY);
    const second = await submitActivity(studentA, ACTIVITY);
    expect(second).toEqual(first);
  });
});

describe("getGradingQueue (Э8.12, §8 ТЗ: GET /grading/queue)", () => {
  const pendingRow = {
    responseId: "resp-1",
    activityId: ACTIVITY,
    activityMode: "lesson" as const,
    materialVersionId: VERSION,
    questionId: "q2",
    response: { type: "open_answer" as const, text: "потому что", attachmentIds: [] },
    studentId: STUDENT_A,
    studentFullName: "Аня",
    submittedAt: new Date("2026-09-04T09:36:00.000Z"),
  };

  beforeEach(() => {
    materialsServiceMock.getMaterialVersion.mockResolvedValue({
      materialId: MATERIAL,
      versionId: VERSION,
      version: 1,
      material: materialWithOpenAnswer,
    });
  });

  it("учитель — очередь фильтруется по assignedBy (его собственные выдачи)", async () => {
    repoMock.listPendingManualGrading.mockResolvedValue([pendingRow]);
    const items = await getGradingQueue(teacher);
    expect(repoMock.listPendingManualGrading).toHaveBeenCalledWith(SCHOOL, TEACHER);
    expect(items).toEqual([
      {
        responseId: "resp-1",
        activityId: ACTIVITY,
        activityMode: "lesson",
        materialTitle: materialWithOpenAnswer.title,
        questionId: "q2",
        promptHtml: "Объясните, почему 2 + 2 = 4",
        rubric: openAnswerBlock.interaction.rubric,
        maxScore: 2,
        studentId: STUDENT_A,
        studentName: "Аня",
        response: { text: "потому что", attachmentIds: [] },
        submittedAt: "2026-09-04T09:36:00.000Z",
      },
    ]);
  });

  it("админ — очередь без фильтра по assignedBy (вся школа)", async () => {
    repoMock.listPendingManualGrading.mockResolvedValue([]);
    await getGradingQueue({ sub: "admin-1", schoolId: SCHOOL, role: "admin" });
    expect(repoMock.listPendingManualGrading).toHaveBeenCalledWith(SCHOOL, null);
  });

  it("не учитель/админ (ученик) — 403", async () => {
    await expect(getGradingQueue(studentA)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("вопрос рассинхронизирован (не open_answer в текущей версии) — молча пропускается", async () => {
    repoMock.listPendingManualGrading.mockResolvedValue([{ ...pendingRow, questionId: "q1" }]);
    const items = await getGradingQueue(teacher);
    expect(items).toEqual([]);
  });
});

describe("gradeManualResponse (Э8.12, §8 ТЗ: POST /grading/:responseId)", () => {
  const target = {
    id: "resp-1",
    assignedBy: TEACHER,
    schoolId: SCHOOL,
    materialVersionId: VERSION,
    questionId: "q2",
    gradedBy: null as string | null,
    autoGraded: false,
    submitted: true,
  };

  beforeEach(() => {
    repoMock.findResponseForGrading.mockResolvedValue(target);
    materialsServiceMock.getMaterialVersion.mockResolvedValue({
      materialId: MATERIAL,
      versionId: VERSION,
      version: 1,
      material: materialWithOpenAnswer,
    });
  });

  it("учитель-владелец ставит баллы — repo.persistManualGrade вызван, результат возвращён", async () => {
    const result = await gradeManualResponse(teacher, "resp-1", {
      score: 1.5,
      rubricScores: { c1: true, c2: false },
      comment: "почти",
    });
    expect(repoMock.persistManualGrade).toHaveBeenCalledWith("resp-1", {
      score: 1.5,
      rubricScores: { c1: true, c2: false },
      comment: "почти",
      gradedBy: TEACHER,
    });
    expect(result).toEqual({ responseId: "resp-1", score: 1.5, maxScore: 2, gradedAt: "2026-09-04T09:50:00.000Z" });
  });

  it("не учитель/админ (ученик) — 403", async () => {
    await expect(
      gradeManualResponse(studentA, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.persistManualGrade).not.toHaveBeenCalled();
  });

  it("ответ не найден / чужая школа — 404", async () => {
    repoMock.findResponseForGrading.mockResolvedValue(null);
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("учитель, который не выдавал это задание — 403", async () => {
    await expect(
      gradeManualResponse(otherTeacher, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("ответ ещё не сдан (черновик) — 409", async () => {
    repoMock.findResponseForGrading.mockResolvedValue({ ...target, submitted: false });
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: "not_pending_manual_grading" });
  });

  it("ответ автопроверяемый — 409 (нечего проверять вручную)", async () => {
    repoMock.findResponseForGrading.mockResolvedValue({ ...target, autoGraded: true });
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: "not_pending_manual_grading" });
  });

  it("уже проверен (gradedBy заполнен) — 409, не зовёт persistManualGrade", async () => {
    repoMock.findResponseForGrading.mockResolvedValue({ ...target, gradedBy: "someone" });
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: "already_graded" });
    expect(repoMock.persistManualGrade).not.toHaveBeenCalled();
  });

  it("неизвестный критерий рубрики — 400", async () => {
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 1, rubricScores: { unknown: true } }),
    ).rejects.toMatchObject({ statusCode: 400, code: "unknown_rubric_criterion" });
  });

  it("балл больше максимального вопроса — 400", async () => {
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 5, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 400, code: "score_exceeds_max" });
  });

  it("гонка: persistManualGrade вернул null (уже проверено между чтением и записью) — 409", async () => {
    repoMock.persistManualGrade.mockResolvedValue(null);
    await expect(
      gradeManualResponse(teacher, "resp-1", { score: 1, rubricScores: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: "already_graded" });
  });
});
