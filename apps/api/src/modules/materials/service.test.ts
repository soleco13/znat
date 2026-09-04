import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessTokenPayload } from "@school/shared";

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    listMaterials: vi.fn(),
  },
}));

vi.mock("./repo.js", () => repoMock);

const { listMaterials } = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const TEACHER: AccessTokenPayload = { sub: "22222222-2222-2222-2222-222222222222", schoolId: SCHOOL, role: "teacher" };
const ADMIN: AccessTokenPayload = { sub: "33333333-3333-3333-3333-333333333333", schoolId: SCHOOL, role: "admin" };
const METHODIST: AccessTokenPayload = {
  sub: "44444444-4444-4444-4444-444444444444",
  schoolId: SCHOOL,
  role: "methodist",
};

describe("listMaterials (Э9.1, §7.2/§4.2 ТЗ: библиотека, «личная папка» учителя)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMock.listMaterials.mockResolvedValueOnce([]);
  });

  it("учителю — ограничение «свои ЛЮБОГО статуса + чужие только опубликованные»", async () => {
    await listMaterials(TEACHER, {});
    expect(repoMock.listMaterials).toHaveBeenCalledWith(
      SCHOOL,
      expect.objectContaining({ restrictToOwnerOrPublished: TEACHER.sub }),
    );
  });

  it.each([
    ["admin", ADMIN],
    ["methodist", METHODIST],
  ] as const)("%s — без ограничения (видит всю библиотеку школы)", async (_label, user) => {
    await listMaterials(user, {});
    expect(repoMock.listMaterials).toHaveBeenCalledWith(
      SCHOOL,
      expect.objectContaining({ restrictToOwnerOrPublished: undefined }),
    );
  });

  it("прокидывает фильтры из query как есть", async () => {
    await listMaterials(ADMIN, { subject: "математика", grade: 8, topic: "Уравнения", q: "квадрат", status: "draft" });
    expect(repoMock.listMaterials).toHaveBeenCalledWith(SCHOOL, {
      subject: "математика",
      grade: 8,
      topic: "Уравнения",
      q: "квадрат",
      status: "draft",
      restrictToOwnerOrPublished: undefined,
    });
  });
});
