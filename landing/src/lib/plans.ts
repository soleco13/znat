/**
 * Тарифы — копия каталога оплаты `packages/shared/src/billing.ts`
 * (`BILLING_PLANS`, `FREE_LIMITS`, `DEDICATED_PLAN_FROM_RUB`,
 * `YEAR_MONTHS_CHARGED`): лендинг собирается отдельно и общий пакет не
 * подключает. Меняете цены или лимиты там — поменяйте и здесь.
 *
 * Ученико-часы — объём тарифа из сетки владельца (2026-10-25). Сервер их пока
 * не считает и урок по ним не прерывает, поэтому на сайте это «объём», а не
 * жёсткий лимит.
 */
export type PlanId = "start" | "tutor" | "mini" | "school" | "pro" | "network";

export type Plan = {
  id: PlanId;
  name: string;
  /** Кому подходит. */
  forWhom: string;
  /** Рублей в месяц при помесячной оплате; 0 — бесплатно. */
  monthly: number;
  hours: number;
  studentsPerLesson: number;
  /** `null` — без ограничения. */
  teachers: number | null;
  rooms: number | null;
  methodists: boolean;
  /** Часов записи в месяц; 0 — записи нет. */
  recordingHours: number;
  /** Дней хранения записи. */
  retentionDays: number | null;
  library: boolean;
  /** Чем тариф отличается от предыдущего — одна строка. */
  extra: string | null;
};

export const PLANS: Plan[] = [
  {
    id: "start",
    name: "Старт",
    forWhom: "Попробовать на паре учеников",
    monthly: 0,
    hours: 10,
    studentsPerLesson: 3,
    teachers: 1,
    rooms: 1,
    methodists: false,
    recordingHours: 0,
    retentionDays: null,
    library: false,
    extra: null,
  },
  {
    id: "tutor",
    name: "Репетитор",
    forWhom: "Один преподаватель: занятия один на один и мини-группы",
    monthly: 790,
    hours: 300,
    studentsPerLesson: 8,
    teachers: 1,
    rooms: 1,
    methodists: false,
    recordingHours: 10,
    retentionDays: 30,
    library: true,
    extra: "Своя аудитория с постоянной ссылкой",
  },
  {
    id: "mini",
    name: "Мини-школа",
    forWhom: "Несколько преподавателей и группы",
    monthly: 2990,
    hours: 1500,
    studentsPerLesson: 15,
    teachers: null,
    rooms: null,
    methodists: true,
    recordingHours: 40,
    retentionDays: 60,
    library: true,
    extra: "Роли: администратор, методист, учитель",
  },
  {
    id: "school",
    name: "Школа",
    forWhom: "Онлайн-школа или учебный центр",
    monthly: 8990,
    hours: 5000,
    studentsPerLesson: 30,
    teachers: null,
    rooms: null,
    methodists: true,
    recordingHours: 150,
    retentionDays: 90,
    library: true,
    extra: "Успеваемость по каждому классу и ученику",
  },
  {
    id: "pro",
    name: "Школа Про",
    forWhom: "Большая школа",
    monthly: 17900,
    hours: 12000,
    studentsPerLesson: 50,
    teachers: null,
    rooms: null,
    methodists: true,
    recordingHours: 500,
    retentionDays: 180,
    library: true,
    extra: "Персональный менеджер",
  },
  {
    id: "network",
    name: "Сеть",
    forWhom: "Крупная школа или несколько филиалов",
    monthly: 59900,
    hours: 40000,
    studentsPerLesson: 100,
    teachers: null,
    rooms: null,
    methodists: true,
    recordingHours: 1000,
    retentionDays: 365,
    library: true,
    extra: "Свой домен и связка с вашей CRM",
  },
];

/** «Выделенный» — свои серверы школы, по договору; онлайн-оплаты нет. */
export const DEDICATED_FROM = 129000;

/** Годовая оплата — 10 месяцев вместо 12. */
export const YEAR_MONTHS_CHARGED = 10;

const nf = new Intl.NumberFormat("ru-RU");
export const rub = (n: number) => `${nf.format(n)} ₽`;
export const num = (n: number) => nf.format(n);
