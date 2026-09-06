/**
 * Выдача заданий (Э8.6/8.11, §7.3/§8 ТЗ). Единственный экспорт модуля.
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
 * **Домашняя работа (Э8.11, `POST /groups/:id/activities`)** — та же самая
 * механика, БЕЗ урока: `lessonId` в БД `null`, доступ определяется
 * группой (`activity.groupId`, заполнено для обоих режимов) и тем, кто
 * выдал (`activity.assignedBy`) — см. `assertActivityMember`/
 * `assertActivityOwner` ниже, они обобщают `assertLessonMember`/
 * `assertLessonTeacher` на оба режима везде, кроме доски (Э8.10): у
 * домашки нет урока — и нет общей доски, `pushAnswerToBoard` ей
 * недоступен принципиально.
 *
 * Область «логика прав доступа» (§ «Что не делегировать вслепую» CLAUDE.md)
 * — `assertLessonTeacher`/`assertLessonMember`/`assertActivityOwner`/
 * `assertActivityMember` ниже читать построчно.
 */
import { createHash } from "node:crypto";
import {
  stripMaterialAnswerKeys,
  type AccessTokenPayload,
  type ActivityDto,
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
  type SubmitActivityResult,
  type SubmitFeedbackItem,
  type GradingQueueItem,
  type GradeManualResponseRequest,
  type GradeManualResponseResult,
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
    groupId: row.groupId,
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
    // Э12: у уроков новой модели группы нет (`groupId === null`) — ученик
    // на них попадает гостевым путём (Э12.4), не через эту проверку.
    const isMember =
      lesson.groupId !== null && (await usersService.isGroupMember(lesson.groupId, user.sub));
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в группе этого урока");
    }
    return lesson;
  }
  throw new AppError(403, "forbidden", "Роль не допускается к участию в уроке");
}

/**
 * Управлять УЖЕ СУЩЕСТВУЮЩЕЙ активностью (Э8.11) — обобщение
 * `assertLessonTeacher` на оба режима. `lesson`-выдача: учитель урока (тот
 * же критерий, что и раньше). `homework`-выдача (нет `lessonId`): тот, кто
 * её выдал (`activity.assignedBy`) — у группы нет собственного «хозяина»
 * (в отличие от урока — `lessons.teacherId`), поэтому единственная точка
 * владения домашней работой — кто именно её создал. Читать построчно.
 */
async function assertActivityOwner(user: AccessTokenPayload, activity: ActivityRow): Promise<void> {
  if (user.role === "admin") return;
  if (activity.lessonId) {
    const lesson = await lessonsService.getLesson(user.schoolId, activity.lessonId);
    if (user.role === "teacher" && lesson.teacherId === user.sub) return;
    throw new AppError(403, "forbidden", "Управлять заданием урока может только его учитель");
  }
  if (user.role === "teacher" && activity.assignedBy === user.sub) return;
  throw new AppError(403, "forbidden", "Управлять этой домашней работой может только тот, кто её выдал");
}

/**
 * Участвует в этой активности (Э8.11) — обобщение `assertLessonMember` на
 * оба режима: админ и владелец (`assertActivityOwner`) допускаются всегда,
 * ученик — если состоит в `activity.groupId` (заполнено для ОБОИХ режимов,
 * см. докстринг `activities.groupId` в схеме БД — для `lesson`-выдачи это
 * копия `lessons.groupId`, снятая на момент запуска). Читать построчно.
 */
