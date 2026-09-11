import { useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import type { LessonStage, ServerRoomMessage } from "@school/shared";
import { Board } from "@/features/canvas/Board.js";
import { useRoomSocket } from "@/features/room/useRoomSocket.js";
import { RecorderActivityStage } from "./RecorderActivityStage.js";

/**
 * Э10.2/Э10.6 — кастомный layout-шаблон записи (§10.4 ТЗ). Эту страницу
 * (`/egress`) открывает headless-Chrome ВНУТРИ контейнера LiveKit Egress
 * на второй машине; она подключается к комнате урока отдельным
 * recorder-участником и компонует кадр, который egress кодирует в MP4.
 *
 * ЧИТАТЬ ПОСТРОЧНО (CLAUDE.md — «конфиги LiveKit» и «работа с Y.Doc» не
 * делегировать вслепую): ошибка в компоновке/сигналах тихо испортит все
 * записи, заметят через недели.
 *
 * Протокол LiveKit для кастомных шаблонов (github.com/livekit/egress,
 * «Custom recording templates», проверено через Context7 по исходнику
 * `pkg/pipeline/source/web.go`):
 *  - egress открывает `customBaseUrl` (уже содержит НАШИ `lessonId`/
 *    `recorderToken` — см. `recordings/service.ts#startLessonRecording`),
 *    ДОписывая `?url=<ws>&token=<jwt>&layout=<name>` — существующие
 *    query-параметры egress сохраняет, не затирает;
 *  - шаблон подключается к комнате этим `token` (у него грант `recorder`);
 *  - как только кадр готов — пишем в консоль ровно `START_RECORDING`;
 *  - когда комната закрылась / запись остановлена — пишем `END_RECORDING`,
 *    и egress финализирует файл.
 * Строки в консоли — это и есть контракт; их читает egress-сервис.
 *
 * Э10.6 — «вся инфа урока» (аудио/камеры/демонстрация — LiveKit-треки;
 * доска/лист с заданиями — НЕТ, это нативные React-компоненты урока, не
 * видео-треки). Recorder — второй, параллельный «немой участник»:
 * LiveKit (для медиа) + WS `/ws?recorderToken=` read-only (для стейджа
 * урока, `rooms/ws.ts`, в обход presence) + REST `/activities/:id/
 * recorder-view` (агрегированный вид задания, `plugins/recorder-access.ts`).
 * Кадр компонует ровно то, что сейчас на сцене урока:
 *  - идёт демонстрация экрана — она в приоритете (самый явный сигнал «сюда
 *    смотреть»), крупным планом + плитка учителя, как и раньше;
 *  - иначе задание на сцене (`activity_started`) — учительский вид
 *    мониторинга (`RecorderActivityStage`, БЕЗ ключей и личных ответов —
 *    решение пользователя от 2026-09-11);
 *  - иначе стейдж = «доска» — читаем `Board` тем же компонентом, что и
 *    живой урок (`connectionToken`/`readOnlyChrome`, Э10.6), без
 *    интерактивного тулбара;
 *  - иначе — камеры (как было в Э10.2).
 *
 * НЕ под нашим JWT и вне `RequireAuth`/`Layout` (см. App.tsx): и LiveKit-, и
 * recorder-токен — из query-параметров, не наша сессия.
 */

interface EgressParams {
  url: string | null;
  token: string | null;
  lessonId: string | null;
  recorderToken: string | null;
}

function useEgressParams(): EgressParams {
  return useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      url: p.get("url"),
      token: p.get("token"),
      lessonId: p.get("lessonId"),
      recorderToken: p.get("recorderToken"),
    };
  }, []);
}

export function EgressPage() {
  const { url, token, lessonId, recorderToken } = useEgressParams();

  // Параметры ещё не подставлены (страницу открыли вручную) — чёрный кадр,
  // никаких подключений.
  if (!url || !token) {
    return <div style={FULLSCREEN_BLACK} />;
  }

  return (
    <div style={{ ...FULLSCREEN_BLACK, overflow: "hidden" }}>
      <LiveKitRoom serverUrl={url} token={token} connect audio={false} video={false}>
        <EgressStage lessonId={lessonId} recorderToken={recorderToken} />
        {/* Аудио комнаты играет в скрытых <audio> — Chrome внутри egress
            захватывает звук вкладки, поэтому рендерер обязателен. */}
        <RoomAudioRenderer />
        <RecordingSignal />
      </LiveKitRoom>
    </div>
  );
}

