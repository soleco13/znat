import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const { authServiceMock, guestsServiceMock } = vi.hoisted(() => ({
  authServiceMock: { verifyAccessToken: vi.fn() },
  guestsServiceMock: { GUEST_COOKIE_NAME: "guest_session", verifyGuestToken: vi.fn() },
}));
vi.mock("../modules/auth/service.js", () => authServiceMock);
vi.mock("../modules/guests/service.js", () => guestsServiceMock);

const { rateLimitKey, rateLimitMax, IDENTITY_RATE_LIMIT_PER_MINUTE, ANONYMOUS_RATE_LIMIT_PER_MINUTE } =
  await import("./rate-limit-key.js");

function request(opts: { authorization?: string; guestCookie?: string; ip?: string }): FastifyRequest {
  return {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    cookies: opts.guestCookie ? { guest_session: opts.guestCookie } : {},
    ip: opts.ip ?? "91.105.156.108",
  } as unknown as FastifyRequest;
}

beforeEach(() => vi.clearAllMocks());

describe("rateLimitKey", () => {
  it("два ученика за одним IP получают разные счётчики", async () => {
    guestsServiceMock.verifyGuestToken.mockImplementation(async (t: string) => ({ guestId: `g-${t}` }));

    const a = await rateLimitKey(request({ guestCookie: "a" }));
    const b = await rateLimitKey(request({ guestCookie: "b" }));

    expect(a).toBe("guest:g-a");
    expect(b).toBe("guest:g-b");
  });

  it("персонал — по sub из проверенного access-токена", async () => {
    authServiceMock.verifyAccessToken.mockResolvedValue({ sub: "teacher-1" });

    await expect(rateLimitKey(request({ authorization: "Bearer tok" }))).resolves.toBe("staff:teacher-1");
    expect(authServiceMock.verifyAccessToken).toHaveBeenCalledWith("tok");
  });

  it("поддельный токен или кука не дают нового счётчика — откат на IP", async () => {
    authServiceMock.verifyAccessToken.mockRejectedValue(new Error("bad"));
    guestsServiceMock.verifyGuestToken.mockRejectedValue(new Error("bad"));

    await expect(
      rateLimitKey(request({ authorization: "Bearer forged", guestCookie: "forged", ip: "1.2.3.4" })),
    ).resolves.toBe("ip:1.2.3.4");
  });

  it("анонимный запрос — по IP с меньшим лимитом", async () => {
    const key = await rateLimitKey(request({ ip: "1.2.3.4" }));

    expect(key).toBe("ip:1.2.3.4");
    expect(rateLimitMax(request({}), key)).toBe(ANONYMOUS_RATE_LIMIT_PER_MINUTE);
    expect(rateLimitMax(request({}), "guest:g-a")).toBe(IDENTITY_RATE_LIMIT_PER_MINUTE);
  });
});
