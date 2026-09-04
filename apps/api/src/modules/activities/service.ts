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
  type ActivityProgress,
  type StudentProgress,
  type ActivityAnalytics,
  type QuestionAnalytics,
  type QuestionResponse,
  type ActivityReview,
  type StartReviewResult,
  type ReviewQuestionResponses,
  type ReviewStudentResponse,
  type PushAnswerToBoardRequest,
} from "@school/shared";
import { buildDistribution, formatResponseText } from "./analytics.js";
import { AppError } from "../../plugins/errors.js";
import { redis } from "../../db/redis.js";
import * as lessonsService from "../lessons/service.js";
import * as usersService from "../users/service.js";
import * as materialsService from "../materials/service.js";
import * as roomsService from "../rooms/service.js";
import * as canvasService from "../canvas/service.js";
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
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
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

function attemptStartKey(attemptId: string): string {
  return `activity:attempt-start:${attemptId}`;
}

/** Момент старта попытки — точка отсчёта таймера. Пишется один раз (NX), переживает перезагрузку; потеря Redis = таймер стартует заново (deadline в БД абсолютный, не страдает). */
async function ensureAttemptStart(attemptId: string): Promise<string> {
  const key = attemptStartKey(attemptId);
  const now = new Date().toISOString();
  await redis.set(key, now, "EX", ATTEMPT_START_TTL_SECONDS, "NX");
  const stored = await redis.get(key);
  return stored ?? now;
}

/** «Застрял» — открыл задание, но не сохранял ответ дольше этого срока и ответил не на все вопросы (§7.3 ТЗ). */
const STUCK_AFTER_MS = 3 * 60 * 1000;

/**
 * Живая картина класса по заданию (Э8.8, §7.3 ТЗ) — учителю. Не пуш, а
 * опрос: учитель тянет этот эндпоинт раз в несколько секунд (панель
 * прогресса), точности «раз в 3-5 сек» для класса достаточно, а пуш на
 * каждое сохранение каждого ученика — лишний трафик по WS-каналу урока.
 */
export async function getProgress(
  user: AccessTokenPayload,
  activityId: string,
): Promise<ActivityProgress> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  const lesson = await assertLessonTeacher(user, activity.lessonId);

  const [roster, stats, loaded] = await Promise.all([
    usersService.listGroupStudents(lesson.groupId),
    repo.answeredStatsByActivity(activityId),
    materialsService.getMaterialVersion(activity.materialVersionId),
  ]);
  const total = loaded.material.blocks.filter((b) => b.type === "question").length;
  const statByUser = new Map(stats.map((s) => [s.userId, s]));

  const opened = await openedUserIds(
    activityId,
    roster.map((r) => r.id),
  );

  const now = Date.now();
  const students: StudentProgress[] = roster.map((r) => {
    const s = statByUser.get(r.id);
    const answered = s?.answered ?? 0;
    const lastAt = s?.lastAt ?? null;
    const hasStarted = answered > 0 || opened.has(r.id);

    let status: StudentProgress["status"];
    if (!hasStarted) {
      status = "not_started";
    } else if (
      answered < total &&
      lastAt !== null &&
      now - new Date(lastAt).getTime() > STUCK_AFTER_MS
    ) {
      status = "stuck";
    } else {
      status = "in_progress";
    }

    return {
      userId: r.id,
      fullName: r.fullName,
      status,
      answered,
      total,
      lastActivityAt: lastAt ? new Date(lastAt).toISOString() : null,
    };
  });

  return { activityId, total, students };
}

/**
 * Агрегированная аналитика по вопросам задания (Э8.9, §7.3 ТЗ) — учителю.
 * Тоже опрос, не пуш (как Э8.8). `interaction` берётся ПОЛНЫМ (с ключом
 * ответа): аналитику видит только учитель, подсветка верного варианта —
 * весь смысл разбора («сразу разобрать ошибку»).
 */
export async function getAnalytics(
  user: AccessTokenPayload,
  activityId: string,
): Promise<ActivityAnalytics> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  await assertLessonTeacher(user, activity.lessonId);

  const [loaded, rows] = await Promise.all([
    materialsService.getMaterialVersion(activity.materialVersionId),
    repo.listResponsesByActivity(activityId),
  ]);

  const byQuestion = new Map<string, QuestionResponse[]>();
  for (const r of rows) {
    const list = byQuestion.get(r.questionId) ?? [];
    list.push(r.response);
    byQuestion.set(r.questionId, list);
  }

  const respondents = new Set(rows.map((r) => r.userId)).size;
  const questions: QuestionAnalytics[] = [];
  for (const block of loaded.material.blocks) {
    if (block.type !== "question") continue;
    // Рассинхронизацию type (saveResponse её не пускает, но БД могла быть
    // заполнена иначе) молча отсекаем — движок проверки на ней бросил бы.
    const answers = (byQuestion.get(block.id) ?? []).filter(
      (r) => r.type === block.interaction.type,
    );
    questions.push({
      questionId: block.id,
      promptHtml: block.prompt.html,
      interactionType: block.interaction.type,
      totalAnswered: answers.length,
      distribution: buildDistribution(block.interaction, answers),
    });
  }

  return { activityId, respondents, questions };
}

// ─── Разбор (Э8.10, §7.3 ТЗ: «показать правильный ответ всем, вынести
// чей-то ответ на доску») ────────────────────────────────────────────────

