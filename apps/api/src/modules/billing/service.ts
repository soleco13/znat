import {
  BILLING_PLANS,
  PAYMENT_MAX_RUB,
  FREE_LIMITS,
  PLATFORM_LIMITS,
  YEAR_MONTHS_CHARGED,
  supportContactsFor,
  type AccessTokenPayload,
  type BillingPlanId,
  type PlanLimits,
  type Role,
  type BillingState,
  type CheckoutRequest,
  type PlategaCallback,
  type SubscribeRequest,
  type TestPaymentComplete,
  type TestPaymentInfo,
} from "@school/shared";
import { randomUUID } from "node:crypto";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import { logEvent } from "../../plugins/logger.js";
import * as membershipsService from "../memberships/service.js";
import * as platega from "./platega.js";
import * as repo from "./repo.js";

/**
 * Оплата тарифа (Platega, 2026-10-25). Разовый платёж на месяц или год:
 * строка `payments` → платёжная форма Platega → callback подтверждает и
 * продлевает `schools.paid_until`. Без ключей Platega checkout отвечает
 * `payments_unavailable`, и страница показывает заглушку.
 */
/**
 * Онлайн-оплата только за открытые тарифы и не дороже лимита Platega на одну
 * транзакцию (`PAYMENT_MAX_RUB`). Скрытые тариф включает супер-админ вручную.
 */
function assertPurchasable(plan: CheckoutRequest["plan"], period: CheckoutRequest["period"]): void {
  const p = BILLING_PLANS.find((x) => x.id === plan);
  if (!p || p.hidden) {
    throw new AppError(400, "plan_unavailable", "Этот тариф сейчас подключаем по запросу — напишите в поддержку");
  }
  if (priceRub(plan, period) > PAYMENT_MAX_RUB) {
    throw new AppError(400, "payment_over_limit", "Сумма больше лимита онлайн-оплаты — выберите помесячную оплату или напишите в поддержку");
  }
}

export function priceRub(plan: CheckoutRequest["plan"], period: CheckoutRequest["period"]): number {
  const p = BILLING_PLANS.find((x) => x.id === plan);
  if (!p) throw new AppError(400, "unknown_plan", "Такого тарифа нет");
  return period === "year" ? p.monthlyRub * YEAR_MONTHS_CHARGED : p.monthlyRub;
}

// ─── Э15.6: лимиты тарифа ─────────────────────────────────────────────────────

/** Кеш лимитов пространства: вход в урок спрашивает их на каждом входе. Потеря кеша безвредна. */
const LIMITS_CACHE_MS = 30_000;
const limitsCache = new Map<string, { value: { plan: BillingPlanId | null; limits: PlanLimits }; at: number }>();

/**
 * Лимиты, которые действуют сейчас: оплаченный тариф или бесплатный
 * минимум (`FREE_LIMITS`), пока не оплачено или срок вышел.
 */
export async function planLimits(schoolId: string): Promise<{ plan: BillingPlanId | null; limits: PlanLimits }> {
  const hit = limitsCache.get(schoolId);
  if (hit && Date.now() - hit.at < LIMITS_CACHE_MS) return hit.value;
  const school = await repo.getSchoolBilling(schoolId);
  const active = school?.paidUntil && school.paidUntil.getTime() > Date.now();
  const plan = active ? BILLING_PLANS.find((p) => p.id === school.billingPlan) : undefined;
  const value = {
    plan: plan?.id ?? null,
    limits: school?.kind === "platform" ? PLATFORM_LIMITS : (plan?.limits ?? FREE_LIMITS),
  };
  limitsCache.set(schoolId, { value, at: Date.now() });
  if (limitsCache.size > 5000) limitsCache.delete(limitsCache.keys().next().value!);
  return value;
}


/** Э15.5: библиотека «Матиса» — пока оплачен тариф, в который она входит. */
export async function hasMatisLibrary(schoolId: string): Promise<boolean> {
  return (await planLimits(schoolId)).limits.matisLibrary;
}

/** Можно ли добавить ещё одного участника с ролью (приглашение, принятие, смена ролей). */
export async function assertRoleSeat(schoolId: string, role: Role): Promise<void> {
  if (role === "admin") return;
  const { plan, limits } = await planLimits(schoolId);
  const max = role === "teacher" ? limits.teachers : limits.methodists;
  if (max === null) return;
  if (role === "methodist" && max === 0) {
    throw new AppError(403, "plan_limit", "Методисты доступны в тарифах для школ — подключаем по запросу, напишите в поддержку");
  }
  const used = (await membershipsService.activeUserIdsWithRole(schoolId, role)).length;
  if (used < max) return;
  throw new AppError(403, "plan_limit", `По тарифу ${role === "teacher" ? "учителей" : "методистов"} не больше ${max}.${upgradeHint(plan)}`);
}

