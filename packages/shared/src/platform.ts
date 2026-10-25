import { z } from "zod";

import { billingPeriodSchema, billingPlanIdSchema } from "./billing.js";
import { roleSchema } from "./roles.js";

/**
 * Раздел «Платформа» для супер-админа (запрос владельца 2026-10-25): все
 * школы, пользователи, платежи и подписки сервиса. Супер-админ — не роль в
 * школе, а список адресов в настройках сервера (`SUPER_ADMIN_EMAILS`); его
 * собственная роль в школе остаётся прежней.
 */
const paymentStatus = z.enum(["pending", "confirmed", "canceled", "chargebacked"]);
const subscriptionStatus = z.enum(["pending", "active", "past_due", "cancelled", "failed"]);

export const platformOverviewSchema = z.object({
  schools: z.number().int(),
  users: z.number().int(),
  paidSchools: z.number().int(),
  activeSubscriptions: z.number().int(),
  revenueRub: z.number().int(),
  revenue30dRub: z.number().int(),
  payments30d: z.number().int(),
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

export const platformSchoolSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  kind: z.string(),
  createdAt: z.string(),
  users: z.number().int(),
  billingPlan: z.string().nullable(),
  paidUntil: z.string().nullable(),
  subscriptionStatus: subscriptionStatus.nullable(),
  /** Э15.4: заблокировано супер-админом. */
  blockedAt: z.string().nullable().default(null),
});
export type PlatformSchool = z.infer<typeof platformSchoolSchema>;

export const platformUserSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  schoolName: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  emailVerified: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PlatformUser = z.infer<typeof platformUserSchema>;

export const platformPaymentSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  schoolName: z.string(),
  userEmail: z.string().nullable(),
  plan: z.string(),
  period: z.string(),
  amountRub: z.number().int(),
  status: paymentStatus,
  recurring: z.boolean(),
  providerTxId: z.string().nullable(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type PlatformPayment = z.infer<typeof platformPaymentSchema>;

export const platformSubscriptionSchema = z.object({
  id: z.string().uuid(),
  plan: z.string(),
  period: z.string(),
  amountRub: z.number().int(),
  status: subscriptionStatus,
  nextChargeAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PlatformSubscription = z.infer<typeof platformSubscriptionSchema>;

export const platformSchoolDetailSchema = z.object({
  school: platformSchoolSchema,
  users: z.array(platformUserSchema),
  payments: z.array(platformPaymentSchema),
  subscriptions: z.array(platformSubscriptionSchema),
});
export type PlatformSchoolDetail = z.infer<typeof platformSchoolDetailSchema>;

/** Ручное включение тарифа (оплата мимо Platega, по договору или в подарок). */
export const platformExtendRequestSchema = z.object({
  plan: billingPlanIdSchema,
  period: billingPeriodSchema,
  count: z.number().int().min(1).max(24),
});
export type PlatformExtendRequest = z.infer<typeof platformExtendRequestSchema>;

export const platformListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** Э15.4: блокировка пространства или аккаунта супер-админом. */
export const platformBlockRequestSchema = z.object({ blocked: z.boolean() });

/** Э15.5: пространство библиотеки «Матиса» — супер-админ входит в него и правит материалы. */
export const platformLibraryResponseSchema = z.object({ schoolId: z.string().uuid() });
export type PlatformLibraryResponse = z.infer<typeof platformLibraryResponseSchema>;
