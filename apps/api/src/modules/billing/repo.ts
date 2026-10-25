import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { payments, schools, subscriptions } from "../../db/schema.js";

export async function getSchoolBilling(schoolId: string) {
  const [row] = await db
    .select({ billingPlan: schools.billingPlan, paidUntil: schools.paidUntil })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  return row ?? null;
}

export async function lastPayment(schoolId: string) {
  const [row] = await db
    .select()
    .from(payments)
    .where(eq(payments.schoolId, schoolId))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row ?? null;
}

export async function insertPayment(input: {
  schoolId: string;
  userId: string;
  plan: string;
  period: string;
  amountRub: number;
}) {
  const [row] = await db.insert(payments).values(input).returning();
  return row!;
}

export async function setProviderTxId(paymentId: string, providerTxId: string) {
  await db.update(payments).set({ providerTxId }).where(eq(payments.id, paymentId));
}

export async function findPaymentByProviderTxId(providerTxId: string) {
  const [row] = await db.select().from(payments).where(eq(payments.providerTxId, providerTxId)).limit(1);
  return row ?? null;
}

/**
 * Подтверждение оплаты: платёж из `pending` в `confirmed` и продление школы —
 * одной транзакцией. Повторный callback (Platega повторяет до 3 раз) ничего
 * не продлевает второй раз: обновляется только строка в статусе `pending`.
 */
export async function confirmPayment(paymentId: string, extend: "1 month" | "1 year") {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .update(payments)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
      .returning();
    if (!p) return null;
    const [school] = await tx
      .update(schools)
      .set({
        billingPlan: p.plan,
        paidUntil: sql`greatest(coalesce(${schools.paidUntil}, now()), now()) + ${extend}::interval`,
      })
      .where(eq(schools.id, p.schoolId))
      .returning({ paidUntil: schools.paidUntil });
    return { payment: p, paidUntil: school?.paidUntil ?? null };
  });
}

export async function setPaymentStatus(paymentId: string, status: "canceled" | "chargebacked") {
  await db.update(payments).set({ status }).where(eq(payments.id, paymentId));
}

/** Действующая или ожидающая привязки подписка школы (последняя по времени). */
export async function currentSubscription(schoolId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.schoolId, schoolId), inArray(subscriptions.status, ["pending", "active", "past_due"])))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function insertSubscription(input: {
  schoolId: string;
  userId: string;
  plan: string;
  period: string;
  amountRub: number;
}) {
  const [row] = await db.insert(subscriptions).values(input).returning();
  return row!;
}

export async function setSubscriptionProviderId(id: string, providerSubId: string) {
  await db.update(subscriptions).set({ providerSubId }).where(eq(subscriptions.id, id));
}

export async function findSubscriptionByProviderId(providerSubId: string) {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubId, providerSubId)).limit(1);
  return row ?? null;
}

export async function updateSubscription(
  id: string,
  patch: { status?: "pending" | "active" | "past_due" | "cancelled" | "failed"; nextChargeAt?: Date | null },
) {
  await db.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.id, id));
}

/**
 * Списание по подписке: новая строка `payments` (ID списания у Platega
 * уникален, повтор callback ничего не добавит) и продление школы — одной
 * транзакцией.
 */
export async function recordSubscriptionCharge(input: {
  subscription: { id: string; schoolId: string; userId: string | null; plan: string; period: string; amountRub: number };
  providerTxId: string;
}) {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(payments)
      .values({
        schoolId: input.subscription.schoolId,
        userId: input.subscription.userId,
        plan: input.subscription.plan,
        period: input.subscription.period,
        amountRub: input.subscription.amountRub,
        status: "confirmed",
        confirmedAt: new Date(),
        providerTxId: input.providerTxId,
        subscriptionId: input.subscription.id,
      })
      .onConflictDoNothing({ target: payments.providerTxId })
      .returning();
    if (!p) return null;
    const extend = input.subscription.period === "year" ? "1 year" : "1 month";
    await tx
      .update(schools)
      .set({
        billingPlan: p.plan,
        paidUntil: sql`greatest(coalesce(${schools.paidUntil}, now()), now()) + ${extend}::interval`,
      })
      .where(eq(schools.id, p.schoolId));
    return p;
  });
}
