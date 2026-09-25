import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, argonMock, redisMock, mailMock } = vi.hoisted(() => ({
  redisMock: { set: vi.fn().mockResolvedValue("OK") },
  mailMock: { sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined) },
  repoMock: {
    revokeAllForUser: vi.fn(),
    updatePasswordHash: vi.fn(),
    insertPasswordResetToken: vi.fn(),
    consumePasswordReset: vi.fn(),
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    touchLastLogin: vi.fn().mockResolvedValue(undefined),
    insertRefreshToken: vi.fn().mockResolvedValue(undefined),
    findActiveRefreshToken: vi.fn(),
    findRefreshTokenByHash: vi.fn(),
    rotateRefreshToken: vi.fn(),
    revokeFamily: vi.fn(),
    deleteExpiredRefreshTokens: vi.fn(),
  },
  argonMock: { verify: vi.fn(), hash: vi.fn(), argon2id: 2 },
}));

vi.mock("./repo.js", () => repoMock);
vi.mock("argon2", () => ({ default: argonMock }));
vi.mock("../../db/redis.js", () => ({ redis: redisMock }));
vi.mock("../mail/service.js", () => mailMock);

const { login, refresh, requestPasswordReset, resetPassword, changePassword } = await import("./service.js");

const USER = {
  id: "22222222-2222-2222-2222-222222222222",
  schoolId: "11111111-1111-1111-1111-111111111111",
  email: "tutor@example.com",
  fullName: "Иван",
  role: "admin",
  isActive: true,
  passwordHash: "hash",
  emailVerifiedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.set.mockResolvedValue("OK");
});

describe("login", () => {
  it("подтверждённая почта и верный пароль — сессия", async () => {
    repoMock.findUserByEmail.mockResolvedValue(USER);
    argonMock.verify.mockResolvedValue(true);
    const session = await login(USER.email, "password123");
    expect(session.accessToken).toEqual(expect.any(String));
  });

  it("почта не подтверждена — 403 email_not_verified, сессия не выдаётся", async () => {
    repoMock.findUserByEmail.mockResolvedValue({ ...USER, emailVerifiedAt: null });
    argonMock.verify.mockResolvedValue(true);
    await expect(login(USER.email, "password123")).rejects.toMatchObject({
      statusCode: 403,
      code: "email_not_verified",
    });
    expect(repoMock.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("неверный пароль у неподтверждённого аккаунта — обычная 401, без подсказки о существовании", async () => {
    repoMock.findUserByEmail.mockResolvedValue({ ...USER, emailVerifiedAt: null });
    argonMock.verify.mockResolvedValue(false);
    await expect(login(USER.email, "wrong")).rejects.toMatchObject({ statusCode: 401, code: "invalid_credentials" });
  });
});

describe("refresh — гонка вкладок", () => {
  const FAMILY = "family-1";
  function record(overrides: Record<string, unknown> = {}) {
    return {
      userId: USER.id,
      familyId: FAMILY,
      revokedAt: null,
      replacedByHash: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    };
  }

  beforeEach(() => {
    repoMock.findUserById.mockResolvedValue(USER);
  });

  it("действующий токен — ротация и новая пара", async () => {
    repoMock.findRefreshTokenByHash.mockResolvedValue(record());
    const result = await refresh("tok");
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(repoMock.rotateRefreshToken).toHaveBeenCalledOnce();
    expect(repoMock.revokeFamily).not.toHaveBeenCalled();
  });

  it("только что ротированный токен (вторая вкладка) — новая пара, цепочка не отзывается", async () => {
    repoMock.findRefreshTokenByHash.mockResolvedValue(
      record({ revokedAt: new Date(Date.now() - 2_000), replacedByHash: "next" }),
    );
    const result = await refresh("tok");
    expect(result.accessToken).toEqual(expect.any(String));
    expect(repoMock.revokeFamily).not.toHaveBeenCalled();
    expect(repoMock.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("давно использованный токен — отзыв всей цепочки (признак кражи)", async () => {
    repoMock.findRefreshTokenByHash.mockResolvedValue(
      record({ revokedAt: new Date(Date.now() - 10 * 60_000), replacedByHash: "next" }),
    );
    await expect(refresh("tok")).rejects.toMatchObject({ code: "refresh_token_reused" });
    expect(repoMock.revokeFamily).toHaveBeenCalledWith(FAMILY);
  });

  it("токен после выхода (отозван без преемника) — отказ даже сразу", async () => {
    repoMock.findRefreshTokenByHash.mockResolvedValue(record({ revokedAt: new Date(), replacedByHash: null }));
    await expect(refresh("tok")).rejects.toMatchObject({ code: "refresh_token_reused" });
  });
});

describe("сброс и смена пароля", () => {
  it("неизвестный email — тихо, без письма (нельзя перебирать адреса)", async () => {
    repoMock.findUserByEmail.mockResolvedValue(null);
    await expect(requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();
    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("известный email — токен (только хэш) и письмо со ссылкой", async () => {
    repoMock.findUserByEmail.mockResolvedValue(USER);
    await requestPasswordReset(USER.email);
    const stored = repoMock.insertPasswordResetToken.mock.calls[0]![0] as { tokenHash: string };
    const link = mailMock.sendPasswordResetEmail.mock.calls[0]![1] as string;
    expect(link).toContain("/reset-password?token=");
    expect(link).not.toContain(stored.tokenHash);
  });

  it("повтор в течение минуты — письмо не уходит", async () => {
    redisMock.set.mockResolvedValue(null);
    repoMock.findUserByEmail.mockResolvedValue(USER);
    await requestPasswordReset(USER.email);
    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("недействительная ссылка — 400", async () => {
    argonMock.hash.mockResolvedValue("new-hash");
    repoMock.consumePasswordReset.mockResolvedValue(null);
    await expect(resetPassword("bad", "newpassword1")).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_reset_token",
    });
  });

  it("смена: неверный текущий пароль — 400, пароль не меняется", async () => {
    repoMock.findUserById.mockResolvedValue(USER);
    argonMock.verify.mockResolvedValue(false);
    await expect(changePassword(USER.id, "wrong", "newpassword1")).rejects.toMatchObject({
      code: "wrong_current_password",
    });
    expect(repoMock.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("смена: новый пароль, остальные сессии отозваны, текущей — новая", async () => {
    repoMock.findUserById.mockResolvedValue(USER);
    argonMock.verify.mockResolvedValue(true);
    argonMock.hash.mockResolvedValue("new-hash");
    const session = await changePassword(USER.id, "old", "newpassword1");
    expect(repoMock.updatePasswordHash).toHaveBeenCalledWith(USER.id, "new-hash");
    expect(repoMock.revokeAllForUser).toHaveBeenCalledWith(USER.id);
    expect(session.refreshToken).toEqual(expect.any(String));
  });
});
