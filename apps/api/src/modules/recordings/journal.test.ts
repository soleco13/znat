import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ServerRoomMessage } from "@school/shared";

const { rawRepoMock, roomsMock, canvasMock, activitiesMock } = vi.hoisted(() => ({
  rawRepoMock: {
    listActiveRawRecordings: vi.fn(),
    maxJournalSeq: vi.fn(),
    insertJournalEvents: vi.fn(),
  },
  roomsMock: {
    subscribeToAllRoomEvents: vi.fn(),
    getCurrentLessonStage: vi.fn().mockResolvedValue("board"),
    listParticipantsSnapshot: vi.fn().mockResolvedValue([]),
  },
  canvasMock: {
    setCanvasJournalObserver: vi.fn(),
    getCanvasDocumentState: vi.fn().mockResolvedValue(new Uint8Array([9, 9])),
  },
  activitiesMock: { getRecorderView: vi.fn() },
}));

vi.mock("./raw-repo.js", () => rawRepoMock);
vi.mock("../rooms/service.js", () => roomsMock);
vi.mock("../canvas/service.js", () => canvasMock);
vi.mock("../activities/service.js", () => activitiesMock);

const journal = await import("./journal.js");

const LESSON = "22222222-2222-2222-2222-222222222222";
const OTHER_LESSON = "33333333-3333-3333-3333-333333333333";
const FOLLOW = "44444444-4444-4444-4444-444444444444";
const RAW_ID = "55555555-5555-5555-5555-555555555555";

type Inserted = { seq: number; kind: string; payload: unknown; data: Buffer | null; tsMs: number };

let roomListener: (lessonId: string, message: ServerRoomMessage) => void;
let canvasObserver: {
  onUpdate(lessonId: string, update: Uint8Array): void;
  onAwareness(lessonId: string, states: Record<string, unknown>[]): void;
};
let inserted: Inserted[];

function activeRow() {
  return {
    id: RAW_ID,
    lessonId: LESSON,
    livekitRoom: `lesson-${LESSON}`,
    startedBy: FOLLOW,
    status: "recording",
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  inserted = [];
  roomsMock.subscribeToAllRoomEvents.mockImplementation((fn: typeof roomListener) => {
    roomListener = fn;
    return () => undefined;
  });
  canvasMock.setCanvasJournalObserver.mockImplementation((o: typeof canvasObserver | null) => {
    if (o) canvasObserver = o;
  });
  rawRepoMock.insertJournalEvents.mockImplementation(async (rows: Inserted[]) => {
    inserted.push(...rows.map((r) => ({ ...r })));
  });
  rawRepoMock.maxJournalSeq.mockResolvedValue(0);
  rawRepoMock.listActiveRawRecordings.mockResolvedValue([activeRow()]);
  await journal.startJournal();
});

afterEach(async () => {
  await journal.stopJournal();
});

