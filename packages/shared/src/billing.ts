import { z } from "zod";

import { supportContactsSchema } from "./support.js";

/**
 * Тарифы и оплата (запрос владельца 2026-10-25, подключение Platega).
 *
 * Два способа: разовая оплата на месяц или год (продлевает клиент сам) и
 * подписка с автосписанием через СБП (Platega списывает по расписанию).
 * Цены — те же, что на лендинге (`landing/src/sections/Pricing.tsx`); годовая
 * оплата — 10 месяцев вместо 12. Сумму платежа считает сервер по этому
 * каталогу, клиент присылает только тариф и период.
 *
 * Сетка владельца 2026-10-25: объём —
 * ученико-часы в месяц, мягкий потолок (урок не прерывается, сервер их пока не
 * считает); аудитории и учителя в школьных тарифах без ограничений. «Выделенный»
 * (свои серверы школы) — по договору, в каталоге оплаты его нет.
 */
export const billingPlanIdSchema = z.enum(["tutor", "mini", "school", "pro", "network"]);
export type BillingPlanId = z.infer<typeof billingPlanIdSchema>;

export const billingPeriodSchema = z.enum(["month", "year"]);
export type BillingPeriod = z.infer<typeof billingPeriodSchema>;

/**
 * Э15.6 — лимиты тарифа (решение владельца 2026-10-25). `null` — без
 * ограничения. Уже созданные аудитории, участники и записи при снижении
 * лимита не удаляются: лишнее не даёт добавлять новое, а аудитории сверх
 * лимита (по порядку создания) не открываются для уроков.
 */
export interface PlanLimits {
  /** Аудиторий (постоянных комнат уроков) в пространстве; `null` — без ограничения. */
  rooms: number | null;
  /** Участников с ролью учителя; `null` — без ограничения. */
  teachers: number | null;
  /** Участников с ролью методиста; `null` — без ограничения. */
  methodists: number | null;
  /** Учеников одновременно в уроке; `null` — сколько выдерживает сервер (`LESSON_MAX_GUESTS`). */
  studentsPerLesson: number | null;
  /** Часов записи в календарный месяц; 0 — записи нет, `null` — без ограничения. */
  recordingHoursPerMonth: number | null;
  /** Дней хранения новой записи; `null` — по настройке сервера (`RECORDING_RETENTION_DAYS`). */
  recordingRetentionDays: number | null;
  /** Библиотека «Матиса» (Э15.5, docs/roles/spec §6.1). */
  matisLibrary: boolean;
}

/** Пока тариф не оплачен или срок вышел — бесплатный «Старт» (10 ученико-часов в месяц, без записи). */
export const FREE_LIMITS: PlanLimits = {
  rooms: 1,
  teachers: 1,
  methodists: 0,
  studentsPerLesson: 3,
  recordingHoursPerMonth: 0,
  recordingRetentionDays: null,
  matisLibrary: false,
};

/**
 * Пространство «Матис» (`kind: platform`) — не школа и без тарифа: команда
 * Матиса и супер-админ работают в нём без ограничений.
 */
export const PLATFORM_LIMITS: PlanLimits = {
  rooms: null,
  teachers: null,
  methodists: null,
  studentsPerLesson: null,
  recordingHoursPerMonth: null,
  recordingRetentionDays: null,
  matisLibrary: true,
};

export interface BillingPlan {
  id: BillingPlanId;
  name: string;
  tagline: string;
  /** Рублей за месяц при помесячной оплате. */
  monthlyRub: number;
  limits: PlanLimits;
  features: string[];
}

export const BILLING_PLANS: readonly BillingPlan[] = [
  {
    id: "tutor",
    name: "Репетитор",
    tagline: "Один преподаватель: занятия один на один и мини-группы",
    monthlyRub: 790,
    // Аудитория репетитору выдаётся сама (при подтверждении почты и оплате) — создавать он не может.
    limits: { rooms: 1, teachers: 1, methodists: 0, studentsPerLesson: 8, recordingHoursPerMonth: 10, recordingRetentionDays: 30, matisLibrary: true },
    features: [
      "1 учитель, своя аудитория с постоянной ссылкой",
      "300 ученико-часов в месяц, до 8 учеников в уроке",
      "Доска, слайды, задания с автопроверкой",
      "Библиотека материалов",
      "Запись уроков: 10 ч в месяц, хранение 30 дней",
    ],
  },
  {
    id: "mini",
    name: "Мини-школа",
    tagline: "Несколько преподавателей и группы",
    monthlyRub: 2990,
    limits: { rooms: null, teachers: null, methodists: null, studentsPerLesson: 15, recordingHoursPerMonth: 40, recordingRetentionDays: 60, matisLibrary: true },
    features: [
      "Учителя и аудитории без ограничений",
      "1 500 ученико-часов в месяц, до 15 учеников в уроке",
      "Роли: администратор, методист, учитель",
      "Редактор материалов для методистов",
      "Запись уроков: 40 ч в месяц, хранение 60 дней",
    ],
  },
  {
    id: "school",
    name: "Школа",
    tagline: "Онлайн-школа или учебный центр",
    monthlyRub: 8990,
    limits: { rooms: null, teachers: null, methodists: null, studentsPerLesson: 30, recordingHoursPerMonth: 150, recordingRetentionDays: 90, matisLibrary: true },
    features: [
      "Всё из «Мини-школы»",
      "5 000 ученико-часов в месяц, класс до 30 учеников",
      "Запись уроков: 150 ч в месяц, хранение 90 дней",
      "Приоритетная поддержка",
    ],
  },
  {
    id: "pro",
    name: "Школа Про",
    tagline: "Большая школа",
    monthlyRub: 17900,
    limits: { rooms: null, teachers: null, methodists: null, studentsPerLesson: 50, recordingHoursPerMonth: 500, recordingRetentionDays: 180, matisLibrary: true },
    features: [
      "Всё из «Школы»",
      "12 000 ученико-часов в месяц, до 50 учеников в уроке",
      "Запись уроков: 500 ч в месяц, хранение 180 дней",
      "Персональный менеджер",
    ],
  },
  {
    id: "network",
    name: "Сеть",
    tagline: "Крупная школа или несколько филиалов",
    monthlyRub: 59900,
    limits: { rooms: null, teachers: null, methodists: null, studentsPerLesson: 100, recordingHoursPerMonth: 1000, recordingRetentionDays: 365, matisLibrary: true },
    features: [
      "Всё из «Школы Про»",
      "40 000 ученико-часов в месяц, до 100 учеников в уроке",
      "Запись уроков: 1 000 ч в месяц, хранение 365 дней",
      "Свой домен и связка с вашей CRM — настраиваем при подключении",
      "Помощь с переносом материалов и обучением учителей",
    ],
  },
] as const;

