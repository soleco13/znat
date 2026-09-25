import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, authServiceMock, mailServiceMock, invitesServiceMock, redisMock } = vi.hoisted(() => ({
  redisMock: { set: vi.fn().mockResolvedValue("OK") },
  repoMock: {
    findUnverifiedUserByEmail: vi.fn().mockResolvedValue(null),
    deleteStaleUnverifiedUser: vi.fn().mockResolvedValue(false),
    insertVerificationToken: vi.fn().mockResolvedValue(undefined),
    listUnverifiedUsersCreatedBefore: vi.fn().mockResolvedValue([]),
    slugExists: vi.fn().mockResolvedValue(false),
    findSchoolBySlug: vi.fn(),
    registerSchoolWithAdmin: vi.fn(),
    joinSchoolViaInvite: vi.fn(),
    findEmailVerificationTokenByHash: vi.fn(),
    consumeVerificationToken: vi.fn(),
  },
  authServiceMock: {
    hashPassword: vi.fn().mockResolvedValue("hashed"),
    issueSessionForUser: vi.fn(),
  },
  mailServiceMock: {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  },
  invitesServiceMock: {
    hashInviteCode: vi.fn((code: string) => `hash(${code})`),
  },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("../../db/redis.js", () => ({ redis: redisMock }));
vi.mock("../auth/service.js", () => authServiceMock);
vi.mock("../mail/service.js", () => mailServiceMock);
vi.mock("../invites/service.js", () => invitesServiceMock);

const {
  registerIndividual,
  registerOrganization,
  confirmEmail,
  getSpacePublicInfo,
  resendVerification,
  runUnverifiedCleanupOnce,
} = await import("./service.js");

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    schoolId: SCHOOL_ID,
    email: "tutor@example.com",
    fullName: "Иван Петров",
    role: "admin",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repoMock.slugExists.mockResolvedValue(false);
  repoMock.findUnverifiedUserByEmail.mockResolvedValue(null);
  repoMock.deleteStaleUnverifiedUser.mockResolvedValue(false);
  redisMock.set.mockResolvedValue("OK");
  mailServiceMock.sendVerificationEmail.mockResolvedValue(undefined);
});

describe("занятый неподтверждённым аккаунтом email", () => {
  it("перед регистрацией пытается освободить адрес от брошенного неподтверждённого аккаунта", async () => {
    repoMock.findUnverifiedUserByEmail.mockResolvedValue(userRow({ id: "stale" }));
    repoMock.registerSchoolWithAdmin.mockResolvedValue({ school: { id: SCHOOL_ID }, user: userRow() });

    await registerIndividual({ fullName: "Иван Петров", email: "tutor@example.com", password: "password123" });

    expect(repoMock.deleteStaleUnverifiedUser).toHaveBeenCalledWith("stale", expect.any(Date));
    expect(repoMock.deleteStaleUnverifiedUser.mock.invocationCallOrder[0]).toBeLessThan(
      repoMock.registerSchoolWithAdmin.mock.invocationCallOrder[0]!,
    );
  });

  it("сбой SMTP не превращает созданный аккаунт в 500 — письмо можно запросить снова", async () => {
    repoMock.registerSchoolWithAdmin.mockResolvedValue({ school: { id: SCHOOL_ID }, user: userRow() });
    mailServiceMock.sendVerificationEmail.mockRejectedValue(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      registerIndividual({ fullName: "Иван Петров", email: "tutor@example.com", password: "password123" }),
    ).resolves.toEqual({ status: "pending_verification", email: "tutor@example.com" });
  });
});

describe("resendVerification", () => {
  it("неподтверждённый аккаунт — новый токен и письмо", async () => {
    repoMock.findUnverifiedUserByEmail.mockResolvedValue(userRow());
    await resendVerification("tutor@example.com");
    expect(repoMock.insertVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, tokenHash: expect.any(String) }),
    );
    expect(mailServiceMock.sendVerificationEmail).toHaveBeenCalledOnce();
  });

  it("нет такого аккаунта — молча ничего не делает (без перебора адресов)", async () => {
    await expect(resendVerification("nobody@example.com")).resolves.toBeUndefined();
    expect(mailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("повтор в течение минуты — письмо не уходит", async () => {
    redisMock.set.mockResolvedValue(null);
    repoMock.findUnverifiedUserByEmail.mockResolvedValue(userRow());
    await resendVerification("tutor@example.com");
    expect(repoMock.findUnverifiedUserByEmail).not.toHaveBeenCalled();
    expect(mailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("runUnverifiedCleanupOnce", () => {
  it("удаляет неподтверждённые аккаунты старше недели и считает только реально удалённые", async () => {
    repoMock.listUnverifiedUsersCreatedBefore.mockResolvedValue(["a", "b"]);
    repoMock.deleteStaleUnverifiedUser.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const now = new Date("2026-09-25T00:00:00Z");

    await expect(runUnverifiedCleanupOnce(now)).resolves.toBe(1);
    expect(repoMock.listUnverifiedUsersCreatedBefore).toHaveBeenCalledWith(
      new Date("2026-09-18T00:00:00Z"),
      expect.any(Number),
    );
  });
});

describe("registerIndividual", () => {
  it("создаёт персональную школу (kind: individual) и отправляет письмо подтверждения", async () => {
    repoMock.registerSchoolWithAdmin.mockResolvedValue({
      school: { id: SCHOOL_ID, kind: "individual" },
      user: userRow(),
    });

    const result = await registerIndividual({
      fullName: "Иван Петров",
      email: "tutor@example.com",
      password: "password123",
    });

    expect(result).toEqual({ status: "pending_verification", email: "tutor@example.com" });
    expect(repoMock.registerSchoolWithAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "individual", role: "admin", email: "tutor@example.com" }),
    );
    expect(mailServiceMock.sendVerificationEmail).toHaveBeenCalledWith(
      "tutor@example.com",
      expect.stringContaining("/verify-email?token="),
    );
  });

  it("дубликат email → 409 email_taken, письмо не отправляется", async () => {
    repoMock.registerSchoolWithAdmin.mockRejectedValue({ code: "23505" });

    await expect(
      registerIndividual({ fullName: "Иван Петров", email: "tutor@example.com", password: "password123" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "email_taken" });
    expect(mailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("registerIndividual с inviteCode (Э14.2 — присоединение к чужому пространству)", () => {
  it("валидный инвайт → пользователь создан в школе/роли инвайта, школа НЕ создаётся заново", async () => {
    repoMock.joinSchoolViaInvite.mockResolvedValue({
      user: userRow({ role: "teacher", email: "joined@example.com" }),
      invite: { schoolId: SCHOOL_ID, role: "teacher" },
    });

    const result = await registerIndividual({
      fullName: "Иван Петров",
      email: "joined@example.com",
      password: "password123",
      inviteCode: "raw-invite-code",
    });

    expect(result).toEqual({ status: "pending_verification", email: "joined@example.com" });
    expect(invitesServiceMock.hashInviteCode).toHaveBeenCalledWith("raw-invite-code");
    expect(repoMock.joinSchoolViaInvite).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCodeHash: "hash(raw-invite-code)", email: "joined@example.com" }),
    );
    expect(repoMock.registerSchoolWithAdmin).not.toHaveBeenCalled();
  });

  it("недействительный/исчерпанный инвайт (repo возвращает null) → 410 invite_invalid", async () => {
    repoMock.joinSchoolViaInvite.mockResolvedValue(null);

    await expect(
      registerIndividual({
        fullName: "Иван Петров",
        email: "joined@example.com",
        password: "password123",
        inviteCode: "bad-code",
      }),
    ).rejects.toMatchObject({ statusCode: 410, code: "invite_invalid" });
    expect(mailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("дубликат email при вступлении по инвайту → 409 email_taken", async () => {
    repoMock.joinSchoolViaInvite.mockRejectedValue({ code: "23505" });

    await expect(
      registerIndividual({
        fullName: "Иван Петров",
        email: "joined@example.com",
        password: "password123",
        inviteCode: "raw-invite-code",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "email_taken" });
  });
});

describe("registerOrganization", () => {
  it("создаёт пространство (kind: organization) с ИНН/ОГРН", async () => {
    repoMock.registerSchoolWithAdmin.mockResolvedValue({
      school: { id: SCHOOL_ID, kind: "organization" },
      user: userRow({ email: "org@example.com" }),
    });

    const result = await registerOrganization({
      fullName: "Иван Петров",
      email: "org@example.com",
      password: "password123",
      orgName: "Школа 10",
      inn: "7707083893",
      ogrn: "1027700132195",
    });

    expect(result.status).toBe("pending_verification");
    expect(repoMock.registerSchoolWithAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "organization",
        schoolName: "Школа 10",
        inn: "7707083893",
        ogrn: "1027700132195",
      }),
    );
  });
});

describe("confirmEmail", () => {
  const TOKEN = "raw-token-value";

  it("валидный токен → подтверждает почту и минтит сессию", async () => {
    repoMock.findEmailVerificationTokenByHash.mockResolvedValue({
      id: "token-1",
      userId: USER_ID,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    repoMock.consumeVerificationToken.mockResolvedValue(userRow());
    authServiceMock.issueSessionForUser.mockResolvedValue({ accessToken: "at", user: userRow() });

    const session = await confirmEmail(TOKEN);

    expect(repoMock.consumeVerificationToken).toHaveBeenCalledWith("token-1", USER_ID);
    expect(authServiceMock.issueSessionForUser).toHaveBeenCalledWith(userRow());
    expect(session).toEqual({ accessToken: "at", user: userRow() });
  });

  it("несуществующий токен → 400 invalid_token", async () => {
    repoMock.findEmailVerificationTokenByHash.mockResolvedValue(null);
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ statusCode: 400, code: "invalid_token" });
  });

  it("уже использованный токен → 400 token_already_used", async () => {
    repoMock.findEmailVerificationTokenByHash.mockResolvedValue({
      id: "token-1",
      userId: USER_ID,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ statusCode: 400, code: "token_already_used" });
  });

  it("просроченный токен → 400 token_expired", async () => {
    repoMock.findEmailVerificationTokenByHash.mockResolvedValue({
      id: "token-1",
      userId: USER_ID,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ statusCode: 400, code: "token_expired" });
  });
});

describe("getSpacePublicInfo", () => {
  it("возвращает публичную информацию о найденном пространстве", async () => {
    repoMock.findSchoolBySlug.mockResolvedValue({
      id: SCHOOL_ID,
      name: "Школа 10",
      slug: "shkola10",
      kind: "organization",
    });

    const info = await getSpacePublicInfo("shkola10");

    expect(info).toEqual({ id: SCHOOL_ID, name: "Школа 10", slug: "shkola10", kind: "organization" });
  });

  it("не найдено → 404", async () => {
    repoMock.findSchoolBySlug.mockResolvedValue(null);
    await expect(getSpacePublicInfo("missing")).rejects.toMatchObject({ statusCode: 404 });
  });
});