describe("журнал экспериментальной записи", () => {
  it("начинается с ключевого кадра: started → снимок урока → снимок доски", async () => {
    await journal.flushJournalsForTest();
    expect(inserted.map((e) => e.kind)).toEqual(["journal_started", "lesson_snapshot", "yjs_snapshot"]);
    expect(inserted.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(inserted[0]!.payload).toMatchObject({ reason: "start" });
    expect(inserted[2]!.data).toEqual(Buffer.from([9, 9]));
  });

  it("пишет события только уроков с идущей записью, без чата", async () => {
    roomListener(OTHER_LESSON, { type: "stage_changed", stage: "people" });
    roomListener(LESSON, { type: "stage_changed", stage: "people" });
    roomListener(LESSON, {
      type: "chat_message",
      message: { id: "x", lessonId: LESSON, authorId: FOLLOW, authorName: "A", text: "секрет", createdAt: "" },
    } as unknown as ServerRoomMessage);
    canvasObserver.onUpdate(OTHER_LESSON, new Uint8Array([1]));
    canvasObserver.onUpdate(LESSON, new Uint8Array([7, 7, 7]));
    await journal.flushJournalsForTest();
    const tail = inserted.slice(3);
    expect(tail.map((e) => e.kind)).toEqual(["room_event", "yjs_update"]);
    expect(tail[0]!.payload).toEqual({ type: "stage_changed", stage: "people" });
    expect(tail[1]!.data).toEqual(Buffer.from([7, 7, 7]));
    expect(JSON.stringify(inserted)).not.toContain("секрет");
  });

  it("порядок seq — порядок поступления, без пропусков", async () => {
    for (let i = 0; i < 5; i++) canvasObserver.onUpdate(LESSON, new Uint8Array([i]));
    await journal.flushJournalsForTest();
    const seqs = inserted.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(inserted.slice(3).map((e) => e.data![0])).toEqual([0, 1, 2, 3, 4]);
  });

  it("сбой записи в БД: пачка остаётся и уходит следующим сбросом с теми же seq", async () => {
    await journal.flushJournalsForTest();
    rawRepoMock.insertJournalEvents.mockRejectedValueOnce(new Error("db down"));
    canvasObserver.onUpdate(LESSON, new Uint8Array([1]));
    await journal.flushJournalsForTest();
    canvasObserver.onUpdate(LESSON, new Uint8Array([2]));
    await journal.flushJournalsForTest();
    expect(inserted.slice(3).map((e) => [e.seq, e.data![0]])).toEqual([
      [4, 1],
      [5, 2],
    ]);
  });

  it("viewport — только того, за кем следует запись, без повторов", async () => {
    await journal.flushJournalsForTest();
    const vp = { scrollX: 1, scrollY: 2, zoom: 1, containerWidth: 100, containerHeight: 50 };
    canvasObserver.onAwareness(LESSON, [{ clientId: 1, user: { id: "someone-else" }, viewport: { ...vp, scrollX: 99 } }]);
    canvasObserver.onAwareness(LESSON, [{ clientId: 2, user: { id: FOLLOW }, viewport: vp }]);
    canvasObserver.onAwareness(LESSON, [{ clientId: 2, user: { id: FOLLOW }, viewport: vp }]);
    await journal.flushJournalsForTest();
    const viewports = inserted.filter((e) => e.kind === "viewport");
    expect(viewports).toHaveLength(1);
    expect(viewports[0]!.payload).toEqual({ userId: FOLLOW, viewport: vp });
  });

  it("частые viewport прореживаются, но последний не теряется", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
      for (let i = 0; i < 5; i++) {
        canvasObserver.onAwareness(LESSON, [{ clientId: 2, user: { id: FOLLOW }, viewport: { scrollX: i } }]);
      }
      await journal.flushJournalsForTest();
      vi.setSystemTime(new Date("2026-10-12T10:00:00.200Z"));
      await journal.flushJournalsForTest();
      const xs = inserted.filter((e) => e.kind === "viewport").map((e) => (e.payload as { viewport: { scrollX: number } }).viewport.scrollX);
      expect(xs).toEqual([0, 4]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("запись закончилась — journal_stopped, дальше событий нет", async () => {
    rawRepoMock.listActiveRawRecordings.mockResolvedValue([]);
    await journal.syncJournals();
    canvasObserver.onUpdate(LESSON, new Uint8Array([1]));
    await journal.flushJournalsForTest();
    expect(inserted.at(-1)!.kind).toBe("journal_stopped");
    expect(inserted.filter((e) => e.kind === "yjs_update")).toHaveLength(0);
    expect(journal.activeJournalCount()).toBe(0);
  });

  it("после рестарта API журнал продолжается с последнего seq и новым ключевым кадром", async () => {
    await journal.stopJournal();
    inserted = [];
    rawRepoMock.maxJournalSeq.mockResolvedValue(41);
    await journal.startJournal();
    await journal.flushJournalsForTest();
    expect(inserted[0]).toMatchObject({ seq: 42, kind: "journal_started", payload: { reason: "resume" } });
    expect(inserted.map((e) => e.kind)).toContain("yjs_snapshot");
  });

  it("задание на сцене: вид задания пишется при изменении, повтор не пишется", async () => {
    const view = { activityId: "a1", materialTitle: "Т", material: { blocks: [] }, progress: { students: [] } };
    activitiesMock.getRecorderView.mockResolvedValue(view);
    roomListener(LESSON, { type: "activity_started", activityId: "a1" } as ServerRoomMessage);
    await vi.waitFor(() => expect(activitiesMock.getRecorderView).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    roomListener(LESSON, { type: "activity_started", activityId: "a1" } as ServerRoomMessage);
    await vi.waitFor(() => expect(activitiesMock.getRecorderView).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    await journal.flushJournalsForTest();
    // Повторный старт того же задания сбрасывает хэш — снимок пишется снова (сцена могла смениться).
    expect(inserted.filter((e) => e.kind === "activity_view")).toHaveLength(2);
  });
});
