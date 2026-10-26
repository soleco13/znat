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
    currentSubscription: vi.fn(),
    insertSubscription: vi.fn(),
    setSubscriptionProviderId: vi.fn(),
    findSubscriptionByProviderId: vi.fn(),
    updateSubscription: vi.fn(),
    recordSubscriptionCharge: vi.fn(),
  },
  plategaMock: {
    plategaConfigured: vi.fn(() => true),
    createTransaction: vi.fn(),
    getTransactionStatus: vi.fn(),
    createSubscription: vi.fn(),
    getSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
  },
}));
vi.mock("./repo.js", () => repoMock);
vi.mock("./platega.js", () => plategaMock);

const { priceRub, checkout, handleCallback, subscribe, cancelAutopay } = await import("./service.js");

const user = { sub: "11111111-1111-4111-8111-111111111111", schoolId: "22222222-2222-4222-8222-222222222222", role: "admin" as const };
const payment = { id: "p1", schoolId: user.schoolId, plan: "tutor", period: "month", amountRub: 990, status: "pending" };

beforeEach(() => {
  vi.clearAllMocks();
  plategaMock.plategaConfigured.mockReturnValue(true);
});

describe("billing", () => {
  it("цена считается на сервере: год — 10 месяцев", () => {
    expect(priceRub("tutor", "month")).toBe(790);
    expect(priceRub("tutor", "year")).toBe(7900);
    expect(priceRub("school", "year")).toBe(89900);
    expect(priceRub("network", "month")).toBe(59900);
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
    expect(repoMock.insertPayment).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 89900, plan: "school", period: "year" }));
    expect(plategaMock.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 89900, orderId: "pay-1" }));
    expect(repoMock.setProviderTxId).toHaveBeenCalledWith("pay-1", "tx-1");
    expect(r.url).toContain("pay.platega.io");
  });

  it("CONFIRMED продлевает тариф только после перепроверки статуса", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    plategaMock.getTransactionStatus.mockResolvedValue("CONFIRMED");
    await handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" }, true);
    expect(repoMock.confirmPayment).toHaveBeenCalledWith("p1", "1 month");
  });

  it("CONFIRMED без подтверждения у Platega — ничего не продлеваем", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    plategaMock.getTransactionStatus.mockResolvedValue("PENDING");
    await expect(handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" }, true)).rejects.toBeTruthy();
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("сумма не совпадает — платёж не подтверждается", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    await handleCallback({ id: "tx-1", amount: 1, currency: "RUB", status: "CONFIRMED" }, true);
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("CANCELED помечает платёж отменённым", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    await handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CANCELED" }, true);
    expect(repoMock.setPaymentStatus).toHaveBeenCalledWith("p1", "canceled");
  });

  it("деньги без ключей Platega не принимаются", async () => {
    await expect(handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" }, false)).rejects.toMatchObject({ code: "unauthorized" });
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("подписка: без согласия схема не пропустит, с согласием — ссылка на привязку", async () => {
    repoMock.currentSubscription.mockResolvedValue(null);
    repoMock.insertSubscription.mockResolvedValue({ id: "s1" });
    plategaMock.createSubscription.mockResolvedValue({ subscriptionId: "ps-1", url: "https://pay.platega.io/subscription/ps-1" });
    const r = await subscribe(user, { plan: "tutor", period: "month", autopayConsent: true });
    expect(plategaMock.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 790, period: "month" }));
    expect(repoMock.setSubscriptionProviderId).toHaveBeenCalledWith("s1", "ps-1");
    expect(r.url).toContain("subscription");
  });

  it("вторая подписка при действующей — отказ", async () => {
    repoMock.currentSubscription.mockResolvedValue({ id: "s1", status: "active", createdAt: new Date() });
    await expect(subscribe(user, { plan: "tutor", period: "month", autopayConsent: true })).rejects.toMatchObject({ code: "subscription_exists" });
  });

  it("списание по подписке продлевает тариф, статус подписки — из API Platega", async () => {
    const sub = { id: "s1", schoolId: user.schoolId, userId: user.sub, plan: "tutor", period: "month", amountRub: 990, status: "active" };
    repoMock.findSubscriptionByProviderId.mockResolvedValue(sub);
    plategaMock.getTransactionStatus.mockResolvedValue("CONFIRMED");
    await handleCallback({ id: "ch-1", amount: 990, currency: "RUB", status: "CONFIRMED", subscriptionId: "ps-1", nextChargeAt: "2026-12-25T10:00:00Z" }, true);
    expect(repoMock.recordSubscriptionCharge).toHaveBeenCalledWith({ subscription: sub, providerTxId: "ch-1" });

    plategaMock.getSubscription.mockResolvedValue({ status: "Cancelled", nextChargeAt: null });
    await handleCallback({ id: "ps-1", amount: 990, currency: "RUB", status: "SUBSCRIPTION_CANCELLED", subscriptionId: "ps-1" }, false);
    expect(repoMock.updateSubscription).toHaveBeenLastCalledWith("s1", { status: "cancelled", nextChargeAt: null });
  });

  it("отключение автопродления отменяет подписку у Platega", async () => {
    repoMock.currentSubscription.mockResolvedValue({ id: "s1", status: "active", providerSubId: "ps-1" });
    await cancelAutopay(user);
    expect(plategaMock.cancelSubscription).toHaveBeenCalledWith("ps-1");
    expect(repoMock.updateSubscription).toHaveBeenCalledWith("s1", { status: "cancelled", nextChargeAt: null });
  });
});
