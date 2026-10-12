import { createHash } from "node:crypto";
import type { JournalEventKind, ServerRoomMessage } from "@school/shared";
import * as activitiesService from "../activities/service.js";
import * as canvasService from "../canvas/service.js";
import * as roomsService from "../rooms/service.js";
import { logTaskFailure, logger } from "../../plugins/logger.js";
import * as rawRepo from "./raw-repo.js";
import type { JournalInsert } from "./raw-repo.js";

/**
 * Журнал урока для экспериментальной записи (docs/experimental-recording.md).
 *
 * Пишется ТОЛЬКО пока у урока идёт экспериментальная запись (`requested`/
 * `recording`) — остальные уроки платят за журнал одним поиском в Map на
 * событие. Источники — серверные точки, через которые события и так идут:
 * WS-события урока (`rooms` → `subscribeToAllRoomEvents`), Yjs-updates и
 * awareness доски (хуки Hocuspocus, `canvas`), вебхуки LiveKit о дорожках.
 * Новых клиентских соединений нет.
 *
 * Время события — `Date.now()` процесса API в момент, когда сервер его
 * увидел (часы хоста). Рекордер помечает RTP-пакеты теми же часами хоста
 * (`CLOCK_REALTIME`), поэтому журнал и медиа ложатся на одну шкалу без
 * отдельной синхронизации — при условии, что API и рекордер на одном хосте
 * или часы хостов синхронизированы (chrony). Погрешность — задержка доставки
 * события до сервера (десятки мс), для смены сцены и штрихов доски незаметна.
 *
 * Порядок: `seq` раздаётся при сбросе буфера в порядке поступления событий
 * (один процесс — один писатель). Буфер в памяти сбрасывается каждые 500 мс:
 * при падении API теряется не больше ~0,5 с журнала, а после рестарта
 * журнал продолжается с нового ключевого кадра (`journal_started` с
 * `reason: resume` + `yjs_snapshot`) — состояние доски восстанавливается
 * целиком, дыра видна по `journal_heartbeat` (раз в 10 с).
 */

const FLUSH_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SYNC_INTERVAL_MS = 5_000;
const ACTIVITY_POLL_MS = 5_000;
/** Ключевой кадр доски — опора на случай потерянных updates. */
const YJS_KEYFRAME_INTERVAL_MS = 5 * 60_000;
/** Viewport того, за кем следует запись: не чаще 10 раз в секунду + последний. */
const VIEWPORT_MIN_INTERVAL_MS = 100;
/** Предел буфера одного урока, если БД недоступна: дальше события отбрасываются со счётчиком. */
const MAX_BUFFERED_EVENTS = 50_000;

interface ActiveJournal {
  recordingId: string;
  lessonId: string;
  livekitRoom: string;
  followUserId: string;
  /** `null`, пока не прочитан последний seq из БД (продолжение после рестарта). */
  nextSeq: number | null;
  buffer: JournalInsert[];
  dropped: number;
  activeActivityId: string | null;
  lastActivityHash: string | null;
  lastViewportJson: string | null;
  lastViewportAt: number;
  pendingViewport: { tsMs: number; json: string } | null;
  lastKeyframeAt: number;
  closing: boolean;
}

const journals = new Map<string, ActiveJournal>();
const roomToLesson = new Map<string, string>();
let timers: ReturnType<typeof setInterval>[] = [];
let unsubscribeRoomEvents: (() => void) | null = null;
let flushing = false;

function push(journal: ActiveJournal, kind: JournalEventKind, payload: unknown, data: Uint8Array | null = null, tsMs = Date.now()): void {
  if (journal.buffer.length >= MAX_BUFFERED_EVENTS) {
    journal.dropped += 1;
    return;
  }
  journal.buffer.push({
    recordingId: journal.recordingId,
    seq: 0, // раздаётся при сбросе
    tsMs,
    kind,
    payload: payload ?? null,
    data: data ? Buffer.from(data) : null,
  });
}

// ─── Источники событий ─────────────────────────────────────────────────────

function onRoomEvent(lessonId: string, message: ServerRoomMessage): void {
  const journal = journals.get(lessonId);
  if (!journal) return;
  // Чат в запись не попадает (ни в Egress, ни здесь) — и в журнал тоже.
  if (message.type === "chat_message" || message.type === "error") return;
  push(journal, "room_event", message);
  // Та же логика сцены, что у шаблона записи `/egress` (EgressPage.tsx):
  // `activity_started` показывает задание, следующий `stage_changed` снимает.
  if (message.type === "activity_started") {
    journal.activeActivityId = message.activityId;
    journal.lastActivityHash = null;
    void pollActivityView(journal);
  } else if (message.type === "stage_changed") {
    journal.activeActivityId = null;
  }
}

function onCanvasUpdate(lessonId: string, update: Uint8Array): void {
  const journal = journals.get(lessonId);
  if (!journal) return;
  push(journal, "yjs_update", null, update);
}

