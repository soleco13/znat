import { useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import type { LessonStage, ParticipantSnapshot, ServerRoomMessage } from "@school/shared";
import { Board } from "@/features/canvas/Board.js";
import { RoomVideoGrid } from "@/features/room/RoomVideoGrid.js";
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
 * урока И presence — `rooms/ws.ts` шлёт recorder'у и то, и другое сразу
 * при подключении, как живому участнику) + REST `/activities/:id/
 * recorder-view` (агрегированный вид задания, `plugins/recorder-access.ts`).
 * Кадр — та же композиция «главное + лента камер справа», что в живом
 * уроке (`RoomPage.tsx#StageContent`): пользователь явно попросил, чтобы
 * запись показывала «всё, что есть в сетке камер», не только то, что
 * сейчас на сцене (доработка после первого теста записи, 2026-09-11).
 *  - идёт демонстрация экрана — она в приоритете (самый явный сигнал «сюда
 *    смотреть») крупным планом (`ScreenShareTile`, тот же компонент, что в
 *    живом уроке) + лента ВСЕХ участников (`RoomVideoGrid` `rail`, включая
 *    учителя — как в живом уроке, а не только его отдельная плитка);
 *  - иначе задание на сцене (`activity_started`) — учительский вид
 *    мониторинга (`RecorderActivityStage`, БЕЗ ключей и личных ответов —
 *    решение пользователя от 2026-09-11) + та же лента;
 *  - иначе стейдж = «доска» — `Board` тем же компонентом, что и живой урок
 *    (`connectionToken`/`readOnlyChrome`), без интерактивного тулбара + лента;
 *  - иначе (стейдж «люди», никто не демонстрирует) — камеры на весь кадр,
 *    `RoomVideoGrid` `grid` (адаптивная сетка, без отдельной ленты — то же
 *    самое, что рельс показал бы построчно).
 *
 * НЕ под нашим JWT и вне `RequireAuth`/`Layout` (см. App.tsx): и LiveKit-, и
 * recorder-токен — из query-параметров, не наша сессия.
 */

interface EgressParams {
  url: string | null;
  token: string | null;
  lessonId: string | null;
  recorderToken: string | null;
  followUserId: string | null;
}

function useEgressParams(): EgressParams {
  return useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      url: p.get("url"),
      token: p.get("token"),
      lessonId: p.get("lessonId"),
      recorderToken: p.get("recorderToken"),
      followUserId: p.get("followUserId"),
    };
  }, []);
}

