import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    insertInvite: vi.fn(),
    findSchoolSlug: vi.fn(),
    listInvitesBySchool: vi.fn(),
    revokeInvite: vi.fn(),
    findInviteWithSchoolByCodeHash: vi.fn(),
    claimInvite: vi.fn(),
    releaseInvite: vi.fn(),
    findInviteById: vi.fn(),
    rotateInviteCode: vi.fn(),
    markSent: vi.fn(),
    findSchoolName: vi.fn(),
  },
}));
const { mailMock, membershipsMock, usersMock } = vi.hoisted(() => ({
  mailMock: { sendInviteEmail: vi.fn() },
  membershipsMock: { getActive: vi.fn(), grantRole: vi.fn() },
  usersMock: { getUserNames: vi.fn(), emailsByIds: vi.fn() },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("../mail/service.js", () => mailMock);
vi.mock("../memberships/service.js", () => membershipsMock);
vi.mock("../users/service.js", () => usersMock);
vi.mock("../billing/service.js", () => ({
  // Э15.6: лимиты тарифа — в этих тестах школе всё разрешено.
  planLimits: vi.fn().mockResolvedValue({ plan: "school", limits: { rooms: 99, teachers: 99, methodists: null, studentsPerLesson: 1000, recordingHoursPerMonth: null, matisLibrary: true } }),
  assertRoleSeat: vi.fn().mockResolvedValue(undefined),
  assertRecordingAllowed: vi.fn().mockResolvedValue(undefined),
  upgradeHint: () => "",
  onPaid: vi.fn(),
}));

const { createInvite, listInvites, revokeInvite, getInvitePublicInfo, acceptInvite, resendInvite } = await import("./service.js");

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
        email: null,
        sentAt: null,
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
    expect(info).toEqual({ schoolName: "Школа 10", schoolSlug: "shkola10", role: "teacher", valid: true, forEmail: null });
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

describe("Э15.2 — приглашения существующему аккаунту и на почту", () => {
  const OTHER_SCHOOL = "33333333-3333-4333-8333-333333333333";
  const tutor = { sub: ADMIN_ID, schoolId: OTHER_SCHOOL, role: "teacher" as const };
  const info = (email: string | null = null) => ({
    role: "teacher",
    maxUses: 1,
    useCount: 0,
    expiresAt: null,
    revokedAt: null,
    email,
    schoolId: SCHOOL_ID,
    schoolName: "Школа 10",
    schoolSlug: "shkola10",
  });

  it("репетитор принимает приглашение: роль добавляется к членству, место занимается", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(info());
    membershipsMock.getActive.mockResolvedValue(null);
    usersMock.emailsByIds.mockResolvedValue(new Map([[ADMIN_ID, "Tutor@Mail.ru"]]));
    repoMock.claimInvite.mockResolvedValue({ id: "inv", schoolId: SCHOOL_ID, role: "teacher" });
    membershipsMock.grantRole.mockResolvedValue(["teacher"]);
    const r = await acceptInvite(tutor, "code");
    expect(repoMock.claimInvite).toHaveBeenCalledWith(expect.any(String), "tutor@mail.ru");
    expect(membershipsMock.grantRole).toHaveBeenCalledWith(ADMIN_ID, SCHOOL_ID, "teacher");
    expect(r).toEqual({ schoolId: SCHOOL_ID, roles: ["teacher"] });
  });

  it("уже участник с этой ролью — место не тратится", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(info());
    membershipsMock.getActive.mockResolvedValue({ schoolId: SCHOOL_ID, roles: ["teacher"], role: "teacher" });
    await acceptInvite(tutor, "code");
    expect(repoMock.claimInvite).not.toHaveBeenCalled();
  });

  it("приглашение на другую почту — 403, место не тратится", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(info("anna@mail.ru"));
    membershipsMock.getActive.mockResolvedValue(null);
    usersMock.emailsByIds.mockResolvedValue(new Map([[ADMIN_ID, "tutor@mail.ru"]]));
    await expect(acceptInvite(tutor, "code")).rejects.toMatchObject({ code: "invite_other_email" });
    expect(repoMock.claimInvite).not.toHaveBeenCalled();
  });

  it("членство не записалось — место возвращается", async () => {
    repoMock.findInviteWithSchoolByCodeHash.mockResolvedValue(info());
    membershipsMock.getActive.mockResolvedValue(null);
    usersMock.emailsByIds.mockResolvedValue(new Map([[ADMIN_ID, "tutor@mail.ru"]]));
    repoMock.claimInvite.mockResolvedValue({ id: "inv", schoolId: SCHOOL_ID, role: "teacher" });
    membershipsMock.grantRole.mockRejectedValue(new Error("db"));
    await expect(acceptInvite(tutor, "code")).rejects.toThrow();
    expect(repoMock.releaseInvite).toHaveBeenCalledWith("inv");
  });

  it("приглашение на почту: одноразовое, 14 дней, письмо отправлено", async () => {
    repoMock.insertInvite.mockImplementation(async (v: Record<string, unknown>) => ({
      id: "inv",
      role: "teacher",
      maxUses: v.maxUses,
      useCount: 0,
      expiresAt: v.expiresAt,
      createdAt: new Date(),
    }));
    repoMock.findSchoolSlug.mockResolvedValue("shkola10");
    repoMock.findSchoolName.mockResolvedValue("Школа 10");
    usersMock.getUserNames.mockResolvedValue(new Map([[ADMIN_ID, { fullName: "Анна Админ" }]]));
    const r = await createInvite(adminUser, { role: "teacher", email: "new@mail.ru" });
    expect(repoMock.insertInvite).toHaveBeenCalledWith(expect.objectContaining({ maxUses: 1, email: "new@mail.ru" }));
    expect(mailMock.sendInviteEmail).toHaveBeenCalledWith("new@mail.ru", expect.objectContaining({ schoolName: "Школа 10", url: r.url }));
    expect(r.emailed).toBe(true);
  });

  it("повторная отправка: новый код, принятое приглашение — 409", async () => {
    repoMock.findInviteById.mockResolvedValue({ id: "inv", role: "teacher", email: "new@mail.ru", maxUses: 1, useCount: 1, revokedAt: null, expiresAt: null, createdAt: new Date() });
    await expect(resendInvite(adminUser, "inv")).rejects.toMatchObject({ code: "invite_used" });
    repoMock.findInviteById.mockResolvedValue({ id: "inv", role: "teacher", email: "new@mail.ru", maxUses: 1, useCount: 0, revokedAt: null, expiresAt: null, createdAt: new Date() });
    repoMock.findSchoolSlug.mockResolvedValue("shkola10");
    repoMock.findSchoolName.mockResolvedValue("Школа 10");
    usersMock.getUserNames.mockResolvedValue(new Map());
    mailMock.sendInviteEmail.mockResolvedValue(undefined);
    await resendInvite(adminUser, "inv");
    expect(repoMock.rotateInviteCode).toHaveBeenCalledWith("inv", expect.any(String), expect.any(Date));
  });
});