function onCanvasAwareness(lessonId: string, states: ReadonlyArray<Record<string | number, unknown>>): void {
  const journal = journals.get(lessonId);
  if (!journal) return;
  for (const state of states) {
    const user = state.user as { id?: unknown } | undefined;
    if (user?.id !== journal.followUserId) continue;
    const viewport = state.viewport;
    if (!viewport) return;
    const json = JSON.stringify(viewport);
    if (json === journal.lastViewportJson) return;
    const now = Date.now();
    if (now - journal.lastViewportAt >= VIEWPORT_MIN_INTERVAL_MS) {
      emitViewport(journal, now, json);
    } else {
      journal.pendingViewport = { tsMs: now, json };
    }
    return;
  }
}

function emitViewport(journal: ActiveJournal, tsMs: number, json: string): void {
  journal.lastViewportJson = json;
  journal.lastViewportAt = tsMs;
  journal.pendingViewport = null;
  push(journal, "viewport", { userId: journal.followUserId, viewport: JSON.parse(json) as unknown }, null, tsMs);
}

/** Вебхук LiveKit по комнате урока (`rooms/livekit-webhook.ts` → `recordings/service.ts`). */
export function journalLivekitEvent(
  livekitRoom: string,
  event: { event: string; identity: string | null; trackSid: string | null; source: string | null; trackType: string | null },
): void {
  const lessonId = roomToLesson.get(livekitRoom);
  const journal = lessonId ? journals.get(lessonId) : undefined;
  if (!journal) return;
  push(journal, "livekit_event", event);
}

async function pollActivityView(journal: ActiveJournal): Promise<void> {
  const activityId = journal.activeActivityId;
  if (!activityId || journal.closing) return;
  try {
    const view = await activitiesService.getRecorderView(
      { lessonId: journal.lessonId, recordingId: journal.recordingId },
      activityId,
    );
    if (journal.activeActivityId !== activityId) return;
    const hash = createHash("sha1").update(JSON.stringify(view)).digest("hex");
    if (hash === journal.lastActivityHash) return;
    journal.lastActivityHash = hash;
    push(journal, "activity_view", view);
  } catch (err) {
    logTaskFailure("recordings.journal_activity_view", err, { recordingId: journal.recordingId, activityId });
  }
}

async function pushYjsKeyframe(journal: ActiveJournal): Promise<void> {
  journal.lastKeyframeAt = Date.now();
  // Время берём ДО чтения: всё, что придёт updates после этой метки, лежит
  // в журнале позже снимка, а применение Yjs-update повторно безвредно.
  const tsMs = Date.now();
  const state = await canvasService.getCanvasDocumentState(journal.lessonId);
  if (state) push(journal, "yjs_snapshot", null, state, tsMs);
}

// ─── Жизненный цикл журналов ───────────────────────────────────────────────

async function openJournal(row: rawRepo.RawRecordingRow): Promise<void> {
  const journal: ActiveJournal = {
    recordingId: row.id,
    lessonId: row.lessonId,
    livekitRoom: row.livekitRoom,
    followUserId: row.startedBy,
    nextSeq: null,
    buffer: [],
    dropped: 0,
    activeActivityId: null,
    lastActivityHash: null,
    lastViewportJson: null,
    lastViewportAt: 0,
    pendingViewport: null,
    lastKeyframeAt: 0,
    closing: false,
  };
  // В Map сразу — события, пришедшие пока читаем БД, не теряются (seq раздаётся при сбросе).
  journals.set(row.lessonId, journal);
  roomToLesson.set(row.livekitRoom, row.lessonId);
  const lastSeq = await rawRepo.maxJournalSeq(row.id);
  journal.nextSeq = lastSeq + 1;
  const reason = lastSeq === 0 ? "start" : "resume";
  push(journal, "journal_started", { reason, followUserId: row.startedBy });
  const [stage, participants] = await Promise.all([
    roomsService.getCurrentLessonStage(row.lessonId),
    roomsService.listParticipantsSnapshot(row.lessonId),
  ]);
  push(journal, "lesson_snapshot", { stage, participants });
  await pushYjsKeyframe(journal);
  logger().info({ recordingId: row.id, lessonId: row.lessonId, reason }, "raw journal opened");
}

async function closeJournal(journal: ActiveJournal): Promise<void> {
  journal.closing = true;
  if (journal.pendingViewport) emitViewport(journal, journal.pendingViewport.tsMs, journal.pendingViewport.json);
  push(journal, "journal_stopped", { dropped: journal.dropped });
  await flushJournal(journal);
  if (journals.get(journal.lessonId) === journal) journals.delete(journal.lessonId);
  if (roomToLesson.get(journal.livekitRoom) === journal.lessonId) roomToLesson.delete(journal.livekitRoom);
}

