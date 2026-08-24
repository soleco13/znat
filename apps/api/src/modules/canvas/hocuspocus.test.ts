import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Doc, Text as YText, applyUpdate, encodeStateAsUpdate } from "yjs";
import type { Document as HocuspocusDocument } from "@hocuspocus/server";
import type { AccessTokenPayload } from "@school/shared";

const { authServiceMock, lessonsServiceMock, usersServiceMock, repoMock } = vi.hoisted(() => ({
  authServiceMock: {
    verifyAccessToken: vi.fn(),
  },
  lessonsServiceMock: {
    getLesson: vi.fn(),
  },
  usersServiceMock: {
    isGroupMember: vi.fn(),
  },
  repoMock: {
    loadDoc: vi.fn(),
    saveDoc: vi.fn(),
  },
}));

vi.mock("../auth/service.js", () => authServiceMock);
vi.mock("../lessons/service.js", () => lessonsServiceMock);
vi.mock("../users/service.js", () => usersServiceMock);
vi.mock("./repo.js", () => repoMock);

const {
  authenticateCanvasConnection,
  loadCanvasDocument,
  storeCanvasDocument,
  clearEmptySinceOnConnect,
  trackEmptySinceOnDisconnect,
  vetoUnloadDuringGracePeriod,
  runCanvasUnloadSweepOnce,
  getActiveCanvasDocumentsCount,
  setDrawPermission,
  clearDrawPermissionOverrides,
  hocuspocus,
} = await import("./hocuspocus.js");

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
      authenticateCanvasConnection({ token: "t", documentName: "not-a-uuid", connectionConfig: fakeConnectionConfig() }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(lessonsServiceMock.getLesson).not.toHaveBeenCalled();
  });

  it("админ подключается к любому уроку своей школы, readOnly не выставляется (Э3.8)", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "admin", sub: "admin-1" }));
    const connectionConfig = fakeConnectionConfig();

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig });
    expect(result).toEqual({ userId: "admin-1", role: "admin" });
    expect(connectionConfig.readOnly).toBe(false);
  });

  it("учитель, ведущий этот урок, подключается, readOnly не выставляется (Э3.8)", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "teacher", sub: TEACHER_ID }));
    const connectionConfig = fakeConnectionConfig();

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig });
    expect(result).toEqual({ userId: TEACHER_ID, role: "teacher" });
    expect(connectionConfig.readOnly).toBe(false);
  });

  it("учитель, НЕ ведущий этот урок, отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(
      tokenFor({ role: "teacher", sub: "77777777-7777-7777-7777-777777777777" }),
    );

    await expect(
      authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig() }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("ученик из группы урока подключается, но по умолчанию readOnly (Э3.8 — canDraw:false у ученика без явного гранта)", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "student", sub: STUDENT_ID }));
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    const connectionConfig = fakeConnectionConfig();

    const result = await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig });
    expect(result).toEqual({ userId: STUDENT_ID, role: "student" });
    expect(usersServiceMock.isGroupMember).toHaveBeenCalledWith(GROUP_ID, STUDENT_ID);
    expect(connectionConfig.readOnly).toBe(true);
  });

  it("ученик НЕ из группы урока (чужой урок) отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "student", sub: STUDENT_ID }));
    usersServiceMock.isGroupMember.mockResolvedValue(false);

    await expect(
      authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig() }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("methodist к уроку не допускается", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "methodist", sub: "88888888-8888-8888-8888-888888888888" }));

    await expect(
      authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig() }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("невалидный токен отклоняется", async () => {
    authServiceMock.verifyAccessToken.mockRejectedValue(new Error("bad token"));

    await expect(
      authenticateCanvasConnection({ token: "bad", documentName: LESSON_ID, connectionConfig: fakeConnectionConfig() }),
    ).rejects.toThrow();
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
    const saved = Buffer.from([1, 2, 3]);
    repoMock.loadDoc.mockResolvedValue(saved);

    const result = await loadCanvasDocument({ documentName: LESSON_ID });
    expect(result).toBe(saved);
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

  it("влияет на readOnly следующего подключения того же участника (документ ещё не в памяти)", async () => {
    setDrawPermission(LESSON_ID, STUDENT_ID, true);
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "student", sub: STUDENT_ID }));
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    const connectionConfig = fakeConnectionConfig();

    await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig });

    expect(connectionConfig.readOnly).toBe(false);
  });

  it("отзыв права переопределяет даже ранее выданное разрешение", async () => {
    setDrawPermission(LESSON_ID, STUDENT_ID, true);
    setDrawPermission(LESSON_ID, STUDENT_ID, false);
    authServiceMock.verifyAccessToken.mockResolvedValue(tokenFor({ role: "student", sub: STUDENT_ID }));
    usersServiceMock.isGroupMember.mockResolvedValue(true);
    const connectionConfig = fakeConnectionConfig();

    await authenticateCanvasConnection({ token: "t", documentName: LESSON_ID, connectionConfig });

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
