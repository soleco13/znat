import type {
  AccessTokenPayload,
  PlatformExtendRequest,
  PlatformOverview,
  PlatformPayment,
  PlatformSchool,
  PlatformSchoolDetail,
  PlatformUser,
} from "@school/shared";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as authService from "../auth/service.js";
import * as billingService from "../billing/service.js";
import * as schoolSettingsService from "../school-settings/service.js";
import { invalidateBlocklist } from "../../plugins/blocklist.js";
import * as usersService from "../users/service.js";

/**
 * Раздел «Платформа» (запрос владельца 2026-10-25): супер-админ видит все
 * школы, пользователей, платежи и подписки. Супер-админ — адрес из
 * `SUPER_ADMIN_EMAILS`; проверяется по почте пользователя в базе на каждом
 * запросе, а не по токену, — убрал адрес из настроек, и доступ закрыт сразу.
 */
export async function isSuperAdmin(user: AccessTokenPayload): Promise<boolean> {
  if (!env.SUPER_ADMIN_EMAILS.length || user.lessonScope) return false;
  // Э15.4: супер-админ может открыть чужое пространство — проверяем аккаунт, не членство в текущем.
  const email = (await usersService.emailsByIds([user.sub])).get(user.sub);
  return Boolean(email && env.SUPER_ADMIN_EMAILS.includes(email.toLowerCase()));
}

export async function requireSuperAdmin(user: AccessTokenPayload): Promise<void> {
  if (!(await isSuperAdmin(user))) throw new AppError(403, "forbidden", "Раздел доступен только администратору сервиса");
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function overview(): Promise<PlatformOverview> {
  const [t, counts] = await Promise.all([billingService.overviewTotals(), usersService.countUsersBySchool()]);
  return {
    schools: t.schools,
    users: [...counts.values()].reduce((a, b) => a + b, 0),
    paidSchools: t.paid_schools,
    activeSubscriptions: t.active_subs,
    revenueRub: t.revenue,
    revenue30dRub: t.revenue_30d,
    payments30d: t.payments_30d,
  };
}

async function schoolsWithCounts(schoolId?: string): Promise<PlatformSchool[]> {
  const [rows, counts] = await Promise.all([billingService.listSchoolsWithBilling(schoolId), usersService.countUsersBySchool()]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    kind: r.kind,
    createdAt: r.createdAt.toISOString(),
    users: counts.get(r.id) ?? 0,
    billingPlan: r.billingPlan,
    paidUntil: iso(r.paidUntil),
    subscriptionStatus: (r.subscriptionStatus as PlatformSchool["subscriptionStatus"]) ?? null,
    blockedAt: iso(r.blockedAt),
  }));
}

export const listSchools = () => schoolsWithCounts();

export async function listUsers(input: { q?: string; schoolId?: string; limit: number }): Promise<PlatformUser[]> {
  const [rows, schools] = await Promise.all([usersService.listAllUsers(input), billingService.listSchoolsWithBilling()]);
  const names = new Map(schools.map((s) => [s.id, s.name]));
  return rows.map((u) => ({
    id: u.id,
    schoolId: u.schoolId,
    schoolName: names.get(u.schoolId) ?? "—",
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    emailVerified: Boolean(u.emailVerifiedAt),
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  }));
}

export async function listPayments(input: { schoolId?: string; limit: number }): Promise<PlatformPayment[]> {
  const rows = await billingService.listPayments(input);
  const emails = await usersService.emailsByIds(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)));
  return rows.map((p) => ({
    id: p.id,
    schoolId: p.schoolId,
    schoolName: p.schoolName,
    userEmail: p.userId ? (emails.get(p.userId) ?? null) : null,
    plan: p.plan,
    period: p.period,
    amountRub: p.amountRub,
    status: p.status,
    recurring: Boolean(p.subscriptionId),
    providerTxId: p.provider === "manual" ? "вручную" : p.providerTxId,
    createdAt: p.createdAt.toISOString(),
    confirmedAt: iso(p.confirmedAt),
  }));
}

export async function schoolDetail(schoolId: string): Promise<PlatformSchoolDetail> {
  const [school] = await schoolsWithCounts(schoolId);
  if (!school) throw new AppError(404, "not_found", "Школа не найдена");
  const [users, payments, subs] = await Promise.all([
    listUsers({ schoolId, limit: 500 }),
    listPayments({ schoolId, limit: 500 }),
    billingService.listSubscriptions(schoolId),
  ]);
  return {
    school,
    users,
    payments,
    subscriptions: subs.map((s) => ({
      id: s.id,
      plan: s.plan,
      period: s.period,
      amountRub: s.amountRub,
      status: s.status,
      nextChargeAt: iso(s.nextChargeAt),
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export async function extend(user: AccessTokenPayload, schoolId: string, req: PlatformExtendRequest): Promise<void> {
  await billingService.manualExtend({ schoolId, byUserId: user.sub, plan: req.plan, period: req.period, count: req.count });
}

/**
 * Э15.4 — блокировка пространства: участники и гости не входят, данные
 * сохраняются; супер-админ продолжает видеть пространство.
 */
export async function blockSchool(schoolId: string, blocked: boolean): Promise<void> {
  if (!(await schoolSettingsService.setSchoolBlocked(schoolId, blocked))) {
    throw new AppError(404, "not_found", "Пространство не найдено");
  }
  invalidateBlocklist();
}

/** Э15.4 — блокировка аккаунта во всех пространствах; сессии отзываются. Себя заблокировать нельзя. */
export async function blockUser(actor: AccessTokenPayload, userId: string, blocked: boolean): Promise<void> {
  if (blocked && userId === actor.sub) throw new AppError(409, "cannot_block_self", "Нельзя заблокировать собственный аккаунт");
  if (!(await usersService.setAccountActive(userId, !blocked))) throw new AppError(404, "not_found", "Пользователь не найден");
  if (blocked) await authService.revokeAllSessions(userId);
  invalidateBlocklist();
}