/** Подсказка к отказу по лимиту — куда расти с текущего тарифа (следующий в каталоге). */
export const upgradeHint = (plan: BillingPlanId | null) => {
  if (plan === null) return " Больше — в платных тарифах, раздел «Тариф».";
  const next = BILLING_PLANS[BILLING_PLANS.findIndex((p) => p.id === plan) + 1];
  if (next?.hidden) return " Больше — по запросу, напишите в поддержку.";
  return next ? ` Больше — в тарифе «${next.name}».` : "";
};

/** Сохранённый в базе тариф, если он есть в каталоге. */
const knownPlan = (plan: string | null | undefined): BillingPlanId | null =>
  BILLING_PLANS.find((p) => p.id === plan)?.id ?? null;

/** Можно ли начать запись: `recordedSec` — уже записано школой в этом месяце. */
export async function assertRecordingAllowed(schoolId: string, recordedSec: () => Promise<number>): Promise<void> {
  const { plan, limits } = await planLimits(schoolId);
  const hours = limits.recordingHoursPerMonth;
  if (hours === null) return;
  if (hours === 0) throw new AppError(403, "plan_limit", "Запись уроков доступна в платных тарифах — раздел «Тариф»");
  if ((await recordedSec()) < hours * 3600) return;
  throw new AppError(403, "plan_limit", `Лимит записи на этот месяц исчерпан: ${hours} ч.${upgradeHint(plan)}`);
}

type PaidListener = (input: { schoolId: string; kind: string; limits: PlanLimits }) => Promise<void>;
const paidListeners: PaidListener[] = [];

/**
 * Подписка на оплату. Её делает `lessons` — выдаёт репетитору аудитории по
 * тарифу (сам он их не создаёт, решение владельца 2026-10-25). billing не
 * может импортировать lessons: lessons → materials → billing уже есть.
 */
export function onPaid(listener: PaidListener): void {
  paidListeners.push(listener);
}

/** После оплаты: сбросить кеш лимитов и известить подписчиков. Их сбой не отменяет оплату. */
async function afterPaid(schoolId: string): Promise<void> {
  limitsCache.delete(schoolId);
  const school = await repo.getSchoolBilling(schoolId);
  if (!school) return;
  const { limits } = await planLimits(schoolId);
  for (const listener of paidListeners) {
    await listener({ schoolId, kind: school.kind, limits }).catch((err: unknown) =>
      logEvent("billing_rooms_failed", { schoolId, err: err instanceof Error ? err.message : String(err) }, "warn"),
    );
  }
}

