import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, argonMock } = vi.hoisted(() => ({
  repoMock: {
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

const { login } = await import("./service.js");

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
