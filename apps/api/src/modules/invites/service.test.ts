import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    insertInvite: vi.fn(),
    findSchoolSlug: vi.fn(),
    listInvitesBySchool: vi.fn(),
    revokeInvite: vi.fn(),
    findInviteWithSchoolByCodeHash: vi.fn(),
  },
}));

vi.mock("./repo.js", () => repoMock);

const { createInvite, listInvites, revokeInvite, getInvitePublicInfo } = await import("./service.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";

const adminUser = { sub: ADMIN_ID, schoolId: SCHOOL_ID, role: "admin" as const };
const teacherUser = { sub: ADMIN_ID, schoolId: SCHOOL_ID, role: "teacher" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createInvite", () => {
  it("не-admin получает 403, инвайт не создаётся", async () => {
    await expect(createInvite(teacherUser, { role: "teacher" })).rejects.toMatchObject({ statusCode: 403 });
    expect(repoMock.insertInvite).not.toHaveBeenCalled();
  });

  it("admin создаёт инвайт в СВОЮ школу, ссылка строится из slug", async () => {
    repoMock.insertInvite.mockResolvedValue({
      id: "invite-1",
      role: "teacher",
      maxUses: null,
      useCount: 0,
      expiresAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    repoMock.findSchoolSlug.mockResolvedValue("shkola10");

    const result = await createInvite(adminUser, { role: "teacher" });

    expect(repoMock.insertInvite).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL_ID, createdBy: ADMIN_ID, role: "teacher" }),
    );
    expect(result.code).toBeTruthy();
    expect(result.url).toContain(`/s/shkola10/invite/${result.code}`);
  });
});

describe("listInvites / revokeInvite", () => {
  it("не-admin получает 403 на список и на отзыв", async () => {
    await expect(listInvites(teacherUser)).rejects.toMatchObject({ statusCode: 403 });
    await expect(revokeInvite(teacherUser, "invite-1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("отзыв несуществующего/чужого инвайта → 404", async () => {
    repoMock.revokeInvite.mockResolvedValue(null);
    await expect(revokeInvite(adminUser, "missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("список маппит строки без сырого кода в поле ответа", async () => {
    repoMock.listInvitesBySchool.mockResolvedValue([
      {
        id: "invite-1",
        role: "teacher",
        maxUses: 5,
        useCount: 1,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const rows = await listInvites(adminUser);
    expect(rows).toEqual([
      {
        id: "invite-1",
        role: "teacher",
        maxUses: 5,
        useCount: 1,
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(rows[0]).not.toHaveProperty("code");
    expect(rows[0]).not.toHaveProperty("codeHash");
  });
});

describe("getInvitePublicInfo", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      role: "teacher" as const,
      maxUses: null,
      useCount: 0,
      expiresAt: null,
      revokedAt: null,
      schoolName: "Школа 10",
      schoolSlug: "shkola10",
      ...overrides,
    };
  }

  it("несуществующий код → 404", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(null);
    await expect(getInvitePublicInfo("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("действующий инвайт → valid: true", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(row());
    const info = await getInvitePublicInfo("code");
    expect(info).toEqual({ schoolName: "Школа 10", schoolSlug: "shkola10", role: "teacher", valid: true });
  });

  it("отозванный инвайт → valid: false, но данные школы видны", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(row({ revokedAt: new Date() }));
    const info = await getInvitePublicInfo("code");
    expect(info.valid).toBe(false);
  });

  it("просроченный инвайт → valid: false", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    const info = await getInvitePublicInfo("code");
    expect(info.valid).toBe(false);
  });

  it("исчерпанный лимит использований → valid: false", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(row({ maxUses: 2, useCount: 2 }));
    const info = await getInvitePublicInfo("code");
    expect(info.valid).toBe(false);
  });
});