export async function getState(
  user: AccessTokenPayload,
  /** Аудитории и секунды записи считают их модули (оба сами зависят от billing). */
  counts: { rooms: () => Promise<number>; recordedSec: () => Promise<number> },
): Promise<BillingState> {
  const school = await repo.getSchoolBilling(user.schoolId);
  const { limits } = await planLimits(user.schoolId);
  const [rooms, teachers, methodists, seconds] = await Promise.all([
    counts.rooms(),
    membershipsService.activeUserIdsWithRole(user.schoolId, "teacher"),
    membershipsService.activeUserIdsWithRole(user.schoolId, "methodist"),
    counts.recordedSec(),
  ]);
  const last = await repo.lastPayment(user.schoolId);
  const plan = school?.billingPlan;
  const sub = await repo.currentSubscription(user.schoolId);
  return {
    limits,
    usage: {
      rooms,
      teachers: teachers.length,
      methodists: methodists.length,
      recordingHoursThisMonth: Math.round((seconds / 3600) * 10) / 10,
    },
    subscription: sub
      ? {
          status: sub.status,
          plan: sub.plan as BillingPlanId,
          period: sub.period as "month" | "year",
          amountRub: sub.amountRub,
          nextChargeAt: sub.nextChargeAt ? sub.nextChargeAt.toISOString() : null,
        }
      : null,
    plan: knownPlan(plan),
    paidUntil: school?.paidUntil ? school.paidUntil.toISOString() : null,
    paymentsEnabled: platega.plategaConfigured() || testMode(),
    testMode: testMode(),
    support: supportContactsFor(school?.kind, env.SUPPORT_EMAIL),
    lastPayment: last
      ? {
          id: last.id,
          status: last.status,
          plan: last.plan as BillingPlanId,
          period: last.period as "month" | "year",
          amountRub: last.amountRub,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
  };
}

/** Тестовая оплата — только пока Platega не подключена. */
const testMode = () => env.BILLING_TEST_MODE && !platega.plategaConfigured();
const publicOrigin = () => env.PUBLIC_ORIGIN.replace(/\/+$/, "");

export async function checkout(user: AccessTokenPayload, email: string, req: CheckoutRequest): Promise<{ url: string }> {
  assertPurchasable(req.plan, req.period);
  if (testMode()) {
    const payment = await repo.insertPayment({
      schoolId: user.schoolId,
      userId: user.sub,
      plan: req.plan,
      period: req.period,
      amountRub: priceRub(req.plan, req.period),
      provider: "test",
    });
    await repo.setProviderTxId(payment.id, `test-${payment.id}`);
    return { url: `${publicOrigin()}/billing/test-pay?payment=${payment.id}` };
  }
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
  assertPurchasable(req.plan, req.period);
  if (!platega.plategaConfigured() && !testMode()) {
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
  if (testMode()) {
    await repo.setSubscriptionProviderId(sub.id, `test-${sub.id}`);
    return { url: `${publicOrigin()}/billing/test-pay?subscription=${sub.id}` };
  }
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
  if (current.providerSubId && !current.providerSubId.startsWith("test-")) await platega.cancelSubscription(current.providerSubId);
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
    await afterPaid(sub.schoolId);
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
    await afterPaid(payment.schoolId);
  } else if (body.status === "CANCELED" && payment.status === "pending") {
    await repo.setPaymentStatus(payment.id, "canceled");
  } else if (body.status === "CHARGEBACKED") {
    await repo.setPaymentStatus(payment.id, "chargebacked");
  }
}

/* ---------- Раздел «Платформа» супер-админа ---------- */

export const listSchoolsWithBilling = (schoolId?: string) => repo.listSchoolsWithBilling(schoolId);
export const listPayments = (input: { schoolId?: string; limit: number }) => repo.listPayments(input);
export const listSubscriptions = (schoolId: string) => repo.listSubscriptions(schoolId);
export const overviewTotals = () => repo.overviewTotals();

/** Ручное включение тарифа супер-админом (оплата мимо Platega, по договору или в подарок). */
export async function manualExtend(input: {
  schoolId: string;
  byUserId: string;
  plan: CheckoutRequest["plan"];
  period: CheckoutRequest["period"];
  count: number;
}): Promise<void> {
  const interval = `${input.count} ${input.period === "year" ? "year" : "month"}`;
  const ok = await repo.manualExtend({
    schoolId: input.schoolId,
    userId: input.byUserId,
    plan: input.plan,
    period: input.period,
    interval,
  });
  if (!ok) throw new AppError(404, "not_found", "Школа не найдена");
  await afterPaid(input.schoolId);
  logEvent("payment_created", { schoolId: input.schoolId, manual: true, plan: input.plan, interval, by: input.byUserId });
}

/* ---------- Тестовая оплата (BILLING_TEST_MODE) ---------- */

async function ownTestItem(user: AccessTokenPayload, kind: "payment" | "subscription", id: string) {
  if (!testMode()) throw new AppError(404, "not_found", "Тестовая оплата выключена");
  const row = kind === "payment" ? await repo.findPayment(id) : await repo.findSubscription(id);
  if (!row || row.schoolId !== user.schoolId) throw new AppError(404, "not_found", "Платёж не найден");
  return row;
}

export async function testInfo(user: AccessTokenPayload, kind: "payment" | "subscription", id: string): Promise<TestPaymentInfo> {
  const row = await ownTestItem(user, kind, id);
  return {
    kind,
    id: row.id,
    plan: row.plan as BillingPlanId,
    period: row.period as "month" | "year",
    amountRub: row.amountRub,
    status: row.status,
  };
}

/** Тестовая форма: «оплатить» проводит платёж тем же путём, что callback Platega. */
export async function testComplete(user: AccessTokenPayload, req: TestPaymentComplete): Promise<void> {
  const row = await ownTestItem(user, req.kind, req.id);
  if (req.kind === "payment") {
    if (row.status !== "pending") return;
    if (req.result === "success") {
      await repo.confirmPayment(row.id, row.period === "year" ? "1 year" : "1 month");
      await afterPaid(row.schoolId);
    } else await repo.setPaymentStatus(row.id, "canceled");
    return;
  }
  if (row.status !== "pending") return;
  if (req.result === "fail") {
    await repo.updateSubscription(row.id, { status: "failed" });
    return;
  }
  const chargeId = `test-charge-${randomUUID()}`;
  const sub = row as Awaited<ReturnType<typeof repo.findSubscription>> & object;
  await repo.recordSubscriptionCharge({ subscription: sub, providerTxId: chargeId });
  await afterPaid(sub.schoolId);
  await repo.markProvider(chargeId, "test");
  const next = new Date();
  if (sub.period === "year") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  await repo.updateSubscription(sub.id, { status: "active", nextChargeAt: next });
}

/**
 * Кто видит тариф и платит (схема владельца 2026-10-25): администратор школы
 * и репетитор в своём личном пространстве (учитель в пространстве
 * `individual`). Учителя и методисты школы о тарифе не знают.
 */
export async function assertBillingAccess(user: AccessTokenPayload): Promise<void> {
  if (user.role === "admin") return;
  if (user.role === "teacher" && (await repo.getSchoolKind(user.schoolId)) === "individual") return;
  throw new AppError(403, "forbidden", "Тариф и оплата доступны только администратору школы");
}
