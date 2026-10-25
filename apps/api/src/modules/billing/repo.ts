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
  provider?: string;
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

/* ---------- Раздел «Платформа» супер-админа ---------- */

export async function listSchoolsWithBilling(schoolId?: string) {
  return db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      kind: schools.kind,
      createdAt: schools.createdAt,
      billingPlan: schools.billingPlan,
      paidUntil: schools.paidUntil,
      blockedAt: schools.blockedAt,
      subscriptionStatus: sql<string | null>`(
        select s.status from ${subscriptions} s
        where s.school_id = ${schools.id} and s.status in ('pending','active','past_due')
        order by s.created_at desc limit 1)`,
    })
    .from(schools)
    .where(schoolId ? eq(schools.id, schoolId) : undefined)
    .orderBy(desc(schools.createdAt));
}

export async function listPayments(input: { schoolId?: string; limit: number }) {
  return db
    .select({
      id: payments.id,
      schoolId: payments.schoolId,
      schoolName: schools.name,
      userId: payments.userId,
      plan: payments.plan,
      period: payments.period,
      amountRub: payments.amountRub,
      status: payments.status,
      provider: payments.provider,
      subscriptionId: payments.subscriptionId,
      providerTxId: payments.providerTxId,
      createdAt: payments.createdAt,
      confirmedAt: payments.confirmedAt,
    })
    .from(payments)
    .innerJoin(schools, eq(schools.id, payments.schoolId))
    .where(input.schoolId ? eq(payments.schoolId, input.schoolId) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(input.limit);
}

export async function listSubscriptions(schoolId: string) {
  return db.select().from(subscriptions).where(eq(subscriptions.schoolId, schoolId)).orderBy(desc(subscriptions.createdAt));
}

export async function overviewTotals() {
  const result = await db.execute<{
    schools: number;
    paid_schools: number;
    active_subs: number;
    revenue: number;
    revenue_30d: number;
    payments_30d: number;
  }>(sql`
    select
      (select count(*) from ${schools} where kind <> 'platform')::int as schools,
      (select count(*) from ${schools} where paid_until > now())::int as paid_schools,
      (select count(*) from ${subscriptions} where status = 'active')::int as active_subs,
      (select coalesce(sum(amount_rub), 0) from ${payments} where status = 'confirmed' and provider = 'platega')::int as revenue,
      (select coalesce(sum(amount_rub), 0) from ${payments} where status = 'confirmed' and provider = 'platega' and confirmed_at > now() - interval '30 days')::int as revenue_30d,
      (select count(*) from ${payments} where status = 'confirmed' and provider = 'platega' and confirmed_at > now() - interval '30 days')::int as payments_30d
  `);
  return result.rows[0]!;
}

/** Ручное включение тарифа: продление школы и запись в истории платежей (provider `manual`, 0 ₽). */
export async function manualExtend(input: { schoolId: string; userId: string; plan: string; period: string; interval: string }) {
  return db.transaction(async (tx) => {
    await tx.insert(payments).values({
      schoolId: input.schoolId,
      userId: input.userId,
      plan: input.plan,
      period: input.period,
      amountRub: 0,
      status: "confirmed",
      provider: "manual",
      confirmedAt: new Date(),
    });
    const [school] = await tx
      .update(schools)
      .set({
        billingPlan: input.plan,
        paidUntil: sql`greatest(coalesce(${schools.paidUntil}, now()), now()) + ${input.interval}::interval`,
      })
      .where(eq(schools.id, input.schoolId))
      .returning({ id: schools.id });
    return school ?? null;
  });
}

export async function findPayment(id: string) {
  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return row ?? null;
}

export async function findSubscription(id: string) {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  return row ?? null;
}

/** Тестовое списание по подписке: та же запись, что от Platega, но provider = 'test'. */
export async function markProvider(paymentProviderTxId: string, provider: string) {
  await db.update(payments).set({ provider }).where(eq(payments.providerTxId, paymentProviderTxId));
}

export async function getSchoolKind(schoolId: string): Promise<string | null> {
  const [row] = await db.select({ kind: schools.kind }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return row?.kind ?? null;
}
