import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { repoMock, egressMock, lessonsMock, roomsMock, storageMock, schoolSettingsMock } = vi.hoisted(() => ({
  repoMock: {
    insertRecording: vi.fn(),
    findRecordingById: vi.fn(),
    findRecordingByEgressId: vi.fn(),
    listRecordingsForLesson: vi.fn(),
    findActiveRecordingForLesson: vi.fn(),
    updateRecording: vi.fn(),
    listExpiredRecordings: vi.fn(),
    listAllActiveRecordings: vi.fn(),
    lessonHasActiveRecording: vi.fn(),
  },
  roomsMock: {
    broadcastToLesson: vi.fn(),
    countConnectedParticipants: vi.fn(),
  },
  egressMock: {
    startRoomRecording: vi.fn(),
    stopRecording: vi.fn(),
    listActiveEgress: vi.fn(),
    getEgressInfo: vi.fn(),
    // реальная (не замоканная) — чистая функция маппинга статуса
    mapEgressStatus: vi.fn(),
  },
  lessonsMock: {
    getLesson: vi.fn(),
    ensureLivekitRoom: vi.fn(),
  },
  storageMock: {
    getSignedFileUrl: vi.fn(),
    deleteFile: vi.fn(),
  },
  schoolSettingsMock: {
    // Параметры школы (запрос 2026-09-14): `recordingEnabled` по умолчанию
    // true в тестах — сам флаг проверяется отдельными кейсами через
    // `.mockResolvedValueOnce`.
    getSchoolSettings: vi.fn().mockResolvedValue({
      guestAccessEnabled: true,
      recordingEnabled: true,
      screenShareEnabled: true,
      pipEnabled: true,
      cameraResolution: "720p",
      cameraFps: 24,
      micHighQuality: false,
      screenShareResolution: "1080p",
      screenShareFps: 15,
      recordingQuality: "720p30",
    }),
  },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("./egress-client.js", () => egressMock);
vi.mock("../lessons/service.js", () => lessonsMock);
vi.mock("../rooms/service.js", () => roomsMock);
vi.mock("../storage/service.js", () => storageMock);
vi.mock("../school-settings/service.js", () => schoolSettingsMock);
vi.mock("../../plugins/env.js", () => ({
  env: {
    STORAGE_ROOT: "/data/assets",
    RECORDING_ENABLED: true,
    RECORDING_RETENTION_DAYS: 90,
    RECORDING_URL_TTL_SEC: 3600,
    RECORDING_EGRESS_TEMPLATE_URL: undefined,
    // Э10.6 — не мокаем recorder-auth/service.js целиком (он «чужой»
    // модуль, но чистый: без сторонних импортов, см. его докстринг), просто
    // даём ему настоящий секрет, чтобы signRecorderToken не молчал на пустом.
    JWT_RECORDER_SECRET: "test-recorder-secret-at-least-32-characters",
  },
}));

const service = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const LESSON = "22222222-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";

const teacherUser = { sub: TEACHER, schoolId: SCHOOL, role: "teacher" as const };
/** Э12.9: роли `student` в модели нет — это выданный до деплоя «легаси»-JWT, который ещё живёт TTL access-токена. */
const studentUser = { sub: OTHER, schoolId: SCHOOL, role: "student" } as unknown as AccessTokenPayload;
const adminUser = { sub: OTHER, schoolId: SCHOOL, role: "admin" as const };

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec-1",
    schoolId: SCHOOL,
    lessonId: LESSON,
    startedBy: TEACHER,
    egressId: "EG_1",
    status: "recording",
    storageKey: `recordings/${SCHOOL}/${LESSON}/rec-1.mp4`,
    durationSec: null,
    sizeBytes: null,
    startedAt: new Date("2026-09-05T10:00:00Z"),
    endedAt: null,
    expiresAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lessonsMock.getLesson.mockResolvedValue({ id: LESSON, schoolId: SCHOOL, teacherId: TEACHER });
  lessonsMock.ensureLivekitRoom.mockResolvedValue(`lesson-${LESSON}`);
  repoMock.findActiveRecordingForLesson.mockResolvedValue(null);
  repoMock.insertRecording.mockImplementation(async (v: Record<string, unknown>) => row(v));
  repoMock.updateRecording.mockImplementation(async (_id: string, p: Record<string, unknown>) => row(p));
  egressMock.startRoomRecording.mockResolvedValue({ egressId: "EG_1", status: "starting" });
  egressMock.stopRecording.mockResolvedValue("processing");
  storageMock.getSignedFileUrl.mockReturnValue("/files/signed?exp=1&sig=x");
});

describe("startLessonRecording (Э10.3, §10.4 ТЗ)", () => {
  it("503, если запись выключена фича-флагом", async () => {
    vi.resetModules();
    vi.doMock("../../plugins/env.js", () => ({ env: { RECORDING_ENABLED: false, STORAGE_ROOT: "/x", RECORDING_RETENTION_DAYS: 90, RECORDING_URL_TTL_SEC: 3600 } }));
    const s = await import("./service.js");
    await expect(s.startLessonRecording(teacherUser, LESSON)).rejects.toMatchObject({ statusCode: 503 });
    vi.doUnmock("../../plugins/env.js");
    vi.resetModules();
  });

  it("403, если запись выключена параметрами школы (запрос 2026-09-14)", async () => {
    schoolSettingsMock.getSchoolSettings.mockResolvedValueOnce({ recordingEnabled: false });
    await expect(service.startLessonRecording(teacherUser, LESSON)).rejects.toMatchObject({ statusCode: 403 });
    expect(egressMock.startRoomRecording).not.toHaveBeenCalled();
  });

  it("ученику — отказ (§10.10 ТЗ: записи ученикам недоступны)", async () => {
    await expect(service.startLessonRecording(studentUser, LESSON)).rejects.toMatchObject({ statusCode: 403 });
    expect(egressMock.startRoomRecording).not.toHaveBeenCalled();
  });

  it("учителю чужого урока — 404, а не 403", async () => {
    lessonsMock.getLesson.mockResolvedValue({ id: LESSON, schoolId: SCHOOL, teacherId: "someone-else" });
    await expect(service.startLessonRecording(teacherUser, LESSON)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("запускает egress в комнате урока и заводит строку записи", async () => {
    const res = await service.startLessonRecording(teacherUser, LESSON);
    expect(egressMock.startRoomRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: `lesson-${LESSON}`,
        absoluteFilepath: expect.stringContaining("/data/assets/recordings/"),
        qualityPreset: "720p30",
      }),
    );
    const inserted = repoMock.insertRecording.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted.storageKey).toMatch(/\.mp4$/);
    expect(inserted.egressId).toBe("EG_1");
    expect(res.status).toBe("starting");
  });

  it("Э10.6: передаёт lessonId и recorder-токен в шаблон записи", async () => {
    await service.startLessonRecording(teacherUser, LESSON);
    const call = egressMock.startRoomRecording.mock.calls[0]![0] as {
      templateQuery?: Record<string, string>;
    };
    expect(call.templateQuery?.lessonId).toBe(LESSON);
    expect(typeof call.templateQuery?.recorderToken).toBe("string");
    expect(call.templateQuery?.recorderToken?.split(".")).toHaveLength(3); // JWT-форма
  });

  it("не поднимает второй egress, если запись урока уже идёт", async () => {
    repoMock.findActiveRecordingForLesson.mockResolvedValue(row({ status: "recording" }));
    const res = await service.startLessonRecording(teacherUser, LESSON);
    expect(egressMock.startRoomRecording).not.toHaveBeenCalled();
    expect(res.id).toBe("rec-1");
  });

  it("egress не ответил → 502, строка не заводится", async () => {
    egressMock.startRoomRecording.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(service.startLessonRecording(adminUser, LESSON)).rejects.toMatchObject({ statusCode: 502 });
    expect(repoMock.insertRecording).not.toHaveBeenCalled();
  });
});

describe("stopLessonRecording (Э10.3)", () => {
  it("уже завершённую запись не трогает", async () => {
    repoMock.findRecordingById.mockResolvedValue(row({ status: "ready" }));
    const res = await service.stopLessonRecording(teacherUser, LESSON, "rec-1");
    expect(egressMock.stopRecording).not.toHaveBeenCalled();
    expect(res.status).toBe("ready");
  });

  it("активную — останавливает и переводит в processing", async () => {
    repoMock.findRecordingById.mockResolvedValue(row({ status: "recording" }));
    egressMock.stopRecording.mockResolvedValue("recording");
    await service.stopLessonRecording(teacherUser, LESSON, "rec-1");
    expect(egressMock.stopRecording).toHaveBeenCalledWith("EG_1");
    const patch = repoMock.updateRecording.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe("processing");
  });

  it("запись другого урока — 404", async () => {
    repoMock.findRecordingById.mockResolvedValue(row({ lessonId: "another-lesson" }));
    await expect(service.stopLessonRecording(teacherUser, LESSON, "rec-1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("applyEgressEvent (Э10 — статус от вебхука к строке)", () => {
  it("ready: пишет длительность из наносекунд, размер и срок ретеншна", async () => {
    repoMock.findRecordingByEgressId.mockResolvedValue(row({ status: "recording" }));
    await service.applyEgressEvent({
      egressId: "EG_1",
      status: "ready",
      fileSizeBytes: 1024,
      fileDurationNanos: 3_600_000_000_000, // 3600 c
      endedAtEpochMs: Date.parse("2026-09-05T11:00:00Z"),
    });
    const patch = repoMock.updateRecording.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe("ready");
    expect(patch.durationSec).toBe(3600);
    expect(patch.sizeBytes).toBe(1024);
    expect((patch.expiresAt as Date).toISOString()).toBe("2026-12-04T11:00:00.000Z"); // +90 дней
  });

  it("не откатывает терминальный статус более ранним из вебхука не по порядку", async () => {
    repoMock.findRecordingByEgressId.mockResolvedValue(row({ status: "ready" }));
    await service.applyEgressEvent({ egressId: "EG_1", status: "recording" });
    expect(repoMock.updateRecording).not.toHaveBeenCalled();
  });

  it("неизвестный egressId — тихо пропускает", async () => {
    repoMock.findRecordingByEgressId.mockResolvedValue(null);
    await service.applyEgressEvent({ egressId: "EG_unknown", status: "ready" });
    expect(repoMock.updateRecording).not.toHaveBeenCalled();
  });
});

describe("getLessonRecordings (Э10.4 — presigned по роли)", () => {
  it("presigned-ссылка только у готовых записей", async () => {
    repoMock.listRecordingsForLesson.mockResolvedValue([
      row({ id: "r-ready", status: "ready", storageKey: "recordings/x/y/r-ready.mp4" }),
      row({ id: "r-live", status: "recording" }),
    ]);
    const res = await service.getLessonRecordings(adminUser, LESSON);
    const ready = res.recordings.find((r) => r.id === "r-ready")!;
    const live = res.recordings.find((r) => r.id === "r-live")!;
    expect(ready.url).toBe("/files/signed?exp=1&sig=x");
    expect(live.url).toBeNull();
    expect(res.active?.id).toBe("r-live");
  });

  it("ученику — отказ", async () => {
    await expect(service.getLessonRecordings(studentUser, LESSON)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("runRetentionCleanup (Э10.4, §10.10 ТЗ)", () => {
  it("удаляет файл через StorageAdapter и помечает запись deleted", async () => {
    repoMock.listExpiredRecordings.mockResolvedValue([
      row({ id: "old-1", status: "ready", storageKey: "recordings/x/y/old-1.mp4" }),
    ]);
    const n = await service.runRetentionCleanup();
    expect(storageMock.deleteFile).toHaveBeenCalledWith("recordings/x/y/old-1.mp4");
    const patch = repoMock.updateRecording.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe("deleted");
    expect(patch.sizeBytes).toBeNull();
    expect(n).toBe(1);
  });

  it("сбой удаления одного файла не роняет весь свип", async () => {
    repoMock.listExpiredRecordings.mockResolvedValue([
      row({ id: "bad", storageKey: "k1" }),
      row({ id: "good", storageKey: "k2" }),
    ]);
    storageMock.deleteFile.mockRejectedValueOnce(new Error("EIO"));
    const n = await service.runRetentionCleanup();
    expect(n).toBe(1);
  });
});

describe("баннер согласия — recording_status в урок (Э10.3, 152-ФЗ)", () => {
  it("старт записи шлёт recording_status active:true всем участникам урока", async () => {
    await service.startLessonRecording(teacherUser, LESSON);
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "recording_status",
      active: true,
    });
  });

  it("стоп записи шлёт recording_status active:false", async () => {
    repoMock.findRecordingById.mockResolvedValue(row({ status: "recording" }));
    await service.stopLessonRecording(teacherUser, LESSON, "rec-1");
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "recording_status",
      active: false,
    });
  });

  it("egress сам завершил активную запись (комната закрылась) → active:false", async () => {
    repoMock.findRecordingByEgressId.mockResolvedValue(row({ status: "recording" }));
    await service.applyEgressEvent({ egressId: "EG_1", status: "aborted" });
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, {
      type: "recording_status",
      active: false,
    });
  });

  it("вебхук по уже терминальной записи не шлёт лишний active:false", async () => {
    repoMock.findRecordingByEgressId.mockResolvedValue(row({ status: "ready" }));
    await service.applyEgressEvent({ egressId: "EG_1", status: "ready" });
    expect(roomsMock.broadcastToLesson).not.toHaveBeenCalled();
  });

  it("isLessonRecordingActive проксирует repo без тенант-скоупа", async () => {
    repoMock.lessonHasActiveRecording.mockResolvedValue(true);
    await expect(service.isLessonRecordingActive(LESSON)).resolves.toBe(true);
    expect(repoMock.lessonHasActiveRecording).toHaveBeenCalledWith(LESSON);
  });
});

describe("getRecordingLoadSnapshot (Э10.5 — метрика «egress без публикующих»)", () => {
  it("по каждой активной записи отдаёт число участников на связи в её уроке", async () => {
    repoMock.listAllActiveRecordings.mockResolvedValue([
      row({ id: "a", lessonId: "lesson-a" }),
      row({ id: "b", lessonId: "lesson-b" }),
    ]);
    roomsMock.countConnectedParticipants.mockImplementation(async (id: string) =>
      id === "lesson-a" ? 5 : 0,
    );
    const snap = await service.getRecordingLoadSnapshot();
    expect(snap).toEqual([
      { lessonId: "lesson-a", connectedParticipants: 5 },
      { lessonId: "lesson-b", connectedParticipants: 0 },
    ]);
  });

  it("нет активных записей — пустой снимок", async () => {
    repoMock.listAllActiveRecordings.mockResolvedValue([]);
    await expect(service.getRecordingLoadSnapshot()).resolves.toEqual([]);
  });
});
