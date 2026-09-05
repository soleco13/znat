import { useEffect, useMemo, useRef } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";

/**
 * Э10.2 — кастомный layout-шаблон записи (§10.4 ТЗ). Эту страницу
 * (`/egress`) открывает headless-Chrome ВНУТРИ контейнера LiveKit Egress
 * на второй машине; она подключается к комнате урока отдельным
 * recorder-участником и компонует кадр, который egress кодирует в MP4.
 *
 * ЧИТАТЬ ПОСТРОЧНО (CLAUDE.md — «конфиги LiveKit не делегировать вслепую»):
 * ошибка в компоновке/сигналах тихо испортит все записи, заметят через недели.
 *
 * Протокол LiveKit для кастомных шаблонов (github.com/livekit/egress,
 * «Custom recording templates»):
 *  - egress открывает `{RECORDING_EGRESS_TEMPLATE_URL}?url=<ws>&token=<jwt>&layout=<name>`;
 *  - шаблон подключается к комнате этим `token` (у него грант `recorder`);
 *  - как только кадр готов — пишем в консоль ровно `START_RECORDING`;
 *  - когда комната закрылась / запись остановлена — пишем `END_RECORDING`,
 *    и egress финализирует файл.
 * Строки в консоли — это и есть контракт; их читает egress-сервис.
 *
 * НЕ под нашим JWT и вне `RequireAuth`/`Layout` (см. App.tsx): токен здесь —
 * это LiveKit access token из query-параметра, а не наша сессия.
 *
 * Компоновка (§Э10.2: «доска/слайд крупно + плитка учителя»): в реальном
 * уроке доска показывается через демонстрацию экрана учителя (Э7), поэтому
 * крупный план — это трек SCREEN_SHARE, а плитка учителя в углу — камера
 * того же участника. Демонстрации нет → крупным планом камера учителя.
 */

interface EgressParams {
  url: string | null;
  token: string | null;
  layout: string;
}

function useEgressParams(): EgressParams {
  return useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return { url: p.get("url"), token: p.get("token"), layout: p.get("layout") ?? "" };
  }, []);
}

export function EgressPage() {
  const { url, token } = useEgressParams();

  // Параметры ещё не подставлены (страницу открыли вручную) — чёрный кадр,
  // никаких подключений.
  if (!url || !token) {
    return <div style={FULLSCREEN_BLACK} />;
  }

  return (
    <div style={{ ...FULLSCREEN_BLACK, overflow: "hidden" }}>
      <LiveKitRoom serverUrl={url} token={token} connect audio={false} video={false}>
        <EgressComposite />
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

/** Сигналы `START_RECORDING` / `END_RECORDING` в консоль — контракт с egress. */
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

function EgressComposite() {
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], {
    onlySubscribed: true,
  });

  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);
  const teacherCam =
    (screen && cameras.find((c) => c.participant.identity === screen.participant.identity)) ??
    cameras[0];
  const stage = screen ?? teacherCam;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {stage ? (
        <VideoTrack
          trackRef={stage}
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
