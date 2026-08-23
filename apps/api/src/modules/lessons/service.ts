import type { CreateLessonRequest, ListLessonsQuery } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { getGroupOrThrow, getUserForAuth } from "../users/service.js";
import * as repo from "./repo.js";

export async function createLesson(schoolId: string, input: CreateLessonRequest) {
  await getGroupOrThrow(schoolId, input.groupId);

  const teacher = await getUserForAuth(schoolId, input.teacherId);
  if (!teacher || teacher.role !== "teacher") {
    throw new AppError(400, "invalid_teacher", "Указанный пользователь не является учителем");
  }

  return repo.insertLesson({
    schoolId,
    groupId: input.groupId,
    teacherId: input.teacherId,
    title: input.title,
    subject: input.subject,
    startsAt: new Date(input.startsAt),
    durationMin: input.durationMin,
  });
}

export async function getLesson(schoolId: string, id: string) {
  const lesson = await repo.findLessonById(id, schoolId);
  if (!lesson) {
    throw new AppError(404, "not_found", "Урок не найден");
  }
  return lesson;
}

export async function listLessons(schoolId: string, query: ListLessonsQuery) {
  return repo.listLessons({
    schoolId,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
    teacherId: query.teacherId,
    page: query.page,
    pageSize: query.pageSize,
  });
}

/** Идемпотентно переводит урок в live — вызывается при первом входе в комнату. */
export async function startLesson(schoolId: string, id: string) {
  const lesson = await getLesson(schoolId, id);
  if (lesson.status === "live") return lesson;
  if (lesson.status !== "scheduled") {
    throw new AppError(409, "invalid_lesson_status", "Урок нельзя начать из текущего статуса");
  }
  const row = await repo.updateLessonStatus(id, schoolId, { status: "live", startedAt: new Date() });
  if (!row) throw new AppError(404, "not_found", "Урок не найден");
  return row;
}

/** Идемпотентно завершает урок — вызывается учителем вручную или по таймауту пустой комнаты. */
export async function endLesson(schoolId: string, id: string) {
  const lesson = await getLesson(schoolId, id);
  if (lesson.status === "ended") return lesson;
  if (lesson.status !== "live") {
    throw new AppError(409, "invalid_lesson_status", "Урок нельзя завершить из текущего статуса");
  }
  const row = await repo.updateLessonStatus(id, schoolId, { status: "ended", endedAt: new Date() });
  if (!row) throw new AppError(404, "not_found", "Урок не найден");
  return row;
}
