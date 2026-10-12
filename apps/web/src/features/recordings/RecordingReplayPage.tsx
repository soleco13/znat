import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  rawReplayDataSchema,
  type JournalEvent,
  type LessonStage,
  type RawReplayData,
  type RecorderActivityView,
  type ServerRoomMessage,
} from "@school/shared";
import { Board } from "@/features/canvas/Board.js";
import { RecorderActivitySheet } from "./RecorderActivityStage.js";
import { ReplayCollabServer, installReplayCollab, type ViewportState } from "./replay-collab.js";

/**
 * Страница кадров экспериментальной записи (docs/experimental-recording.md).
 * Её открывает headless-Chrome рендера ПОСЛЕ урока и снимает кадры главной
 * области записи — доски и задания — в нужные моменты времени. Камеры,
 * звук и демонстрацию рендер берёт из записанных дорожек сам.
 *
 * Компоненты — те же, что в живом уроке и в шаблоне Egress (`/egress`):
 * `Board` (через эмуляцию Hocuspocus на журнале, `replay-collab.ts`) и
 * лист задания (`RecorderActivitySheet`). Логика сцены — как в
 * `EgressPage.tsx`: `activity_started` показывает задание, следующий
 * `stage_changed` его снимает; иначе сцена «доска» или «люди».
 *
 * Контракт с рендером (services/raw-recorder, CDP):
 *   window.__matisReplay.state     — "loading" | "ready" | "error";
 *   window.__matisReplay.info()    — шкала и моменты изменений;
 *   window.__matisReplay.seek(t)   — показать главную область на момент t
 *                                    (Unix мс), промис — кадр готов к снимку.
 * Не под нашим JWT (как `/egress`): журнал — по recorder-токену из query.
 */

type SceneKind = "board" | "activity" | "people";

interface SceneInterval {
  fromMs: number;
  kind: SceneKind;
  activityId: string | null;
}

interface ReplayInfo {
  t0Ms: number;
  t1Ms: number;
  scenes: SceneInterval[];
  /** Моменты, когда меняется картинка доски/задания (Unix мс, по возрастанию). */
  changeTimes: number[];
}

interface ReplayApi {
  state: "loading" | "ready" | "error";
  error: string | null;
  info(): ReplayInfo;
  seek(tMs: number): Promise<{ kind: SceneKind }>;
}

declare global {
  interface Window {
    __matisReplay?: ReplayApi;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Сцены по журналу — та же логика, что `EgressStage` в EgressPage.tsx. */
function buildScenes(data: RawReplayData): SceneInterval[] {
  const scenes: SceneInterval[] = [];
  let stage: LessonStage = "people";
  let activityId: string | null = null;
  const push = (fromMs: number) => {
    const kind: SceneKind = activityId ? "activity" : stage === "board" ? "board" : "people";
    const last = scenes[scenes.length - 1];
    if (last && last.kind === kind && last.activityId === activityId) return;
    if (last && last.fromMs === fromMs) scenes.pop();
    scenes.push({ fromMs, kind, activityId });
  };
  push(data.t0Ms);
  for (const ev of data.events) {
    if (ev.kind === "lesson_snapshot") {
      const snap = ev.payload as { stage?: LessonStage } | null;
      if (snap?.stage) stage = snap.stage;
    } else if (ev.kind === "room_event") {
      const msg = ev.payload as ServerRoomMessage;
      if (msg.type === "stage_changed") {
        stage = msg.stage;
        activityId = null;
      } else if (msg.type === "activity_started") {
        activityId = msg.activityId;
      } else {
        continue;
      }
    } else {
      continue;
    }
    push(Math.max(ev.tsMs, data.t0Ms));
  }
  return scenes;
}

function sceneAt(scenes: SceneInterval[], tMs: number): SceneInterval {
  let current = scenes[0]!;
  for (const s of scenes) {
    if (s.fromMs <= tMs) current = s;
    else break;
  }
  return current;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Кадр готов: два кадра отрисовки, загруженные картинки (слайды), ещё кадр. */
async function settle(extraMs: number): Promise<void> {
  await nextFrame();
  await nextFrame();
  if (extraMs > 0) await sleep(extraMs);
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline && [...document.images].some((img) => !img.complete)) {
    await sleep(50);
  }
  await nextFrame();
  await nextFrame();
}

function useReplayParams() {
  return useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return { rid: p.get("rid"), token: p.get("token") };
  }, []);
}

