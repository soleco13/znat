import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { repoMock, lessonsServiceMock, usersServiceMock, storageServiceMock, jobsServiceMock } =
  vi.hoisted(() => ({
    repoMock: {
      insertDeck: vi.fn(),
      findReadyDeckBySha: vi.fn(),
      findDeckById: vi.fn(),
      listDecksByLesson: vi.fn(),
      listSlidesByDeck: vi.fn(),
      listSlidesForDecks: vi.fn(),
      setDeckStatus: vi.fn(),
      replaceDeckSlides: vi.fn(),
      deleteDeck: vi.fn(),
    },
    lessonsServiceMock: { getLesson: vi.fn() },
    usersServiceMock: { isGroupMember: vi.fn() },
    storageServiceMock: {
      uploadFile: vi.fn(),
      getSignedFileUrl: vi.fn((k: string) => `/files/${k}?sig=x`),
      deleteFile: vi.fn(),
    },
    jobsServiceMock: { enqueueConvert: vi.fn() },
  }));

vi.mock("./repo.js", () => repoMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);
vi.mock("../storage/service.js", () => storageServiceMock);
vi.mock("../jobs/service.js", () => jobsServiceMock);

const {
  createDeckFromUpload,
  deleteDeck,
  buildConvertJobHandlers,
} = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const LESSON = "22222222-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";
const DECK = "44444444-4444-4444-4444-444444444444";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const teacher: AccessTokenPayload = { sub: TEACHER, schoolId: SCHOOL, role: "teacher" };
const otherTeacher: AccessTokenPayload = { sub: "99999999-9999-9999-9999-999999999999", schoolId: SCHOOL, role: "teacher" };

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue({
    id: LESSON,
    schoolId: SCHOOL,
    teacherId: TEACHER,
    groupId: "group-1",
  });
  storageServiceMock.uploadFile.mockResolvedValue({ storageKey: `${SCHOOL}/src.pptx`, sizeBytes: 10 });
  storageServiceMock.deleteFile.mockResolvedValue(undefined);
  repoMock.insertDeck.mockResolvedValue({ id: DECK, schoolId: SCHOOL, lessonId: LESSON });
});

describe("createDeckFromUpload (Э4.3)", () => {
  it("отклоняет неподдерживаемый тип файла до обращения к хранилищу и очереди", async () => {
    await expect(
      createDeckFromUpload({
        user: teacher,
        lessonId: LESSON,
        buffer: Buffer.from("x"),
        filename: "a.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(storageServiceMock.uploadFile).not.toHaveBeenCalled();
    expect(jobsServiceMock.enqueueConvert).not.toHaveBeenCalled();
  });

  it("не даёт чужому учителю грузить презентацию в урок", async () => {
    await expect(
      createDeckFromUpload({
        user: otherTeacher,
        lessonId: LESSON,
        buffer: Buffer.from("x"),
        filename: "a.pptx",
        mimeType: PPTX,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("сохраняет файл, заводит строку и ставит задачу с jobId === deckId", async () => {
    const buffer = Buffer.from("presentation-bytes");
    const sha = createHash("sha256").update(buffer).digest("hex");

    const res = await createDeckFromUpload({
      user: teacher,
      lessonId: LESSON,
      buffer,
      filename: "Урок 1.pptx",
      mimeType: PPTX,
    });

    expect(res).toEqual({ deckId: DECK, jobId: DECK, status: "pending" });
    expect(repoMock.insertDeck).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: SCHOOL,
        lessonId: LESSON,
        sourceSha256: sha,
        title: "Урок 1",
        sourceName: "Урок 1.pptx",
        createdBy: TEACHER,
      }),
    );
    expect(jobsServiceMock.enqueueConvert).toHaveBeenCalledWith({
      deckId: DECK,
      schoolId: SCHOOL,
      sourceStorageKey: `${SCHOOL}/src.pptx`,
      sourceMimeType: PPTX,
    });
  });
});

describe("buildConvertJobHandlers (Э4.3)", () => {
  const handlers = buildConvertJobHandlers();

  it("onProgress помечает презентацию converting с done/total", async () => {
    await handlers.onProgress(DECK, { done: 3, total: 10 });
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "converting",
      progress: 3,
      slideCount: 10,
    });
  });

  it("onCompleted заменяет слайды и ставит ready", async () => {
    const slides = [
      { index: 0, imageStorageKey: "a", thumbStorageKey: "b", width: 1, height: 2, textLayer: null },
    ];
    await handlers.onCompleted(DECK, { slideCount: 1, slides });
    expect(repoMock.replaceDeckSlides).toHaveBeenCalledWith(DECK, slides);
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "ready",
      progress: 1,
      slideCount: 1,
      error: null,
    });
  });

  it("onFailed ставит failed с обрезанной причиной", async () => {
    await handlers.onFailed(DECK, "x".repeat(5000));
    const call = repoMock.setDeckStatus.mock.calls.at(-1);
    expect(call?.[0]).toBe(DECK);
    expect(call?.[1].status).toBe("failed");
    expect(call?.[1].error).toHaveLength(2000);
  });
});

describe("deleteDeck (Э4.3)", () => {
  it("404, если презентация не из этого урока", async () => {
    repoMock.findDeckById.mockResolvedValue({ id: DECK, lessonId: "other-lesson" });
    await expect(deleteDeck(teacher, LESSON, DECK)).rejects.toMatchObject({ statusCode: 404 });
    expect(repoMock.deleteDeck).not.toHaveBeenCalled();
  });

  it("удаляет строку и все файлы слайдов + исходник", async () => {
    repoMock.findDeckById.mockResolvedValue({
      id: DECK,
      lessonId: LESSON,
      sourceStorageKey: "src-key",
    });
    repoMock.listSlidesByDeck.mockResolvedValue([
      { imageStorageKey: "img-0", thumbStorageKey: "thumb-0" },
      { imageStorageKey: "img-1", thumbStorageKey: "thumb-1" },
    ]);

    await deleteDeck(teacher, LESSON, DECK);

    expect(repoMock.deleteDeck).toHaveBeenCalledWith(DECK);
    expect(storageServiceMock.deleteFile).toHaveBeenCalledWith("img-0");
    expect(storageServiceMock.deleteFile).toHaveBeenCalledWith("thumb-1");
    expect(storageServiceMock.deleteFile).toHaveBeenCalledWith("src-key");
  });
});
