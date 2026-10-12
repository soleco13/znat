import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { LessonRecordingMode, RawRecordingStatus } from "@school/shared";
import { ACTIVE_RAW_RECORDING_STATUSES } from "@school/shared";
import { db } from "../../db/client.js";
import { lessonRecordingModes, rawRecordingJournal, rawRecordings } from "../../db/schema.js";

/**
 * Хранилище экспериментальной записи (docs/experimental-recording.md).
 * Переходы статусов — условными UPDATE (`WHERE status = … AND lease = …`):
 * два рекордера или два рендера не возьмут одно задание, а опоздавший
 * отчёт по чужой лизе ничего не изменит.
 */

export type RawRecordingRow = typeof rawRecordings.$inferSelect;
export type JournalRow = typeof rawRecordingJournal.$inferSelect;

// ─── Режим урока ───────────────────────────────────────────────────────────

export async function findLessonMode(lessonId: string): Promise<LessonRecordingMode | null> {
  const [row] = await db
    .select({ mode: lessonRecordingModes.mode })
    .from(lessonRecordingModes)
    .where(eq(lessonRecordingModes.lessonId, lessonId))
    .limit(1);
  return row?.mode ?? null;
}

export async function upsertLessonMode(input: {
  lessonId: string;
  schoolId: string;
  mode: LessonRecordingMode;
  setBy: string;
}): Promise<void> {
  await db
    .insert(lessonRecordingModes)
    .values(input)
    .onConflictDoUpdate({
      target: lessonRecordingModes.lessonId,
      set: { mode: input.mode, setBy: input.setBy, setAt: sql`now()` },
    });
}

export async function deleteLessonMode(lessonId: string): Promise<void> {
  await db.delete(lessonRecordingModes).where(eq(lessonRecordingModes.lessonId, lessonId));
}

// ─── Записи ────────────────────────────────────────────────────────────────

export async function insertRawRecording(input: {
  id: string;
  schoolId: string;
  lessonId: string;
  startedBy: string;
  livekitRoom: string;
  recordingDir: string;
  outputKey: string;
  compareRecordingId: string | null;
}): Promise<RawRecordingRow | null> {
  // Уникальный индекс «одна идущая на урок»: параллельный старт не создаст вторую.
  const [row] = await db.insert(rawRecordings).values(input).onConflictDoNothing().returning();
  return row ?? null;
}

export async function findRawRecording(id: string): Promise<RawRecordingRow | null> {
  const [row] = await db.select().from(rawRecordings).where(eq(rawRecordings.id, id)).limit(1);
  return row ?? null;
}

export async function findActiveRawRecordingForLesson(lessonId: string): Promise<RawRecordingRow | null> {
  const [row] = await db
    .select()
    .from(rawRecordings)
    .where(and(eq(rawRecordings.lessonId, lessonId), inArray(rawRecordings.status, [...ACTIVE_RAW_RECORDING_STATUSES])))
    .limit(1);
  return row ?? null;
}

export async function listRawRecordingsForLesson(lessonId: string, schoolId: string): Promise<RawRecordingRow[]> {
  return db
    .select()
    .from(rawRecordings)
    .where(and(eq(rawRecordings.lessonId, lessonId), eq(rawRecordings.schoolId, schoolId)))
    .orderBy(desc(rawRecordings.startedAt));
}

/** Все идущие экспериментальные записи — для журнала (какие уроки журналировать). */
export async function listActiveRawRecordings(): Promise<RawRecordingRow[]> {
  return db
    .select()
    .from(rawRecordings)
    .where(inArray(rawRecordings.status, [...ACTIVE_RAW_RECORDING_STATUSES]));
}

export interface RawRecordingUpdate {
  status?: RawRecordingStatus;
  stopRequestedAt?: Date | null;
  stoppedAt?: Date | null;
  endedAt?: Date | null;
  lastError?: string | null;
  durationSec?: number | null;
  sizeBytes?: number | null;
  renderMetrics?: unknown;
  renderStep?: string | null;
  recorderStats?: unknown;
  rawExpiresAt?: Date | null;
  expiresAt?: Date | null;
  recorderLeaseId?: string | null;
  renderLeaseId?: string | null;
  renderAttempts?: number;
}

/** Обновление при условии текущего статуса — `null`, если статус уже другой. */
export async function updateRawRecordingIf(
  id: string,
  expected: readonly RawRecordingStatus[],
  patch: RawRecordingUpdate,
): Promise<RawRecordingRow | null> {
  const [row] = await db
    .update(rawRecordings)
    .set(patch)
    .where(and(eq(rawRecordings.id, id), inArray(rawRecordings.status, [...expected])))
    .returning();
  return row ?? null;
}

