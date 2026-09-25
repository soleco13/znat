import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const {
  repoMock,
  lessonsServiceMock,
  storageServiceMock,
  jobsServiceMock,
  roomsServiceMock,
} = vi.hoisted(() => ({
    repoMock: {
      insertDeck: vi.fn(),
      findReadyDeckBySha: vi.fn(),
      findDeckById: vi.fn(),
      listDecksByLesson: vi.fn(),
      listSlidesByDeck: vi.fn(),
      listSlidesForDecks: vi.fn(),
      listUnfinishedDecks: vi.fn(),
      setDeckStatus: vi.fn(),
      replaceDeckSlides: vi.fn(),
      deleteDeck: vi.fn(),
    },
    lessonsServiceMock: { getLesson: vi.fn() },
    storageServiceMock: {
      uploadFile: vi.fn(),
      copyFile: vi.fn(),
      getSignedFileUrl: vi.fn((k: string) => `/files/${k}?sig=x`),
      deleteFile: vi.fn(),
    },
    jobsServiceMock: { enqueueConvert: vi.fn(), getConvertJobOutcome: vi.fn() },
    roomsServiceMock: { broadcastToLesson: vi.fn() },
  }));

vi.mock("./repo.js", () => repoMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../storage/service.js", () => storageServiceMock);
vi.mock("../jobs/service.js", () => jobsServiceMock);
vi.mock("../rooms/service.js", () => roomsServiceMock);

const {
  createDeckFromUpload,
  listDecks,
  deleteDeck,
  buildConvertJobHandlers,
  reconcileStuckDecks,
} = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const LESSON = "22222222-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";
const DECK = "44444444-4444-4444-4444-444444444444";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const STUDENT = "66666666-6666-6666-6666-666666666666";

const teacher: AccessTokenPayload = { sub: TEACHER, schoolId: SCHOOL, role: "teacher" };
const otherTeacher: AccessTokenPayload = { sub: "99999999-9999-9999-9999-999999999999", schoolId: SCHOOL, role: "teacher" };
/** Э12.9: роли `student` в модели нет — «легаси»-JWT, выданный до деплоя (TTL access-токена ещё не истёк). */
const student = { sub: STUDENT, schoolId: SCHOOL, role: "student" } as unknown as AccessTokenPayload;

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue({
    id: LESSON,
    schoolId: SCHOOL,
    teacherId: TEACHER,
  });
  // Как настоящее хранилище — дочитывает поток (sha256 считается по пути).
  storageServiceMock.uploadFile.mockImplementation(async ({ stream }: { stream: NodeJS.ReadableStream }) => {
    for await (const _chunk of stream) void _chunk;
    return { storageKey: `${SCHOOL}/src.pptx`, sizeBytes: 10 };
  });
  storageServiceMock.deleteFile.mockResolvedValue(undefined);
  storageServiceMock.copyFile.mockImplementation((input: { sourceKey: string }) =>
    Promise.resolve({ storageKey: `${SCHOOL}/copy-of-${input.sourceKey}`, sizeBytes: 5 }),
  );
  // По умолчанию двойника нет — идёт обычная конвертация (Э4.5).
  repoMock.findReadyDeckBySha.mockResolvedValue(null);
  repoMock.listSlidesByDeck.mockResolvedValue([]);
  repoMock.insertDeck.mockResolvedValue({
    id: DECK,
    schoolId: SCHOOL,
    lessonId: LESSON,
    title: "Урок 1",
    status: "pending",
    progress: 0,
    slideCount: 0,
    error: null,
  });
  // Э4.4: setDeckStatus теперь возвращает обновлённую строку (для WS-события).
  repoMock.setDeckStatus.mockImplementation((id: string, patch: Record<string, unknown>) =>
    Promise.resolve({
      id,
      lessonId: LESSON,
      title: "Урок 1",
      status: "converting",
      progress: 0,
      slideCount: 0,
      error: null,
      ...patch,
    }),
  );
});

