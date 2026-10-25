import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, membershipsMock } = vi.hoisted(() => ({
  repoMock: { getSchoolBilling: vi.fn() },
  membershipsMock: { activeUserIdsWithRole: vi.fn() },
}));
vi.mock("./repo.js", () => repoMock);
vi.mock("./platega.js", () => ({}));
vi.mock("../memberships/service.js", () => membershipsMock);

const { planLimits, assertRoleSeat, assertRecordingAllowed, hasMatisLibrary } = await import("./service.js");

const future = () => new Date(Date.now() + 86_400_000);
let n = 0;
/** Кеш лимитов — по школе; каждому тесту своя. */
const school = () => `school-${++n}`;

beforeEach(() => vi.clearAllMocks());

describe("Э15.6: лимиты тарифа", () => {
  it("не оплачено или срок вышел — бесплатный минимум", async () => {
    repoMock.getSchoolBilling.mockResolvedValueOnce({ billingPlan: "school", paidUntil: new Date(Date.now() - 1000), kind: "organization" });
    const r = await planLimits(school());
    expect(r.plan).toBeNull();
    expect(r.limits).toMatchObject({ rooms: 1, teachers: 1, methodists: 0, studentsPerLesson: 6, recordingHoursPerMonth: 0, matisLibrary: false });
  });

  it("оплачена «Школа» — её лимиты; результат кешируется", async () => {
    const id = school();
    repoMock.getSchoolBilling.mockResolvedValue({ billingPlan: "school", paidUntil: future(), kind: "organization" });
    expect((await planLimits(id)).limits).toMatchObject({ rooms: 15, teachers: 15, methodists: null, studentsPerLesson: 30 });
    expect(await hasMatisLibrary(id)).toBe(true);
    expect(repoMock.getSchoolBilling).toHaveBeenCalledTimes(1);
  });

  it("учителя: место есть — пропускаем, нет — понятный отказ с подсказкой тарифа", async () => {
    repoMock.getSchoolBilling.mockResolvedValue({ billingPlan: "tutor", paidUntil: future(), kind: "individual" });
    const id = school();
    membershipsMock.activeUserIdsWithRole.mockResolvedValueOnce([]);
    await expect(assertRoleSeat(id, "teacher")).resolves.toBeUndefined();
    membershipsMock.activeUserIdsWithRole.mockResolvedValueOnce(["t1"]);
    await expect(assertRoleSeat(id, "teacher")).rejects.toMatchObject({ statusCode: 403, code: "plan_limit", message: expect.stringContaining("«Школа»") });
  });

  it("методисты: без тарифа «Школа» нельзя, в «Школе» — без ограничения; админ не считается", async () => {
    repoMock.getSchoolBilling.mockResolvedValueOnce({ billingPlan: null, paidUntil: null, kind: "organization" });
    await expect(assertRoleSeat(school(), "methodist")).rejects.toMatchObject({ message: "Методисты доступны в тарифе «Школа»" });
    repoMock.getSchoolBilling.mockResolvedValueOnce({ billingPlan: "school", paidUntil: future(), kind: "organization" });
    await expect(assertRoleSeat(school(), "methodist")).resolves.toBeUndefined();
    await expect(assertRoleSeat(school(), "admin")).resolves.toBeUndefined();
    expect(membershipsMock.activeUserIdsWithRole).not.toHaveBeenCalled();
  });

  it("запись: бесплатно — нет, «Репетитор» — до 20 ч в месяц, «Школа» — без ограничения", async () => {
    repoMock.getSchoolBilling.mockResolvedValueOnce({ billingPlan: null, paidUntil: null, kind: "individual" });
    await expect(assertRecordingAllowed(school(), async () => 0)).rejects.toMatchObject({ code: "plan_limit" });
    repoMock.getSchoolBilling.mockResolvedValue({ billingPlan: "tutor", paidUntil: future(), kind: "individual" });
    const tutor = school();
    await expect(assertRecordingAllowed(tutor, async () => 19 * 3600)).resolves.toBeUndefined();
    await expect(assertRecordingAllowed(tutor, async () => 20 * 3600)).rejects.toMatchObject({ message: expect.stringContaining("20 ч") });
    repoMock.getSchoolBilling.mockResolvedValue({ billingPlan: "school", paidUntil: future(), kind: "organization" });
    await expect(assertRecordingAllowed(school(), async () => 10_000 * 3600)).resolves.toBeUndefined();
  });
});