export function RecordingReplayPage() {
  const { rid, token } = useReplayParams();
  const [data, setData] = useState<RawReplayData | null>(null);
  const [scene, setScene] = useState<{ kind: SceneKind; view: RecorderActivityView | null }>({ kind: "board", view: null });

  useEffect(() => {
    const api: ReplayApi = {
      state: "loading",
      error: null,
      info: () => {
        throw new Error("not ready");
      },
      seek: () => Promise.reject(new Error("not ready")),
    };
    window.__matisReplay = api;
    if (!rid || !token) {
      api.state = "error";
      api.error = "missing rid/token";
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/raw-recordings/${rid}/replay`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`replay data: HTTP ${res.status}`);
        const parsed = rawReplayDataSchema.parse(await res.json());
        if (cancelled) return;
        const player = createPlayer(parsed, (next) => flushSync(() => setScene(next)));
        installReplayCollab(player.server);
        api.info = player.info;
        api.seek = player.seek;
        // Доска получает состояние начала записи сразу при подключении:
        // первый ключевой кадр журнала снят через миллисекунды после t0.
        player.applyUntil(player.initialMs);
        setData(parsed);
        await waitForBoard();
        api.state = "ready";
      } catch (err) {
        api.state = "error";
        api.error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rid, token]);

  if (!data) return <div style={FULLSCREEN} />;

  return (
    <div style={FULLSCREEN}>
      <div style={{ position: "absolute", inset: 0 }}>
        <Board
          lessonId={data.lessonId}
          canDraw={false}
          connectionToken="replay"
          readOnlyChrome
          followUserId={data.followUserId}
        />
      </div>
      {scene.kind === "activity" && scene.view && (
        <div style={{ position: "absolute", inset: 0, background: "#fff" }}>
          <RecorderActivitySheet view={scene.view} />
        </div>
      )}
    </div>
  );
}

const FULLSCREEN: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  background: "#fff",
  overflow: "hidden",
};

/** Доска смонтирована и холст Excalidraw на месте. */
async function waitForBoard(): Promise<void> {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    if (document.querySelector(".excalidraw canvas")) {
      await settle(300);
      return;
    }
    await sleep(100);
  }
  throw new Error("board did not mount");
}

/**
 * Проигрыватель журнала: только вперёд по времени (рендер снимает кадры по
 * возрастанию t). Yjs-события применяются по порядку `seq`; ключевые кадры
 * (`yjs_snapshot`) — тем же `applyUpdate`, повтор безвреден.
 */
function createPlayer(
  data: RawReplayData,
  showScene: (scene: { kind: SceneKind; view: RecorderActivityView | null }) => void,
) {
  const server = new ReplayCollabServer(data.followUserId);
  const yjsEvents = data.events.filter((e) => (e.kind === "yjs_snapshot" || e.kind === "yjs_update") && e.data);
  const viewportEvents = data.events.filter((e) => e.kind === "viewport");
  const activityViews = data.events.filter((e) => e.kind === "activity_view");
  const scenes = buildScenes(data);
  let yjsCursor = 0;
  let viewportCursor = 0;
  let lastViewport: JournalEvent | null = null;

  const activePage = () => server.doc.getMap("meta").get("activePageId");

  function applyUntil(tMs: number): { pageChanged: boolean } {
    const before = activePage();
    while (yjsCursor < yjsEvents.length && yjsEvents[yjsCursor]!.tsMs <= tMs) {
      server.applyUpdate(base64ToBytes(yjsEvents[yjsCursor]!.data!));
      yjsCursor += 1;
    }
    while (viewportCursor < viewportEvents.length && viewportEvents[viewportCursor]!.tsMs <= tMs) {
      lastViewport = viewportEvents[viewportCursor]!;
      viewportCursor += 1;
    }
    if (lastViewport) {
      const vp = (lastViewport.payload as { viewport: ViewportState }).viewport;
      server.setViewport(vp);
      lastViewport = null;
    }
    return { pageChanged: before !== activePage() };
  }

  function viewAt(activityId: string, tMs: number): RecorderActivityView | null {
    let found: RecorderActivityView | null = null;
    for (const ev of activityViews) {
      if (ev.tsMs > tMs) break;
      const view = ev.payload as RecorderActivityView;
      if (view.activityId === activityId) found = view;
    }
    return found;
  }

  const changeTimes = [
    ...scenes.map((s) => s.fromMs),
    ...yjsEvents.map((e) => e.tsMs),
    ...viewportEvents.map((e) => e.tsMs),
    ...activityViews.map((e) => e.tsMs),
  ]
    .filter((t) => t >= data.t0Ms && t <= data.t1Ms)
    .sort((a, b) => a - b)
    .filter((t, i, arr) => i === 0 || t !== arr[i - 1]);

  const firstSnapshot = yjsEvents.find((e) => e.kind === "yjs_snapshot");
  const initialMs =
    firstSnapshot && firstSnapshot.tsMs - data.t0Ms < 10_000 ? Math.max(firstSnapshot.tsMs, data.t0Ms) : data.t0Ms;

  return {
    server,
    initialMs,
    applyUntil,
    info: (): ReplayInfo => ({ t0Ms: data.t0Ms, t1Ms: data.t1Ms, scenes, changeTimes }),
    seek: async (tMs: number): Promise<{ kind: SceneKind }> => {
      const { pageChanged } = applyUntil(tMs);
      const s = sceneAt(scenes, tMs);
      const view = s.kind === "activity" && s.activityId ? viewAt(s.activityId, tMs) : null;
      showScene({ kind: s.kind, view });
      // Смена страницы — новый фон (слайд PDF рендерится pdf.js) — ждём дольше.
      await settle(pageChanged ? 800 : 0);
      return { kind: s.kind };
    },
  };
}
