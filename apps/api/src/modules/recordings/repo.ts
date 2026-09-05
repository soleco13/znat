import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { RecordingStatus } from "@school/shared";
import { ACTIVE_RECORDING_STATUSES } from "@school/shared";
import { db } from "../../db/client.js";
import { recordings } from "../../db/schema.js";

export type RecordingRow = typeof recordings.$inferSelect;

export async function insertRecording(input: {
  id: string;
  schoolId: string;
  lessonId: string;
  startedBy: string;
  egressId: string;
  status: RecordingStatus;
  storageKey: string;
}): Promise<RecordingRow> {
  const [row] = await db.insert(recordings).values(input).returning();
  return row!;
}

export async function findRecordingById(id: string, schoolId: string): Promise<RecordingRow | null> {
  const [row] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.schoolId, schoolId)))
    .limit(1);
  return row ?? null;
}

export async function findRecordingByEgressId(egressId: string): Promise<RecordingRow | null> {
  const [row] = await db
    .select()
    .from(recordings)
    .where(eq(recordings.egressId, egressId))
    .limit(1);
  return row ?? null;
}

export async function listRecordingsForLesson(
  lessonId: string,
  schoolId: string,
): Promise<RecordingRow[]> {
  return db
    .select()
    .from(recordings)
    .where(and(eq(recordings.lessonId, lessonId), eq(recordings.schoolId, schoolId)))
    .orderBy(desc(recordings.startedAt));
}

/**
 * Идёт ли запись этого урока прямо сейчас (`starting`/`recording`). Нужно
 * и для баннера согласия (Э10.3), и для защиты от двойного старта.
 */
export async function findActiveRecordingForLesson(
  lessonId: string,
  schoolId: string,
): Promise<RecordingRow | null> {
  const [row] = await db
    .select()
    .from(recordings)
    .where(
      and(
        eq(recordings.lessonId, lessonId),
        eq(recordings.schoolId, schoolId),
        inArray(recordings.status, [...ACTIVE_RECORDING_STATUSES]),
      ),
    )
    .orderBy(desc(recordings.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Все записи всех школ, которые egress прямо сейчас пишет
 * (`starting`/`recording`) — для метрики нагрузки/алерта Э10.5 «egress без
 * публикующих» и для реконсиляции зависших записей. Схема сама по себе
 * не тенант-скоупится: метрики платформенные.
 */
export async function listAllActiveRecordings(): Promise<RecordingRow[]> {
  return db
    .select()
    .from(recordings)
    .where(inArray(recordings.status, [...ACTIVE_RECORDING_STATUSES]));
}

/**
 * Быстрый ответ «идёт ли запись этого урока» без тенант-скоупа — для
 * баннера согласия при подключении сокета (Э10.3), где `schoolId` под
 * рукой нет, а `lessonId` (UUID) и так уникален глобально.
 */
export async function lessonHasActiveRecording(lessonId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(
      and(
        eq(recordings.lessonId, lessonId),
        inArray(recordings.status, [...ACTIVE_RECORDING_STATUSES]),
      ),
    )
    .limit(1);
  return row != null;
}

export interface RecordingUpdate {
  status?: RecordingStatus;
  storageKey?: string | null;
  durationSec?: number | null;
  sizeBytes?: number | null;
  endedAt?: Date | null;
  expiresAt?: Date | null;
}

export async function updateRecording(
  id: string,
  patch: RecordingUpdate,
): Promise<RecordingRow | null> {
  const [row] = await db.update(recordings).set(patch).where(eq(recordings.id, id)).returning();
  return row ?? null;
}

/**
 * Записи под автоудаление по ретеншну (Э10.4): готовый файл, срок вышел.
 * `deleted`-строки уже без файла — не выбираются.
 */
export async function listExpiredRecordings(limit = 50): Promise<RecordingRow[]> {
  return db
    .select()
    .from(recordings)
    .where(and(eq(recordings.status, "ready"), lt(recordings.expiresAt, sql`now()`)))
    .limit(limit);
}
