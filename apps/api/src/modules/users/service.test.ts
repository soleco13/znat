import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    listGroupsForUser: vi.fn(),
    listGroups: vi.fn(),
  },
}));

vi.mock("./repo.js", () => repoMock);

const { listMyGroups } = await import("./service.js");

const SCHOOL = "11111111-1111-1111-1111-111111111111";
const STUDENT = "22222222-2222-2222-2222-222222222222";

describe("listMyGroups (Э8.11 UI: GET /users/me/groups)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ученику — только группы, в которых он состоит", async () => {
    repoMock.listGroupsForUser.mockResolvedValueOnce([{ id: "g1", name: "9А" }]);
    const rows = await listMyGroups(SCHOOL, STUDENT, "student");
    expect(repoMock.listGroupsForUser).toHaveBeenCalledWith(SCHOOL, STUDENT);
    expect(repoMock.listGroups).not.toHaveBeenCalled();
    expect(rows).toEqual([{ id: "g1", name: "9А" }]);
  });

  it.each(["teacher", "methodist", "admin"] as const)(
    "%s — все группы школы (у групп нет своего учителя-хозяина)",
    async (role) => {
      repoMock.listGroups.mockResolvedValueOnce([{ id: "g1" }, { id: "g2" }]);
      const rows = await listMyGroups(SCHOOL, STUDENT, role);
      expect(repoMock.listGroups).toHaveBeenCalledWith(SCHOOL);
      expect(repoMock.listGroupsForUser).not.toHaveBeenCalled();
      expect(rows).toHaveLength(2);
    },
  );
});