/** «Выделенный» — свои серверы школы, по договору; в каталоге оплаты его нет. */
export const DEDICATED_PLAN_FROM_RUB = 129000;

/** Годовая оплата — 10 месяцев вместо 12. */
export const YEAR_MONTHS_CHARGED = 10;

const planLimitsSchema = z.object({
  rooms: z.number().int().nullable(),
  teachers: z.number().int().nullable(),
  methodists: z.number().int().nullable(),
  studentsPerLesson: z.number().int().nullable(),
  recordingHoursPerMonth: z.number().nullable(),
  recordingRetentionDays: z.number().int().nullable(),
  matisLibrary: z.boolean(),
});

export const billingStateSchema = z.object({
  /** Э15.6: лимиты, которые действуют сейчас (оплаченный тариф или бесплатный минимум), и что из них занято. */
  limits: planLimitsSchema,
  usage: z.object({
    rooms: z.number().int(),
    teachers: z.number().int(),
    methodists: z.number().int(),
    recordingHoursThisMonth: z.number(),
  }),
  /** Оплаченный тариф; null — ещё не платили. */
  plan: billingPlanIdSchema.nullable(),
  /** До какого момента оплачено (ISO); null — не оплачено. */
  paidUntil: z.string().nullable(),
  /** Платёжная система подключена (иначе кнопка «Оплатить» показывает заглушку). */
  paymentsEnabled: z.boolean(),
  /** Тестовый режим: вместо Platega — своя тестовая форма, деньги не списываются. */
  testMode: z.boolean(),
  /** Контакты поддержки по виду пространства: репетитору — только Telegram. */
  support: supportContactsSchema,
  /** Подписка с автосписанием через СБП; null — не оформляли или она закончилась. */
  subscription: z
    .object({
      status: z.enum(["pending", "active", "past_due", "cancelled", "failed"]),
      plan: billingPlanIdSchema,
      period: billingPeriodSchema,
      amountRub: z.number().int(),
      nextChargeAt: z.string().nullable(),
    })
    .nullable(),
  /** Последний платёж школы — для экрана после возврата с платёжной формы. */
  lastPayment: z
    .object({
      id: z.string().uuid(),
      status: z.enum(["pending", "confirmed", "canceled", "chargebacked"]),
      plan: billingPlanIdSchema,
      period: billingPeriodSchema,
      amountRub: z.number().int(),
      createdAt: z.string(),
    })
    .nullable(),
});
export type BillingState = z.infer<typeof billingStateSchema>;

export const checkoutRequestSchema = z.object({
  plan: billingPlanIdSchema,
  period: billingPeriodSchema,
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const checkoutResponseSchema = z.object({
  /** Платёжная форма Platega. */
  url: z.string().url(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

/**
 * Подписка с автосписанием через СБП. Согласие на автоплатежи — отдельное и
 * явное (галочка не стоит заранее), без него сервер подписку не создаёт.
 */
export const subscribeRequestSchema = z.object({
  plan: billingPlanIdSchema,
  period: billingPeriodSchema,
  autopayConsent: z.literal(true),
});
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

/**
 * Callback Platega (docs.platega.io): разовый платёж, списание по подписке
 * (есть `subscriptionId`) или смена статуса подписки (`SUBSCRIPTION_*`).
 * Platega присылает поля то с маленькой, то с большой буквы — сервер
 * приводит первую букву к маленькой до разбора.
 */
export const plategaCallbackSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum([
    "PENDING",
    "CONFIRMED",
    "CANCELED",
    "CHARGEBACKED",
    "SUBSCRIPTION_ACTIVATED",
    "SUBSCRIPTION_PAST_DUE",
    "SUBSCRIPTION_CANCELLED",
    "SUBSCRIPTION_FAILED",
  ]),
  paymentMethod: z.number().optional(),
  payload: z.string().optional().nullable(),
  subscriptionId: z.string().optional().nullable(),
  nextChargeAt: z.string().optional().nullable(),
});
export type PlategaCallback = z.infer<typeof plategaCallbackSchema>;

/** Тестовая форма оплаты (BILLING_TEST_MODE): что оплачиваем. */
export const testPaymentInfoSchema = z.object({
  kind: z.enum(["payment", "subscription"]),
  id: z.string().uuid(),
  plan: billingPlanIdSchema,
  period: billingPeriodSchema,
  amountRub: z.number().int(),
  status: z.string(),
});
export type TestPaymentInfo = z.infer<typeof testPaymentInfoSchema>;

export const testPaymentCompleteSchema = z.object({
  kind: z.enum(["payment", "subscription"]),
  id: z.string().uuid(),
  result: z.enum(["success", "fail"]),
});
export type TestPaymentComplete = z.infer<typeof testPaymentCompleteSchema>;
