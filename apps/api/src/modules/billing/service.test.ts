import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, plategaMock } = vi.hoisted(() => ({
  repoMock: {
    getSchoolBilling: vi.fn(),
    lastPayment: vi.fn(),
    insertPayment: vi.fn(),
    setProviderTxId: vi.fn(),
    findPaymentByProviderTxId: vi.fn(),
    confirmPayment: vi.fn(),
    setPaymentStatus: vi.fn(),
  },
  plategaMock: {
    plategaConfigured: vi.fn(() => true),
    createTransaction: vi.fn(),
    getTransactionStatus: vi.fn(),
  },
}));
vi.mock("./repo.js", () => repoMock);
vi.mock("./platega.js", () => plategaMock);

const { priceRub, checkout, handleCallback } = await import("./service.js");

const user = { sub: "11111111-1111-4111-8111-111111111111", schoolId: "22222222-2222-4222-8222-222222222222", role: "admin" as const };
const payment = { id: "p1", schoolId: user.schoolId, plan: "tutor", period: "month", amountRub: 990, status: "pending" };

beforeEach(() => {
  vi.clearAllMocks();
  plategaMock.plategaConfigured.mockReturnValue(true);
});

describe("billing", () => {
  it("цена считается на сервере: год — 10 месяцев", () => {
    expect(priceRub("tutor", "month")).toBe(990);
    expect(priceRub("tutor", "year")).toBe(9900);
    expect(priceRub("school", "year")).toBe(69000);
  });

  it("без ключей Platega — заглушка payments_unavailable", async () => {
    plategaMock.plategaConfigured.mockReturnValue(false);
    await expect(checkout(user, "a@b.ru", { plan: "tutor", period: "month" })).rejects.toMatchObject({ code: "payments_unavailable" });
    expect(repoMock.insertPayment).not.toHaveBeenCalled();
  });

  it("checkout создаёт платёж с серверной суммой и возвращает ссылку Platega", async () => {
    repoMock.insertPayment.mockResolvedValue({ ...payment, id: "pay-1" });
    plategaMock.createTransaction.mockResolvedValue({ transactionId: "tx-1", url: "https://pay.platega.io/?id=tx-1" });
    const r = await checkout(user, "a@b.ru", { plan: "school", period: "year" });
    expect(repoMock.insertPayment).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 69000, plan: "school", period: "year" }));
    expect(plategaMock.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 69000, orderId: "pay-1" }));
    expect(repoMock.setProviderTxId).toHaveBeenCalledWith("pay-1", "tx-1");
    expect(r.url).toContain("pay.platega.io");
  });

  it("CONFIRMED продлевает тариф только после перепроверки статуса", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    plategaMock.getTransactionStatus.mockResolvedValue("CONFIRMED");
    await handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" });
    expect(repoMock.confirmPayment).toHaveBeenCalledWith("p1", "1 month");
  });

  it("CONFIRMED без подтверждения у Platega — ничего не продлеваем", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    plategaMock.getTransactionStatus.mockResolvedValue("PENDING");
    await expect(handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" })).rejects.toBeTruthy();
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("сумма не совпадает — платёж не подтверждается", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    await handleCallback({ id: "tx-1", amount: 1, currency: "RUB", status: "CONFIRMED" });
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("CANCELED помечает платёж отменённым", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    await handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CANCELED" });
    expect(repoMock.setPaymentStatus).toHaveBeenCalledWith("p1", "canceled");
  });
});
