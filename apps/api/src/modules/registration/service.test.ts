import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, authServiceMock, mailServiceMock } = vi.hoisted(() => ({
  repoMock: {
    slugExists: vi.fn().mockResolvedValue(false),
    findSchoolBySlug: vi.fn(),
    registerSchoolWithAdmin: vi.fn(),
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
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("../auth/service.js", () => authServiceMock);
vi.mock("../mail/service.js", () => mailServiceMock);

const { registerIndividual, registerOrganization, confirmEmail, getSpacePublicInfo } = await import(
  "./service.js"
);

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

  it("inviteCode ещё не поддержан (Э14.2) — явный 501, школа не создаётся", async () => {
    await expect(
      registerIndividual({
        fullName: "Иван Петров",
        email: "tutor@example.com",
        password: "password123",
        inviteCode: "some-code",
      }),
    ).rejects.toMatchObject({ statusCode: 501 });
    expect(repoMock.registerSchoolWithAdmin).not.toHaveBeenCalled();
  });

  it("дубликат email → 409 email_taken, письмо не отправляется", async () => {
    repoMock.registerSchoolWithAdmin.mockRejectedValue({ code: "23505" });

    await expect(
      registerIndividual({ fullName: "Иван Петров", email: "tutor@example.com", password: "password123" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "email_taken" });
    expect(mailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
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
