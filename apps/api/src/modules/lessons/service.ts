import { randomBytes } from "node:crypto";
import {
  defaultLessonSettings,
  lessonSettingsSchema,
  type AdminCreateLessonRequest,
  type LessonAttendance,
  type LessonAttendanceRow,
  type LessonMaterial,
  type LessonSettings,
  type LessonSummary,
  type UpdateLessonRequest,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as materialsService from "../materials/service.js";
import * as usersService from "../users/service.js";
import * as repo from "./repo.js";

/** 32 случайных байта → 64 hex-символа. Секрет прямой ссылки урока (§1.6 план-ТЗ). */
function mintJoinToken(): string {
  return randomBytes(32).toString("hex");
}

function joinPath(joinToken: string): string {
  return `/j/${joinToken}`;
}

/** `lessons.settings` — внешняя граница (jsonb): парсим схемой, не доверяем форме из БД. */
export function parseLessonSettings(raw: unknown): LessonSettings {
  const parsed = lessonSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultLessonSettings();
}

type LessonRow = NonNullable<Awaited<ReturnType<typeof repo.findLessonById>>>;

function toSummary(row: LessonRow, teacherName: string): LessonSummary {
  return {
    id: row.id,
    title: row.title,
    teacherId: row.teacherId,
    teacherName,
    scheduledAt: row.startsAt ? row.startsAt.toISOString() : null,
    settings: parseLessonSettings(row.settings),
    joinToken: row.joinToken,
    joinPath: joinPath(row.joinToken),
    createdAt: row.startsAt ? row.startsAt.toISOString() : new Date(0).toISOString(),
  };
}

// ─── Чтение, нужное другим модулям (rooms, decks, activities, recordings) ─────

export async function getLesson(schoolId: string, id: string) {
  const lesson = await repo.findLessonById(id, schoolId);
  if (!lesson) throw new AppError(404, "not_found", "Урок не найден");
  return lesson;
}

/**
 * Имя комнаты LiveKit для урока — назначается один раз при первом входе и
 * хранится в lessons.livekit_room (не выводится заново из id при каждом
 * запросе, чтобы Э2.7 мог сопоставлять вебхуки LiveKit с уроком напрямую).
 */
export async function ensureLivekitRoom(schoolId: string, id: string): Promise<string> {
  const lesson = await getLesson(schoolId, id);
  if (lesson.livekitRoom) return lesson.livekitRoom;
  const livekitRoom = `lesson-${id}`;
  const updated = await repo.setLivekitRoomIfEmpty(id, schoolId, livekitRoom);
  return updated?.livekitRoom ?? livekitRoom;
}

/** Для LiveKit-вебхука (Э2.7) — сопоставляет событие с уроком по имени комнаты, без привязки к школе. */
export async function getLessonByLivekitRoom(livekitRoom: string) {
  return repo.findLessonByLivekitRoom(livekitRoom);
}

/**
 * @deprecated Э12.4 — урок постоянный, статус-машины нет. Пока `rooms`
 * зовёт это при первом входе персонала и при авто-завершении пустой
 * комнаты; после перевода `rooms` на новую модель функция уходит вместе
 * с колонкой `lessons.status`.
 */
export async function startLesson(schoolId: string, id: string) {
  const lesson = await getLesson(schoolId, id);
  if (lesson.status === "live") return lesson;
  const row = await repo.updateLessonStatus(id, schoolId, { status: "live", startedAt: new Date() });
  if (!row) throw new AppError(404, "not_found", "Урок не найден");
  return row;
}

/** @deprecated Э12.4 — см. `startLesson`. */
export async function endLesson(schoolId: string, id: string) {
  const lesson = await getLesson(schoolId, id);
  if (lesson.status === "ended") return lesson;
  const row = await repo.updateLessonStatus(id, schoolId, { status: "ended", endedAt: new Date() });
  if (!row) throw new AppError(404, "not_found", "Урок не найден");
  return row;
}

// ─── Гостевой вход: разрешение токена (сам JWT/куки — Э12.4) ──────────────────

/** Публичная инфо-карточка урока по токену (`GET /j/:token`). Ничего лишнего до входа. */
export async function resolveJoinToken(joinToken: string) {
  const lesson = await repo.findLessonByJoinToken(joinToken);
  if (!lesson) throw new AppError(404, "not_found", "Ссылка недействительна");
  return lesson;
}

// ─── Админские операции над уроком ───────────────────────────────────────────

export async function createLesson(
  schoolId: string,
  input: AdminCreateLessonRequest,
): Promise<LessonSummary> {
  const teacher = await usersService.assertTeacher(schoolId, input.teacherId);
  const settings = lessonSettingsSchema.parse(input.settings ?? {});
  const row = await repo.insertLesson({
    schoolId,
    teacherId: input.teacherId,
    title: input.title,
    joinToken: mintJoinToken(),
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    settings,
  });
  return toSummary(row, teacher.fullName);
}

export async function updateLesson(
  schoolId: string,
  id: string,
  input: UpdateLessonRequest,
): Promise<LessonSummary> {
  const current = await getLesson(schoolId, id);
  if (input.teacherId && input.teacherId !== current.teacherId) {
    await usersService.assertTeacher(schoolId, input.teacherId);
  }
  const patch: Parameters<typeof repo.updateLesson>[2] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.teacherId !== undefined) patch.teacherId = input.teacherId;
  if (input.scheduledAt !== undefined && input.scheduledAt !== null) {
    patch.startsAt = new Date(input.scheduledAt);
  }
  if (input.settings !== undefined) {
    patch.settings = lessonSettingsSchema.parse({
      ...parseLessonSettings(current.settings),
      ...input.settings,
    }) as Record<string, unknown>;
  }
  const row = await repo.updateLesson(id, schoolId, patch);
  if (!row) throw new AppError(404, "not_found", "Урок не найден");
  const teacher = await usersService.getUserForAuth(schoolId, row.teacherId);
  return toSummary(row, teacher?.fullName ?? "—");
}

