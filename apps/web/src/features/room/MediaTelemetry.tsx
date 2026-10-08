import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, DisconnectReason, RoomEvent, Track, type Room } from "livekit-client";
import { errorFields, track } from "../../shared/telemetry.js";

/**
 * События медиасоединения урока — в серверный лог (shared/telemetry.ts).
 * identity = participantId из livekit_token_created на сервере, комната —
 * имя LiveKit-комнаты: строки сводятся с логами LiveKit-сервера и вебхуками.
 * Ничего не показывает и на урок не влияет.
 */
export function MediaTelemetry({ lessonId }: { lessonId: string }) {
  const room = useRoomContext();

  useEffect(() => {
    let attempt = 0;
    let connectingSince = 0;
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSlow = () => {
      if (slowTimer) clearTimeout(slowTimer);
      slowTimer = null;
    };
    let reconnectingSince = 0;
    const base = () => ({
      lessonId,
      livekitRoom: room.name || null,
      identity: room.localParticipant.identity || null,
      online: navigator.onLine,
    });

    const onState = (state: ConnectionState) => {
      if (state === ConnectionState.Connecting) {
        connectingSince = Date.now();
        track("livekit_connection_started", { ...base(), attempt });
        attempt += 1;
        clearSlow();
        // ICE/DTLS не сходятся — без этого такие ученики видны только как
        // «подключился через минуту» или вовсе не видны (ушли сами).
        slowTimer = setTimeout(() => {
          if (room.state === ConnectionState.Connecting) {
            track("livekit_connect_slow", { ...base(), waitedMs: Date.now() - connectingSince });
          }
        }, CONNECT_SLOW_MS);
      } else if (state === ConnectionState.Connected && connectingSince > 0) {
        track("livekit_connected", { ...base(), durationMs: Date.now() - connectingSince });
        connectingSince = 0;
        clearSlow();
      } else if (state === ConnectionState.Disconnected) {
        clearSlow();
      }
    };
    const onReconnecting = (kind: "media" | "signal") => () => {
      if (reconnectingSince === 0) reconnectingSince = Date.now();
      track("livekit_reconnecting", { ...base(), kind });
    };
    const onMediaReconnecting = onReconnecting("media");
    const onSignalReconnecting = onReconnecting("signal");
    const onReconnected = () => {
      track("livekit_reconnected", { ...base(), durationMs: reconnectingSince ? Date.now() - reconnectingSince : null });
      reconnectingSince = 0;
    };
    const onDisconnected = (reason?: DisconnectReason) => {
      track("livekit_disconnected", {
        ...base(),
        reason: reason === undefined ? null : (DisconnectReason[reason] ?? String(reason)),
      });
      reconnectingSince = 0;
    };
    const onDevicesError = (err: Error) => {
      track("client_error", { ...base(), area: "media_devices", ...errorFields(err) });
    };

    room.on(RoomEvent.ConnectionStateChanged, onState);
    room.on(RoomEvent.Reconnecting, onMediaReconnecting);
    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.MediaDevicesError, onDevicesError);
    return () => {
      clearSlow();
      room.off(RoomEvent.ConnectionStateChanged, onState);
      room.off(RoomEvent.Reconnecting, onMediaReconnecting);
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.MediaDevicesError, onDevicesError);
    };
  }, [room, lessonId]);

  useEffect(() => {
    const sampler = new MediaStatsSampler(room, lessonId);
    let firstTimer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (firstTimer) clearTimeout(firstTimer);
      if (interval) clearInterval(interval);
      firstTimer = null;
      interval = null;
    };
    const start = () => {
      stop();
      // Через несколько секунд после подключения пара ICE уже выбрана, а
      // первые кадры камеры ушли — раньше статистика пустая.
      firstTimer = setTimeout(() => void sampler.sample(), FIRST_SAMPLE_MS);
      interval = setInterval(() => void sampler.sample(), QUALITY_INTERVAL_MS);
    };
    const onState = (state: ConnectionState) => {
      if (state === ConnectionState.Connected) start();
      else if (state === ConnectionState.Disconnected) stop();
    };
    // После переподключения путь мог смениться (UDP → TCP/TURN) — проверить сразу.
    const onReconnected = () => start();
    if (room.state === ConnectionState.Connected) start();
    room.on(RoomEvent.ConnectionStateChanged, onState);
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      stop();
      room.off(RoomEvent.ConnectionStateChanged, onState);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room, lessonId]);

  return null;
}

