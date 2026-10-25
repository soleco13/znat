import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Экспериментальная запись: изоляция от основной (Egress), включение только
 * явно, разделение статусов и ошибок, проверка MP4 перед `ready`.
 */

const envMock = vi.hoisted(() => ({
  env: {
    STORAGE_ROOT: "/data/assets",
    RECORDING_ENABLED: true,
    RECORDING_RETENTION_DAYS: 90,
    RECORDING_URL_TTL_SEC: 3600,
    RECORDING_EGRESS_TEMPLATE_URL: undefined as string | undefined,
    JWT_RECORDER_SECRET: "test-recorder-secret-at-least-32-characters",
    LIVEKIT_URL: "ws://livekit:7880",
    LIVEKIT_API_KEY: "devkey",
    LIVEKIT_API_SECRET: "test-livekit-api-secret-at-least-32-chars",
    PUBLIC_ORIGIN: "https://matis.test",
    RAW_RECORDER_SECRET: undefined as string | undefined,
    RECORDING_EXPERIMENTAL_SCHOOL_IDS: [] as string[],
    RAW_RECORDER_LIVEKIT_URL: undefined as string | undefined,
    RAW_RENDER_REPLAY_ORIGIN: undefined as string | undefined,
    RAW_RECORDING_MAX_DURATION_SEC: 4 * 3600,
    RAW_RECORDING_SOURCE_RETENTION_HOURS: 168,
  },
}));

const { rawRepoMock, repoMock, egressMock, lessonsMock, roomsMock, storageMock, journalMock, settingsMock } = vi.hoisted(() => ({
  rawRepoMock: {
    findLessonMode: vi.fn(),
    upsertLessonMode: vi.fn(),
    deleteLessonMode: vi.fn(),
    insertRawRecording: vi.fn(),
    findRawRecording: vi.fn(),
    findActiveRawRecordingForLesson: vi.fn(),
    listRawRecordingsForLesson: vi.fn(),
    listActiveRawRecordings: vi.fn(),
    updateRawRecordingIf: vi.fn(),
    claimRecordJob: vi.fn(),
    touchRecorderLease: vi.fn(),
    finishRecorderLease: vi.fn(),
    expireRecorderLeases: vi.fn(),
    settleStoppedUnclaimed: vi.fn(),
    claimRenderJob: vi.fn(),
    touchRenderLease: vi.fn(),
    findByRenderLease: vi.fn(),
    completeRenderLease: vi.fn(),
    expireRenderLeases: vi.fn(),
    countJournalEvents: vi.fn(),
    listRawRecordingsForSchool: vi.fn(),
    countRawRecordingsForSchool: vi.fn(),
    sumReadyRawSizeForSchool: vi.fn(),
    markRawDeleted: vi.fn(),
    clearRawExpiry: vi.fn(),
    listJournalPage: vi.fn(),
  },
  repoMock: {
    insertRecording: vi.fn(),
    findRecordingById: vi.fn(),
    findRecordingByEgressId: vi.fn(),
    listRecordingsForLesson: vi.fn(),
    findActiveRecordingForLesson: vi.fn(),
    updateRecording: vi.fn(),
    lessonHasActiveRecording: vi.fn(),
    listRecordingsForSchool: vi.fn(),
    sumRecordingsSizeForSchool: vi.fn(),
  },
  egressMock: {
    startRoomRecording: vi.fn(),
    stopRecording: vi.fn(),
    findActiveEgressByFilepath: vi.fn(),
    mapEgressStatus: vi.fn(),
  },
  lessonsMock: {
    getLesson: vi.fn(),
    ensureLivekitRoom: vi.fn(),
    getLessonTitles: vi.fn().mockResolvedValue(new Map([["22222222-2222-2222-2222-222222222222", { title: "Тест", teacherId: "33333333-3333-3333-3333-333333333333" }]])),
  },
  roomsMock: { broadcastToLesson: vi.fn(), countConnectedParticipants: vi.fn() },
  storageMock: {
    getSignedFileUrl: vi.fn((key: string) => `/files/${key}?sig`),
    deleteFile: vi.fn(),
    deleteTree: vi.fn(),
    statFile: vi.fn(),
  },
  journalMock: {
    openJournalForRecording: vi.fn().mockResolvedValue(undefined),
    closeJournalForRecording: vi.fn().mockResolvedValue(undefined),
    journalLivekitEvent: vi.fn(),
    startJournal: vi.fn(),
    stopJournal: vi.fn(),
  },
  settingsMock: {
    getSchoolSettings: vi.fn().mockResolvedValue({
      recordingEnabled: true,
      recordingResolution: "720p",
      recordingFps: 24,
      recordingBitrateKbps: 3000,
    }),
  },
}));

