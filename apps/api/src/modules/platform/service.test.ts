import { beforeEach, describe, expect, it, vi } from "vitest";

const { usersMock, envMock } = vi.hoisted(() => ({
  usersMock: { getUserForAuth: vi.fn(), emailsByIds: vi.fn() },
  envMock: { env: { SUPER_ADMIN_EMAILS: ["admin@school.dev"] } },
}));
vi.mock("../users/service.js", () => usersMock);
vi.mock("../billing/service.js", () => ({}));
vi.mock("../auth/service.js", () => ({}));
vi.mock("../school-settings/service.js", () => ({}));
vi.mock("../../plugins/blocklist.js", () => ({ invalidateBlocklist: vi.fn() }));
vi.mock("../../plugins/env.js", () => envMock);

const { isSuperAdmin, requireSuperAdmin } = await import("./service.js");
const token = { sub: "11111111-1111-4111-8111-111111111111", schoolId: "22222222-2222-4222-8222-222222222222", role: "admin" as const };

beforeEach(() => vi.clearAllMocks());

describe("супер-админ", () => {
  it("адрес из SUPER_ADMIN_EMAILS (без учёта регистра) — доступ есть", async () => {
    usersMock.emailsByIds.mockResolvedValue(new Map([[token.sub, "Admin@School.dev"]]));
    expect(await isSuperAdmin(token)).toBe(true);
  });

  it("обычный администратор школы — 403", async () => {
    usersMock.emailsByIds.mockResolvedValue(new Map([[token.sub, "owner@school.ru"]]));
    await expect(requireSuperAdmin(token)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("гость с правами учителя — без доступа (заблокированный аккаунт отсекает authenticate)", async () => {
    usersMock.emailsByIds.mockResolvedValue(new Map([[token.sub, "admin@school.dev"]]));
    expect(await isSuperAdmin({ ...token, lessonScope: "33333333-3333-4333-8333-333333333333" })).toBe(false);
  });
});