const CONNECT_SLOW_MS = 15_000;
const FIRST_SAMPLE_MS = 5_000;
const QUALITY_INTERVAL_MS = 60_000;
/** getStats на каждую принимаемую камеру класса 30 раз в минуту не нужен — хватит выборки. */
const MAX_RECV_TRACKS = 12;

type StatsEntry = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function statsOfType(report: RTCStatsReport, type: string): StatsEntry[] {
  const out: StatsEntry[] = [];
  report.forEach((s: StatsEntry) => {
    if (s.type === type) out.push(s);
  });
  return out;
}

/** Выбранная пара ICE: transport.selectedCandidatePairId (Chrome/Safari) или nominated+succeeded. */
function selectedPath(report: RTCStatsReport) {
  const pairId = statsOfType(report, "transport")
    .map((t) => str(t.selectedCandidatePairId))
    .find((id) => id !== null);
  const pair: StatsEntry | undefined =
    (pairId ? (report.get(pairId) as StatsEntry | undefined) : undefined) ??
    statsOfType(report, "candidate-pair").find((p) => p.selected === true || (p.nominated === true && p.state === "succeeded"));
  if (!pair) return null;
  const local = report.get(String(pair.localCandidateId)) as StatsEntry | undefined;
  const remote = report.get(String(pair.remoteCandidateId)) as StatsEntry | undefined;
  const rtt = num(pair.currentRoundTripTime);
  const out = num(pair.availableOutgoingBitrate);
  return {
    localType: str(local?.candidateType),
    protocol: str(local?.protocol),
    relayProtocol: str(local?.relayProtocol),
    remoteType: str(remote?.candidateType),
    rttMs: rtt === null ? null : Math.round(rtt * 1000),
    availableOutKbps: out === null ? null : Math.round(out / 1000),
  };
}

/**
 * Раз в минуту — тип пути ICE и качество медиа в серверный лог. Отвечает на
 * вопросы аудита LiveKit 2026-10-07: есть ли ученики на TCP/TURN, у скольких
 * отправка упирается в канал (`bandwidth`) или процессор (`cpu`), сколько
 * заморозок видео на приёме. Ничего не показывает.
 */
class MediaStatsSampler {
  private lastPathKey: string | null = null;
  private lastBytesSent: { at: number; bytes: number } | null = null;
  private lastFreezes = new Map<string, number>();
  private lastAudio = new Map<string, { concealed: number; total: number }>();
  private running = false;

  constructor(
    private readonly room: Room,
    private readonly lessonId: string,
  ) {}

  async sample(): Promise<void> {
    if (this.running || this.room.state !== ConnectionState.Connected) return;
    this.running = true;
    try {
      await this.sampleInner();
    } catch {
      // Статистика — не повод для ошибки урока; следующий тик попробует снова.
    } finally {
      this.running = false;
    }
  }

