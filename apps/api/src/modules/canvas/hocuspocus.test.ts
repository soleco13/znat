import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Doc,
  Map as YMap,
  Text as YText,
  applyUpdate,
  encodeStateAsUpdate,
  encodeStateVector,
  encodeStateVectorFromUpdate,
} from "yjs";
import type { Document as HocuspocusDocument } from "@hocuspocus/server";
import type { AccessTokenPayload } from "@school/shared";
// Э10.6: НЕ мокаем — чистый модуль без сторонних импортов (см. его докстринг),
// секрет для теста уже в apps/api/vitest.config.ts (JWT_RECORDER_SECRET).
import { signRecorderToken } from "../recorder-auth/service.js";

const { authServiceMock, lessonsServiceMock, guestsServiceMock, repoMock } = vi.hoisted(() => ({
  authServiceMock: {
    verifyAccessToken: vi.fn(),
  },
  lessonsServiceMock: {
    getLesson: vi.fn(),
  },
  guestsServiceMock: {
    GUEST_COOKIE_NAME: "guest_session",
    REMOVED_FROM_LESSON_MESSAGE: "removed",
    isGuestSessionRevoked: vi.fn().mockResolvedValue(false),
    verifyGuestToken: vi.fn(),
    resolveGuestSession: vi.fn(),
  },
  repoMock: {
    loadDoc: vi.fn(),
    saveDoc: vi.fn(),
  },
}));

// Как настоящий resolveGuestSession: подпись/срок → 401, отзыв → 403.
// Тесты по-прежнему настраивают verifyGuestToken/isGuestSessionRevoked.
guestsServiceMock.resolveGuestSession.mockImplementation(async (token: string) => {
  let payload: { lessonId: string; guestId: string; name: string };
  try {
    payload = await guestsServiceMock.verifyGuestToken(token);
  } catch {
    throw Object.assign(new Error("invalid"), { statusCode: 401, code: "invalid_guest_session" });
  }
  if (await guestsServiceMock.isGuestSessionRevoked(payload.guestId)) {
    throw Object.assign(new Error("removed"), { statusCode: 403, code: "removed_from_lesson" });
  }
  return { kind: "guest", participantId: payload.guestId, schoolId: "s", role: null, lessonId: payload.lessonId, displayName: payload.name };
});

