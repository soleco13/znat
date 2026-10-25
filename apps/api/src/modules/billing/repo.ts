import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { payments, schools } from "../../db/schema.js";

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