vi.mock("../../plugins/env.js", () => envMock);
vi.mock("./raw-repo.js", () => rawRepoMock);
vi.mock("./repo.js", () => repoMock);
vi.mock("./egress-client.js", () => egressMock);
vi.mock("./journal.js", () => journalMock);
vi.mock("./poster.js", () => ({
  posterKeyFor: (k: string) => k.replace(/\.mp4$/, ".jpg"),
  posterExists: vi.fn().mockResolvedValue(false),
  enqueuePoster: vi.fn().mockResolvedValue(true),
  removePoster: vi.fn(),
}));
vi.mock("../lessons/service.js", () => lessonsMock);
vi.mock("../billing/service.js", () => ({
  // Э15.6: лимиты тарифа — в этих тестах школе всё разрешено.
  planLimits: vi.fn().mockResolvedValue({ plan: "school", limits: { rooms: 99, teachers: 99, methodists: null, studentsPerLesson: 1000, recordingHoursPerMonth: null, matisLibrary: true } }),
  assertRoleSeat: vi.fn().mockResolvedValue(undefined),
  assertRecordingAllowed: vi.fn().mockResolvedValue(undefined),
  upgradeHint: () => "",
  onPaid: vi.fn(),
}));
vi.mock("../rooms/service.js", () => roomsMock);
vi.mock("../storage/service.js", () => storageMock);
vi.mock("../school-settings/service.js", () => settingsMock);
vi.mock("../users/service.js", () => ({
  getUserNames: vi.fn().mockResolvedValue(new Map([["33333333-3333-3333-3333-333333333333", { fullName: "Учитель" }]])),
}));

const service = await import("./service.js");
const raw = await import("./raw-service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const OTHER_SCHOOL = "99999999-9999-9999-9999-999999999999";
const LESSON = "22222222-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";
const RAW_ID = "55555555-5555-5555-5555-555555555555";
const LEASE = "66666666-6666-6666-6666-666666666666";
const SECRET = "raw-recorder-secret-at-least-32-characters!";

const teacher = { sub: TEACHER, schoolId: SCHOOL, role: "teacher" as const };
const admin = { sub: TEACHER, schoolId: SCHOOL, role: "admin" as const };

function egressRow(over: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-7777-7777-777777777777",
    schoolId: SCHOOL,
    lessonId: LESSON,
    startedBy: TEACHER,
    egressId: "EG_1",
    status: "starting",
    storageKey: `recordings/${SCHOOL}/${LESSON}/x.mp4`,
    durationSec: null,
    sizeBytes: null,
    startedAt: new Date("2026-10-12T10:00:00Z"),
    endedAt: null,
    expiresAt: null,
    ...over,
  };
}

function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: RAW_ID,
    schoolId: SCHOOL,
    lessonId: LESSON,
    startedBy: TEACHER,
    livekitRoom: `lesson-${LESSON}`,
    status: "requested",
    attempt: 0,
    recorderLeaseId: null,
    recorderWorker: null,
    recorderHeartbeatAt: null,
    recorderStats: null,
    stopRequestedAt: null,
    renderAttempts: 0,
    renderLeaseId: null,
    renderWorker: null,
    renderHeartbeatAt: null,
    renderStep: null,
    renderMetrics: null,
    recordingDir: `raw-recordings/${SCHOOL}/${LESSON}/${RAW_ID}`,
    outputKey: `recordings/${SCHOOL}/${LESSON}/${RAW_ID}.mp4`,
    compareRecordingId: null,
    lastError: null,
    durationSec: null,
    sizeBytes: null,
    startedAt: new Date("2026-10-12T10:00:00Z"),
    stoppedAt: null,
    endedAt: null,
    rawExpiresAt: null,
    expiresAt: null,
    ...over,
  };
}

