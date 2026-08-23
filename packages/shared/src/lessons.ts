import { z } from "zod";
import { lessonStatusSchema } from "./roles.js";

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