const FULLSCREEN_BLACK: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  background: "#000",
};

/** Сигналы `START_RECORDING` / `END_RECORDING` в консоль — контракт с egress. Не зависит от стейджа/WS ниже. */
function RecordingSignal() {
  const state = useConnectionState();
  const started = useRef(false);

  useEffect(() => {
    if (state === ConnectionState.Connected && !started.current) {
      started.current = true;
      // eslint-disable-next-line no-console
      console.log("START_RECORDING");
    } else if (state === ConnectionState.Disconnected && started.current) {
      // eslint-disable-next-line no-console
      console.log("END_RECORDING");
    }
  }, [state]);

  return null;
}

/**
 * Стейдж урока для recorder'а. Сервер не хранит «идёт ли сейчас задание»
 * (то же самое, что у живого участника без WS-сигнала — см. докстринг
 * файла): `activity_started` включает показ задания, а следующий
 * `stage_changed` (учитель явно переключил доску/людей) его снимает — у
 * recorder'а нет кнопки «Свернуть», поэтому решение принимает сервер стейджа,
 * не локальный клик.
 */
function EgressStage({ lessonId, recorderToken }: { lessonId: string | null; recorderToken: string | null }) {
  const [stage, setStage] = useState<LessonStage>("people");
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);

  const handleMessage = (message: ServerRoomMessage) => {
    if (message.type === "stage_changed") {
      setStage(message.stage);
      setActiveActivityId(null);
    } else if (message.type === "activity_started") {
      setActiveActivityId(message.activityId);
    }
  };

  useRoomSocket(
    lessonId ?? "",
    handleMessage,
    !!lessonId && !!recorderToken,
    "recorder",
    recorderToken ?? undefined,
  );

  // Только присутствие демонстрации — сам композитинг ниже, в
  // `CameraComposite`, своим вызовом `useTracks` (тот же приём, что был в
  // Э10.2): `ReturnType<typeof useTracks>` на дженерик-хуке резолвится в
  // широкий `TrackReferenceOrPlaceholder[]`, а `VideoTrack` требует узкий
  // `TrackReference[]` — передавать треки пропом типобезопасно не вышло,
  // поэтому каждый компонент, которому нужны треки, зовёт хук сам.
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const hasScreen = screenTracks.length > 0;

  // Демонстрация экрана — самый явный сигнал «сюда смотреть», в приоритете
  // над стейджем доски/задания (тот же принцип, что уже был в Э10.2).
  if (hasScreen) {
    return <CameraComposite />;
  }
  if (activeActivityId && recorderToken) {
    return <RecorderActivityStage activityId={activeActivityId} recorderToken={recorderToken} />;
  }
  if (stage === "board" && lessonId) {
    return (
      <div style={{ position: "absolute", inset: 0, background: "#fff" }}>
        <Board lessonId={lessonId} canDraw={false} connectionToken={recorderToken ?? undefined} readOnlyChrome />
      </div>
    );
  }
  return <CameraComposite />;
}

function CameraComposite() {
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], { onlySubscribed: true });
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);
  const teacherCam =
    (screen && cameras.find((c) => c.participant.identity === screen.participant.identity)) ??
    cameras[0];
  const stageTrack = screen ?? teacherCam;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {stageTrack ? (
        <VideoTrack
          trackRef={stageTrack}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            color: "#888",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Ожидание видео урока…
        </div>
      )}

      {/* Плитка учителя поверх демонстрации — только когда крупным планом
          идёт экран (иначе учитель и так крупным планом). */}
      {screen && teacherCam && (
        <div
          style={{
            position: "absolute",
            right: "2.5%",
            bottom: "2.5%",
            width: "22%",
            aspectRatio: "16 / 9",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 0 0 2px rgba(255,255,255,0.75)",
            background: "#111",
          }}
        >
          <VideoTrack
            trackRef={teacherCam}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}
    </div>
  );
}
