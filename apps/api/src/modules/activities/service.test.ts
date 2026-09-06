import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload, Material } from "@school/shared";
import type { LessonActor } from "../guests/service.js";

const {
  repoMock,
  lessonsServiceMock,
  materialsServiceMock,
  roomsServiceMock,
  canvasServiceMock,
  redisMock,
} = vi.hoisted(() => ({
  repoMock: {
    insertActivity: vi.fn(),
    findActivityById: vi.fn(),
    listActivitiesByLesson: vi.fn(),
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
  materialsServiceMock: { getLatestMaterial: vi.fn(), getMaterialVersion: vi.fn(), gradeResponse: vi.fn() },
  roomsServiceMock: {
    broadcastToLesson: vi.fn(),
    ensureParticipant: vi.fn(),
    listLessonParticipants: vi.fn(),
    getParticipantNames: vi.fn(),
  },
  canvasServiceMock: { postAnswerToBoard: vi.fn() },
  redisMock: { set: vi.fn(), get: vi.fn(), mget: vi.fn() },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../materials/service.js", () => materialsServiceMock);
vi.mock("../rooms/service.js", () => roomsServiceMock);
vi.mock("../canvas/service.js", () => canvasServiceMock);
vi.mock("../../db/redis.js", () => ({ redis: redisMock }));

const {
  createActivity,
  getMyActivity,
  listLessonActivities,
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
const OTHER_LESSON = "2222bbbb-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";
const MATERIAL = "44444444-4444-4444-4444-444444444444";
const VERSION = "55555555-5555-5555-5555-555555555555";
const ACTIVITY = "66666666-6666-6666-6666-666666666666";
/** Гостевые id учеников (в куке сессии урока). */
const GUEST_A = "77777777-7777-7777-7777-777777777777";
const GUEST_B = "88888888-8888-8888-8888-888888888888";
/** Канонические строки участников урока (`lesson_participants.id`) — к ним привязаны ответы (Э12.5). */
const PARTICIPANT_A = "a0000000-0000-0000-0000-0000000000a1";
const PARTICIPANT_B = "a0000000-0000-0000-0000-0000000000b2";
const PARTICIPANT_C = "a0000000-0000-0000-0000-0000000000c3";

const teacher: AccessTokenPayload = { sub: TEACHER, schoolId: SCHOOL, role: "teacher" };
const otherTeacher: AccessTokenPayload = {
  sub: "99999999-9999-9999-9999-999999999999",
  schoolId: SCHOOL,
  role: "teacher",
};

/** Actor гостя-ученика этого урока (Э12.4). */
function guest(guestId: string, name: string, lessonId = LESSON): LessonActor {
  return { kind: "guest", participantId: guestId, schoolId: SCHOOL, role: null, lessonId, displayName: name };
}
/** Actor персонала (учителя) — задание он не проходит. */
const staffActor: LessonActor = {
  kind: "staff",
  participantId: TEACHER,
  schoolId: SCHOOL,
  role: "teacher",
  lessonId: LESSON,
  displayName: "Учитель",
};
const guestA = guest(GUEST_A, "Аня");
const guestB = guest(GUEST_B, "Боря");

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
  assignedBy: TEACHER,
  // Относительный дедлайн (неделя вперёд) — не фиксированная дата: submitActivity
  // сравнивает его с `Date.now()`, фиксированный «2026-09-05» стал бы time-bomb'ом.
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  timerSeconds: 600,
  createdAt: new Date("2026-09-04T09:00:00.000Z"),
  reviewedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue({
    id: LESSON,
    schoolId: SCHOOL,
    teacherId: TEACHER,
  });
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
  repoMock.markReviewed.mockResolvedValue(new Date("2026-09-04T09:40:00.000Z"));
  repoMock.attemptSubmittedAt.mockResolvedValue(null);
  repoMock.upsertGradedResponse.mockResolvedValue(undefined);
  repoMock.listPendingManualGrading.mockResolvedValue([]);
  repoMock.findResponseForGrading.mockResolvedValue(null);
  repoMock.persistManualGrade.mockResolvedValue(new Date("2026-09-04T09:50:00.000Z"));
  canvasServiceMock.postAnswerToBoard.mockResolvedValue(undefined);
  // Каноническая строка участника по гостевому id (Э12.5).
  roomsServiceMock.ensureParticipant.mockImplementation((actor: LessonActor) =>
    Promise.resolve(
      actor.participantId === GUEST_B
        ? { id: PARTICIPANT_B, displayName: actor.displayName }
        : { id: PARTICIPANT_A, displayName: actor.displayName },
    ),
  );
  roomsServiceMock.listLessonParticipants.mockResolvedValue([]);
  roomsServiceMock.getParticipantNames.mockResolvedValue(new Map());
  redisMock.set.mockResolvedValue("OK");
  redisMock.get.mockResolvedValue("2026-09-04T09:30:00.000Z");
  redisMock.mget.mockResolvedValue([]);
});

describe("deriveAttemptId", () => {
  it("детерминирован и валидный UUID v5", () => {
    const a = deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1);
    const b = deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("разный для разных участников и разных попыток", () => {
    expect(deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1)).not.toBe(deriveAttemptId(ACTIVITY, PARTICIPANT_B, 1));
    expect(deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1)).not.toBe(deriveAttemptId(ACTIVITY, PARTICIPANT_A, 2));
  });
});

describe("createActivity (Э8.6 → Э12.5)", () => {
  it("учитель-хозяин: закрепляет версию, шлёт activity_started, возвращает dto", async () => {
    const dto = await createActivity(teacher, LESSON, {
      materialId: MATERIAL,
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
    expect(dto).toMatchObject({ id: ACTIVITY, lessonId: LESSON, materialId: MATERIAL, materialVersion: 1 });
    expect(dto.deadline).toBe(activityRow.deadline!.toISOString());
  });

  it("чужой учитель не может запустить задание", async () => {
    await expect(createActivity(otherTeacher, LESSON, { materialId: MATERIAL })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repoMock.insertActivity).not.toHaveBeenCalled();
  });
});

describe("getMyActivity (Э12.5) — индивидуальный канал", () => {
  it("гость-ученик: материал без ключей ответов, свой attemptId по канонической строке участника", async () => {
    const my = await getMyActivity(guestA, ACTIVITY);

    expect(my.attemptId).toBe(deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1));
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
    const a = await getMyActivity(guestA, ACTIVITY);
    const b = await getMyActivity(guestB, ACTIVITY);
    expect(a.attemptId).not.toBe(b.attemptId);
  });

  it("отдаёт ранее сохранённые черновики только своей попытки", async () => {
    const attemptId = deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1);
    repoMock.findResponsesByAttempt.mockImplementation((id: string) =>
      Promise.resolve(
        id === attemptId
          ? [{ questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } }]
          : [],
      ),
    );

    const a = await getMyActivity(guestA, ACTIVITY);
    expect(a.savedResponses.q1).toEqual({ type: "single_choice", selectedOptionId: "o2" });

    const b = await getMyActivity(guestB, ACTIVITY);
    expect(b.savedResponses).toEqual({});
    expect(repoMock.findResponsesByAttempt).toHaveBeenCalledWith(deriveAttemptId(ACTIVITY, PARTICIPANT_B, 1));
  });

  it("гость другого урока — 403", async () => {
    await expect(getMyActivity(guest(GUEST_A, "Аня", OTHER_LESSON), ACTIVITY)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("персонал задание не проходит — 403", async () => {
    await expect(getMyActivity(staffActor, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("задание другой школы — 404 (существование не подтверждаем)", async () => {
    repoMock.findActivityById.mockResolvedValue({ ...activityRow, schoolId: OTHER_SCHOOL });
    await expect(getMyActivity(guestA, ACTIVITY)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("saveResponse (Э8.7) — автосохранение черновика", () => {
  const draft = { type: "single_choice" as const, selectedOptionId: "o2" };

  it("гость-ученик: upsert по своему attemptId + participantId, { saved: true }", async () => {
    const res = await saveResponse(guestA, ACTIVITY, { questionId: "q1", response: draft });

    expect(res).toEqual({ saved: true, savedAt: "2026-09-04T09:31:00.000Z" });
    expect(repoMock.upsertDraftResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1),
        attemptNumber: 1,
        activityId: ACTIVITY,
        materialId: MATERIAL,
        lessonId: LESSON,
        participantId: PARTICIPANT_A,
        questionId: "q1",
        response: draft,
      }),
    );
  });

  it("два ученика пишут в РАЗНЫЕ attemptId (ответы не пересекаются)", async () => {
    await saveResponse(guestA, ACTIVITY, { questionId: "q1", response: draft });
    await saveResponse(guestB, ACTIVITY, { questionId: "q1", response: draft });
    const [a] = repoMock.upsertDraftResponse.mock.calls[0]!;
    const [b] = repoMock.upsertDraftResponse.mock.calls[1]!;
    expect(a.attemptId).not.toBe(b.attemptId);
    expect(a.participantId).toBe(PARTICIPANT_A);
    expect(b.participantId).toBe(PARTICIPANT_B);
  });

  it("персонал не сохраняет ответы — 403", async () => {
    await expect(
      saveResponse(staffActor, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.upsertDraftResponse).not.toHaveBeenCalled();
  });

  it("дедлайн прошёл — 409, ответ не пишется", async () => {
    repoMock.findActivityById.mockResolvedValue({
      ...activityRow,
      deadline: new Date("2020-01-01T00:00:00.000Z"),
    });
    await expect(
      saveResponse(guestA, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(repoMock.upsertDraftResponse).not.toHaveBeenCalled();
  });

  it("вопроса нет в материале — 404", async () => {
    await expect(
      saveResponse(guestA, ACTIVITY, { questionId: "нет-такого", response: draft }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("тип ответа не совпадает с типом вопроса — 400", async () => {
    await expect(
      saveResponse(guestA, ACTIVITY, { questionId: "q1", response: { type: "true_false", value: true } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("гость другого урока — 403", async () => {
    await expect(
      saveResponse(guest(GUEST_A, "Аня", OTHER_LESSON), ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("работа уже сдана (Э8.12) — 409, черновик не пишется", async () => {
    repoMock.attemptSubmittedAt.mockResolvedValue(new Date("2026-09-04T09:35:00.000Z"));
    await expect(
      saveResponse(guestA, ACTIVITY, { questionId: "q1", response: draft }),
    ).rejects.toMatchObject({ statusCode: 409, code: "already_submitted" });
    expect(repoMock.upsertDraftResponse).not.toHaveBeenCalled();
  });
});

describe("getProgress (Э8.8 → Э12.5) — панель прогресса по участникам урока", () => {
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
    roomsServiceMock.listLessonParticipants.mockResolvedValue([
      { id: PARTICIPANT_A, kind: "guest", displayName: "Аня" },
      { id: PARTICIPANT_B, kind: "guest", displayName: "Боря" },
      { id: PARTICIPANT_C, kind: "guest", displayName: "Витя" },
      // Персонал в ростере прогресса игнорируется.
      { id: "staff-row", kind: "staff", displayName: "Учитель" },
    ]);
  });

  it("классифицирует not_started / in_progress / stuck по введённым именам", async () => {
    repoMock.answeredStatsByActivity.mockResolvedValue([
      { participantId: PARTICIPANT_A, answered: 2, lastAt: new Date().toISOString() },
      { participantId: PARTICIPANT_B, answered: 1, lastAt: "2020-01-01T00:00:00.000Z" },
    ]);
    redisMock.mget.mockResolvedValue(["2026-09-04T09:00:00.000Z", "2026-09-04T09:00:00.000Z", null]);

    const progress = await getProgress(teacher, ACTIVITY);

    expect(progress.total).toBe(2);
    expect(progress.students).toHaveLength(3);
    const byName = Object.fromEntries(progress.students.map((s) => [s.displayName, s]));
    expect(byName["Аня"]).toMatchObject({ participantId: PARTICIPANT_A, status: "in_progress", answered: 2 });
    expect(byName["Боря"]).toMatchObject({ status: "stuck", answered: 1 });
    expect(byName["Витя"]).toMatchObject({ status: "not_started", answered: 0, lastActivityAt: null });
  });

  it("ученик открыл, но ещё не отвечал — in_progress, не not_started", async () => {
    repoMock.answeredStatsByActivity.mockResolvedValue([]);
    redisMock.mget.mockResolvedValue(["2026-09-04T09:00:00.000Z", null, null]);
    const progress = await getProgress(teacher, ACTIVITY);
    const anya = progress.students.find((s) => s.displayName === "Аня")!;
    expect(anya.status).toBe("in_progress");
  });

  it("чужой учитель не видит прогресс — 403", async () => {
    await expect(getProgress(otherTeacher, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("getAnalytics (Э8.9) — гистограмма ответов", () => {
  it("учителю: по одному разбору на вопрос + число ответивших участников", async () => {
    repoMock.listResponsesByActivity.mockResolvedValue([
      { participantId: PARTICIPANT_A, questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
      { participantId: PARTICIPANT_B, questionId: "q1", response: { type: "single_choice", selectedOptionId: "o1" } },
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
    await expect(getReview(guestA, ACTIVITY)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("после начала разбора — ПОЛНЫЙ материал (с ключом ответа), доступен и ученику", async () => {
    repoMock.findActivityById.mockResolvedValue({
      ...activityRow,
      reviewedAt: new Date("2026-09-04T09:40:00.000Z"),
    });
    const review = await getReview(guestA, ACTIVITY);
    expect(review.reviewedAt).toBe("2026-09-04T09:40:00.000Z");
    expect(JSON.stringify(review.material)).toContain("correct");
  });

  it("getReview: гость другого урока — 403", async () => {
    repoMock.findActivityById.mockResolvedValue({
      ...activityRow,
      reviewedAt: new Date("2026-09-04T09:40:00.000Z"),
    });
    await expect(getReview(guest(GUEST_A, "Аня", OTHER_LESSON), ACTIVITY)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe("getReviewResponses / pushAnswerToBoard (Э8.10) — вынести ответ на доску", () => {
  const reviewedRow = { ...activityRow, reviewedAt: new Date("2026-09-04T09:40:00.000Z") };

  beforeEach(() => {
    repoMock.findActivityById.mockResolvedValue(reviewedRow);
    roomsServiceMock.listLessonParticipants.mockResolvedValue([
      { id: PARTICIPANT_A, kind: "guest", displayName: "Аня" },
      { id: PARTICIPANT_B, kind: "guest", displayName: "Боря" },
    ]);
    repoMock.listResponsesByActivity.mockResolvedValue([
      { participantId: PARTICIPANT_A, questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
    ]);
  });

  it("до начала разбора — 409", async () => {
    repoMock.findActivityById.mockResolvedValue(activityRow);
    await expect(getReviewResponses(teacher, ACTIVITY, "q1")).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", participantId: PARTICIPANT_A, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("getReviewResponses: только ответившие, с введёнными именами", async () => {
    const result = await getReviewResponses(teacher, ACTIVITY, "q1");
    expect(result).toEqual({
      questionId: "q1",
      responses: [
        {
          participantId: PARTICIPANT_A,
          displayName: "Аня",
          response: { type: "single_choice", selectedOptionId: "o2" },
        },
      ],
    });
  });

  it("pushAnswerToBoard: анонимно — без имени, текст ответа читаемый", async () => {
    await pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", participantId: PARTICIPANT_A, anonymous: true });
    expect(canvasServiceMock.postAnswerToBoard).toHaveBeenCalledWith(LESSON, "Ответ ученика:\n4");
  });

  it("pushAnswerToBoard: с именем — подпись ученика", async () => {
    await pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", participantId: PARTICIPANT_A, anonymous: false });
    expect(canvasServiceMock.postAnswerToBoard).toHaveBeenCalledWith(LESSON, "Аня:\n4");
  });

  it("у ученика нет ответа на вопрос — 404", async () => {
    await expect(
      pushAnswerToBoard(teacher, ACTIVITY, { questionId: "q1", participantId: PARTICIPANT_B, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(canvasServiceMock.postAnswerToBoard).not.toHaveBeenCalled();
  });

  it("чужой учитель не может выносить ответы на доску — 403", async () => {
    await expect(
      pushAnswerToBoard(otherTeacher, ACTIVITY, { questionId: "q1", participantId: PARTICIPANT_A, anonymous: true }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("listLessonActivities (Э8.6 → Э12.5)", () => {
  it("участнику урока (гостю) — список выдач", async () => {
    repoMock.listActivitiesByLesson.mockResolvedValue([activityRow]);
    const items = await listLessonActivities(guestA, LESSON);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: ACTIVITY, materialId: MATERIAL });
  });

  it("гость другого урока — 403", async () => {
    await expect(listLessonActivities(guest(GUEST_A, "Аня", OTHER_LESSON), LESSON)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("чужой учитель — 403", async () => {
    await expect(listLessonActivities(staffActor, LESSON)).resolves.toBeDefined();
    await expect(
      listLessonActivities(
        { ...staffActor, participantId: "99999999-9999-9999-9999-999999999999" },
        LESSON,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

/** Материал с одним автопроверяемым вопросом (q1, single_choice, 1 балл) и одним ручным (q2, open_answer, 2 балла). */
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

    const result = await submitActivity(guestA, ACTIVITY);

    expect(result.score).toBe(1); // только q1 (1 балл), q2 ждёт учителя
    expect(result.maxScore).toBe(3); // 1 + 2 — оба вопроса учтены в потолке
    expect(result.feedback).toEqual([
      { questionId: "q1", score: 1, maxScore: 1, correct: true, autoGraded: true },
      { questionId: "q2", score: 0, maxScore: 2, correct: null, autoGraded: false },
    ]);
  });

  it("неотвеченный вопрос — пустой ответ своего типа, 0 баллов, но НЕ пропуск (тот же движок)", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([]);

    const result = await submitActivity(guestA, ACTIVITY);

    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(3);
    expect(materialsServiceMock.gradeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ type: "single_choice" }),
      { type: "single_choice", selectedOptionId: null },
      1,
    );
  });

  it("пишет каждый вопрос через repo.upsertGradedResponse с attemptId/participantId попытки", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([]);
    await submitActivity(guestA, ACTIVITY);

    expect(repoMock.upsertGradedResponse).toHaveBeenCalledTimes(2);
    expect(repoMock.upsertGradedResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: deriveAttemptId(ACTIVITY, PARTICIPANT_A, 1),
        attemptNumber: 1,
        activityId: ACTIVITY,
        materialId: MATERIAL,
        participantId: PARTICIPANT_A,
        questionId: "q1",
      }),
    );
  });

  it("персонал не сдаёт работу — 403", async () => {
    await expect(submitActivity(staffActor, ACTIVITY)).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.upsertGradedResponse).not.toHaveBeenCalled();
  });

  it("дедлайн прошёл — 409, сабмита не происходит", async () => {
    repoMock.findActivityById.mockResolvedValue({
      ...activityRow,
      deadline: new Date("2020-01-01T00:00:00.000Z"),
    });
    await expect(submitActivity(guestA, ACTIVITY)).rejects.toMatchObject({ statusCode: 409 });
    expect(repoMock.upsertGradedResponse).not.toHaveBeenCalled();
  });

  it("гость другого урока — 403", async () => {
    await expect(submitActivity(guest(GUEST_A, "Аня", OTHER_LESSON), ACTIVITY)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("идемпотентна: повторный вызов пересчитывает те же баллы, не падает", async () => {
    repoMock.findResponsesByAttempt.mockResolvedValue([
      { questionId: "q1", response: { type: "single_choice", selectedOptionId: "o2" } },
    ]);
    const first = await submitActivity(guestA, ACTIVITY);
    const second = await submitActivity(guestA, ACTIVITY);
    expect(second).toEqual(first);
  });
});

describe("getGradingQueue (Э8.12, §8 ТЗ: GET /grading/queue)", () => {
  const pendingRow = {
    responseId: "resp-1",
    activityId: ACTIVITY,
    materialVersionId: VERSION,
    questionId: "q2",
    response: { type: "open_answer" as const, text: "потому что", attachmentIds: [] },
    participantId: PARTICIPANT_A,
    submittedAt: new Date("2026-09-04T09:36:00.000Z"),
  };

  beforeEach(() => {
    materialsServiceMock.getMaterialVersion.mockResolvedValue({
      materialId: MATERIAL,
      versionId: VERSION,
      version: 1,
      material: materialWithOpenAnswer,
    });
    roomsServiceMock.getParticipantNames.mockResolvedValue(
      new Map([[PARTICIPANT_A, { displayName: "Аня", kind: "guest" }]]),
    );
  });

  it("учитель — очередь фильтруется по assignedBy, имя из строки участника урока", async () => {
    repoMock.listPendingManualGrading.mockResolvedValue([pendingRow]);
    const items = await getGradingQueue(teacher);
    expect(repoMock.listPendingManualGrading).toHaveBeenCalledWith(SCHOOL, TEACHER);
    expect(items).toEqual([
      {
        responseId: "resp-1",
        activityId: ACTIVITY,
        materialTitle: materialWithOpenAnswer.title,
        questionId: "q2",
        promptHtml: "Объясните, почему 2 + 2 = 4",
        rubric: openAnswerBlock.interaction.rubric,
        maxScore: 2,
        participantId: PARTICIPANT_A,
        participantName: "Аня",
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

  it("не учитель/админ — 403", async () => {
    await expect(
      getGradingQueue({ sub: "x", schoolId: SCHOOL, role: "methodist" }),
    ).rejects.toMatchObject({ statusCode: 403 });
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

  it("не учитель/админ — 403", async () => {
    await expect(
      gradeManualResponse({ sub: "x", schoolId: SCHOOL, role: "methodist" }, "resp-1", {
        score: 1,
        rubricScores: {},
      }),
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