function enableExperimental(schools: string[] = [SCHOOL]) {
  envMock.env.RAW_RECORDER_SECRET = SECRET;
  envMock.env.RECORDING_EXPERIMENTAL_SCHOOL_IDS = schools;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.env.RAW_RECORDER_SECRET = undefined;
  envMock.env.RECORDING_EXPERIMENTAL_SCHOOL_IDS = [];
  lessonsMock.getLesson.mockResolvedValue({ id: LESSON, schoolId: SCHOOL, teacherId: TEACHER });
  lessonsMock.ensureLivekitRoom.mockResolvedValue(`lesson-${LESSON}`);
  repoMock.findActiveRecordingForLesson.mockResolvedValue(null);
  repoMock.insertRecording.mockImplementation(async (input: Record<string, unknown>) => egressRow(input));
  egressMock.startRoomRecording.mockResolvedValue({ egressId: "EG_1", status: "starting" });
  rawRepoMock.findActiveRawRecordingForLesson.mockResolvedValue(null);
  rawRepoMock.insertRawRecording.mockImplementation(async (input: Record<string, unknown>) => rawRow(input));
});

describe("выбор метода записи — по умолчанию только Egress", () => {
  it("без секрета метод выключен: режим урока даже не читается", async () => {
    envMock.env.RECORDING_EXPERIMENTAL_SCHOOL_IDS = [SCHOOL];
    expect(await raw.resolveRecordingMode(SCHOOL, LESSON)).toBe("egress");
    expect(rawRepoMock.findLessonMode).not.toHaveBeenCalled();
  });

  it("школы нет в списке допуска — egress, хотя строка урока есть", async () => {
    enableExperimental([OTHER_SCHOOL]);
    rawRepoMock.findLessonMode.mockResolvedValue("experimental");
    expect(await raw.resolveRecordingMode(SCHOOL, LESSON)).toBe("egress");
  });

  it("школа допущена, но урок не отмечен — egress", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue(null);
    expect(await raw.resolveRecordingMode(SCHOOL, LESSON)).toBe("egress");
  });

  it("ошибка чтения режима — egress (урок не остаётся без записи)", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockRejectedValue(new Error("db down"));
    expect(await raw.resolveRecordingMode(SCHOOL, LESSON)).toBe("egress");
  });

  it("режим урока ставит только admin и только для допущенной школы", async () => {
    await expect(raw.setLessonRecordingMode(teacher, LESSON, "both")).rejects.toMatchObject({ statusCode: 403 });
    await expect(raw.setLessonRecordingMode(admin, LESSON, "both")).rejects.toMatchObject({
      statusCode: 403,
      code: "experimental_recording_not_allowed",
    });
    expect(rawRepoMock.upsertLessonMode).not.toHaveBeenCalled();
  });

  it("возврат к egress удаляет строку режима урока", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue(null);
    const res = await raw.setLessonRecordingMode(admin, LESSON, "egress");
    expect(rawRepoMock.deleteLessonMode).toHaveBeenCalledWith(LESSON);
    expect(res.effectiveMode).toBe("egress");
  });
});

describe("старт записи по режиму урока", () => {
  it("egress (по умолчанию): экспериментальная запись не заводится", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue(null);
    await service.startLessonRecording(teacher, LESSON);
    expect(egressMock.startRoomRecording).toHaveBeenCalledTimes(1);
    expect(rawRepoMock.insertRawRecording).not.toHaveBeenCalled();
  });

  it("both: Egress и экспериментальная, связаны compareRecordingId", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue("both");
    const res = await service.startLessonRecording(teacher, LESSON);
    expect(egressMock.startRoomRecording).toHaveBeenCalledTimes(1);
    expect(rawRepoMock.insertRawRecording).toHaveBeenCalledWith(
      expect.objectContaining({ compareRecordingId: res.id, lessonId: LESSON }),
    );
    expect(res.method).toBeUndefined(); // ответ — запись Egress, как раньше
  });

  it("both: сбой экспериментальной не ломает старт Egress", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue("both");
    rawRepoMock.insertRawRecording.mockRejectedValue(new Error("db down"));
    const res = await service.startLessonRecording(teacher, LESSON);
    expect(res.status).toBe("starting");
    expect(repoMock.insertRecording).toHaveBeenCalledTimes(1);
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, { type: "recording_status", active: true });
  });

  it("experimental: Egress не запускается, баннер согласия показывается", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue("experimental");
    const res = await service.startLessonRecording(teacher, LESSON);
    expect(egressMock.startRoomRecording).not.toHaveBeenCalled();
    expect(repoMock.insertRecording).not.toHaveBeenCalled();
    const inserted = rawRepoMock.insertRawRecording.mock.calls[0]![0] as { id: string; outputKey: string };
    expect(res).toMatchObject({ id: inserted.id, status: "starting", method: "experimental" });
    expect(inserted.outputKey).toBe(`recordings/${SCHOOL}/${LESSON}/${inserted.id}.mp4`);
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, { type: "recording_status", active: true });
    expect(journalMock.openJournalForRecording).toHaveBeenCalled();
  });

  it("двойной клик: уже идущая экспериментальная возвращается, вторая не заводится", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue("experimental");
    rawRepoMock.findActiveRawRecordingForLesson.mockResolvedValue(rawRow({ status: "recording" }));
    const res = await service.startLessonRecording(teacher, LESSON);
    expect(rawRepoMock.insertRawRecording).not.toHaveBeenCalled();
    expect(res.status).toBe("recording");
  });
});

