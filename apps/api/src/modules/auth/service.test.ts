import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, argonMock, redisMock, mailMock } = vi.hoisted(() => ({
  redisMock: {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  },
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

const { login, refresh, requestPasswordReset, resetPassword, changePassword, issueSessionForUser } = await import(
  "./service.js"
);

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
  redisMock.get.mockResolvedValue(null);
  redisMock.incr.mockResolvedValue(1);
  redisMock.del.mockResolvedValue(1);
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

describe("login — лимит неудач на аккаунт", () => {
  it("неверный пароль засчитывается в счётчик email", async () => {
    repoMock.findUserByEmail.mockResolvedValue(USER);
    argonMock.verify.mockResolvedValue(false);
    await expect(login(USER.email, "wrong")).rejects.toMatchObject({ statusCode: 401 });
    expect(redisMock.incr).toHaveBeenCalledWith(`login:fail:${USER.email}`);
  });

  it("10 неудач — 429 без проверки пароля (argon2 не вызывается)", async () => {
    redisMock.get.mockResolvedValue("10");
    await expect(login(USER.email, "password123")).rejects.toMatchObject({
      statusCode: 429,
      code: "too_many_login_attempts",
    });
    expect(argonMock.verify).not.toHaveBeenCalled();
  });

  it("успешный вход сбрасывает счётчик", async () => {
    repoMock.findUserByEmail.mockResolvedValue(USER);
    argonMock.verify.mockResolvedValue(true);
    await login(USER.email, "password123");
    expect(redisMock.del).toHaveBeenCalledWith(`login:fail:${USER.email}`);
  });
});

describe("issueSessionForUser", () => {
  it("отключённому аккаунту сессия не выдаётся (в т.ч. по ссылке подтверждения почты)", async () => {
    await expect(issueSessionForUser({ ...USER, isActive: false })).rejects.toMatchObject({ statusCode: 401 });
    expect(repoMock.insertRefreshToken).not.toHaveBeenCalled();
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
    repoMock.findRefreshTokenByHash
      .mockResolvedValueOnce(record({ revokedAt: new Date(Date.now() - 2_000), replacedByHash: "next" }))
      .mockResolvedValueOnce(record({ tokenHash: "next" }));
    const result = await refresh("tok");
    expect(result.accessToken).toEqual(expect.any(String));
    expect(repoMock.revokeFamily).not.toHaveBeenCalled();
    expect(repoMock.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("только что ротированный, но цепочку потом отозвали (сброс пароля) — отказ", async () => {
    repoMock.findRefreshTokenByHash
      .mockResolvedValueOnce(record({ revokedAt: new Date(Date.now() - 2_000), replacedByHash: "next" }))
      .mockResolvedValueOnce(record({ tokenHash: "next", revokedAt: new Date(), replacedByHash: null }));
    await expect(refresh("tok")).rejects.toMatchObject({ code: "refresh_token_reused" });
    expect(repoMock.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("давно использованный токен — отзыв всей цепочки (признак кражи)", async () => {
    repoMock.findRefreshTokenByHash.mockResolvedValue(
      record({ revokedAt: new Date(Date.now() - 10 * 60_000), replacedByHash: "next" }),
    );
    await expect(refresh("tok")).rejects.toMatchObject({ code: "refresh_token_reused" });
    expect(repoMock.revokeFamily).toHaveBeenCalledWith(FAMILY);
  });

  // Ротация прошла, ответ потерялся в сети: возвращаем запись о преемнике из
  // первой ротации, как её положил бы сервер.
  async function rotateAndCapture(token: string) {
    repoMock.findRefreshTokenByHash.mockResolvedValueOnce(record());
    const first = await refresh(token);
    const [key, value] = redisMock.set.mock.calls.at(-1)!;
    const successorHash = repoMock.rotateRefreshToken.mock.calls.at(-1)![0].newTokenHash as string;
    vi.clearAllMocks();
    repoMock.findUserById.mockResolvedValue(USER);
    redisMock.get.mockImplementation(async (k: string) => (k === key ? value : null));
    return { first, successorHash, value: value as string };
  }

  it("ответ на refresh потерялся, повтор через 73 с — тот же преемник, цепочка цела", async () => {
    const { first, successorHash } = await rotateAndCapture("tok");
    repoMock.findRefreshTokenByHash
      .mockResolvedValueOnce(record({ revokedAt: new Date(Date.now() - 73_000), replacedByHash: successorHash }))
      .mockResolvedValueOnce(record({ tokenHash: successorHash, expiresAt: first.refreshExpiresAt }));
    const replay = await refresh("tok");
    expect(replay.refreshToken).toBe(first.refreshToken);
    expect(replay.accessToken).toEqual(expect.any(String));
    expect(repoMock.insertRefreshToken).not.toHaveBeenCalled();
    expect(repoMock.rotateRefreshToken).not.toHaveBeenCalled();
    expect(repoMock.revokeFamily).not.toHaveBeenCalled();
  });

  it("преемник уже использован — повтор старым токеном вне окна гонки отзывает цепочку", async () => {
    const { successorHash } = await rotateAndCapture("tok");
    repoMock.findRefreshTokenByHash
      .mockResolvedValueOnce(record({ revokedAt: new Date(Date.now() - 73_000), replacedByHash: successorHash }))
      .mockResolvedValueOnce(record({ tokenHash: successorHash, revokedAt: new Date(), replacedByHash: "next2" }));
    await expect(refresh("tok")).rejects.toMatchObject({ code: "refresh_token_reused" });
    expect(repoMock.revokeFamily).toHaveBeenCalledWith(FAMILY);
  });

  it("повтор позже окна в 5 минут — отзыв цепочки", async () => {
    const { successorHash } = await rotateAndCapture("tok");
    repoMock.findRefreshTokenByHash.mockResolvedValue(
      record({ revokedAt: new Date(Date.now() - 6 * 60_000), replacedByHash: successorHash }),
    );
    await expect(refresh("tok")).rejects.toMatchObject({ code: "refresh_token_reused" });
    expect(repoMock.revokeFamily).toHaveBeenCalledWith(FAMILY);
  });

  it("запись о преемнике не расшифровывается чужим токеном — отказ", async () => {
    const { successorHash, value } = await rotateAndCapture("tok");
    // Отдаём запись под любым ключом: проверяем именно шифрование, а не адресацию.
    redisMock.get.mockResolvedValue(value);
    repoMock.findRefreshTokenByHash.mockResolvedValueOnce(
      record({ revokedAt: new Date(Date.now() - 73_000), replacedByHash: successorHash }),
    );
    await expect(refresh("other-token")).rejects.toMatchObject({ code: "refresh_token_reused" });
    expect(repoMock.insertRefreshToken).not.toHaveBeenCalled();
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