async function flushJournal(journal: ActiveJournal): Promise<void> {
  if (journal.nextSeq === null || journal.buffer.length === 0) return;
  const batch = journal.buffer.splice(0, journal.buffer.length);
  const firstSeq = journal.nextSeq;
  batch.forEach((row, i) => {
    row.seq = firstSeq + i;
  });
  try {
    await rawRepo.insertJournalEvents(batch);
    journal.nextSeq = firstSeq + batch.length;
  } catch (err) {
    // Вернуть в начало буфера: следующий сброс повторит с теми же seq
    // (повтор по (recording, seq) БД пропустит, если часть всё же записалась).
    journal.buffer.unshift(...batch);
    logTaskFailure("recordings.journal_flush", err, { recordingId: journal.recordingId, events: batch.length });
  }
}

async function flushAll(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const journal of journals.values()) {
      const pending = journal.pendingViewport;
      if (pending && Date.now() - journal.lastViewportAt >= VIEWPORT_MIN_INTERVAL_MS) {
        emitViewport(journal, pending.tsMs, pending.json);
      }
      await flushJournal(journal);
    }
  } finally {
    flushing = false;
  }
}

/**
 * Свести журналы в памяти с идущими экспериментальными записями в БД:
 * открыть новые (в т.ч. после рестарта API), закрыть завершённые.
 */
export async function syncJournals(): Promise<void> {
  const rows = await rawRepo.listActiveRawRecordings();
  const activeIds = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    const current = journals.get(row.lessonId);
    if (current?.recordingId === row.id) continue;
    if (current) await closeJournal(current);
    try {
      await openJournal(row);
    } catch (err) {
      logTaskFailure("recordings.journal_open", err, { recordingId: row.id });
    }
  }
  for (const journal of [...journals.values()]) {
    if (!activeIds.has(journal.recordingId)) await closeJournal(journal);
  }
}

/** Закрыть журнал записи сразу (стоп) — не ждать следующей сверки. */
export async function closeJournalForRecording(recordingId: string): Promise<void> {
  for (const journal of journals.values()) {
    if (journal.recordingId === recordingId) await closeJournal(journal);
  }
}

/** Открыть журнал новой записи сразу, не дожидаясь сверки (первые секунды урока важны). */
export async function openJournalForRecording(row: rawRepo.RawRecordingRow): Promise<void> {
  if (journals.get(row.lessonId)?.recordingId === row.id) return;
  await openJournal(row);
}

function heartbeat(): void {
  const now = Date.now();
  for (const journal of journals.values()) {
    if (journal.nextSeq === null) continue;
    push(journal, "journal_heartbeat", { dropped: journal.dropped, buffered: journal.buffer.length });
    if (now - journal.lastKeyframeAt >= YJS_KEYFRAME_INTERVAL_MS) {
      void pushYjsKeyframe(journal).catch((err: unknown) =>
        logTaskFailure("recordings.journal_keyframe", err, { recordingId: journal.recordingId }),
      );
    }
  }
}

/** Запуск журнала; промис — первая сверка (в тестах её дожидаются, в проде — нет). */
export function startJournal(): Promise<void> {
  if (timers.length > 0) return Promise.resolve();
  unsubscribeRoomEvents = roomsService.subscribeToAllRoomEvents(onRoomEvent);
  canvasService.setCanvasJournalObserver({ onUpdate: onCanvasUpdate, onAwareness: onCanvasAwareness });
  const every = (ms: number, fn: () => Promise<void> | void, task: string) => {
    const t = setInterval(() => {
      void Promise.resolve()
        .then(fn)
        .catch((err: unknown) => logTaskFailure(task, err));
    }, ms);
    t.unref?.();
    timers.push(t);
  };
  every(FLUSH_INTERVAL_MS, flushAll, "recordings.journal_flush_all");
  every(HEARTBEAT_INTERVAL_MS, heartbeat, "recordings.journal_heartbeat");
  every(SYNC_INTERVAL_MS, syncJournals, "recordings.journal_sync");
  every(
    ACTIVITY_POLL_MS,
    () => Promise.all([...journals.values()].map((j) => pollActivityView(j))).then(() => undefined),
    "recordings.journal_activity_poll",
  );
  return syncJournals().catch((err: unknown) => logTaskFailure("recordings.journal_sync", err));
}

/** Остановка процесса: сбросить буферы (журнал продолжится после рестарта с `resume`). */
export async function stopJournal(): Promise<void> {
  for (const t of timers) clearInterval(t);
  timers = [];
  unsubscribeRoomEvents?.();
  unsubscribeRoomEvents = null;
  canvasService.setCanvasJournalObserver(null);
  for (const journal of journals.values()) await flushJournal(journal);
  journals.clear();
  roomToLesson.clear();
}

/** Для тестов: сколько уроков сейчас журналируется. */
export function activeJournalCount(): number {
  return journals.size;
}

export { flushAll as flushJournalsForTest };