describe("кнопка «Тестовая запись» (test: true)", () => {
  it("только экспериментальная запись, Egress не запускается, даже если урок в режиме egress", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue(null);
    const res = await service.startLessonRecording(teacher, LESSON, { test: true });
    expect(egressMock.startRoomRecording).not.toHaveBeenCalled();
    expect(repoMock.insertRecording).not.toHaveBeenCalled();
    expect(res.method).toBe("experimental");
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, { type: "recording_status", active: true });
  });

  it("RECORDING_EXPERIMENTAL_SCHOOL_IDS=all — кнопка доступна любой школе", async () => {
    enableExperimental(["all"]);
    expect(raw.isSchoolAllowedForExperimental(OTHER_SCHOOL)).toBe(true);
    const res = await service.startLessonRecording(teacher, LESSON, { test: true });
    expect(res.method).toBe("experimental");
  });

  it("школа не допущена — 403, никакой записи не начинается", async () => {
    enableExperimental([OTHER_SCHOOL]);
    await expect(service.startLessonRecording(teacher, LESSON, { test: true })).rejects.toMatchObject({
      statusCode: 403,
      code: "experimental_recording_not_allowed",
    });
    expect(egressMock.startRoomRecording).not.toHaveBeenCalled();
    expect(rawRepoMock.insertRawRecording).not.toHaveBeenCalled();
  });

  it("метод выключен на сервере — 403", async () => {
    await expect(service.startLessonRecording(teacher, LESSON, { test: true })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("обычная кнопка в режиме урока egress — только Egress", async () => {
    enableExperimental();
    rawRepoMock.findLessonMode.mockResolvedValue(null);
    await service.startLessonRecording(teacher, LESSON);
    expect(egressMock.startRoomRecording).toHaveBeenCalledTimes(1);
    expect(rawRepoMock.insertRawRecording).not.toHaveBeenCalled();
  });

  it("список записей сообщает, доступна ли кнопка", async () => {
    repoMock.listRecordingsForLesson.mockResolvedValue([]);
    rawRepoMock.listRawRecordingsForLesson.mockResolvedValue([]);
    expect((await service.getLessonRecordings(teacher, LESSON)).experimentalAvailable).toBeUndefined();
    enableExperimental();
    expect((await service.getLessonRecordings(teacher, LESSON)).experimentalAvailable).toBe(true);
    enableExperimental([OTHER_SCHOOL]);
    expect((await service.getLessonRecordings(teacher, LESSON)).experimentalAvailable).toBe(false);
  });
});

describe("стоп и статусы — раздельно по методам", () => {
  it("стоп Egress в режиме both останавливает и экспериментальную", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(egressRow({ status: "recording" }));
    egressMock.stopRecording.mockResolvedValue("processing");
    repoMock.updateRecording.mockResolvedValue(egressRow({ status: "processing" }));
    rawRepoMock.findActiveRawRecordingForLesson.mockResolvedValue(rawRow({ status: "recording" }));
    rawRepoMock.updateRawRecordingIf.mockResolvedValue(rawRow({ status: "finalizing" }));
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow({ status: "finalizing" }));
    const res = await service.stopLessonRecording(teacher, LESSON, egressRow().id);
    expect(res.status).toBe("processing");
    expect(rawRepoMock.updateRawRecordingIf).toHaveBeenCalledWith(
      RAW_ID,
      ["recording"],
      expect.objectContaining({ status: "finalizing" }),
    );
  });

  it("сбой стопа экспериментальной не ломает стоп Egress", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(egressRow({ status: "recording" }));
    egressMock.stopRecording.mockResolvedValue("processing");
    repoMock.updateRecording.mockResolvedValue(egressRow({ status: "processing" }));
    rawRepoMock.findActiveRawRecordingForLesson.mockRejectedValue(new Error("db down"));
    const res = await service.stopLessonRecording(teacher, LESSON, egressRow().id);
    expect(res.status).toBe("processing");
  });

  it("стоп по id экспериментальной записи (режим experimental)", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(null);
    rawRepoMock.findRawRecording
      .mockResolvedValueOnce(rawRow({ status: "recording" }))
      .mockResolvedValueOnce(rawRow({ status: "finalizing" }));
    rawRepoMock.updateRawRecordingIf.mockResolvedValue(rawRow({ status: "finalizing" }));
    const res = await service.stopLessonRecording(teacher, LESSON, RAW_ID);
    expect(res).toMatchObject({ status: "processing", method: "experimental" });
    expect(egressMock.stopRecording).not.toHaveBeenCalled();
    expect(roomsMock.broadcastToLesson).toHaveBeenCalledWith(LESSON, { type: "recording_status", active: false });
  });

  it("метод выключен — id экспериментальной записи не ищется (404, как раньше)", async () => {
    repoMock.findRecordingById.mockResolvedValue(null);
    await expect(service.stopLessonRecording(teacher, LESSON, RAW_ID)).rejects.toMatchObject({ statusCode: 404 });
    expect(rawRepoMock.findRawRecording).not.toHaveBeenCalled();
  });

  it("баннер согласия: идущая экспериментальная запись = запись идёт", async () => {
    enableExperimental();
    repoMock.lessonHasActiveRecording.mockResolvedValue(false);
    rawRepoMock.findActiveRawRecordingForLesson.mockResolvedValue(rawRow({ status: "recording" }));
    expect(await service.isLessonRecordingActive(LESSON)).toBe(true);
  });

  it("метод выключен — проверка баннера идёт только по Egress", async () => {
    repoMock.lessonHasActiveRecording.mockResolvedValue(false);
    expect(await service.isLessonRecordingActive(LESSON)).toBe(false);
    expect(rawRepoMock.findActiveRawRecordingForLesson).not.toHaveBeenCalled();
  });

  it("список записей урока: обе, у экспериментальной свой method, ссылка только у ready", async () => {
    enableExperimental();
    repoMock.listRecordingsForLesson.mockResolvedValue([egressRow({ status: "ready" })]);
    rawRepoMock.listRawRecordingsForLesson.mockResolvedValue([
      rawRow({ status: "rendering", startedAt: new Date("2026-10-12T10:00:01Z") }),
    ]);
    const res = await service.getLessonRecordings(teacher, LESSON);
    expect(res.recordings).toHaveLength(2);
    const exp = res.recordings.find((r) => r.method === "experimental")!;
    expect(exp.status).toBe("processing");
    expect(exp.url).toBeNull();
  });

  it("проекция статусов не смешивает шкалы", () => {
    expect(raw.projectRawStatus("requested")).toBe("starting");
    expect(raw.projectRawStatus("finalizing")).toBe("processing");
    expect(raw.projectRawStatus("verifying")).toBe("processing");
    expect(raw.projectRawStatus("ready")).toBe("ready");
  });
});