export function EgressPage() {
  const { url, token, lessonId, recorderToken, followUserId } = useEgressParams();

  // Параметры ещё не подставлены (страницу открыли вручную) — чёрный кадр,
  // никаких подключений.
  if (!url || !token) {
    return <div style={FULLSCREEN_BLACK} />;
  }

  return (
    <div style={{ ...FULLSCREEN_BLACK, overflow: "hidden" }}>
      <LiveKitRoom serverUrl={url} token={token} connect audio={false} video={false}>
        <EgressStage lessonId={lessonId} recorderToken={recorderToken} followUserId={followUserId} />
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

/**
 * Демонстрация экрана в записи — в той же общей области main+rail, что и
 * доска/задание (ветка `hasScreen` в `EgressStage` отдаёт этот компонент в
 * `main`, лента камер участников — рядом вертикальной полосой, не поверх
 * видео: запрос пользователя, 2026-09-12). `object-contain`, а не `cover`:
 * `cover` резал бы содержимое при нетипичных пропорциях экрана, а
 * демонстрация — это часто документ/таблица, где обрезанный край теряет
 * данные.
 */
function RecordingScreenShareTile() {
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const track = tracks[0];
  if (!track) return null;
  return (
    <VideoTrack
      trackRef={track}
      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
    />
  );
}

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
function EgressStage({
  lessonId,
  recorderToken,
  followUserId,
}: {
  lessonId: string | null;
  recorderToken: string | null;
  followUserId: string | null;
}) {
  const [stage, setStage] = useState<LessonStage>("people");
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantSnapshot[]>([]);

  // Тот же редьюсер presence-сообщений, что в живом уроке (`RoomPage.tsx`)
  // — recorder получает те же broadcast-события (`rooms/ws.ts`: он сидит на
  // общем `roomEvents.on(lessonId, ...)`), только БЕЗ own `attachSocket`
  // (не участник) и с initial `presence` сразу при подключении.
  const handleMessage = (message: ServerRoomMessage) => {
    switch (message.type) {
      case "stage_changed":
        setStage(message.stage);
        setActiveActivityId(null);
        break;
      case "activity_started":
        setActiveActivityId(message.activityId);
        break;
      case "presence":
        setParticipants(message.participants);
        break;
      case "participant_joined":
        setParticipants((prev) => [
          ...prev.filter((p) => p.userId !== message.participant.userId),
          message.participant,
        ]);
        break;
      case "participant_updated":
        setParticipants((prev) =>
          prev.some((p) => p.userId === message.participant.userId)
            ? prev.map((p) => (p.userId === message.participant.userId ? message.participant : p))
            : [...prev, message.participant],
        );
        break;
      case "participant_left":
      case "participant_removed":
        setParticipants((prev) => prev.filter((p) => p.userId !== message.userId));
        break;
      case "permissions_updated":
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === message.userId ? { ...p, permissions: message.permissions } : p,
          ),
        );
        break;
      case "hand_raised":
        setParticipants((prev) =>
          prev.map((p) => (p.userId === message.userId ? { ...p, handRaised: message.raised } : p)),
        );
        break;
      case "participant_pinned":
        setParticipants((prev) =>
          prev.map((p) => (p.userId === message.userId ? { ...p, pinned: message.pinned } : p)),
        );
        break;
    }
  };

  useRoomSocket(
    lessonId ?? "",
    handleMessage,
    !!lessonId && !!recorderToken,
    "recorder",
    recorderToken ?? undefined,
  );

  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const hasScreen = screenTracks.length > 0;

  let main: React.ReactNode;
  if (hasScreen) {
    // Демонстрация экрана — самый явный сигнал «сюда смотреть», в приоритете
    // над стейджем доски/задания (тот же принцип, что был в Э10.2).
    //
    // Пользователь попросил (2026-09-12) убрать наложение камер поверх
    // демонстрации — как в живом уроке (`RoomPage.tsx#StageContent`), камеры
    // ленты должны быть вертикальной полосой РЯДОМ с демонстрацией, а не
    // прозрачным слоем над ней. Общий блок main+rail ниже уже даёт ровно
    // такую раскладку — здесь просто отдаём в него `RecordingScreenShareTile`
    // вместо доски/задания, тем же путём, что и они.
    main = <RecordingScreenShareTile />;
  } else if (activeActivityId && recorderToken) {
    main = <RecorderActivityStage activityId={activeActivityId} recorderToken={recorderToken} />;
  } else if (stage === "board" && lessonId) {
    main = (
      <Board
        lessonId={lessonId}
        canDraw={false}
        connectionToken={recorderToken ?? undefined}
        readOnlyChrome
        followUserId={followUserId ?? undefined}
      />
    );
  } else {
    main = null;
  }

  // «Люди» без демонстрации — камеры и так на весь кадр (`grid`), отдельная
  // лента рядом с самой собой не нужна (пользовательский запрос — «всё, что
  // в сетке камер» — тут и так вся сетка).
  if (!main) {
    return (
      <div style={{ position: "absolute", inset: 0, background: "#000" }}>
        <RoomVideoGrid participants={participants} selfId={undefined} />
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 12, padding: 12, background: "#000", boxSizing: "border-box" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, background: "#fff", borderRadius: 8, overflow: "hidden" }}>
        {main}
      </div>
      <RoomVideoGrid participants={participants} selfId={undefined} variant="rail" />
    </div>
  );
}
