import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  primaryKey,
  index,
  unique,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";

/** Бинарное состояние Y.Doc (§9 ТЗ: `canvas_docs.ydoc BYTEA`). `pg`/node-postgres
 *  сам маппит bytea <-> Node Buffer, доп. toDriver/fromDriver не нужны. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const roleEnum = pgEnum("role", ["admin", "methodist", "teacher", "student"]);
export const lessonStatusEnum = pgEnum("lesson_status", [
  "scheduled",
  "live",
  "ended",
  "cancelled",
]);
export const deckStatusEnum = pgEnum("deck_status", [
  "pending",
  "converting",
  "ready",
  "failed",
]);
export const activityModeEnum = pgEnum("activity_mode", ["lesson", "homework"]);

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: roleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  grade: integer("grade").notNull(),
  academicYear: text("academic_year").notNull(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    subject: text("subject").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    status: lessonStatusEnum("status").notNull().default("scheduled"),
    livekitRoom: text("livekit_room"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    settings: jsonb("settings").notNull().default({}),
  },
  (t) => [index("lessons_school_starts_idx").on(t.schoolId, t.startsAt)],
);

export const lessonParticipants = pgTable(
  "lesson_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [index("lesson_participants_lesson_idx").on(t.lessonId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [index("chat_messages_lesson_created_idx").on(t.lessonId, t.createdAt)],
);

/**
 * Один Y.Doc на урок (Э3.2, §9 ТЗ). `lessonId` — сам PK (не отдельный
 * uuid-суррогат), т.к. документ ровно один на урок и отдельный id не нужен.
 * Строка появляется только при первом `onStoreDocument` (первое
 * дебаунсированное сохранение после начала рисования) через upsert — до
 * этого момента для урока просто нет строки, что отличается от «строка с
 * пустым бинарным состоянием» и читается репозиторием canvas как «истории
 * ещё нет, доска пустая».
 */
