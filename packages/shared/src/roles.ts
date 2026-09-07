import { z } from "zod";

/**
 * Э12: учётная запись есть только у персонала. Ученик — не роль, а участник
 * урока (`participantKindSchema` → `guest`), вошедший по ссылке с введённым
 * именем; роль `student` удалена вместе с группами и аккаунтами учеников.
 */
export const roleSchema = z.enum(["admin", "methodist", "teacher"]);
export type Role = z.infer<typeof roleSchema>;

/**
 * Э12 (§1.3 план-ТЗ) — вид участника урока в новой модели доступа. Права на
 * уроке привязаны к этому, а не к `Role`: `staff` — учитель/админ/методист
 * с аккаунтом, `guest` — ученик, вошедший по ссылке с введённым именем.
 */
export const participantKindSchema = z.enum(["staff", "guest"]);
export type ParticipantKind = z.infer<typeof participantKindSchema>;