export async function deleteLesson(schoolId: string, id: string): Promise<void> {
  const ok = await repo.deleteLesson(id, schoolId);
  if (!ok) throw new AppError(404, "not_found", "Урок не найден");
}

export async function rotateJoinLink(schoolId: string, id: string) {
  const token = mintJoinToken();
  const row = await repo.setJoinToken(id, schoolId, token);
  if (!row) throw new AppError(404, "not_found", "Урок не найден");
  return { joinToken: token, joinPath: joinPath(token) };
}

/** admin — все уроки школы; teacher — только свои (§1.4 план-ТЗ). */
export async function listLessons(
  schoolId: string,
  requester: { sub: string; role: string },
): Promise<LessonSummary[]> {
  const rows = await repo.listLessons({
    schoolId,
    ownerTeacherId: requester.role === "teacher" ? requester.sub : undefined,
  });
  const names = await usersService.getUserNames(
    schoolId,
    rows.map((r) => r.teacherId),
  );
  return rows.map((r) => toSummary(r, names.get(r.teacherId)?.fullName ?? "—"));
}

export async function getLessonSummary(schoolId: string, id: string): Promise<LessonSummary> {
  const row = await getLesson(schoolId, id);
  const teacher = await usersService.getUserForAuth(schoolId, row.teacherId);
  return toSummary(row, teacher?.fullName ?? "—");
}

// ─── Журнал посещений ───────────────────────────────────────────────────────

export async function getAttendance(schoolId: string, id: string): Promise<LessonAttendance> {
  await getLesson(schoolId, id);
  const rows = await repo.listAttendance(id);
  const userIds = rows.flatMap((r) => (r.userId ? [r.userId] : []));
  const names = await usersService.getUserNames(schoolId, userIds);
  const attendance: LessonAttendanceRow[] = rows.map((r) => {
    const user = r.userId ? names.get(r.userId) : undefined;
    // Э12: до перевода `lesson_participants` на гостевую модель (Э12.4)
    // все строки имеют `user_id`; ученик = роль `student` → `guest`.
    const kind = user && user.role !== "student" ? "staff" : "guest";
    return {
      participantId: r.participantId,
      kind,
      displayName: user?.fullName ?? "Гость",
      userId: r.userId,
      joinedAt: r.joinedAt.toISOString(),
      leftAt: r.leftAt ? r.leftAt.toISOString() : null,
    };
  });
  return { lessonId: id, rows: attendance };
}

// ─── Материалы урока («домашка») ─────────────────────────────────────────────

export async function listLessonMaterials(schoolId: string, id: string): Promise<LessonMaterial[]> {
  await getLesson(schoolId, id);
  const rows = await repo.listLessonMaterialRows(id);
  if (rows.length === 0) return [];
  const [summaries, names] = await Promise.all([
    materialsService.getMaterialSummaries(
      schoolId,
      rows.map((r) => r.materialId),
    ),
    usersService.getUserNames(
      schoolId,
      rows.map((r) => r.assignedBy),
    ),
  ]);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  return rows.flatMap((r) => {
    const material = byId.get(r.materialId);
    if (!material) return []; // материал удалён из библиотеки — строку не показываем
    return [
      {
        id: r.id,
        lessonId: r.lessonId,
        materialId: r.materialId,
        materialTitle: material.title,
        subject: material.subject,
        assignedBy: r.assignedBy,
        assignedByName: names.get(r.assignedBy)?.fullName ?? "—",
        assignedAt: r.assignedAt.toISOString(),
      },
    ];
  });
}

export async function assignLessonMaterial(
  schoolId: string,
  id: string,
  materialId: string,
  assignedBy: string,
): Promise<void> {
  await getLesson(schoolId, id);
  await materialsService.assertMaterialInSchool(schoolId, materialId);
  await repo.insertLessonMaterial({ lessonId: id, materialId, assignedBy });
}

export async function unassignLessonMaterial(
  schoolId: string,
  id: string,
  materialId: string,
): Promise<void> {
  await getLesson(schoolId, id);
  const ok = await repo.deleteLessonMaterial(id, materialId);
  if (!ok) throw new AppError(404, "not_found", "Материал уроку не назначен");
}

/** Id назначенных уроку материалов — для гостевого экрана «материалы урока» (Э12.6). */
export async function getLessonMaterialIds(lessonId: string): Promise<string[]> {
  return repo.findLessonMaterialIds(lessonId);
}
