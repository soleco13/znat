/**
 * Выдача заданий (Э8.6, §7.3/§8 ТЗ). Единственный экспорт модуля.
 *
 * **Задание уходит каждому ученику индивидуально, не через Y.Doc урока**
 * (DoD Э8.6: «ученик не видит ответы соседа»). `POST /lessons/:id/activities`
 * заводит строку `activities` и шлёт в WS-канал урока (модуль `rooms`, не
 * Yjs) короткий сигнал `activity_started`. Дальше каждый клиент сам зовёт
 * `GET /activities/:id/my` — получает свою копию материала БЕЗ ключей
 * ответов (`stripMaterialAnswerKeys`, Э8.1), со своим `attemptId` и своим
 * порядком перемешанных вариантов. Черновики ответов (Э8.7) пишутся в
 * `responses` по `attemptId` — пересечься с чужими нечем.
 *
 * Область «логика прав доступа» (§ «Что не делегировать вслепую» CLAUDE.md)
 * — `assertLessonTeacher`/`assertLessonMember` ниже читать построчно.
 */
import { createHash } from "node:crypto";
import {
  stripMaterialAnswerKeys,
  type AccessTokenPayload,
  type ActivityDto,
  type ActivityMode,
  type CreateActivityRequest,
  type Material,
  type MyActivity,
  type SaveResponseRequest,
  type SaveResponseResult,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { redis } from "../../db/redis.js";
import * as lessonsService from "../lessons/service.js";
import * as usersService from "../users/service.js";
import * as materialsService from "../materials/service.js";
import * as roomsService from "../rooms/service.js";
import * as repo from "./repo.js";
import type { ActivityRow } from "./repo.js";

/** Namespace для name-based UUID (RFC 4122 §4.3) — привязка `attemptId` к тройке (активность, ученик, номер попытки). */
const ATTEMPT_NAMESPACE = "a1e4d2c7-3b8f-4e6a-9d0c-5f7b1a2e8c34";

/** TTL метки старта попытки в Redis — «кеш, который можно потерять» (§ Железные правила): при потере таймер стартует заново, абсолютный `deadline` в БД от этого не страдает. */
const ATTEMPT_START_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Детерминированный UUID v5 (SHA-1) — один и тот же `attemptId` для одной
 * тройки (activityId, userId, attemptNumber) без отдельной таблицы `attempts`
 * (Э8.2 сознательно её не завёл). Стабильность важна: `attemptId` — сид
 * перемешивания вариантов (Э8.1), перезагрузка страницы посреди попытки не
 * должна менять порядок ответов под рукой у ученика.
 */
export function deriveAttemptId(activityId: string, userId: string, attemptNumber: number): string {
  const ns = Buffer.from(ATTEMPT_NAMESPACE.replace(/-/g, ""), "hex");
  const name = `${activityId}:${userId}:${attemptNumber}`;
  const h = createHash("sha1").update(ns).update(name, "utf8").digest();
  const b = Buffer.alloc(16);
  h.copy(b, 0, 0, 16);
  b.writeUInt8((b.readUInt8(6) & 0x0f) | 0x50, 6); // версия 5
  b.writeUInt8((b.readUInt8(8) & 0x3f) | 0x80, 8); // вариант RFC 4122
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toDto(row: ActivityRow): ActivityDto {
  return {
    id: row.id,
    lessonId: row.lessonId,
    materialId: row.materialId,
    materialVersion: row.materialVersion,
    mode: row.mode,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    timerSeconds: row.timerSeconds,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Управлять заданиями урока может только его учитель или админ. Читать построчно. */
async function assertLessonTeacher(user: AccessTokenPayload, lessonId: string) {
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);
  if (user.role === "admin") return lesson;
  if (user.role === "teacher" && lesson.teacherId === user.sub) return lesson;
  throw new AppError(403, "forbidden", "Запускать задания в уроке может только его учитель");
}

/** В уроке участвует: админ, учитель-хозяин, ученик из группы урока. Читать построчно. */
async function assertLessonMember(user: AccessTokenPayload, lessonId: string) {
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);
  if (user.role === "admin") return lesson;
  if (user.role === "teacher") {
    if (lesson.teacherId !== user.sub) {
      throw new AppError(403, "forbidden", "Вы не ведёте этот урок");
    }
    return lesson;
  }
  if (user.role === "student") {
    const isMember = await usersService.isGroupMember(lesson.groupId, user.sub);
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в группе этого урока");
    }
    return lesson;
  }
  throw new AppError(403, "forbidden", "Роль не допускается к участию в уроке");
}

export async function createActivity(
  user: AccessTokenPayload,
  lessonId: string,
  input: CreateActivityRequest,
): Promise<ActivityDto> {
  const lesson = await assertLessonTeacher(user, lessonId);
  if (lesson.status === "ended") {
    throw new AppError(409, "lesson_ended", "Урок уже завершён — задание не выдать");
  }

  // Закрепляем ИМЕННО ту версию, что учитель видит сейчас (Э8.2): разбор и
  // пересчёт баллов после публикации новой версии (Э9.8) должны сверяться
  // с тем содержимым, которое реально увидит ученик.
  const loaded = await materialsService.getLatestMaterial(user.schoolId, input.materialId);

  const mode: ActivityMode = input.mode;
  const deadline = input.deadline ? new Date(input.deadline) : null;
  if (deadline && Number.isNaN(deadline.getTime())) {
    throw new AppError(400, "bad_deadline", "Некорректный дедлайн");
  }

  const id = await repo.insertActivity({
    materialVersionId: loaded.versionId,
    lessonId,
    mode,
    assignedBy: user.sub,
    deadline,
    timerSeconds: input.timerSeconds ?? null,
  });

  const row = await repo.findActivityById(id);
  if (!row) throw new AppError(500, "activity_lost", "Активность не найдена сразу после создания");

  // Сигнал «откройте задание» — по WS-каналу урока, НЕ через Y.Doc. Сам
  // материал и ответы этот канал не переносит (см. докстринг файла).
  roomsService.broadcastToLesson(lessonId, { type: "activity_started", activityId: id });

  return toDto(row);
}

export async function listLessonActivities(
  user: AccessTokenPayload,
  lessonId: string,
): Promise<ActivityDto[]> {
  await assertLessonMember(user, lessonId);
  const rows = await repo.listActivitiesByLesson(lessonId);
  return rows.map(toDto);
}

async function loadActivityForSchool(activityId: string, schoolId: string): Promise<ActivityRow> {
  const row = await repo.findActivityById(activityId);
  // Чужая школа — отвечаем 404, а не 403: существование активности другой школы наружу не подтверждаем.
  if (!row || row.schoolId !== schoolId) {
    throw new AppError(404, "activity_not_found", "Задание не найдено");
  }
  return row;
}

/**
 * Индивидуальная копия задания для ОДНОГО ученика — своя на попытку, без
 * ключей ответов. Возвращает и ранее сохранённые черновики этой же попытки
 * (Э8.7), чтобы перезагрузка страницы не теряла ответы.
 */
export async function getMyActivity(
  user: AccessTokenPayload,
  activityId: string,
): Promise<MyActivity> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    // «Домашняя работа» вне урока — Э8.11, ещё не сделана.
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  await assertLessonMember(user, activity.lessonId);

  const { attemptNumber, attemptId } = await resolveAttempt(activityId, user.sub);

  const startedAt = await ensureAttemptStart(attemptId);

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  const publicMaterial = stripMaterialAnswerKeys(loaded.material, attemptId);

  const saved = await repo.findResponsesByAttempt(attemptId);
  const savedResponses: MyActivity["savedResponses"] = {};
  for (const r of saved) savedResponses[r.questionId] = r.response;

  return {
    activityId,
    attemptId,
    attemptNumber,
    mode: activity.mode,
    deadline: activity.deadline ? activity.deadline.toISOString() : null,
    timerSeconds: activity.timerSeconds,
    startedAt,
    material: publicMaterial,
    savedResponses,
  };
}