// ─── Лизы рекордера ────────────────────────────────────────────────────────

/**
 * Взять задание записи: самое старое `requested` без стопа. `FOR UPDATE
 * SKIP LOCKED` — несколько рекордеров не возьмут одно и то же.
 */
export async function claimRecordJob(workerId: string, leaseId: string): Promise<RawRecordingRow | null> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE raw_recordings SET
      status = 'recording',
      attempt = attempt + 1,
      recorder_lease_id = ${leaseId},
      recorder_worker = ${workerId},
      recorder_heartbeat_at = now()
    WHERE id = (
      SELECT id FROM raw_recordings
      WHERE status = 'requested' AND stop_requested_at IS NULL
      ORDER BY started_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const id = result.rows[0]?.id;
  return id ? findRawRecording(id) : null;
}

/** Heartbeat рекордера: продлевает лизу, если она всё ещё его. */
export async function touchRecorderLease(
  id: string,
  leaseId: string,
  stats: unknown,
): Promise<RawRecordingRow | null> {
  const [row] = await db
    .update(rawRecordings)
    .set({ recorderHeartbeatAt: sql`now()`, recorderStats: stats })
    .where(
      and(
        eq(rawRecordings.id, id),
        eq(rawRecordings.recorderLeaseId, leaseId),
        inArray(rawRecordings.status, ["recording", "finalizing"]),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Рекордер закрыл файлы. Если стоп уже запрошен — данные готовы к рендеру;
 * если нет (рекордер вышел сам: ошибка, предел длительности) — тоже рендер,
 * урок дальше не пишется: перезапуск записи — новое нажатие «Запись».
 */
export async function finishRecorderLease(
  id: string,
  leaseId: string,
  patch: { stats: unknown; lastError: string | null },
): Promise<RawRecordingRow | null> {
  const [row] = await db
    .update(rawRecordings)
    .set({
      status: "queued_for_render",
      recorderLeaseId: null,
      recorderStats: patch.stats,
      lastError: patch.lastError,
      stoppedAt: sql`coalesce(${rawRecordings.stoppedAt}, now())`,
      stopRequestedAt: sql`coalesce(${rawRecordings.stopRequestedAt}, now())`,
    })
    .where(
      and(
        eq(rawRecordings.id, id),
        eq(rawRecordings.recorderLeaseId, leaseId),
        inArray(rawRecordings.status, ["recording", "finalizing"]),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Рекордер пропал (нет heartbeat): если запись не остановлена — вернуть в
 * `requested`, следующий рекордер продолжит новой попыткой; если стоп уже
 * был — дорожки на диске (чанки по 60 с), отправляем на рендер.
 */
export async function expireRecorderLeases(staleBefore: Date): Promise<RawRecordingRow[]> {
  const resumed = await db
    .update(rawRecordings)
    .set({ status: "requested", recorderLeaseId: null, recorderWorker: null })
    .where(
      and(
        eq(rawRecordings.status, "recording"),
        isNull(rawRecordings.stopRequestedAt),
        lt(rawRecordings.recorderHeartbeatAt, staleBefore),
      ),
    )
    .returning();
  const finished = await db
    .update(rawRecordings)
    .set({ status: "queued_for_render", recorderLeaseId: null, stoppedAt: sql`coalesce(${rawRecordings.stoppedAt}, now())` })
    .where(
      and(
        inArray(rawRecordings.status, ["recording", "finalizing"]),
        isNotNull(rawRecordings.stopRequestedAt),
        lt(rawRecordings.recorderHeartbeatAt, staleBefore),
      ),
    )
    .returning();
  return [...resumed, ...finished];
}

/**
 * Воркер перезапустился (тот же `workerId`): его прежний процесс мёртв, ждать
 * истечения лиз (30 с записи урока!) незачем — задания сразу возвращаются:
 * идущая запись — в `requested` (новая попытка), остановленная — на рендер,
 * недособранная — в очередь рендера (продолжит с контрольных точек).
 */
export async function recoverWorkerLeases(workerId: string): Promise<RawRecordingRow[]> {
  const resumed = await db
    .update(rawRecordings)
    .set({ status: "requested", recorderLeaseId: null, recorderWorker: null })
    .where(
      and(
        eq(rawRecordings.status, "recording"),
        eq(rawRecordings.recorderWorker, workerId),
        isNull(rawRecordings.stopRequestedAt),
      ),
    )
    .returning();
  const stopped = await db
    .update(rawRecordings)
    .set({ status: "queued_for_render", recorderLeaseId: null, stoppedAt: sql`coalesce(${rawRecordings.stoppedAt}, now())` })
    .where(
      and(
        inArray(rawRecordings.status, ["recording", "finalizing"]),
        eq(rawRecordings.recorderWorker, workerId),
        isNotNull(rawRecordings.stopRequestedAt),
      ),
    )
    .returning();
  const renders = await db
    .update(rawRecordings)
    .set({ status: "queued_for_render", renderLeaseId: null })
    .where(and(inArray(rawRecordings.status, ["rendering", "verifying"]), eq(rawRecordings.renderWorker, workerId)))
    .returning();
  return [...resumed, ...stopped, ...renders];
}

/**
 * Стоп запрошен, а рекордер так и не взял задание (`requested`): данных
 * нет — если ни одной попытки не было, это `aborted`, иначе — рендер того,
 * что успели записать прошлые попытки.
 */
export async function settleStoppedUnclaimed(): Promise<RawRecordingRow[]> {
  const aborted = await db
    .update(rawRecordings)
    .set({ status: "aborted", endedAt: sql`now()`, stoppedAt: sql`coalesce(${rawRecordings.stoppedAt}, now())` })
    .where(and(eq(rawRecordings.status, "requested"), isNotNull(rawRecordings.stopRequestedAt), eq(rawRecordings.attempt, 0)))
    .returning();
  const toRender = await db
    .update(rawRecordings)
    .set({ status: "queued_for_render", stoppedAt: sql`coalesce(${rawRecordings.stoppedAt}, now())` })
    .where(and(eq(rawRecordings.status, "requested"), isNotNull(rawRecordings.stopRequestedAt), gt(rawRecordings.attempt, 0)))
    .returning();
  return [...aborted, ...toRender];
}

// ─── Лизы рендера ──────────────────────────────────────────────────────────

export async function claimRenderJob(
  workerId: string,
  leaseId: string,
  maxAttempts: number,
): Promise<RawRecordingRow | null> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE raw_recordings SET
      status = 'rendering',
      render_attempts = render_attempts + 1,
      render_lease_id = ${leaseId},
      render_worker = ${workerId},
      render_heartbeat_at = now(),
      render_step = 'claimed'
    WHERE id = (
      SELECT id FROM raw_recordings
      WHERE status = 'queued_for_render' AND render_attempts < ${maxAttempts}
      ORDER BY queued_at NULLS LAST, stopped_at NULLS LAST, started_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const id = result.rows[0]?.id;
  return id ? findRawRecording(id) : null;
}

export async function touchRenderLease(
  id: string,
  leaseId: string,
  step: string,
): Promise<RawRecordingRow | null> {
  const status: RawRecordingStatus = step === "verify" ? "verifying" : "rendering";
  const [row] = await db
    .update(rawRecordings)
    .set({ renderHeartbeatAt: sql`now()`, renderStep: step, status })
    .where(
      and(
        eq(rawRecordings.id, id),
        eq(rawRecordings.renderLeaseId, leaseId),
        inArray(rawRecordings.status, ["rendering", "verifying"]),
      ),
    )
    .returning();
  return row ?? null;
}

/** Рендер с этой лизой в работе (для финального отчёта). */
export async function findByRenderLease(id: string, leaseId: string): Promise<RawRecordingRow | null> {
  const [row] = await db
    .select()
    .from(rawRecordings)
    .where(
      and(
        eq(rawRecordings.id, id),
        eq(rawRecordings.renderLeaseId, leaseId),
        inArray(rawRecordings.status, ["rendering", "verifying"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function completeRenderLease(
  id: string,
  leaseId: string,
  patch: RawRecordingUpdate,
): Promise<RawRecordingRow | null> {
  const [row] = await db
    .update(rawRecordings)
    .set({ ...patch, renderLeaseId: null })
    .where(
      and(
        eq(rawRecordings.id, id),
        eq(rawRecordings.renderLeaseId, leaseId),
        inArray(rawRecordings.status, ["rendering", "verifying"]),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Рендер пропал (нет heartbeat): задание снова в очередь; исчерпавшее
 * попытки — `failed` (исходники остаются, можно пересобрать вручную).
 */
export async function expireRenderLeases(staleBefore: Date, maxAttempts: number): Promise<RawRecordingRow[]> {
  const stale = and(
    inArray(rawRecordings.status, ["rendering", "verifying"]),
    lt(rawRecordings.renderHeartbeatAt, staleBefore),
  );
  const failed = await db
    .update(rawRecordings)
    .set({
      status: "failed",
      renderLeaseId: null,
      endedAt: sql`now()`,
      lastError: sql`coalesce(${rawRecordings.lastError}, 'render worker lost (no heartbeat)')`,
    })
    .where(and(stale, sql`${rawRecordings.renderAttempts} >= ${maxAttempts}`))
    .returning();
  const requeued = await db
    .update(rawRecordings)
    .set({ status: "queued_for_render", renderLeaseId: null })
    .where(and(stale, sql`${rawRecordings.renderAttempts} < ${maxAttempts}`))
    .returning();
  return [...failed, ...requeued];
}

// ─── Ретеншн ───────────────────────────────────────────────────────────────

/** Записи, чьи исходные дорожки можно удалять: `ready`/`failed` со сроком в прошлом. */
export async function listRawSourcesToPurge(limit = 20): Promise<RawRecordingRow[]> {
  return db
    .select()
    .from(rawRecordings)
    .where(and(inArray(rawRecordings.status, ["ready", "failed", "aborted"]), lt(rawRecordings.rawExpiresAt, sql`now()`)))
    .limit(limit);
}

export async function listExpiredRawOutputs(limit = 20): Promise<RawRecordingRow[]> {
  return db
    .select()
    .from(rawRecordings)
    .where(and(eq(rawRecordings.status, "ready"), lt(rawRecordings.expiresAt, sql`now()`)))
    .limit(limit);
}

export async function clearRawExpiry(id: string): Promise<void> {
  await db.update(rawRecordings).set({ rawExpiresAt: null }).where(eq(rawRecordings.id, id));
}

export async function markRawDeleted(id: string): Promise<void> {
  await db
    .update(rawRecordings)
    .set({ status: "deleted", sizeBytes: null })
    .where(eq(rawRecordings.id, id));
}

// ─── Журнал ────────────────────────────────────────────────────────────────

export interface JournalInsert {
  recordingId: string;
  seq: number;
  tsMs: number;
  kind: string;
  payload: unknown;
  data: Buffer | null;
}

/** Пачка событий журнала; повтор той же (recording, seq) пропускается. */
export async function insertJournalEvents(rows: JournalInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(rawRecordingJournal)
    .values(rows.map((r) => ({ ...r, payload: r.payload ?? null })))
    .onConflictDoNothing();
}

export async function maxJournalSeq(recordingId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<string | null>`max(${rawRecordingJournal.seq})` })
    .from(rawRecordingJournal)
    .where(eq(rawRecordingJournal.recordingId, recordingId));
  return row?.value == null ? 0 : Number(row.value);
}

export async function countJournalEvents(recordingId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(rawRecordingJournal)
    .where(eq(rawRecordingJournal.recordingId, recordingId));
  return Number(row?.value ?? 0);
}

export async function listJournalPage(
  recordingId: string,
  afterSeq: number,
  limit: number,
  kinds?: readonly string[],
): Promise<JournalRow[]> {
  return db
    .select()
    .from(rawRecordingJournal)
    .where(
      and(
        eq(rawRecordingJournal.recordingId, recordingId),
        gt(rawRecordingJournal.seq, afterSeq),
        kinds && kinds.length > 0 ? inArray(rawRecordingJournal.kind, [...kinds]) : undefined,
      ),
    )
    .orderBy(asc(rawRecordingJournal.seq))
    .limit(limit);
}

/** Есть ли у записи хоть одна строка журнала с этим видом — для проверки полноты. */
export async function hasJournalKind(recordingId: string, kind: string): Promise<boolean> {
  const [row] = await db
    .select({ seq: rawRecordingJournal.seq })
    .from(rawRecordingJournal)
    .where(and(eq(rawRecordingJournal.recordingId, recordingId), eq(rawRecordingJournal.kind, kind)))
    .limit(1);
  return row != null;
}


/**
 * Состояние очереди экспериментальной записи для метрик: число записей по
 * статусам, возраст самого старого ожидающего рендера (с момента стопа) и
 * суммарная длительность уроков в очереди (сколько «урока» ждёт сборки).
 */
export async function queueSnapshot(): Promise<{
  byStatus: Record<string, number>;
  oldestQueuedSec: number;
  queuedLessonSec: number;
}> {
  const counts = await db.execute<{ status: string; n: string }>(sql`
    SELECT status::text AS status, count(*)::text AS n FROM raw_recordings
    WHERE status NOT IN ('ready', 'deleted', 'aborted', 'failed') GROUP BY status`);
  const [q] = (
    await db.execute<{ oldest: string | null; total: string | null }>(sql`
      SELECT extract(epoch FROM now() - min(coalesce(queued_at, stopped_at, started_at)))::text AS oldest,
             sum(extract(epoch FROM coalesce(stopped_at, now()) - started_at))::text AS total
      FROM raw_recordings WHERE status IN ('queued_for_render', 'rendering', 'verifying', 'finalizing')`)
  ).rows;
  const byStatus: Record<string, number> = {};
  for (const r of counts.rows) byStatus[r.status] = Number(r.n);
  return { byStatus, oldestQueuedSec: Number(q?.oldest ?? 0), queuedLessonSec: Number(q?.total ?? 0) };
}
