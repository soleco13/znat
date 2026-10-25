import { z } from "zod";

/**
 * Тарифы и оплата (запрос владельца 2026-10-25, подключение Platega).
 *
 * Два способа: разовая оплата на месяц или год (продлевает клиент сам) и
 * подписка с автосписанием через СБП (Platega списывает по расписанию).
 * Цены — те же, что на лендинге (`landing/src/sections/Pricing.tsx`); годовая
 * оплата — 10 месяцев вместо 12. Сумму платежа считает сервер по этому
 * каталогу, клиент присылает только тариф и период.
 */
export const billingPlanIdSchema = z.enum(["tutor", "school"]);
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
  /** Библиотека «Матиса» (Э15.5, docs/roles/spec §6.1). */
  matisLibrary: boolean;
}

/** Пока тариф не оплачен или срок вышел — бесплатный минимум. */
export const FREE_LIMITS: PlanLimits = {
  rooms: 1,
  teachers: 1,
  methodists: 0,
  studentsPerLesson: 6,
  recordingHoursPerMonth: 0,
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
    tagline: "Индивидуальные занятия и мини-группы",
    monthlyRub: 990,
    // Аудитория репетитору выдаётся сама (при подтверждении почты и оплате) — создавать он не может.
    limits: { rooms: 1, teachers: 1, methodists: 0, studentsPerLesson: 6, recordingHoursPerMonth: 20, matisLibrary: true },
    features: [
      "1 учитель и 1 аудитория, до 6 учеников в уроке",
      "Видеоуроки, доска, слайды, задания",
      "Библиотека материалов",
      "Запись урока (до 20 ч в месяц)",
      "Вход учеников по ссылке",
    ],
  },
  {
    id: "school",
    name: "Школа",
    tagline: "Для онлайн-школы или учебного центра",
    monthlyRub: 6900,
    limits: { rooms: 15, teachers: 15, methodists: null, studentsPerLesson: 30, recordingHoursPerMonth: null, matisLibrary: true },
    features: [
      "До 15 учителей и 15 аудиторий, класс до 30 учеников",
      "Всё из «Репетитора»",
      "Методисты без ограничения, редактор материалов",
      "Запись без лимита минут",
      "Роли: администратор, методист, учитель",
    ],
  },
] as const;

/** Годовая оплата — 10 месяцев вместо 12. */
export const YEAR_MONTHS_CHARGED = 10;

const planLimitsSchema = z.object({
  rooms: z.number().int().nullable(),
  teachers: z.number().int().nullable(),
  methodists: z.number().int().nullable(),
  studentsPerLesson: z.number().int().nullable(),
  recordingHoursPerMonth: z.number().nullable(),
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
  supportEmail: z.string(),
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