describe("createDeckFromUpload (Э4.3)", () => {
  it("отклоняет неподдерживаемый тип файла до обращения к хранилищу и очереди", async () => {
    await expect(
      createDeckFromUpload({
        user: teacher,
        lessonId: LESSON,
        stream: Readable.from([Buffer.from("x")]),
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
        stream: Readable.from([Buffer.from("x")]),
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
      stream: Readable.from([buffer]),
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
    expect(repoMock.insertDeck).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMimeType: PPTX }),
    );
    expect(jobsServiceMock.enqueueConvert).toHaveBeenCalledWith({
      deckId: DECK,
      schoolId: SCHOOL,
      sourceStorageKey: `${SCHOOL}/src.pptx`,
      sourceMimeType: PPTX,
    });
  });

  it("Э4.4: сразу шлёт в WS-канал урока событие deck_status со статусом pending", async () => {
    await createDeckFromUpload({
      user: teacher,
      lessonId: LESSON,
      stream: Readable.from([Buffer.from("x")]),
      filename: "Урок 1.pptx",
      mimeType: PPTX,
    });

    expect(roomsServiceMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "deck_status",
      deck: { deckId: DECK, title: "Урок 1", status: "pending", progress: 0, slideCount: 0, error: null },
    });
  });
});

describe("createDeckFromUpload — дедуп по sha256 (Э4.5)", () => {
  const TWIN = "55555555-5555-5555-5555-555555555555";

  beforeEach(() => {
    repoMock.findReadyDeckBySha.mockResolvedValue({ id: TWIN, schoolId: SCHOOL, slideCount: 2 });
    repoMock.listSlidesByDeck.mockResolvedValue([
      { index: 0, imageStorageKey: "twin-img-0", thumbStorageKey: "twin-thumb-0", width: 1920, height: 1080, textLayer: null },
      { index: 1, imageStorageKey: "twin-img-1", thumbStorageKey: "twin-thumb-1", width: 1920, height: 1080, textLayer: null },
    ]);
  });

  it("не ставит задачу конвертации, копирует слайды двойника, отдаёт готово сразу", async () => {
    const res = await createDeckFromUpload({
      user: teacher,
      lessonId: LESSON,
      stream: Readable.from([Buffer.from("same-bytes")]),
      filename: "Повтор.pptx",
      mimeType: PPTX,
    });

    expect(res).toEqual({ deckId: DECK, jobId: null, status: "ready" });
    expect(jobsServiceMock.enqueueConvert).not.toHaveBeenCalled();
    // Копия каждого файла (изображение + превью) обоих слайдов двойника.
    expect(storageServiceMock.copyFile).toHaveBeenCalledTimes(4);
    expect(storageServiceMock.copyFile).toHaveBeenCalledWith({ sourceKey: "twin-img-0", schoolId: SCHOOL });
    expect(repoMock.replaceDeckSlides).toHaveBeenCalledWith(DECK, [
      expect.objectContaining({ index: 0, imageStorageKey: `${SCHOOL}/copy-of-twin-img-0` }),
      expect.objectContaining({ index: 1, thumbStorageKey: `${SCHOOL}/copy-of-twin-thumb-1` }),
    ]);
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "ready",
      progress: 2,
      slideCount: 2,
      error: null,
    });
  });

  it("шлёт в WS-канал урока событие deck_status со статусом ready", async () => {
    await createDeckFromUpload({
      user: teacher,
      lessonId: LESSON,
      stream: Readable.from([Buffer.from("same-bytes")]),
      filename: "Повтор.pptx",
      mimeType: PPTX,
    });

    expect(roomsServiceMock.broadcastToLesson).toHaveBeenCalledWith(
      LESSON,
      expect.objectContaining({ type: "deck_status", deck: expect.objectContaining({ status: "ready", slideCount: 2 }) }),
    );
  });

  it("Э4.7: двойник — PDF (renderMode pdf) → готово сразу, без копирования и ClamAV", async () => {
    repoMock.findReadyDeckBySha.mockResolvedValue({
      id: TWIN,
      schoolId: SCHOOL,
      slideCount: 8,
      renderMode: "pdf",
    });

    const res = await createDeckFromUpload({
      user: teacher,
      lessonId: LESSON,
      stream: Readable.from([Buffer.from("same-pdf-bytes")]),
      filename: "Повтор.pdf",
      mimeType: "application/pdf",
    });

    expect(res).toEqual({ deckId: DECK, jobId: null, status: "ready" });
    expect(jobsServiceMock.enqueueConvert).not.toHaveBeenCalled();
    expect(storageServiceMock.copyFile).not.toHaveBeenCalled();
    expect(repoMock.listSlidesByDeck).not.toHaveBeenCalled();
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "ready",
      renderMode: "pdf",
      progress: 8,
      slideCount: 8,
      error: null,
    });
  });

  it("двойник ищется по школе и sha256 исходника", async () => {
    const buffer = Buffer.from("same-bytes");
    const sha = createHash("sha256").update(buffer).digest("hex");
    await createDeckFromUpload({
      user: teacher,
      lessonId: LESSON,
      stream: Readable.from([buffer]),
      filename: "Повтор.pptx",
      mimeType: PPTX,
    });
    expect(repoMock.findReadyDeckBySha).toHaveBeenCalledWith(SCHOOL, sha);
  });
});

