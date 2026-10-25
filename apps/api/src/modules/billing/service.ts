import {
  BILLING_PLANS,
  YEAR_MONTHS_CHARGED,
  type AccessTokenPayload,
  type BillingState,
  type CheckoutRequest,
  type PlategaCallback,
  type SubscribeRequest,
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
  const sub = await repo.currentSubscription(user.schoolId);
  return {
    subscription: sub
      ? {
          status: sub.status,
          plan: sub.plan as "tutor" | "school",
          period: sub.period as "month" | "year",
          amountRub: sub.amountRub,
          nextChargeAt: sub.nextChargeAt ? sub.nextChargeAt.toISOString() : null,
        }
      : null,
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

/** Ожидание привязки у Platega — 30 минут; после этого подписка у них Failed. */
const PENDING_SUB_TTL_MS = 35 * 60 * 1000;

/**
 * Подписка с автосписанием через СБП. Одна действующая подписка на школу;
 * незавершённая привязка старше 30 минут считается неудавшейся.
 */
export async function subscribe(user: AccessTokenPayload, req: SubscribeRequest): Promise<{ url: string }> {
  if (!platega.plategaConfigured()) {
    throw new AppError(503, "payments_unavailable", "Оплата пока недоступна");
  }
  const current = await repo.currentSubscription(user.schoolId);
  if (current?.status === "active") {
    throw new AppError(409, "subscription_exists", "Автопродление уже включено — сначала отключите текущую подписку");
  }
  if (current?.status === "pending") {
    if (Date.now() - current.createdAt.getTime() < PENDING_SUB_TTL_MS) {
      throw new AppError(409, "subscription_pending", "Подписка ждёт подтверждения в банке — завершите его или попробуйте через 30 минут");
    }
    await repo.updateSubscription(current.id, { status: "failed" });
  }
  const amountRub = priceRub(req.plan, req.period);
  const plan = BILLING_PLANS.find((x) => x.id === req.plan)!;
  const sub = await repo.insertSubscription({ schoolId: user.schoolId, userId: user.sub, plan: req.plan, period: req.period, amountRub });
  const created = await platega.createSubscription({
    amountRub,
    period: req.period,
    description: `Матис, тариф «${plan.name}», ${amountRub} ₽ ${req.period === "year" ? "раз в год" : "раз в месяц"}`,
  });
  await repo.setSubscriptionProviderId(sub.id, created.subscriptionId);
  logEvent("payment_created", { subscriptionId: sub.id, schoolId: user.schoolId, plan: req.plan, period: req.period, amountRub, recurring: true });
  return { url: created.url };
}

/** Отключение автопродления: будущих списаний не будет, оплаченный срок остаётся. */
export async function cancelAutopay(user: AccessTokenPayload): Promise<void> {
  const current = await repo.currentSubscription(user.schoolId);
  if (!current) return;
  if (current.providerSubId) await platega.cancelSubscription(current.providerSubId);
  await repo.updateSubscription(current.id, { status: "cancelled", nextChargeAt: null });
}

const SUB_STATUS: Record<string, "pending" | "active" | "past_due" | "cancelled" | "failed"> = {
  PendingAgreement: "pending",
  Active: "active",
  PastDue: "past_due",
  Cancelled: "cancelled",
  Failed: "failed",
};

/** Смена статуса подписки: тело callback не используем, статус берём у Platega. */
async function syncSubscription(providerSubId: string): Promise<void> {
  const sub = await repo.findSubscriptionByProviderId(providerSubId);
  if (!sub) return;
  const remote = await platega.getSubscription(providerSubId);
  const status = remote ? SUB_STATUS[remote.status] : undefined;
  if (!remote || !status) {
    throw new AppError(502, "payment_provider_error", "Не удалось получить статус подписки");
  }
  await repo.updateSubscription(sub.id, {
    status,
    nextChargeAt: remote.nextChargeAt ? new Date(remote.nextChargeAt) : null,
  });
}

/**
 * Callback Platega. Подлинность — по заголовкам X-MerchantId/X-Secret; сумма
 * сверяется с нашей строкой; перед продлением статус перепроверяется запросом
 * к Platega. Ответ 200 на всё, что разобрано, чтобы Platega не повторяла
 * заведомо бесполезные запросы.
 */
export async function handleCallback(body: PlategaCallback, authenticated: boolean): Promise<void> {
  if (body.status.startsWith("SUBSCRIPTION_")) {
    logEvent("payment_callback", { subId: body.subscriptionId ?? body.id, status: body.status });
    await syncSubscription(body.subscriptionId ?? body.id);
    return;
  }
  // Деньги — только из callback с нашими ключами; статус всё равно перепроверяем.
  if (!authenticated) throw new AppError(401, "unauthorized", "Неверная подпись callback");
  if (body.subscriptionId) {
    await handleSubscriptionCharge(body);
    return;
  }
  await handlePaymentCallback(body);
}

async function handleSubscriptionCharge(body: PlategaCallback): Promise<void> {
  const sub = await repo.findSubscriptionByProviderId(body.subscriptionId!);
  logEvent("payment_callback", { txId: body.id, subId: body.subscriptionId, status: body.status, found: Boolean(sub) });
  if (!sub) return;
  if (body.status === "CONFIRMED") {
    if (Math.round(body.amount) !== sub.amountRub || body.currency !== "RUB") {
      logEvent("payment_callback", { subscriptionId: sub.id, mismatch: true, amount: body.amount }, "warn");
      return;
    }
    const actual = await platega.getTransactionStatus(body.id);
    if (actual !== "CONFIRMED") throw new AppError(409, "payment_not_confirmed", "Статус списания не подтверждён");
    await repo.recordSubscriptionCharge({ subscription: sub, providerTxId: body.id });
    await repo.updateSubscription(sub.id, {
      status: "active",
      nextChargeAt: body.nextChargeAt ? new Date(body.nextChargeAt) : null,
    });
  } else if (body.status === "CANCELED") {
    // Списание не прошло: у Platega подписка переходит в PastDue без повторов.
    await repo.updateSubscription(sub.id, { status: "past_due", nextChargeAt: null });
  }
}

async function handlePaymentCallback(body: PlategaCallback): Promise<void> {
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