  private async sampleInner(): Promise<void> {
    const local = this.room.localParticipant;
    const camera = local.getTrackPublication(Track.Source.Camera)?.track;
    const mic = local.getTrackPublication(Track.Source.Microphone)?.track;
    const cameraReport = camera && !camera.isMuted ? await camera.getRTCStatsReport() : undefined;

    const remoteVideo: { sid: string; report: RTCStatsReport }[] = [];
    const remoteAudio: { sid: string; report: RTCStatsReport }[] = [];
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        const t = pub.track;
        if (!t || !pub.isSubscribed) continue;
        const bucket = t.kind === Track.Kind.Video ? remoteVideo : remoteAudio;
        if (bucket.length >= MAX_RECV_TRACKS) continue;
        const report = await t.getRTCStatsReport();
        if (report) bucket.push({ sid: pub.trackSid, report });
      }
    }

    // Путь: любой отчёт, где есть транспорт. Свой микрофон есть почти всегда.
    const pathReport =
      cameraReport ?? (mic ? await mic.getRTCStatsReport() : undefined) ?? remoteAudio[0]?.report ?? remoteVideo[0]?.report;
    const path = pathReport ? selectedPath(pathReport) : null;
    const base = {
      lessonId: this.lessonId,
      livekitRoom: this.room.name || null,
      identity: local.identity || null,
    };
    if (path) {
      const key = `${path.localType}/${path.protocol}/${path.relayProtocol}/${path.remoteType}`;
      if (key !== this.lastPathKey) {
        track("media_path", {
          ...base,
          localType: path.localType,
          protocol: path.protocol,
          relayProtocol: path.relayProtocol,
          remoteType: path.remoteType,
          previous: this.lastPathKey,
        });
        this.lastPathKey = key;
      }
    }

    // Отправка своей камеры: самый высокий активный слой simulcast.
    let sendHeight: number | null = null;
    let sendFps: number | null = null;
    let sendLimit: string | null = null;
    let sendKbps: number | null = null;
    if (cameraReport) {
      let bytes = 0;
      for (const o of statsOfType(cameraReport, "outbound-rtp")) {
        bytes += num(o.bytesSent) ?? 0;
        sendLimit ??= str(o.qualityLimitationReason);
        const h = num(o.frameHeight);
        if (h !== null && (num(o.framesPerSecond) ?? 0) > 0 && (sendHeight === null || h > sendHeight)) {
          sendHeight = h;
          sendFps = num(o.framesPerSecond);
        }
      }
      const now = Date.now();
      if (this.lastBytesSent && bytes >= this.lastBytesSent.bytes) {
        sendKbps = Math.round(((bytes - this.lastBytesSent.bytes) * 8) / (now - this.lastBytesSent.at));
      }
      this.lastBytesSent = { at: now, bytes };
    } else {
      this.lastBytesSent = null;
    }

    // Приём: новые заморозки видео и доля маскированного звука с прошлого тика.
    let recvFreezes = 0;
    let recvMinFps: number | null = null;
    const freezes = new Map<string, number>();
    for (const { sid, report } of remoteVideo) {
      for (const i of statsOfType(report, "inbound-rtp")) {
        const count = num(i.freezeCount) ?? 0;
        freezes.set(sid, count);
        recvFreezes += Math.max(0, count - (this.lastFreezes.get(sid) ?? count));
        const fps = num(i.framesPerSecond);
        if (fps !== null && (recvMinFps === null || fps < recvMinFps)) recvMinFps = fps;
      }
    }
    this.lastFreezes = freezes;
    let concealed = 0;
    let total = 0;
    const audio = new Map<string, { concealed: number; total: number }>();
    for (const { sid, report } of remoteAudio) {
      for (const i of statsOfType(report, "inbound-rtp")) {
        // Тишину собеседника (DTX: в паузах Opus почти не шлёт пакеты) браузер
        // тоже маскирует — без вычета silentConcealedSamples выключенный или
        // молчащий микрофон давал 50–100% «потерь».
        const cur = {
          concealed: Math.max(0, (num(i.concealedSamples) ?? 0) - (num(i.silentConcealedSamples) ?? 0)),
          total: num(i.totalSamplesReceived) ?? 0,
        };
        audio.set(sid, cur);
        const prev = this.lastAudio.get(sid);
        if (prev && cur.total >= prev.total) {
          concealed += cur.concealed - prev.concealed;
          total += cur.total - prev.total;
        }
      }
    }
    this.lastAudio = audio;

    track("media_quality", {
      ...base,
      pathType: path?.localType ?? null,
      protocol: path?.protocol ?? null,
      rttMs: path?.rttMs ?? null,
      availableOutKbps: path?.availableOutKbps ?? null,
      sendHeight,
      sendFps,
      sendLimit,
      sendKbps,
      recvVideo: remoteVideo.length,
      recvMinFps,
      recvFreezes,
      recvAudioConcealedPct: total > 0 ? Math.round((concealed / total) * 1000) / 10 : null,
      hidden: document.visibilityState === "hidden",
    });
  }
}

/** Подключение к LiveKit не удалось (onError у `<LiveKitRoom>`, повтор в MediaRecovery). */
export function reportLiveKitConnectionFailed(lessonId: string, err: unknown, stage: "initial" | "recover"): void {
  track("livekit_connection_failed", { lessonId, stage, online: navigator.onLine, ...errorFields(err) });
}
