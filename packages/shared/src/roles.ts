import { z } from "zod";

export const roleSchema = z.enum(["admin", "methodist", "teacher", "student"]);
export type Role = z.infer<typeof roleSchema>;

/**
 * Э12 (§1.3 план-ТЗ) — вид участника урока в новой модели доступа. Права на
 * уроке привязаны к этому, а не к `Role`: `staff` — учитель/админ/методист
 * с аккаунтом, `guest` — ученик, вошедший по ссылке с введённым именем.
 */
export const participantKindSchema = z.enum(["staff", "guest"]);
export type ParticipantKind = z.infer<typeof participantKindSchema>;