describe("внутренний API: секрет и лизы", () => {
  it("без секрета на сервере внутренний API закрыт для любого заголовка", () => {
    expect(raw.verifyInternalSecret(`Bearer ${SECRET}`)).toBe(false);
  });

  it("секрет сверяется точно", () => {
    enableExperimental();
    expect(raw.verifyInternalSecret(`Bearer ${SECRET}`)).toBe(true);
    expect(raw.verifyInternalSecret(`Bearer ${SECRET}x`)).toBe(false);
    expect(raw.verifyInternalSecret(undefined)).toBe(false);
  });

  it("задание рекордера: скрытый участник без права публикации, каталог попытки", async () => {
    enableExperimental();
    rawRepoMock.claimRecordJob.mockResolvedValue(rawRow({ status: "recording", attempt: 2 }));
    const job = (await raw.claimRecordJob("rec-host-1"))!;
    expect(job.attemptDir).toBe(`raw-recordings/${SCHOOL}/${LESSON}/${RAW_ID}/attempt-2`);
    const grant = JSON.parse(Buffer.from(job.livekitToken.split(".")[1]!, "base64url").toString()) as {
      sub: string;
      video: Record<string, unknown>;
    };
    expect(grant.sub).toBe(`RR_55555555_2`);
    expect(grant.video).toMatchObject({ hidden: true, recorder: true, canPublish: false, canSubscribe: true });
  });

  it("heartbeat по чужой лизе — 409, рекордер должен остановиться", async () => {
    rawRepoMock.touchRecorderLease.mockResolvedValue(null);
    await expect(
      raw.recorderHeartbeat(RAW_ID, LEASE, { tracks: 0, packets: 0, bytes: 0, lostPackets: 0, keyframeRequests: 0 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("heartbeat после стопа отвечает stop: true", async () => {
    rawRepoMock.touchRecorderLease.mockResolvedValue(rawRow({ status: "finalizing", stopRequestedAt: new Date() }));
    const res = await raw.recorderHeartbeat(RAW_ID, LEASE, {
      tracks: 3,
      packets: 10,
      bytes: 100,
      lostPackets: 0,
      keyframeRequests: 1,
    });
    expect(res.stop).toBe(true);
  });
});

describe("публикация MP4 — ready только после проверки файла", () => {
  beforeEach(() => {
    rawRepoMock.findByRenderLease.mockResolvedValue(rawRow({ status: "verifying", renderAttempts: 1 }));
    rawRepoMock.completeRenderLease.mockResolvedValue(rawRow({ status: "ready" }));
  });

  it("файл на месте и размер совпал — ready, ретеншн исходников после ready", async () => {
    storageMock.statFile.mockResolvedValue({ sizeBytes: 1234 });
    await raw.renderFinished(RAW_ID, LEASE, { durationSec: 61.5, sizeBytes: 1234, metrics: { renderSec: 10 } });
    const patch = rawRepoMock.completeRenderLease.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.status).toBe("ready");
    expect(patch.rawExpiresAt).toBeInstanceOf(Date);
    expect(patch.expiresAt).toBeInstanceOf(Date);
  });

  it("файла нет — не ready, задание снова в очередь", async () => {
    storageMock.statFile.mockResolvedValue(null);
    await raw.renderFinished(RAW_ID, LEASE, { durationSec: 61.5, sizeBytes: 1234, metrics: {} });
    const patch = rawRepoMock.completeRenderLease.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.status).toBe("queued_for_render");
    expect(String(patch.lastError)).toContain("file missing");
  });

  it("размер не совпал (недописанный файл) — не ready", async () => {
    storageMock.statFile.mockResolvedValue({ sizeBytes: 999 });
    await raw.renderFinished(RAW_ID, LEASE, { durationSec: 61.5, sizeBytes: 1234, metrics: {} });
    const patch = rawRepoMock.completeRenderLease.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.status).toBe("queued_for_render");
  });

  it("неповторяемая ошибка — сразу failed, исходники хранятся 14 дней", async () => {
    await raw.renderFailed(RAW_ID, LEASE, { error: "no media tracks", retryable: false });
    const patch = rawRepoMock.completeRenderLease.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.status).toBe("failed");
    const keepMs = (patch.rawExpiresAt as Date).getTime() - Date.now();
    expect(keepMs).toBeGreaterThan(13 * 24 * 3600_000);
  });

  it("исчерпаны попытки — failed даже для повторяемой ошибки", async () => {
    rawRepoMock.findByRenderLease.mockResolvedValue(rawRow({ status: "rendering", renderAttempts: raw.MAX_RENDER_ATTEMPTS }));
    await raw.renderFailed(RAW_ID, LEASE, { error: "ffmpeg crashed", retryable: true });
    const patch = rawRepoMock.completeRenderLease.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.status).toBe("failed");
  });

  it("отчёт по чужой лизе ничего не меняет", async () => {
    rawRepoMock.findByRenderLease.mockResolvedValue(null);
    await expect(raw.renderFinished(RAW_ID, LEASE, { durationSec: 1, sizeBytes: 1, metrics: {} })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(rawRepoMock.completeRenderLease).not.toHaveBeenCalled();
  });
});

describe("страница кадров: доступ только токеном этой записи", () => {
  it("токен другой записи — 404", async () => {
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow());
    await expect(
      raw.getReplayData({ typ: "recorder", lessonId: LESSON, recordingId: "88888888-8888-8888-8888-888888888888" }, RAW_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("свой токен — журнал постранично целиком", async () => {
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow({ stoppedAt: new Date("2026-10-12T10:30:00Z") }));
    rawRepoMock.listJournalPage.mockResolvedValueOnce([
      { recordingId: RAW_ID, seq: 1, tsMs: 1, kind: "journal_started", payload: {}, data: null },
      { recordingId: RAW_ID, seq: 2, tsMs: 2, kind: "yjs_update", payload: null, data: Buffer.from([1, 2]) },
    ]);
    const data = await raw.getReplayData({ typ: "recorder", lessonId: LESSON, recordingId: RAW_ID }, RAW_ID);
    expect(data.events).toHaveLength(2);
    expect(data.events[1]!.data).toBe(Buffer.from([1, 2]).toString("base64"));
    expect(data.t1Ms - data.t0Ms).toBe(30 * 60_000);
  });
});

describe("страница администратора «Записи» — экспериментальные тоже", () => {
  it("список: обе таблицы по времени начала, пагинация и общий счёт", async () => {
    enableExperimental();
    repoMock.listRecordingsForSchool.mockResolvedValue({
      rows: [egressRow({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "aborted", startedAt: new Date("2026-10-12T12:48:00Z") })],
      total: 1,
    });
    rawRepoMock.listRawRecordingsForSchool.mockResolvedValue([rawRow({ status: "ready", startedAt: new Date("2026-10-12T13:35:00Z") })]);
    rawRepoMock.countRawRecordingsForSchool.mockResolvedValue(1);
    const res = await service.listAllRecordings(admin, { page: 1, pageSize: 20 });
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.method ?? "egress")).toEqual(["experimental", "egress"]);
    expect(res.items[0]).toMatchObject({ lessonTitle: "Тест", teacherName: "Учитель", status: "ready" });
    expect(res.items[0]!.url).toContain(RAW_ID);
  });

  it("метод выключен — список как раньше, только Egress", async () => {
    repoMock.listRecordingsForSchool.mockResolvedValue({ rows: [egressRow({ status: "ready" })], total: 1 });
    const res = await service.listAllRecordings(admin, { page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(rawRepoMock.listRawRecordingsForSchool).not.toHaveBeenCalled();
  });

  it("удаление экспериментальной: ролик, обложка и исходные дорожки", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(null);
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow({ status: "ready" }));
    await service.adminDeleteRecording(admin, RAW_ID);
    expect(storageMock.deleteFile).toHaveBeenCalledWith(`recordings/${SCHOOL}/${LESSON}/${RAW_ID}.mp4`);
    expect(storageMock.deleteTree).toHaveBeenCalledWith(`raw-recordings/${SCHOOL}/${LESSON}/${RAW_ID}`);
    expect(rawRepoMock.markRawDeleted).toHaveBeenCalledWith(RAW_ID);
  });

  it("идущую или собираемую экспериментальную удалить нельзя", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(null);
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow({ status: "rendering" }));
    await expect(service.adminDeleteRecording(admin, RAW_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(storageMock.deleteTree).not.toHaveBeenCalled();
  });

  it("чужая школа — 404", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(null);
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow({ schoolId: OTHER_SCHOOL, status: "ready" }));
    await expect(service.getRecordingDetail(admin, RAW_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("внешняя ссылка на готовую экспериментальную", async () => {
    enableExperimental();
    repoMock.findRecordingById.mockResolvedValue(null);
    rawRepoMock.findRawRecording.mockResolvedValue(rawRow({ status: "ready" }));
    const link = await service.createExternalDownloadLink(admin, RAW_ID);
    expect(link.url).toContain(`${RAW_ID}.mp4`);
  });
});
