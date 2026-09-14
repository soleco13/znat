import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    getRawSettings: vi.fn(),
    updateRawSettings: vi.fn(),
  },
}));

vi.mock("./repo.js", () => repoMock);

const service = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const adminUser = { sub: "u1", schoolId: SCHOOL, role: "admin" } as AccessTokenPayload;
const teacherUser = { sub: "u2", schoolId: SCHOOL, role: "teacher" } as AccessTokenPayload;

beforeEach(() => {
  vi.clearAllMocks();
  repoMock.getRawSettings.mockResolvedValue({});
});

describe("getSchoolSettings (параметры школы, запрос 2026-09-14)", () => {
  it("пустой jsonb → дефолты схемы", async () => {
    const settings = await service.getSchoolSettings(SCHOOL);
    expect(settings).toMatchObject({
      guestAccessEnabled: true,
      recordingEnabled: true,
      screenShareEnabled: true,
      pipEnabled: true,
      cameraResolution: "720p",
      recordingResolution: "720p",
      recordingBitrateKbps: 1500,
    });
  });

  it("невалидная форма в БД → дефолты, не падает", async () => {
    repoMock.getRawSettings.mockResolvedValue({ guestAccessEnabled: "yes" }); // не boolean
    const settings = await service.getSchoolSettings(SCHOOL);
    expect(settings.guestAccessEnabled).toBe(true);
  });
});

describe("getSettingsForAdmin — доступ только admin", () => {
  it("не-admin — 403", async () => {
    await expect(service.getSettingsForAdmin(teacherUser)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("admin — отдаёт настройки", async () => {
    await expect(service.getSettingsForAdmin(adminUser)).resolves.toMatchObject({ guestAccessEnabled: true });
  });
});

describe("updateSettings — частичный патч мержится поверх текущих значений", () => {
  it("меняет только переданные поля, остальное не трогает", async () => {
    repoMock.getRawSettings.mockResolvedValue({ recordingEnabled: false, cameraFps: 30 });

    const next = await service.updateSettings(adminUser, { guestAccessEnabled: false });

    expect(next).toMatchObject({ guestAccessEnabled: false, recordingEnabled: false, cameraFps: 30 });
    expect(repoMock.updateRawSettings).toHaveBeenCalledWith(SCHOOL, expect.objectContaining({ guestAccessEnabled: false }));
  });

  it("не-admin — 403, ничего не пишет", async () => {
    await expect(service.updateSettings(teacherUser, { guestAccessEnabled: false })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repoMock.updateRawSettings).not.toHaveBeenCalled();
  });
});
