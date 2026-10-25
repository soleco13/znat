import {
  BILLING_PLANS,
  YEAR_MONTHS_CHARGED,
  type AccessTokenPayload,
  type BillingState,
  type CheckoutRequest,
  type PlategaCallback,
} from "@school/shared";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import { logEvent } from "../../plugins/logger.js";
import * as platega from "./platega.js";
import * as repo from "./repo.js";

/**
 * Оплата тарифа (Platega, 2026-10-25). Разовый платёж на месяц или год:
 * строка `payments` → платёжная форма Platega → callback подтверждает и
 * продлевает `schools.paid_until`. Без ключей Platega checkout отвечает
 * `payments_unavailable`, и страница показывает заглушку.
 */
export function priceRub(plan: CheckoutRequest["plan"], period: CheckoutRequest["period"]): number {
  const p = BILLING_PLANS.find((x) => x.id === plan);
  if (!p) throw new AppError(400, "unknown_plan", "Такого тарифа нет");
  return period === "year" ? p.monthlyRub * YEAR_MONTHS_CHARGED : p.monthlyRub;
}

export async function getState(user: AccessTokenPayload): Promise<BillingState> {
  const school = await repo.getSchoolBilling(user.schoolId);
  const last = await repo.lastPayment(user.schoolId);
  const plan = school?.billingPlan;
  return {
    plan: plan === "tutor" || plan === "school" ? plan : null,
    paidUntil: school?.paidUntil ? school.paidUntil.toISOString() : null,
    paymentsEnabled: platega.plategaConfigured(),
    supportEmail: env.SUPPORT_EMAIL,
    lastPayment: last
      ? {
          id: last.id,
          status: last.status,
          plan: last.plan as "tutor" | "school",
          period: last.period as "month" | "year",
          amountRub: last.amountRub,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
  };
}

export async function checkout(user: AccessTokenPayload, email: string, req: CheckoutRequest): Promise<{ url: string }> {
  if (!platega.plategaConfigured()) {
    throw new AppError(503, "payments_unavailable", "Оплата пока недоступна");
  }
  const amountRub = priceRub(req.plan, req.period);
  const plan = BILLING_PLANS.find((x) => x.id === req.plan)!;
  const payment = await repo.insertPayment({
    schoolId: user.schoolId,
    userId: user.sub,
    plan: req.plan,
    period: req.period,
    amountRub,
  });
  const origin = env.PUBLIC_ORIGIN.replace(/\/+$/, "");
  const tx = await platega.createTransaction({
    amountRub,
    description: `Матис, тариф «${plan.name}», ${req.period === "year" ? "12 месяцев" : "1 месяц"}`,
    returnUrl: `${origin}/billing?payment=${payment.id}`,
    failedUrl: `${origin}/billing?payment=${payment.id}&failed=1`,
    orderId: payment.id,
    userId: user.sub,
    userName: email,
  });
  await repo.setProviderTxId(payment.id, tx.transactionId);
  logEvent("payment_created", { paymentId: payment.id, schoolId: user.schoolId, plan: req.plan, period: req.period, amountRub });
  return { url: tx.url };
}

/**
 * Callback Platega. Подлинность — по заголовкам X-MerchantId/X-Secret; сумма
 * сверяется с нашей строкой; перед продлением статус перепроверяется запросом
 * к Platega. Ответ 200 на всё, что разобрано, чтобы Platega не повторяла
 * заведомо бесполезные запросы.
 */
export async function handleCallback(body: PlategaCallback): Promise<void> {
  const payment = await repo.findPaymentByProviderTxId(body.id);
  logEvent("payment_callback", { txId: body.id, status: body.status, found: Boolean(payment) });
  if (!payment) return;
  if (Math.round(body.amount) !== payment.amountRub || body.currency !== "RUB") {
    logEvent("payment_callback", { paymentId: payment.id, mismatch: true, amount: body.amount, currency: body.currency }, "warn");
    return;
  }
  if (body.status === "CONFIRMED") {
    const actual = await platega.getTransactionStatus(body.id);
    if (actual !== "CONFIRMED") {
      logEvent("payment_callback", { paymentId: payment.id, recheck: actual }, "warn");
      throw new AppError(409, "payment_not_confirmed", "Статус платежа не подтверждён");
    }
    await repo.confirmPayment(payment.id, payment.period === "year" ? "1 year" : "1 month");
  } else if (body.status === "CANCELED" && payment.status === "pending") {
    await repo.setPaymentStatus(payment.id, "canceled");
  } else if (body.status === "CHARGEBACKED") {
    await repo.setPaymentStatus(payment.id, "chargebacked");
  }
}