export const canvasDocs = pgTable("canvas_docs", {
  lessonId: uuid("lesson_id")
    .primaryKey()
    .references(() => lessons.id, { onDelete: "cascade" }),
  ydoc: bytea("ydoc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Презентации урока (Э4, §3.5/§9 ТЗ). Вместо `source_asset_id`/`image_asset_id`
 * из §9 — `storageKey` строкой: в проекте нет таблицы `assets`, файлы
 * адресуются ключом + HMAC-URL (как в Э0.5/Э3.10).
 */
export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    sourceStorageKey: text("source_storage_key").notNull(),
    /** MIME исходника — нужен для повторной постановки в очередь (reconcile). */
    sourceMimeType: text("source_mime_type").notNull(),
    /** sha256 исходного файла — дедуп повторной конвертации (Э4.5). */
    sourceSha256: text("source_sha256").notNull(),
    sourceName: text("source_name").notNull(),
    title: text("title").notNull(),
    status: deckStatusEnum("status").notNull().default("pending"),
    /** Э4.7: 'images' — PNG-слайды на сервере; 'pdf' — исходный PDF рендерит pdf.js в браузере. */
    renderMode: text("render_mode").notNull().default("images"),
    slideCount: integer("slide_count").notNull().default(0),
    /** Сколько слайдов отрендерено (Э4.4). */
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("decks_lesson_idx").on(t.lessonId),
    // Дедуп (Э4.5): «та же презентация конвертируется один раз» в пределах школы.
    index("decks_school_sha_idx").on(t.schoolId, t.sourceSha256),
  ],
);

export const deckSlides = pgTable(
  "deck_slides",
  {
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    imageStorageKey: text("image_storage_key").notNull(),
    thumbStorageKey: text("thumb_storage_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Текстовый слой из `pdftotext -bbox` (Э4.8). */
    textLayer: jsonb("text_layer"),
    /** Заметки докладчика из исходного .pptx/.odp (Э4.9) — «видны только учителю». */
    notes: text("notes"),
  },
  (t) => [primaryKey({ columns: [t.deckId, t.index] })],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    familyId: uuid("family_id").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByHash: text("replaced_by_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("refresh_tokens_family_idx").on(t.familyId)],
);

/**
 * Материал (Э8.2, §6.1/§6.5 ТЗ) — тонкая обёртка идентичности/владения, БЕЗ
 * содержимого. Содержимое (title/subject/grades/blocks — всё, что описывает
 * `materialSchema` в `packages/shared`) живёт только в `material_versions`,
 * не дублируется здесь: два источника правды для одного и того же поля —
 * готовый рецепт рассинхронизации при правке. Редактора/публикации ещё нет
 * (Э9) — на Э8 материалы заводятся JSON-ом через seed-скрипт/Postman
 * (стоп-лист Э8), поэтому `currentVersionId`-указателя тоже нет: «текущая»
 * версия — последняя по `version` (см. `material_versions` ниже), без
 * циклической связи между двумя таблицами.
 */
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Версия материала (Э8.2, §6.1 ТЗ) — `content` целиком проверяется
 * `materialSchema` (`packages/shared`) до записи, это ЕДИНСТВЕННОЕ место
 * хранения содержимого (title/subject/grades/blocks/settings — включая
 * ключи ответов, `stripInteractionAnswerKey` их снимает только при отдаче
 * ученику, не здесь). Append-only, без `updatedAt` — правка публикованной
 * версии создаёт НОВУЮ строку с большим `version` (задел на workflow
 * черновик→ревью→публикация, Э9.8), а не мутирует существующую.
 */
export const materialVersions = pgTable(
  "material_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("material_versions_material_version_idx").on(t.materialId, t.version)],
);

/**
 * Выдача материала классу или ученику (Э8.2/8.6, §8 ТЗ — сам эндпоинт
 * `POST /lessons/:id/activities` ещё не сделан, это только таблица).
 * `lessonId` nullable — «домашняя работа» (Э8.11) не привязана к
 * конкретному уроку. Ссылается на `materialVersions`, не `materials`
 * напрямую — какую именно версию видел ученик, должно быть воспроизводимо
 * даже после того, как методист опубликует новую (Э9.8).
 *
 * `groupId` (Э8.11) — ДЕНОРМАЛИЗОВАН и заполняется ВСЕГДА, для обоих
 * режимов: у `lesson`-выдачи это `lessons.groupId` урока на момент запуска
 * (копия, не FK через `lessons`), у `homework` — группа, которой она
 * прямо адресована. Без этого поля роль «ученик»/«прогресс класса»
 * (Э8.8/8.9) для домашней работы не смогла бы понять, чей это ростер — у
 * homework-активности нет урока, откуда обычно берётся `groupId`.
 * Nullable в схеме БД (не NOT NULL) — намеренно, чтобы `drizzle-kit
 * generate` не потребовал интерактивного дефолта для уже существующих
 * строк; инвариант «всегда заполнено» держит только сервис-слой
 * (`repo.insertActivity` не вызывается без него ни из одного пути).
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialVersionId: uuid("material_version_id")
      .notNull()
      .references(() => materialVersions.id, { onDelete: "restrict" }),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "restrict" }),
    mode: activityModeEnum("mode").notNull(),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deadline: timestamp("deadline", { withTimezone: true }),
    timerSeconds: integer("timer_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Момент, когда учитель начал разбор (Э8.10, §7.3 ТЗ) — до этого момента полный материал (с ключами ответов) не отдаётся никому, кроме учителя (аналитика, Э8.9). `null` — разбор ещё не начат. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("activities_lesson_idx").on(t.lessonId), index("activities_group_idx").on(t.groupId)],
);

/**
 * Ответ ученика на один вопрос одной попытки (Э8.2, §6.5 ТЗ — колонки
 * взяты дословно из спецификации: `attempt_id, material_id, lesson_id
 * (nullable), user_id, question_id, response, score, max_score,
 * auto_graded, graded_by, graded_at, time_spent_ms, attempt_number,
 * submitted_at`). Отдельной таблицы `attempts` нет — ТЗ не заводит её,
 * `attemptId` здесь просто UUID, сгенерированный при старте попытки
 * (Э8.6, ещё не сделан), группирующий строки одной попытки без отдельной
 * сущности. `activityId`/`materialId` — оба сразу: `materialId` — как в
 * ТЗ (аналитика по материалу вне привязки к конкретной выдаче, Э8.9),
 * `activityId` — необходимое дополнение (в ТЗ не названо явно): один и
 * тот же материал можно выдать дважды (разным урокам или как домашнюю
 * работу), без него ответы разных выдач было бы не различить.
 * `questionId` — `text`, не FK: вопросы живут внутри `material_versions.content`
 * (JSONB), не в отдельной таблице.
 *
 * `response` хранится ВСЕГДА, независимо от `autoGraded` — «чтобы можно
 * было перепроверить после исправления ключа ответа» (§6.5 ТЗ дословно).
 */
export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    response: jsonb("response").notNull(),
    score: numeric("score", { precision: 10, scale: 4 }),
    maxScore: numeric("max_score", { precision: 10, scale: 4 }),
    autoGraded: boolean("auto_graded").notNull(),
    gradedBy: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    timeSpentMs: integer("time_spent_ms").notNull().default(0),
    attemptNumber: integer("attempt_number").notNull().default(1),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Естественный ключ автосохранения (Э8.7) — upsert-цель «этот ответ этой попытки этого вопроса».
    unique("responses_attempt_question_idx").on(t.attemptId, t.questionId),
    index("responses_activity_user_idx").on(t.activityId, t.userId),
    // Аналитика по вопросу (Э8.9): «17 из 24 выбрали B» — агрегат по материалу+вопросу вне привязки к конкретной выдаче.
    index("responses_material_question_idx").on(t.materialId, t.questionId),
  ],
);