/**
 * Текущая попытка ученика по активности. `attemptNumber` = наибольший
 * существующий или 1; `submit` (Э8.10+) заведёт следующую при повторных
 * попытках (`attemptsAllowed`). Один и тот же результат у `getMyActivity`
 * и `saveResponse` — черновик пишется в ту же попытку, что отдаётся плееру.
 */
async function resolveAttempt(
  activityId: string,
  userId: string,
): Promise<{ attemptNumber: number; attemptId: string }> {
  const attemptNumber = Math.max(await repo.maxAttemptNumber(activityId, userId), 1);
  return { attemptNumber, attemptId: deriveAttemptId(activityId, userId, attemptNumber) };
}

function findQuestion(material: Material, questionId: string) {
  for (const block of material.blocks) {
    if (block.type === "question" && block.id === questionId) return block;
  }
  return null;
}

/**
 * Автосохранение черновика одного ответа (Э8.7, §8 ТЗ). DoD: «обрыв связи не
 * теряет ответы» — идемпотентный upsert по `(attemptId, questionId)`,
 * клиент шлёт раз в ~5 сек и при потере фокуса/выгрузке вкладки.
 *
 * Черновик НЕ оценивается (движок Э8.3 — на сабмите). Тип ответа сверяется
 * с типом взаимодействия вопроса по ЗАКРЕПЛЁННОЙ версии материала — плеер не
 * может подсунуть ответ не того типа, а `gradeResponse` (Э8.3) бросил бы на
 * таком рассогласовании.
 */
export async function saveResponse(
  user: AccessTokenPayload,
  activityId: string,
  input: SaveResponseRequest,
): Promise<SaveResponseResult> {
  if (user.role !== "student") {
    throw new AppError(403, "forbidden", "Сохранять ответы может только ученик");
  }
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  await assertLessonMember(user, activity.lessonId);

  if (activity.deadline && activity.deadline.getTime() < Date.now()) {
    throw new AppError(409, "deadline_passed", "Дедлайн прошёл — ответы больше не принимаются");
  }

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  const question = findQuestion(loaded.material, input.questionId);
  if (!question) {
    throw new AppError(404, "question_not_found", "Вопрос не найден в материале");
  }
  if (question.interaction.type !== input.response.type) {
    throw new AppError(
      400,
      "response_type_mismatch",
      `Тип ответа (${input.response.type}) не соответствует типу вопроса (${question.interaction.type})`,
    );
  }

  const { attemptNumber, attemptId } = await resolveAttempt(activityId, user.sub);
  await ensureAttemptStart(attemptId);

  const savedAt = await repo.upsertDraftResponse({
    attemptId,
    activityId,
    materialId: activity.materialId,
    lessonId: activity.lessonId,
    userId: user.sub,
    questionId: input.questionId,
    response: input.response,
    attemptNumber,
    timeSpentMs: input.timeSpentMs ?? 0,
  });

  return { saved: true, savedAt: savedAt.toISOString() };
}

/** Момент старта попытки — точка отсчёта таймера. Пишется один раз (NX), переживает перезагрузку; потеря Redis = таймер стартует заново (deadline в БД абсолютный, не страдает). */
async function ensureAttemptStart(attemptId: string): Promise<string> {
  const key = `activity:attempt-start:${attemptId}`;
  const now = new Date().toISOString();
  await redis.set(key, now, "EX", ATTEMPT_START_TTL_SECONDS, "NX");
  const stored = await redis.get(key);
  return stored ?? now;
}
