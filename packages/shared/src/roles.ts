import { z } from "zod";

export const roleSchema = z.enum(["admin", "methodist", "teacher", "student"]);
export type Role = z.infer<typeof roleSchema>;

export const lessonStatusSchema = z.enum(["scheduled", "live", "ended", "cancelled"]);
export type LessonStatus = z.infer<typeof lessonStatusSchema>;
