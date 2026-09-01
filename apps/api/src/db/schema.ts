import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  primaryKey,
  index,
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
