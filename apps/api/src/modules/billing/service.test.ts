import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoMock, plategaMock, mailMock, usersMock } = vi.hoisted(() => ({
  mailMock: { sendPlanActivatedEmail: vi.fn() },
  usersMock: { emailsByIds: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "tutor@example.com"]))) },
  repoMock: {
    getSchoolKind: vi.fn(),
    paymentHistory: vi.fn(),
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
    getTransaction: vi.fn(),
    createSubscription: vi.fn(),
    getSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
  },
}));
vi.mock("./repo.js", () => repoMock);
vi.mock("./platega.js", () => plategaMock);
vi.mock("../mail/service.js", () => mailMock);
vi.mock("../users/service.js", () => usersMock);

const { priceRub, checkout, handleCallback, subscribe, cancelAutopay, assertBillingAccess } = await import("./service.js");

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
    const r = await checkout(user, "a@b.ru", { plan: "tutor", period: "year" });
    expect(repoMock.insertPayment).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 7900, plan: "tutor", period: "year" }));
    expect(plategaMock.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 7900, orderId: "pay-1", userEmail: "a@b.ru" }));
    expect(repoMock.setProviderTxId).toHaveBeenCalledWith("pay-1", "tx-1");
    expect(r.url).toContain("pay.platega.io");
  });

  // 2026-10-28: лимит Platega 19 000 ₽ на транзакцию — школьные тарифы скрыты, онлайн их не оплатить.
  it("скрытый тариф онлайн не оплачивается — ни разово, ни подпиской", async () => {
    plategaMock.plategaConfigured.mockReturnValue(true);
    for (const plan of ["mini", "school", "pro", "network"] as const) {
      await expect(checkout(user, "a@b.ru", { plan, period: "month" })).rejects.toMatchObject({ code: "plan_unavailable" });
      await expect(subscribe(user, "a@b.ru", { plan, period: "year", autopayConsent: true })).rejects.toMatchObject({ code: "plan_unavailable" });
    }
    expect(repoMock.insertPayment).not.toHaveBeenCalled();
    expect(plategaMock.createTransaction).not.toHaveBeenCalled();
  });

  it("частичный возврат и спор тариф не трогают — разбираются вручную", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue({ ...payment, status: "confirmed" });
    for (const status of ["PARTIALLY_REFUNDED", "DISPUTED"] as const) {
      await handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status }, true);
    }
    expect(repoMock.setPaymentStatus).not.toHaveBeenCalled();
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("CONFIRMED продлевает тариф только после перепроверки статуса", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    plategaMock.getTransaction.mockResolvedValue({ status: "CONFIRMED", amount: 990, commission: 84.15, currency: "RUB" });
    await handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" }, true);
    expect(repoMock.confirmPayment).toHaveBeenCalledWith("p1", "1 month");
  });

  it("CONFIRMED без подтверждения у Platega — ничего не продлеваем", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    plategaMock.getTransaction.mockResolvedValue({ status: "PENDING", amount: 990, commission: 0, currency: "RUB" });
    await expect(handleCallback({ id: "tx-1", amount: 990, currency: "RUB", status: "CONFIRMED" }, true)).rejects.toBeTruthy();
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("комиссия на клиенте: 790 ₽ + 67,15 ₽ — тариф продлевается", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue({ ...payment, amountRub: 790 });
    plategaMock.getTransaction.mockResolvedValue({ status: "CONFIRMED", amount: 857.15, commission: 67.15, currency: "RUB" });
    await handleCallback({ id: "tx-1", amount: 857.15, currency: "RUB", status: "CONFIRMED" }, true);
    expect(repoMock.confirmPayment).toHaveBeenCalledWith("p1", "1 month");
  });

  it("сумма не совпадает — платёж не подтверждается", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    for (const tx of [
      { status: "CONFIRMED", amount: 1, commission: 0, currency: "RUB" },
      { status: "CONFIRMED", amount: 990, commission: 0, currency: "USD" },
      { status: "CONFIRMED", amount: 900, commission: 10, currency: "RUB" },
    ]) {
      plategaMock.getTransaction.mockResolvedValue(tx);
      await handleCallback({ id: "tx-1", amount: tx.amount, currency: "RUB", status: "CONFIRMED" }, true);
    }
    expect(repoMock.confirmPayment).not.toHaveBeenCalled();
  });

  it("CANCELED помечает платёж отменённым", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue(payment);
    await handleCallback({ id: "tx-1", amount: 1074.15, currency: "RUB", status: "CANCELED" }, true);
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
    const r = await subscribe(user, "a@b.ru", { plan: "tutor", period: "month", autopayConsent: true });
    expect(plategaMock.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ amountRub: 790, period: "month" }));
    expect(repoMock.setSubscriptionProviderId).toHaveBeenCalledWith("s1", "ps-1");
    expect(r.url).toContain("subscription");
  });

  it("вторая подписка при действующей — отказ", async () => {
    repoMock.currentSubscription.mockResolvedValue({ id: "s1", status: "active", createdAt: new Date() });
    await expect(subscribe(user, "a@b.ru", { plan: "tutor", period: "month", autopayConsent: true })).rejects.toMatchObject({ code: "subscription_exists" });
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

describe("тариф только у репетитора и письмо после оплаты (2026-11-24)", () => {
  it("«Тариф» открыт репетитору в личном пространстве и закрыт в школе", async () => {
    repoMock.getSchoolKind.mockResolvedValue("individual");
    await expect(assertBillingAccess({ ...user, role: "teacher" })).resolves.toBeUndefined();
    repoMock.getSchoolKind.mockResolvedValue("organization");
    await expect(assertBillingAccess({ ...user, role: "admin" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(assertBillingAccess({ ...user, role: "teacher" })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("после подтверждённой оплаты плательщику уходит письмо с тарифом и сроком", async () => {
    const until = new Date("2026-12-24T10:00:00Z");
    repoMock.findPaymentByProviderTxId.mockResolvedValue({ ...payment, amountRub: 790, userId: "u1", subscriptionId: null });
    plategaMock.getTransaction.mockResolvedValue({ status: "CONFIRMED", amount: 790, commission: 0, currency: "RUB" });
    repoMock.confirmPayment.mockResolvedValue({ payment: { ...payment, amountRub: 790, userId: "u1", subscriptionId: null }, paidUntil: until });
    repoMock.getSchoolBilling.mockResolvedValue({ billingPlan: "tutor", paidUntil: until, kind: "individual" });
    repoMock.currentSubscription.mockResolvedValue(null);
    await handleCallback({ id: "tx-9", status: "CONFIRMED", amount: 790, currency: "RUB" } as never, true);
    expect(mailMock.sendPlanActivatedEmail).toHaveBeenCalledWith(
      "tutor@example.com",
      expect.objectContaining({ planName: "Репетитор", amountRub: 790, paidUntil: until, nextChargeAt: null }),
    );
  });

  it("повторный callback по уже подтверждённому платежу письмо не дублирует", async () => {
    repoMock.findPaymentByProviderTxId.mockResolvedValue({ ...payment, userId: "u1" });
    plategaMock.getTransaction.mockResolvedValue({ status: "CONFIRMED", amount: 990, commission: 0, currency: "RUB" });
    repoMock.confirmPayment.mockResolvedValue(null);
    repoMock.getSchoolBilling.mockResolvedValue(null);
    await handleCallback({ id: "tx-9", status: "CONFIRMED", amount: 990, currency: "RUB" } as never, true);
    expect(mailMock.sendPlanActivatedEmail).not.toHaveBeenCalled();
  });
});