async function assertActivityMember(user: AccessTokenPayload, activity: ActivityRow): Promise<void> {
  if (user.role === "student") {
    const isMember = await usersService.isGroupMember(activity.groupId, user.sub);
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в группе этого задания");
    }
    return;
  }
  await assertActivityOwner(user, activity);
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
  if (!lesson.groupId) {
    // Э12: интерактивные задания на уроках новой модели репойнтятся с
    // группы на участника (`lesson_participants`) в Э12.5 — до этого
    // момента их можно запускать только в legacy-уроках с группой.
    throw new AppError(
      409,
      "lesson_activities_pending",
      "Задания на уроке этого типа появятся после Э12.5",
    );
  }

  // Закрепляем ИМЕННО ту версию, что учитель видит сейчас (Э8.2): разбор и
  // пересчёт баллов после публикации новой версии (Э9.8) должны сверяться
  // с тем содержимым, которое реально увидит ученик.
  const loaded = await materialsService.getLatestMaterial(user.schoolId, input.materialId);

  const deadline = input.deadline ? new Date(input.deadline) : null;
  if (deadline && Number.isNaN(deadline.getTime())) {
    throw new AppError(400, "bad_deadline", "Некорректный дедлайн");
  }

  const id = await repo.insertActivity({
    materialVersionId: loaded.versionId,
    lessonId,
    // Денормализованная копия — см. докстринг `activities.groupId`
    // (Э8.11): не FK-переход через lessons на каждое чтение, а снятая на
    // момент запуска группа урока.
    groupId: lesson.groupId,
    // `mode` из тела запроса ИГНОРИРУЕТСЯ — этот роут только для
    // lesson-выдачи, режим определяет URL (см. докстринг
    // `createActivityRequestSchema` в packages/shared).
    mode: "lesson",
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

/**
 * Домашняя работа (Э8.11, §7.3/§8 ТЗ, DoD «ученик заходит и делает») —
 * то же самое задание, что и в уроке, но БЕЗ урока: адресовано группе
 * напрямую, доступно в любой момент, не только пока урок идёт. Любой
 * учитель/админ школы может задать домашку любой группе своей школы — у
 * групп нет собственного «хозяина»-учителя (в отличие от урока), значит и
 * права на СОЗДАНИЕ здесь по школе, а не по владению группой; кто именно
 * выдал — фиксируется `assignedBy` и решает дальнейшее владение
 * (`assertActivityOwner`).
 *
 * `mode` из тела запроса ИГНОРИРУЕТСЯ — сюда всегда пишется `"homework"`
 * (см. докстринг `createActivityRequestSchema`, тот же приём, что и в
 * `createActivity` выше для `"lesson"`).
 */
export async function createHomeworkActivity(
  user: AccessTokenPayload,
  groupId: string,
  input: CreateActivityRequest,
): Promise<ActivityDto> {
  if (user.role !== "teacher" && user.role !== "admin") {
    throw new AppError(403, "forbidden", "Задавать домашнюю работу может только учитель");
  }
  await usersService.getGroupOrThrow(user.schoolId, groupId);

  const loaded = await materialsService.getLatestMaterial(user.schoolId, input.materialId);

  const deadline = input.deadline ? new Date(input.deadline) : null;
  if (deadline && Number.isNaN(deadline.getTime())) {
    throw new AppError(400, "bad_deadline", "Некорректный дедлайн");
  }

  const id = await repo.insertActivity({
    materialVersionId: loaded.versionId,
    lessonId: null,
    groupId,
    mode: "homework",
    assignedBy: user.sub,
    deadline,
    timerSeconds: input.timerSeconds ?? null,
  });

  const row = await repo.findActivityById(id);
  if (!row) throw new AppError(500, "activity_lost", "Активность не найдена сразу после создания");

  return toDto(row);
}

/**
 * Список домашних заданий группы (Э8.11) — учителю/админу школы (видят все
 * домашки группы, не только свои — тот же принцип школьного, а не личного
 * доступа, что и создание) либо ученику из этой группы (видит свои).
 */
export async function listGroupActivities(
  user: AccessTokenPayload,
  groupId: string,
): Promise<ActivityDto[]> {
  await usersService.getGroupOrThrow(user.schoolId, groupId);
  if (user.role === "student") {
    const isMember = await usersService.isGroupMember(groupId, user.sub);
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в этой группе");
    }
  } else if (user.role !== "teacher" && user.role !== "admin") {
    throw new AppError(403, "forbidden", "Роль не допускается к списку домашних заданий");
  }
  const rows = await repo.listHomeworkActivitiesByGroup(groupId);
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
 * (Э8.7), чтобы перезагрузка страницы не теряла ответы. Работает
 * одинаково для `lesson`- и `homework`-выдачи (Э8.11) — единственное, что
 * отличало домашку от задания урока, было жёсткое требование `lessonId`
 * здесь; `assertActivityMember` проверяет членство по `activity.groupId`
 * без похода к самому уроку.
 */
export async function getMyActivity(
  user: AccessTokenPayload,
  activityId: string,
): Promise<MyActivity> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  await assertActivityMember(user, activity);

  const { attemptNumber, attemptId } = await resolveAttempt(activityId, user.sub);

  const startedAt = await ensureAttemptStart(attemptId);

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  const publicMaterial = stripMaterialAnswerKeys(loaded.material, attemptId);

  const saved = await repo.findResponsesByAttempt(attemptId);
  const savedResponses: MyActivity["savedResponses"] = {};
  for (const r of saved) savedResponses[r.questionId] = r.response;

  const submittedAt = await repo.attemptSubmittedAt(attemptId);

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
    submittedAt: submittedAt ? submittedAt.toISOString() : null,
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
  await assertActivityMember(user, activity);

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
  if (await repo.attemptSubmittedAt(attemptId)) {
    throw new AppError(409, "already_submitted", "Работа уже сдана — ответы больше нельзя менять");
  }
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
  await assertActivityOwner(user, activity);

  const [roster, stats, loaded] = await Promise.all([
    usersService.listGroupStudents(activity.groupId),
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
  await assertActivityOwner(user, activity);

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
 * учителя (например, после перезагрузки страницы) безопасен. Работает и
 * для домашней работы (Э8.11) — WS-сигнал `activity_reviewed` шлётся,
 * только если это выдача В УРОКЕ (`activity.lessonId` есть): у домашки нет
 * живого канала, куда его слать, ученик просто увидит разбор при
 * следующем заходе на `GET /activities/:id/review`.
 */
export async function startReview(user: AccessTokenPayload, activityId: string): Promise<StartReviewResult> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  await assertActivityOwner(user, activity);

  const reviewedAt = await repo.markReviewed(activityId);

  if (activity.lessonId) {
    // Сигнал «начался разбор» — по WS-каналу урока, тем же путём, что
    // activity_started (Э8.6): сам материал ученик заберёт отдельным
    // HTTP-запросом (см. getReview ниже), это только пуш «обнови экран».
    roomsService.broadcastToLesson(activity.lessonId, { type: "activity_reviewed", activityId });
  }

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
  await assertActivityMember(user, activity);
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
  await assertActivityOwner(user, activity);
  if (!activity.reviewedAt) {
    throw new AppError(409, "not_reviewed", "Разбор ещё не начат");
  }

  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);
  const question = findQuestion(loaded.material, questionId);
  if (!question) {
    throw new AppError(404, "question_not_found", "Вопрос не найден в материале");
  }

  const [roster, rows] = await Promise.all([
    usersService.listGroupStudents(activity.groupId),
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
 * можно только начиная с явного разбора. У домашней работы (Э8.11) нет
 * урока и, значит, нет общей доски — это ЕДИНСТВЕННОЕ место во всём
 * разборе, которое домашке недоступно принципиально, а не по нехватке прав.
 */
export async function pushAnswerToBoard(
  user: AccessTokenPayload,
  activityId: string,
  input: PushAnswerToBoardRequest,
): Promise<void> {
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  await assertActivityOwner(user, activity);
  if (!activity.lessonId) {
    throw new AppError(409, "activity_not_in_lesson", "У домашней работы нет общей доски — вынести ответ некуда");
  }
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
    const roster = await usersService.listGroupStudents(activity.groupId);
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

// ─── Сабмит (Э8.12, §8 ТЗ: `POST /activities/:id/submit`) ─────────────────

/** Пустой ответ своего типа — вопрос, на который ученик вообще не сохранил черновик, идёт через ТОТ ЖЕ движок проверки, что и отвеченный (см. докстринг `submitActivity`), а не отдельную ветку «нет ответа». */
function emptyResponseFor(type: QuestionResponse["type"]): QuestionResponse {
  switch (type) {
    case "single_choice":
      return { type, selectedOptionId: null };
    case "multiple_choice":
      return { type, selectedOptionIds: [] };
    case "true_false":
      return { type, value: null };
    case "text_input":
      return { type, value: "" };
    case "numeric_input":
      return { type, value: null };
    case "open_answer":
      return { type, text: "", attachmentIds: [] };
    case "cloze_dropdown":
      return { type, values: {} };
    case "cloze_text":
      return { type, values: {} };
    case "matching":
      return { type, pairs: [] };
    case "ordering":
      return { type, order: [] };
  }
}

/**
 * Сдать текущую попытку (§8 ТЗ: `POST /activities/:id/submit → { score,
 * maxScore, feedback[] }`). Единственное место, которое реально ЗАПИСЫВАЕТ
 * результат движка проверки (Э8.3) в БД — `getAnalytics` (Э8.9) тоже зовёт
 * `gradeResponse`, но только для агрегатов, ничего не сохраняя.
 *
 * Идемпотентна: повторный вызов пересчитывает автопроверяемые вопросы
 * (детерминированно — тот же материал, тот же ответ, тот же результат) и
 * НЕ трогает уже выставленную учителем ручную оценку (гарантия —
 * `repo.upsertGradedResponse`, читать её докстринг). После первого успешного
 * вызова `saveResponse` (Э8.7) отказывает — попытка зафиксирована.
 *
 * `score`/`maxScore` в ответе считают ТОЛЬКО автопроверяемые вопросы —
 * `settings.showFeedback` (когда его когда-либо доделают) здесь не
 * учитывается: этот пробел уже существовал в `stripQuestionBlockAnswerKey`
 * (Э8.1) и `MaterialPlayer`/`ReviewPanel` (Э8.6/8.10) до Э8.12, не заводится
 * заново — вне рамок стоп-листа этого этапа.
 */
export async function submitActivity(user: AccessTokenPayload, activityId: string): Promise<SubmitActivityResult> {
  if (user.role !== "student") {
    throw new AppError(403, "forbidden", "Сдавать работу может только ученик");
  }
  const activity = await loadActivityForSchool(activityId, user.schoolId);
  await assertActivityMember(user, activity);

  if (activity.deadline && activity.deadline.getTime() < Date.now()) {
    throw new AppError(409, "deadline_passed", "Дедлайн прошёл — сдать работу больше нельзя");
  }

  const { attemptNumber, attemptId } = await resolveAttempt(activityId, user.sub);
  const loaded = await materialsService.getMaterialVersion(activity.materialVersionId);

  const saved = await repo.findResponsesByAttempt(attemptId);
  const savedByQuestion = new Map(saved.map((r) => [r.questionId, r.response]));

  const feedback: SubmitFeedbackItem[] = [];
  let score = 0;
  let maxScore = 0;

  for (const block of loaded.material.blocks) {
    if (block.type !== "question") continue;

    const existing = savedByQuestion.get(block.id);
    const response =
      existing && existing.type === block.interaction.type ? existing : emptyResponseFor(block.interaction.type);

    const result = materialsService.gradeResponse(block.interaction, response, block.points);

    await repo.upsertGradedResponse({
      attemptId,
      activityId,
      materialId: activity.materialId,
      lessonId: activity.lessonId,
      userId: user.sub,
      questionId: block.id,
      response,
      attemptNumber,
      result,
    });

    feedback.push({
      questionId: block.id,
      score: result.autoGraded ? result.score : 0,
      maxScore: result.maxScore,
      correct: result.correct,
      autoGraded: result.autoGraded,
    });
    maxScore += result.maxScore;
    if (result.autoGraded) score += result.score;
  }

  return { attemptId, score, maxScore, feedback };
}

// ─── Ручная проверка (Э8.12, §6.4/§8 ТЗ: «попадает в очередь учителя с
// рубрикой») ─────────────────────────────────────────────────────────────

/**
 * Очередь ручной проверки — учителю/админу. `submitted = true, autoGraded =
 * false, gradedBy IS NULL` (`repo.listPendingManualGrading`) после сабмита
 * однозначно означает `open_answer` (Э8.3: единственный тип, где движок
 * возвращает `autoGraded: false`) — черновики (`submitted = false`) сюда не
 * попадают, ученик ещё печатает. Учитель видит только то, что сам выдал
 * (`assignedBy`, тот же критерий владения, что и у остальных ручек, — см.
 * `repo.listPendingManualGrading`), админ — всю школу.
 */
export async function getGradingQueue(user: AccessTokenPayload): Promise<GradingQueueItem[]> {
  if (user.role !== "teacher" && user.role !== "admin") {
    throw new AppError(403, "forbidden", "Очередь ручной проверки доступна только учителю");
  }
  const rows = await repo.listPendingManualGrading(user.schoolId, user.role === "teacher" ? user.sub : null);

  const materialCache = new Map<string, Awaited<ReturnType<typeof materialsService.getMaterialVersion>>>();
  const items: GradingQueueItem[] = [];
  for (const row of rows) {
    let loaded = materialCache.get(row.materialVersionId);
    if (!loaded) {
      loaded = await materialsService.getMaterialVersion(row.materialVersionId);
      materialCache.set(row.materialVersionId, loaded);
    }
    const question = findQuestion(loaded.material, row.questionId);
    // Рассинхронизацию (вопрос удалён из версии, чужой тип ответа) молча пропускаем — та же защита, что в getAnalytics.
    if (!question || question.interaction.type !== "open_answer" || row.response.type !== "open_answer") continue;

    items.push({
      responseId: row.responseId,
      activityId: row.activityId,
      activityMode: row.activityMode,
      materialTitle: loaded.material.title,
      questionId: row.questionId,
      promptHtml: question.prompt.html,
      rubric: question.interaction.rubric,
      maxScore: question.points,
      studentId: row.studentId,
      studentName: row.studentFullName,
      response: { text: row.response.text, attachmentIds: row.response.attachmentIds },
      submittedAt: row.submittedAt.toISOString(),
    });
  }
  return items;
}

/**
 * Учитель ставит баллы за `open_answer` (§8 ТЗ: `POST /grading/:responseId
 * { score, rubricScores, comment }`). `rubricScores` сверяется с реальной
 * рубрикой вопроса (закреплённая версия материала — та же, что видел
 * ученик), `score` не обязан буквально совпадать с суммой отмеченных
 * критериев (§6.4 ТЗ «ручная проверка» — рубрика ориентир, не формула).
 * Атомарная защита от повторной/гонки-проверки — в `repo.persistManualGrade`
 * (`WHERE graded_by IS NULL`), эта проверка здесь — только для быстрого и
 * понятного сообщения об ошибке.
 */
export async function gradeManualResponse(
  user: AccessTokenPayload,
  responseId: string,
  input: GradeManualResponseRequest,
): Promise<GradeManualResponseResult> {
  if (user.role !== "teacher" && user.role !== "admin") {
    throw new AppError(403, "forbidden", "Проверять ответы может только учитель");
  }
  const target = await repo.findResponseForGrading(responseId);
  if (!target || target.schoolId !== user.schoolId) {
    throw new AppError(404, "response_not_found", "Ответ не найден");
  }
  if (user.role === "teacher" && target.assignedBy !== user.sub) {
    throw new AppError(403, "forbidden", "Проверять этот ответ может только тот, кто выдал задание");
  }
  if (!target.submitted || target.autoGraded) {
    throw new AppError(409, "not_pending_manual_grading", "Этот ответ не ждёт ручной проверки");
  }
  if (target.gradedBy) {
    throw new AppError(409, "already_graded", "Этот ответ уже проверен");
  }

  const loaded = await materialsService.getMaterialVersion(target.materialVersionId);
  const question = findQuestion(loaded.material, target.questionId);
  if (!question || question.interaction.type !== "open_answer") {
    throw new AppError(500, "not_open_answer", "Вопрос не является заданием с ручной проверкой");
  }

  const criteriaIds = new Set(question.interaction.rubric.map((c) => c.id));
  for (const id of Object.keys(input.rubricScores)) {
    if (!criteriaIds.has(id)) {
      throw new AppError(400, "unknown_rubric_criterion", `Критерий "${id}" не найден в рубрике вопроса`);
    }
  }
  if (input.score > question.points) {
    throw new AppError(400, "score_exceeds_max", `Балл (${input.score}) больше максимального (${question.points})`);
  }

  const gradedAt = await repo.persistManualGrade(responseId, {
    score: input.score,
    rubricScores: input.rubricScores,
    comment: input.comment ?? null,
    gradedBy: user.sub,
  });
  if (!gradedAt) {
    throw new AppError(409, "already_graded", "Этот ответ уже проверен");
  }

  return { responseId, score: input.score, maxScore: question.points, gradedAt: gradedAt.toISOString() };
}