/**
 * Учитель начинает разбор — с этого момента `GET /activities/:id/review`
 * отдаёт ПОЛНЫЙ материал (с ключами ответов) и ученикам тоже. До этого
 * вызова тот же эндпоинт отвечает 409 — идемпотентно (`repo.markReviewed`
 * не двигает уже выставленный `reviewedAt`), поэтому повторный клик
 * учителя (например, после перезагрузки страницы) безопасен.
 */
export async function startReview(user: AccessTokenPayload, activityId: string): Promise<StartReviewResult> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  await assertLessonTeacher(user, activity.lessonId);

  const reviewedAt = await repo.markReviewed(activityId);

  // Сигнал «начался разбор» — по WS-каналу урока, тем же путём, что
  // activity_started (Э8.6): сам материал ученик заберёт отдельным HTTP-
  // запросом (см. getReview ниже), это только пуш «обнови экран».
  roomsService.broadcastToLesson(activity.lessonId, { type: "activity_reviewed", activityId });

  return { activityId, reviewedAt: reviewedAt.toISOString() };
}

/**
 * Полный материал (с ключами ответов) — и ученику, и учителю, но только
 * когда разбор уже начат (`reviewedAt` не `null`). До этого — 409: та же
 * граница «ключи ответов не текут раньше времени», что и `stripMaterialAnswerKeys`
 * в `getMyActivity`, просто с другой стороны — здесь как раз момент, когда
 * их МОЖНО показывать.
 */
export async function getReview(user: AccessTokenPayload, activityId: string): Promise<ActivityReview> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  await assertLessonMember(user, activity.lessonId);
  if (!activity.reviewedAt) {
    throw new AppError(409, "not_reviewed", "Разбор ещё не начат");
  }

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  return { activityId, reviewedAt: activity.reviewedAt.toISOString(), material: loaded.material };
}

/**
 * Ответы класса на один вопрос, с именами — учителю, для выбора «чей ответ
 * вынести на доску». Тоже гейтится `reviewedAt`: раскрывать чужие ответы
 * поимённо раньше явного начала разбора не нужно (аналитика Э8.9 уже даёт
 * агрегат без привязки к ученику до этого момента).
 */
export async function getReviewResponses(
  user: AccessTokenPayload,
  activityId: string,
  questionId: string,
): Promise<ReviewQuestionResponses> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  const lesson = await assertLessonTeacher(user, activity.lessonId);
  if (!activity.reviewedAt) {
    throw new AppError(409, "not_reviewed", "Разбор ещё не начат");
  }

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  const question = findQuestion(loaded.material, questionId);
  if (!question) {
    throw new AppError(404, "question_not_found", "Вопрос не найден в материале");
  }

  const [roster, rows] = await Promise.all([
    usersService.listGroupStudents(lesson.groupId),
    repo.listResponsesByActivity(activityId),
  ]);
  const byUser = new Map(
    rows.filter((r) => r.questionId === questionId && r.response.type === question.interaction.type).map((r) => [r.userId, r.response]),
  );

  const responses: ReviewStudentResponse[] = [];
  for (const student of roster) {
    const response = byUser.get(student.id);
    if (response) responses.push({ userId: student.id, fullName: student.fullName, response });
  }

  return { questionId, responses };
}

/**
 * Учитель выносит ответ ОДНОГО ученика на доску урока (§7.3 ТЗ: «анонимно
 * или с именем») — дописывает текстовый элемент в Y.Doc холста через
 * `canvasService.postAnswerToBoard` (единственная точка входа модуля
 * `canvas`, правило модульности CLAUDE.md). Гейтится `reviewedAt` тем же
 * образом, что `getReviewResponses` — раскрывать чужой ответ на общей доске
 * можно только начиная с явного разбора.
 */
export async function pushAnswerToBoard(
  user: AccessTokenPayload,
  activityId: string,
  input: PushAnswerToBoardRequest,
): Promise<void> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "Задание не привязано к уроку");
  }
  const lesson = await assertLessonTeacher(user, activity.lessonId);
  if (!activity.reviewedAt) {
    throw new AppError(409, "not_reviewed", "Разбор ещё не начат");
  }

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  const question = findQuestion(loaded.material, input.questionId);
  if (!question) {
    throw new AppError(404, "question_not_found", "Вопрос не найден в материале");
  }

  const rows = await repo.listResponsesByActivity(activityId);
  const responseRow = rows.find(
    (r) => r.questionId === input.questionId && r.userId === input.userId && r.response.type === question.interaction.type,
  );
  if (!responseRow) {
    throw new AppError(404, "response_not_found", "У этого ученика нет ответа на этот вопрос");
  }

  let label = "Ответ ученика";
  if (!input.anonymous) {
    const roster = await usersService.listGroupStudents(lesson.groupId);
    const student = roster.find((s) => s.id === input.userId);
    label = student ? student.fullName : label;
  }

  const answerText = formatResponseText(question.interaction, responseRow.response);
  await canvasService.postAnswerToBoard(activity.lessonId, `${label}:\n${answerText}`);
}

/** Кто из перечисленных учеников уже открывал задание (метка старта попытки в Redis). */
async function openedUserIds(activityId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const keys = userIds.map((uid) => attemptStartKey(deriveAttemptId(activityId, uid, 1)));
  const values = await redis.mget(keys);
  const opened = new Set<string>();
  userIds.forEach((uid, i) => {
    if (values[i] != null) opened.add(uid);
  });
  return opened;
}