describe("listDecks (Э4.8)", () => {
  it("прокидывает текстовый слой слайда из pdftotext -bbox в ответ API", async () => {
    repoMock.listDecksByLesson.mockResolvedValue([
      {
        id: DECK,
        lessonId: LESSON,
        title: "Т",
        status: "ready",
        renderMode: "images",
        slideCount: 1,
        progress: 1,
        error: null,
        createdAt: new Date(0),
        sourceStorageKey: "src-key",
      },
    ]);
    repoMock.listSlidesForDecks.mockResolvedValue([
      {
        deckId: DECK,
        index: 0,
        imageStorageKey: "img-0",
        thumbStorageKey: "thumb-0",
        width: 1920,
        height: 1080,
        textLayer: [{ text: "Привет", x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
      },
    ]);

    const [deck] = await listDecks(teacher, LESSON);

    expect(deck?.slides[0]?.textLayer).toEqual([{ text: "Привет", x: 0.1, y: 0.2, w: 0.3, h: 0.05 }]);
  });

  it("слайд без распознанного текста отдаёт textLayer: null", async () => {
    repoMock.listDecksByLesson.mockResolvedValue([
      {
        id: DECK,
        lessonId: LESSON,
        title: "Т",
        status: "ready",
        renderMode: "images",
        slideCount: 1,
        progress: 1,
        error: null,
        createdAt: new Date(0),
        sourceStorageKey: "src-key",
      },
    ]);
    repoMock.listSlidesForDecks.mockResolvedValue([
      { deckId: DECK, index: 0, imageStorageKey: "img-0", thumbStorageKey: "thumb-0", width: 1920, height: 1080, textLayer: null },
    ]);

    const [deck] = await listDecks(teacher, LESSON);

    expect(deck?.slides[0]?.textLayer).toBeNull();
  });
});

describe("listDecks — заметки докладчика видны только учителю (Э4.9)", () => {
  beforeEach(() => {
    repoMock.listDecksByLesson.mockResolvedValue([
      {
        id: DECK,
        lessonId: LESSON,
        title: "Т",
        status: "ready",
        renderMode: "images",
        slideCount: 1,
        progress: 1,
        error: null,
        createdAt: new Date(0),
        sourceStorageKey: "src-key",
      },
    ]);
    repoMock.listSlidesForDecks.mockResolvedValue([
      {
        deckId: DECK,
        index: 0,
        imageStorageKey: "img-0",
        thumbStorageKey: "thumb-0",
        width: 1920,
        height: 1080,
        textLayer: null,
        notes: "Не забыть сказать про формулу",
      },
    ]);
  });

  it("хозяину урока (учителю) заметки видны", async () => {
    const [deck] = await listDecks(teacher, LESSON);
    expect(deck?.slides[0]?.notes).toBe("Не забыть сказать про формулу");
  });

  it("админу заметки видны", async () => {
    const admin: AccessTokenPayload = { sub: "77777777-7777-7777-7777-777777777777", schoolId: SCHOOL, role: "admin" };
    const [deck] = await listDecks(admin, LESSON);
    expect(deck?.slides[0]?.notes).toBe("Не забыть сказать про формулу");
  });

  it("не-персонал (устаревшая роль student) к презентациям урока по HTTP не допускается — 403", async () => {
    // Э12.5: ученики новой модели аккаунта не имеют; ветка «ученик из группы» убрана.
    await expect(listDecks(student, LESSON)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("чужому учителю (не хозяину урока) заметки не видны", async () => {
    await expect(listDecks(otherTeacher, LESSON)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("reconcileStuckDecks (Э4.3, долг)", () => {
  it("подхватывает пропущенное завершение: missing-событие, задача completed", async () => {
    repoMock.listUnfinishedDecks.mockResolvedValue([
      { id: DECK, schoolId: SCHOOL, status: "converting", sourceStorageKey: "k", sourceMimeType: PPTX },
    ]);
    const slides = [
      { index: 0, imageStorageKey: "a", thumbStorageKey: "b", width: 1, height: 1, textLayer: null },
    ];
    jobsServiceMock.getConvertJobOutcome.mockResolvedValue({ kind: "completed", result: { slideCount: 1, slides } });

    await reconcileStuckDecks();

    expect(repoMock.replaceDeckSlides).toHaveBeenCalledWith(DECK, slides);
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, expect.objectContaining({ status: "ready" }));
  });

  it("converting + задачи в Redis нет → failed с просьбой перезалить", async () => {
    repoMock.listUnfinishedDecks.mockResolvedValue([
      { id: DECK, schoolId: SCHOOL, status: "converting", sourceStorageKey: "k", sourceMimeType: PPTX },
    ]);
    jobsServiceMock.getConvertJobOutcome.mockResolvedValue({ kind: "missing" });

    await reconcileStuckDecks();

    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(
      DECK,
      expect.objectContaining({ status: "failed" }),
    );
    expect(jobsServiceMock.enqueueConvert).not.toHaveBeenCalled();
  });

  it("pending + задачи нет → переставляет в очередь", async () => {
    repoMock.listUnfinishedDecks.mockResolvedValue([
      { id: DECK, schoolId: SCHOOL, status: "pending", sourceStorageKey: "src-k", sourceMimeType: PPTX },
    ]);
    jobsServiceMock.getConvertJobOutcome.mockResolvedValue({ kind: "missing" });

    await reconcileStuckDecks();

    expect(jobsServiceMock.enqueueConvert).toHaveBeenCalledWith({
      deckId: DECK,
      schoolId: SCHOOL,
      sourceStorageKey: "src-k",
      sourceMimeType: PPTX,
    });
    expect(repoMock.setDeckStatus).not.toHaveBeenCalled();
  });

  it("задача ещё выполняется → ничего не трогает", async () => {
    repoMock.listUnfinishedDecks.mockResolvedValue([
      { id: DECK, schoolId: SCHOOL, status: "converting", sourceStorageKey: "k", sourceMimeType: PPTX },
    ]);
    jobsServiceMock.getConvertJobOutcome.mockResolvedValue({ kind: "in-progress" });

    await reconcileStuckDecks();

    expect(repoMock.setDeckStatus).not.toHaveBeenCalled();
    expect(repoMock.replaceDeckSlides).not.toHaveBeenCalled();
    expect(jobsServiceMock.enqueueConvert).not.toHaveBeenCalled();
  });
});

describe("buildConvertJobHandlers (Э4.3)", () => {
  const handlers = buildConvertJobHandlers();

  it("onProgress помечает презентацию converting с done/total и шлёт WS-событие «3 из 10»", async () => {
    await handlers.onProgress(DECK, { done: 3, total: 10 });
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "converting",
      progress: 3,
      slideCount: 10,
    });
    expect(roomsServiceMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "deck_status",
      deck: { deckId: DECK, title: "Урок 1", status: "converting", progress: 3, slideCount: 10, error: null },
    });
  });

  it("onCompleted заменяет слайды и ставит ready", async () => {
    const slides = [
      { index: 0, imageStorageKey: "a", thumbStorageKey: "b", width: 1, height: 2, textLayer: null, notes: null },
    ];
    await handlers.onCompleted(DECK, { slideCount: 1, slides });
    expect(repoMock.replaceDeckSlides).toHaveBeenCalledWith(DECK, slides);
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "ready",
      renderMode: "images",
      progress: 1,
      slideCount: 1,
      error: null,
    });
  });

  it("Э4.7: onCompleted с pdf: true — слайды не пишет, ставит renderMode pdf", async () => {
    await handlers.onCompleted(DECK, { slideCount: 12, slides: [], pdf: true });
    expect(repoMock.replaceDeckSlides).toHaveBeenCalledWith(DECK, []);
    expect(repoMock.setDeckStatus).toHaveBeenCalledWith(DECK, {
      status: "ready",
      renderMode: "pdf",
      progress: 12,
      slideCount: 12,
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