vi.mock("../auth/service.js", () => authServiceMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../guests/service.js", () => guestsServiceMock);
vi.mock("./repo.js", () => repoMock);

/** Э12.4: гостевую куку `guest_session` кладём в заголовок `Cookie` — hocuspocus отдаёт `requestHeaders` как `Headers`. */
function guestCookieHeaders(token: string): Headers {
  return new Headers({ cookie: `guest_session=${token}` });
}

const {
  authenticateCanvasConnection,
  assertCanDrawForLesson,
  loadCanvasDocument,
  storeCanvasDocument,
  clearEmptySinceOnConnect,
  trackEmptySinceOnDisconnect,
  vetoUnloadDuringGracePeriod,
  runCanvasUnloadSweepOnce,
  getActiveCanvasDocumentsCount,
  setDrawPermission,
  setDrawPermissionResolver,
  clearDrawPermissionOverrides,
  postAnswerToBoard,
  hocuspocus,
  trackReadOnlyRejection,
  limitGuestCanvasInbound,
  getRejectedReadOnlyUpdatesCount,
  getCanvasDocumentsWithPendingUpdatesCount,
} = await import("./hocuspocus.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const TEACHER_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_STUDENT_ID = "55555555-5555-5555-5555-555555555555";

function baseLesson(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LESSON_ID,
    schoolId: SCHOOL_ID,
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

/** `connectionConfig` мутируется authenticateCanvasConnection напрямую (Э3.8) — как и реальный Hocuspocus, тест передаёт свежий объект и проверяет его после вызова. */
function fakeConnectionConfig() {
  return { readOnly: false, isAuthenticated: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  lessonsServiceMock.getLesson.mockResolvedValue(baseLesson());
});

describe("authenticateCanvasConnection", () => {
  it("некорректный documentName (не UUID) отклоняется до похода в БД", async () => {
    await expect(
      authenticateCanvasConnection({ token: "t", documentName: "not-a-uuid", connectionConfig: fakeConnectionConfig(), requestHeaders: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(lessonsServiceMock.getLesson).not.toHaveBeenCalled();
  });

  it("админ подключается к любому уроку своей школы, readOnly не выставляется (Э3.8)", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "admin", sub: "admin-1" }));
    const connectionConfig = fakeConnectionConfig();

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig, requestHeaders: new Headers() });
    expect(result).toEqual({ userId: "admin-1", role: "admin" });
    expect(connectionConfig.readOnly).toBe(false);
  });

  it("учитель, ведущий этот урок, подключается, readOnly не выставляется (Э3.8)", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "teacher", sub: TEACHER_ID }));
    const connectionConfig = fakeConnectionConfig();

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig, requestHeaders: new Headers() });
    expect(result).toEqual({ userId: TEACHER_ID, role: "teacher" });
    expect(connectionConfig.readOnly).toBe(false);
  });

  it("учитель, НЕ ведущий этот урок, отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(
      tokenFor({ role: "teacher", sub: "77777777-7777-7777-7777-777777777777" }),
    );

    await expect(
      authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig(), requestHeaders: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("Э12.4: гость подключается к своему уроку по куке, но по умолчанию readOnly (canDraw:false у гостя)", async () => {
    guestsServiceMock.verifyGuestToken.mockResolvedValue({
      typ: "guest",
      lessonId: LESSON_ID,
      guestId: STUDENT_ID,
      name: "Аня",
      lt: "l".repeat(64),
    });
    const connectionConfig = fakeConnectionConfig();

    const result = await authenticateCanvasConnection({
      token: "",
      documentName: LESSON_ID,
      connectionConfig,
      requestHeaders: guestCookieHeaders("guest-jwt"),
    });
    expect(result).toEqual({ userId: STUDENT_ID, role: "guest" });
    expect(connectionConfig.readOnly).toBe(true);
  });

  it("после рестарта (в памяти прав нет) право рисовать берётся из presence в Redis", async () => {
    const lessonId = "66666666-6666-6666-6666-666666666666";
    guestsServiceMock.verifyGuestToken.mockResolvedValue({
      typ: "guest",
      lessonId,
      guestId: STUDENT_ID,
      name: "Аня",
      lt: "l".repeat(64),
    });
    const resolver = vi.fn().mockResolvedValue(true);
    setDrawPermissionResolver(resolver);
    try {
      const connectionConfig = fakeConnectionConfig();
      await authenticateCanvasConnection({
        token: "",
        documentName: lessonId,
        connectionConfig,
        requestHeaders: guestCookieHeaders("guest-jwt"),
      });
      expect(resolver).toHaveBeenCalledWith(lessonId, STUDENT_ID);
      expect(connectionConfig.readOnly).toBe(false);

      // Живой грант учителя важнее: в памяти уже есть ответ — Redis не спрашиваем.
      resolver.mockClear();
      setDrawPermission(lessonId, STUDENT_ID, false);
      const second = fakeConnectionConfig();
      await authenticateCanvasConnection({
        token: "",
        documentName: lessonId,
        connectionConfig: second,
        requestHeaders: guestCookieHeaders("guest-jwt"),
      });
      expect(resolver).not.toHaveBeenCalled();
      expect(second.readOnly).toBe(true);
    } finally {
      setDrawPermissionResolver(async () => null);
      await clearDrawPermissionOverrides({ documentName: lessonId });
    }
  });

  it("Э12.4: гостевая сессия другого урока отклоняется", async () => {
    guestsServiceMock.verifyGuestToken.mockResolvedValue({
      typ: "guest",
      lessonId: "99999999-9999-9999-9999-999999999999",
      guestId: STUDENT_ID,
      name: "Аня",
      lt: "l".repeat(64),
    });

    await expect(
      authenticateCanvasConnection({
        token: "",
        documentName: LESSON_ID,
        connectionConfig: fakeConnectionConfig(),
        requestHeaders: guestCookieHeaders("guest-jwt"),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("Э12.4: ни access-токена, ни гостевой куки — 401", async () => {
    await expect(
      authenticateCanvasConnection({
        token: "",
        documentName: LESSON_ID,
        connectionConfig: fakeConnectionConfig(),
        requestHeaders: new Headers(),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("methodist к уроку не допускается", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "methodist", sub: "88888888-8888-8888-8888-888888888888" }));

    await expect(
      authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig(), requestHeaders: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("невалидный токен отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockRejectedValue(new Error("bad token"));

    await expect(
      authenticateCanvasConnection({ token: "bad", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig(), requestHeaders: new Headers() }),
    ).rejects.toThrow();
  });

  describe("Э10.6 — recorder шаблона записи", () => {
    it("recorder-токен своего урока — read-only ВСЕГДА, в обход computeCanDraw", async () => {
      const RECORDING_ID = "66666666-6666-6666-6666-666666666666";
      const token = await signRecorderToken(LESSON_ID, RECORDING_ID);
      const connectionConfig = fakeConnectionConfig();

      const result = await authenticateCanvasConnection({
        token,
        documentName: LESSON_ID,
        connectionConfig,
        requestHeaders: new Headers(),
      });

      expect(result).toEqual({ userId: `recorder:${RECORDING_ID}`, role: "recorder" });
      expect(connectionConfig.readOnly).toBe(true);
      // Recorder не персонал — не идёт через assertStaffLessonAccess/lessonsService.
      expect(lessonsServiceMock.getLesson).not.toHaveBeenCalled();
    });

    it("recorder-токен другого урока — 403", async () => {
      const token = await signRecorderToken(
        "99999999-9999-9999-9999-999999999999",
        "66666666-6666-6666-6666-666666666666",
      );

      await expect(
        authenticateCanvasConnection({
          token,
          documentName: LESSON_ID,
          connectionConfig: fakeConnectionConfig(),
          requestHeaders: new Headers(),
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});

describe("loadCanvasDocument (Э3.2)", () => {
  it("документа ещё нет в БД — возвращает undefined (штатный пустой Y.Doc)", async () => {
    repoMock.loadDoc.mockResolvedValue(null);

    const result = await loadCanvasDocument({ documentName: LESSON_ID });
    expect(result).toBeUndefined();
    expect(repoMock.loadDoc).toHaveBeenCalledWith(LESSON_ID);
  });

  it("документ есть в БД — возвращает сырые байты как есть", async () => {
    const doc = new Doc();
    doc.getArray("elements").push(["stroke"]);
    const saved = Buffer.from(encodeStateAsUpdate(doc));
    repoMock.loadDoc.mockResolvedValue(saved);

    const result = await loadCanvasDocument({ documentName: LESSON_ID });
    expect(result).toBe(saved);
  });

  it("выбрасывает застрявшие pending-правки, сохраняя видимое содержимое", async () => {
    const author = new Doc();
    author.getArray("elements").push(["lost"]);
    const lost = encodeStateAsUpdate(author);
    author.getArray("elements").push(["stuck"]);
    const stuck = encodeStateAsUpdate(author, encodeStateVectorFromUpdate(lost));
    const teacher = new Doc();
    teacher.getArray("elements").push(["visible"]);
    const server = new Doc();
    applyUpdate(server, encodeStateAsUpdate(teacher));
    applyUpdate(server, stuck);
    expect(server.store.pendingStructs).not.toBeNull();
    repoMock.loadDoc.mockResolvedValue(Buffer.from(encodeStateAsUpdate(server)));

    const result = await loadCanvasDocument({ documentName: LESSON_ID });

    const loaded = new Doc();
    applyUpdate(loaded, result!);
    expect(loaded.store.pendingStructs).toBeNull();
    expect(loaded.getArray("elements").toArray()).toEqual(["visible"]);
    // Автор, всё ещё подключённый, досылает пропуск — и его правки восстанавливаются целиком.
    applyUpdate(loaded, encodeStateAsUpdate(author, encodeStateVector(loaded)));
    expect(loaded.getArray("elements").toArray()).toHaveLength(3);
  });
});

describe("storeCanvasDocument (Э3.2)", () => {
  it("сохраняет полное состояние Y.Doc, применимое обратно через applyUpdate", async () => {
    const doc = new Doc();
    doc.getText("note").insert(0, "привет");

    await storeCanvasDocument({ documentName: LESSON_ID, document: doc as unknown as HocuspocusDocument });

    expect(repoMock.saveDoc).toHaveBeenCalledTimes(1);
    const [savedLessonId, savedBytes] = repoMock.saveDoc.mock.calls[0] as [string, Buffer];
    expect(savedLessonId).toBe(LESSON_ID);
    expect(Buffer.isBuffer(savedBytes)).toBe(true);

    // Круглый путь: применённые к новому документу байты дают тот же текст.
    const restored = new Doc();
    applyUpdate(restored, savedBytes);
    expect((restored.getText("note") as YText).toString()).toBe("привет");

    // Сверка независимым вызовом encodeStateAsUpdate — не мок, реальный Yjs.
    expect(savedBytes.equals(Buffer.from(encodeStateAsUpdate(doc)))).toBe(true);
  });
});

function fakeDocument(connectionsCount: number): HocuspocusDocument {
  return { getConnectionsCount: () => connectionsCount } as unknown as HocuspocusDocument;
}

describe("грейс-период выгрузки Y.Doc (Э3.3)", () => {
  const FIVE_MIN_MS = 5 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("документ с активными подключениями не помечается пустым при disconnect другого клиента", async () => {
    const doc = "lesson-still-connected";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(1) });

    // getConnectionsCount() > 0 в момент disconnect — значит ушёл не последний,
    // emptySince не должен был выставиться. Проверяем это через veto: раз
    // "since" нет, veto уходит в защитную ветку "только начался", а не
    // "не прошло 5 минут" — но в обоих случаях он отклоняет, поэтому
    // единственный наблюдаемый способ различить их снаружи — проверить sweep:
    // документ без записи в emptySince вообще не попадёт в его цикл.
    hocuspocus.documents.set(doc, fakeDocument(1));
    const unloadSpy = vi.spyOn(hocuspocus, "unloadDocument").mockResolvedValue(undefined);
    vi.setSystemTime(Date.now() + FIVE_MIN_MS + 1000);
    runCanvasUnloadSweepOnce();
    expect(unloadSpy).not.toHaveBeenCalled();
    unloadSpy.mockRestore();
    hocuspocus.documents.delete(doc);
  });

  it("sweep не выгружает документ, если у него прямо сейчас снова есть подключения (гонка с reconnect)", async () => {
    const doc = "lesson-reconnected-race";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(0) });
    vi.setSystemTime(Date.now() + FIVE_MIN_MS + 1000);
    // К моменту sweep кто-то успел переподключиться, но connected-хук по
    // какой-то причине ещё не вызван (гонка) — sweep обязан сам перепроверить
    // getConnectionsCount() у актуального документа, а не слепо верить
    // устаревшей отметке emptySince.
    hocuspocus.documents.set(doc, fakeDocument(1));
    const unloadSpy = vi.spyOn(hocuspocus, "unloadDocument").mockResolvedValue(undefined);

    runCanvasUnloadSweepOnce();

    expect(unloadSpy).not.toHaveBeenCalled();
    unloadSpy.mockRestore();
    hocuspocus.documents.delete(doc);
  });

  it("выгрузка отклоняется (veto), пока не прошло 5 минут с момента опустения", async () => {
    const doc = "lesson-grace-not-elapsed";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(0) });

    await expect(vetoUnloadDuringGracePeriod({ documentName: doc })).rejects.toThrow();

    vi.setSystemTime(Date.now() + FIVE_MIN_MS - 1000);
    await expect(vetoUnloadDuringGracePeriod({ documentName: doc })).rejects.toThrow();
  });

  it("выгрузка разрешается (не throw) после истечения 5 минут", async () => {
    const doc = "lesson-grace-elapsed";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(0) });

    vi.setSystemTime(Date.now() + FIVE_MIN_MS + 1000);
    await expect(vetoUnloadDuringGracePeriod({ documentName: doc })).resolves.toBeUndefined();
  });

  it("переподключение (connected) сбрасывает отметку опустения — грейс-период начинается заново", async () => {
    const doc = "lesson-reconnected";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(0) });
    vi.setSystemTime(Date.now() + FIVE_MIN_MS + 1000);

    await clearEmptySinceOnConnect({ documentName: doc });

    // Отметка сброшена — следующая попытка выгрузки видит "документ ещё не
    // помечался пустым" и защитно ветирует заново, а не считает грейс истёкшим.
    await expect(vetoUnloadDuringGracePeriod({ documentName: doc })).rejects.toThrow();
  });

  it("sweep выгружает документ без подключений, у которого истёк грейс-период", async () => {
    const doc = "lesson-swept";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(0) });
    hocuspocus.documents.set(doc, fakeDocument(0));
    const unloadSpy = vi.spyOn(hocuspocus, "unloadDocument").mockResolvedValue(undefined);

    vi.setSystemTime(Date.now() + FIVE_MIN_MS + 1000);
    runCanvasUnloadSweepOnce();

    expect(unloadSpy).toHaveBeenCalledTimes(1);
    unloadSpy.mockRestore();
    hocuspocus.documents.delete(doc);
  });

  it("sweep не трогает документ без подключений раньше истечения грейс-периода", async () => {
    const doc = "lesson-not-yet";
    await trackEmptySinceOnDisconnect({ documentName: doc, document: fakeDocument(0) });
    hocuspocus.documents.set(doc, fakeDocument(0));
    const unloadSpy = vi.spyOn(hocuspocus, "unloadDocument").mockResolvedValue(undefined);

    vi.setSystemTime(Date.now() + FIVE_MIN_MS - 1000);
    runCanvasUnloadSweepOnce();

    expect(unloadSpy).not.toHaveBeenCalled();
    unloadSpy.mockRestore();
    hocuspocus.documents.delete(doc);
  });
});

describe("getActiveCanvasDocumentsCount (Э3.3, метрика Prometheus)", () => {
  it("отражает актуальный размер hocuspocus.documents", () => {
    const before = getActiveCanvasDocumentsCount();
    hocuspocus.documents.set("lesson-metric-probe", fakeDocument(0));
    expect(getActiveCanvasDocumentsCount()).toBe(before + 1);
    hocuspocus.documents.delete("lesson-metric-probe");
    expect(getActiveCanvasDocumentsCount()).toBe(before);
  });
});

function fakeConnection(userId: string, readOnly: boolean) {
  return { context: { userId }, readOnly };
}

describe("setDrawPermission (Э3.8)", () => {
  afterEach(() => {
    // Оверрайды — module-level Map, между тестами их нужно чистить самим:
    // используем тот же путь, что и настоящий afterUnloadDocument-хук.
    clearDrawPermissionOverrides({ documentName: LESSON_ID });
  });

  function mockGuest(sub: string) {
    guestsServiceMock.verifyGuestToken.mockResolvedValue({
      typ: "guest",
      lessonId: LESSON_ID,
      guestId: sub,
      name: "Гость",
      lt: "l".repeat(64),
    });
  }

  it("влияет на readOnly следующего подключения того же участника (документ ещё не в памяти)", async () => {
    setDrawPermission(LESSON_ID, STUDENT_ID, true);
    mockGuest(STUDENT_ID);
    const connectionConfig = fakeConnectionConfig();

    await authenticateCanvasConnection({
      token: "",
      documentName: LESSON_ID,
      connectionConfig,
      requestHeaders: guestCookieHeaders("g"),
    });

    expect(connectionConfig.readOnly).toBe(false);
  });

  it("отзыв права переопределяет даже ранее выданное разрешение", async () => {
    setDrawPermission(LESSON_ID, STUDENT_ID, true);
    setDrawPermission(LESSON_ID, STUDENT_ID, false);
    mockGuest(STUDENT_ID);
    const connectionConfig = fakeConnectionConfig();

    await authenticateCanvasConnection({
      token: "",
      documentName: LESSON_ID,
      connectionConfig,
      requestHeaders: guestCookieHeaders("g"),
    });

    expect(connectionConfig.readOnly).toBe(true);
  });

  it("применяется немедленно к уже открытому подключению этого участника, не трогая чужие", () => {
    const mine = fakeConnection(STUDENT_ID, true);
    const someoneElse = fakeConnection(OTHER_STUDENT_ID, true);
    const document = { ...fakeDocument(2), getConnections: () => [mine, someoneElse] } as unknown as HocuspocusDocument;
    hocuspocus.documents.set(LESSON_ID, document);

    setDrawPermission(LESSON_ID, STUDENT_ID, true);

    expect(mine.readOnly).toBe(false);
    expect(someoneElse.readOnly).toBe(true);
    hocuspocus.documents.delete(LESSON_ID);
  });

  it("документ этого урока ещё не загружен в память — тихо ничего не делает, не падает", () => {
    expect(() => setDrawPermission("lesson-not-loaded-yet", STUDENT_ID, true)).not.toThrow();
  });
});

describe("assertCanDrawForLesson (Э3.10 — право загружать изображение на доску)", () => {
  afterEach(() => {
    clearDrawPermissionOverrides({ documentName: LESSON_ID });
  });

  it("учитель, ведущий урок, проходит (canDraw по умолчанию у роли)", async () => {
    await expect(
      assertCanDrawForLesson({ sub: TEACHER_ID, role: "teacher", schoolId: SCHOOL_ID }, LESSON_ID),
    ).resolves.toBeUndefined();
  });

  it("учитель, НЕ ведущий этот урок, отклоняется — членство проверяется раньше canDraw", async () => {
    await expect(
      assertCanDrawForLesson(
        { sub: "77777777-7777-7777-7777-777777777777", role: "teacher", schoolId: SCHOOL_ID },
        LESSON_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("Э12.4: не-персонал (роль вне admin/teacher) к этому HTTP-пути не допускается", async () => {
    await expect(
      assertCanDrawForLesson({ sub: STUDENT_ID, role: "methodist", schoolId: SCHOOL_ID }, LESSON_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("postAnswerToBoard (Э8.10, §7.3 ТЗ: «вынести чей-то ответ на доску»)", () => {
  afterEach(() => {
    hocuspocus.documents.delete(LESSON_ID);
  });

  it("дописывает текстовый элемент в Y.Array активной страницы и сохраняет документ", async () => {
    repoMock.loadDoc.mockResolvedValue(null);
    repoMock.saveDoc.mockResolvedValue(undefined);

    await postAnswerToBoard(LESSON_ID, "Аня:\n4");

    expect(repoMock.saveDoc).toHaveBeenCalledWith(LESSON_ID, expect.any(Buffer));

    const doc = hocuspocus.documents.get(LESSON_ID)!;
    const pageId = doc.getMap("meta").get("activePageId") as string;
    expect(pageId).toBeTruthy();
    const yElements = doc.getArray(`elements:${pageId}`);
    expect(yElements.length).toBe(1);
    const el = (yElements.get(0) as InstanceType<typeof YMap>).get("el") as { type: string; text: string };
    expect(el.type).toBe("text");
    expect(el.text).toBe("Аня:\n4");
  });

  it("вызов без единого подключения сам заводит первую страницу холста (защитный случай)", async () => {
    repoMock.loadDoc.mockResolvedValue(null);
    await postAnswerToBoard(LESSON_ID, "первый ответ");
    const doc = hocuspocus.documents.get(LESSON_ID)!;
    expect(doc.getMap("pages").size).toBe(1);
  });

  it("повторный вызов дописывает в ТУ ЖЕ активную страницу, не заводит новую", async () => {
    repoMock.loadDoc.mockResolvedValue(null);
    await postAnswerToBoard(LESSON_ID, "первый");
    const doc = hocuspocus.documents.get(LESSON_ID)!;
    const pageId = doc.getMap("meta").get("activePageId") as string;

    await postAnswerToBoard(LESSON_ID, "второй");

    expect(doc.getMap("meta").get("activePageId")).toBe(pageId);
    expect(doc.getMap("pages").size).toBe(1);
    expect(doc.getArray(`elements:${pageId}`).length).toBe(2);
  });

  it("длинный ответ переносится по строкам не длиннее лимита символов", async () => {
    repoMock.loadDoc.mockResolvedValue(null);
    const longText = Array.from({ length: 20 }, () => "слово").join(" ");

    await postAnswerToBoard(LESSON_ID, longText);

    const doc = hocuspocus.documents.get(LESSON_ID)!;
    const pageId = doc.getMap("meta").get("activePageId") as string;
    const el = (doc.getArray(`elements:${pageId}`).get(0) as InstanceType<typeof YMap>).get("el") as {
      text: string;
    };
    for (const line of el.text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(48);
    }
    // Ни одно слово не потерялось при переносе.
    expect(el.text.replace(/\n/g, " ")).toBe(longText);
  });

  it("уважает уже открытую страницу с элементами — новый элемент идёт последним по pos", async () => {
    repoMock.loadDoc.mockResolvedValue(null);
    // Имитация того, что доска уже открыта с одним нарисованным элементом
    // (как её создал бы реальный ExcalidrawBinding, Board.tsx).
    const doc = await hocuspocus.openDirectConnection(LESSON_ID);
    await doc.transact((document) => {
      const pageId = "existing-page";
      document.getMap("pages").set(pageId, { order: 0, backgroundAssetId: null, kind: "blank" });
      document.getMap("meta").set("activePageId", pageId);
      const yElements = document.getArray(`elements:${pageId}`);
      yElements.push([new YMap(Object.entries({ pos: "a0", el: { id: "existing", type: "rectangle" } }))]);
    });
    await doc.disconnect();

    await postAnswerToBoard(LESSON_ID, "ответ ученика");

    const stored = hocuspocus.documents.get(LESSON_ID)!;
    const pageId = stored.getMap("meta").get("activePageId") as string;
    expect(pageId).toBe("existing-page");
    const yElements = stored.getArray(`elements:${pageId}`);
    expect(yElements.length).toBe(2);
    const ids = yElements.toArray().map((m) => (m as InstanceType<typeof YMap>).get("el") as { id: string }).map((e) => e.id);
    expect(ids).toEqual(["existing", expect.any(String)]);
  });
});

describe("видимость отброшенных и застрявших правок доски", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  afterEach(() => {
    warn.mockClear();
    clearDrawPermissionOverrides({ documentName: LESSON_ID });
  });

  function syncPayload(readOnly: boolean, type: number, userId = STUDENT_ID) {
    return {
      connection: fakeConnection(userId, readOnly),
      type,
      documentName: LESSON_ID,
      context: { userId },
    } as unknown as Parameters<typeof trackReadOnlyRejection>[0];
  }

  it("считает правку read-only подключения и пишет в лог", async () => {
    const before = getRejectedReadOnlyUpdatesCount();

    await trackReadOnlyRejection(syncPayload(true, 2));

    expect(getRejectedReadOnlyUpdatesCount()).toBe(before + 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(STUDENT_ID);
  });

  it("лог — не чаще раза в минуту на участника, счётчик — каждый отказ", async () => {
    const before = getRejectedReadOnlyUpdatesCount();

    await trackReadOnlyRejection(syncPayload(true, 2));
    await trackReadOnlyRejection(syncPayload(true, 2));
    await trackReadOnlyRejection(syncPayload(true, 2, OTHER_STUDENT_ID));

    expect(getRejectedReadOnlyUpdatesCount()).toBe(before + 3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("не считает правки подключения с правом рисовать и рукопожатие read-only клиента", async () => {
    const before = getRejectedReadOnlyUpdatesCount();

    await trackReadOnlyRejection(syncPayload(false, 2));
    await trackReadOnlyRejection(syncPayload(true, 0));
    await trackReadOnlyRejection(syncPayload(true, 1));

    expect(getRejectedReadOnlyUpdatesCount()).toBe(before);
  });

  it("находит документ, где правки клиента застряли в pending из-за пропущенного начала", () => {
    const author = new Doc();
    const probe = new Doc();
    author.getArray("elements").push(["first"]);
    const first = encodeStateAsUpdate(author);
    author.getArray("elements").push(["second"]);
    const onlySecond = encodeStateAsUpdate(author, encodeStateVectorFromUpdate(first));
    applyUpdate(probe, onlySecond);
    const before = getCanvasDocumentsWithPendingUpdatesCount();

    hocuspocus.documents.set("lesson-pending-probe", probe as unknown as HocuspocusDocument);
    expect(getCanvasDocumentsWithPendingUpdatesCount()).toBe(before + 1);

    applyUpdate(probe, first);
    expect(getCanvasDocumentsWithPendingUpdatesCount()).toBe(before);
    hocuspocus.documents.delete("lesson-pending-probe");
  });
});

describe("limitGuestCanvasInbound", () => {
  const doc = "77777777-7777-7777-7777-777777777777";
  const MB = 1024 * 1024;

  it("гость сверх 20 МБ в минуту — соединение закрывается, через минуту бюджет новый", async () => {
    const ctx = { userId: STUDENT_ID, role: "guest" };
    const t0 = 1_000_000;
    await limitGuestCanvasInbound({ update: new Uint8Array(15 * MB), documentName: doc, context: ctx }, t0);
    await expect(
      limitGuestCanvasInbound({ update: new Uint8Array(6 * MB), documentName: doc, context: ctx }, t0 + 1_000),
    ).rejects.toMatchObject({ code: 4429 });
    await expect(
      limitGuestCanvasInbound({ update: new Uint8Array(6 * MB), documentName: doc, context: ctx }, t0 + 61_000),
    ).resolves.toBeUndefined();
    await clearDrawPermissionOverrides({ documentName: doc });
  });

  it("персонал не ограничивается", async () => {
    const ctx = { userId: TEACHER_ID, role: "teacher" };
    await expect(
      limitGuestCanvasInbound({ update: new Uint8Array(30 * MB), documentName: doc, context: ctx }),
    ).resolves.toBeUndefined();
  });
});
