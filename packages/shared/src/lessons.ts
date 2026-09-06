import { z } from "zod";
import { lessonStatusSchema, participantKindSchema } from "./roles.js";
import { lessonModeSchema } from "./rooms.js";

// ─────────────────────────────────────────────────────────────────────────────
// ДЕЙСТВУЮЩАЯ модель (до Э12) — урок с группой, расписанием и статусом.
// Помечено к удалению в Э12.3 (переработка модуля lessons), пока используется
// бэкендом (`lessons/routes.ts`, `lessons/service.ts`) — держим ради зелёной
// сборки на Э12.1.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Э12.3 — урок создаёт только admin, без группы/предмета/расписания. См. `adminCreateLessonRequestSchema`. */
export const createLessonRequestSchema = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(100),
  groupId: z.string().uuid(),
  teacherId: z.string().uuid(),
  startsAt: z.string().datetime(),
  durationMin: z.number().int().min(5).max(240),
});
export type CreateLessonRequest = z.infer<typeof createLessonRequestSchema>;

export const listLessonsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  teacherId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListLessonsQuery = z.infer<typeof listLessonsQuerySchema>;

/** @deprecated Э12.3 — см. `lessonSummarySchema`. */
export const lessonResponseSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  groupId: z.string().uuid(),
  teacherId: z.string().uuid(),
  title: z.string(),
  subject: z.string(),
  startsAt: z.string(),
  durationMin: z.number(),
  status: lessonStatusSchema,
});
export type LessonResponse = z.infer<typeof lessonResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Э12 — постоянный урок без расписания и статуса (§0, §1.1 план-ТЗ).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Настройки урока (`lessons.settings`, типизированный jsonb — §1.4/Э12.2
 * план-ТЗ). Всё опционально в запросах на правку; при чтении сервер
 * отдаёт объект целиком с дефолтами. Права гостя на уроке (рисовать,
 * камера, экран) выводятся отсюда + из живых грантов учителя.
 */
export const lessonSettingsSchema = z.object({
  /** Медиапрофиль видео по умолчанию при входе в урок (см. `lessonModeSchema`, §5.2 ТЗ). */
  defaultMode: lessonModeSchema.default("lecture"),
  /** Начинать запись автоматически при первом входе персонала. Баннер согласия 152-ФЗ всё равно показывается (Э10.3). */
  autoRecord: z.boolean().default(false),
  /** Ученикам разрешено рисовать на доске без индивидуального гранта учителя. */
  studentsCanDraw: z.boolean().default(false),
  /** Ученики могут публиковать камеру (максимум 360p, §5.2 ТЗ) без индивидуального гранта. */
  studentsCanPublishVideo: z.boolean().default(false),
  /** Ученики могут демонстрировать экран без индивидуального гранта. */
  studentsCanShareScreen: z.boolean().default(false),
});
export type LessonSettings = z.infer<typeof lessonSettingsSchema>;

/** Дефолтные настройки урока — единая точка, чтобы бэк и фронт не расходились. */
export const defaultLessonSettings = (): LessonSettings => lessonSettingsSchema.parse({});

/** Тело `POST /lessons` — только admin (§1.2/§1.4 план-ТЗ). Учитель обязателен, настройки опциональны (мержатся с дефолтами). */
export const adminCreateLessonRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  teacherId: z.string().uuid(),
  /** Плановое время — только метка для сортировки в списке, ничего не гейтит (§1.1 план-ТЗ). */
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  settings: lessonSettingsSchema.partial().optional(),
});
export type AdminCreateLessonRequest = z.infer<typeof adminCreateLessonRequestSchema>;

/** Тело `PATCH /lessons/:id` — имя, учитель, плановое время, настройки; только admin. Пустой запрос допустим (no-op). */
export const updateLessonRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    teacherId: z.string().uuid().optional(),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    settings: lessonSettingsSchema.partial().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Пустой запрос на обновление" });
export type UpdateLessonRequest = z.infer<typeof updateLessonRequestSchema>;

/**
 * Урок в списке/карточке для персонала (`GET /lessons`, `GET /lessons/:id`).
 * `joinToken`/`joinPath` отдаются только staff — по ним админ копирует
 * ссылку ученикам. Гость этой формы не видит никогда.
 */
export const lessonSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  scheduledAt: z.string().nullable(),
  settings: lessonSettingsSchema,
  joinToken: z.string(),
  /** Относительный путь входа (`/j/<token>`) — фронт достраивает до абсолютного URL сам. */
  joinPath: z.string(),
  createdAt: z.string(),
});
export type LessonSummary = z.infer<typeof lessonSummarySchema>;

/** Ответ `POST /lessons/:id/link/rotate` — новый токен, старый мгновенно недействителен (§1.6 план-ТЗ). */
export const rotateLessonLinkResponseSchema = z.object({
  joinToken: z.string(),
  joinPath: z.string(),
});
export type RotateLessonLinkResponse = z.infer<typeof rotateLessonLinkResponseSchema>;

// ─── Журнал посещений (`GET /lessons/:id/attendance`, было `/summary`) ────────

/**
 * Одна строка журнала = один вход участника на урок. Для персонала
 * `userId` заполнен, для гостя `null` (личность = введённое имя + `guestId`).
 * Живёт в пределах урока, между уроками не переносится (§0 план-ТЗ).
 */
export const lessonAttendanceRowSchema = z.object({
  participantId: z.string().uuid(),
  kind: participantKindSchema,
  displayName: z.string(),
  userId: z.string().uuid().nullable(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
});
export type LessonAttendanceRow = z.infer<typeof lessonAttendanceRowSchema>;

export const lessonAttendanceSchema = z.object({
  lessonId: z.string().uuid(),
  rows: z.array(lessonAttendanceRowSchema),
});
export type LessonAttendance = z.infer<typeof lessonAttendanceSchema>;

// ─── Домашка = список материалов урока (§1.3 план-ТЗ) ─────────────────────────

/** Тело `POST /lessons/:id/materials` — назначить уроку материал из библиотеки; только staff. */
export const assignLessonMaterialRequestSchema = z.object({
  materialId: z.string().uuid(),
});
export type AssignLessonMaterialRequest = z.infer<typeof assignLessonMaterialRequestSchema>;

/**
 * Материал, назначенный уроку («домашнее задание» в новой модели — просто
 * список, без сдачи ответов и проверки, §1.3 план-ТЗ). Ученик по ссылке
 * видит эти материалы и проходит их сам.
 */
export const lessonMaterialSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  materialId: z.string().uuid(),
  materialTitle: z.string(),
  subject: z.string(),
  assignedBy: z.string().uuid(),
  assignedByName: z.string(),
  assignedAt: z.string(),
});
export type LessonMaterial = z.infer<typeof lessonMaterialSchema>;
