import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, DisconnectReason, RoomEvent, Track, type Room } from "livekit-client";
import { errorFields, track } from "../../shared/telemetry.js";
import { currentPressure } from "./cpu-load-engine.js";
import { receivePressure } from "./receive-pressure.js";
import { peerStats, statsEntries } from "./peer-stats.js";

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
      const durationMs = reconnectingSince ? Date.now() - reconnectingSince : null;
      track("livekit_reconnected", { ...base(), durationMs });
      // Долгое восстановление — отдельным событием (как «Long conference
      // reconnection» у Контур Толка): по нему видно, где resume не спас.
      if (durationMs !== null && durationMs > SLOW_RESTORE_MS) track("livekit_restore_slow", { ...base(), durationMs });
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
/** Восстановление дольше — отдельное событие `livekit_restore_slow`. */
const SLOW_RESTORE_MS = 30_000;
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
  /** Накопительные счётчики соединения с прошлого тика (одним `getStats`). */
  private lastTotals: Record<string, number> | null = null;
  private lastAudio = new Map<string, { concealed: number; total: number; jbDelay: number; jbTarget: number; jbEmitted: number }>();
  private lastVideo = new Map<string, { decoded: number; decodeS: number; dropped: number }>();
  private running = false;

  constructor(
    private readonly room: Room,
    private readonly lessonId: string,
  ) {}

  private async connectionTotals(captureHeight: number | null, sendHeight: number | null): Promise<Record<string, number | string | null>> {
    const cur = await readTotals(this.room).catch(() => null);
    const prev = this.lastTotals;
    this.lastTotals = cur;
    const out: Record<string, number | string | null> = {
      computePressure: currentPressure(),
      cameraDownscale: captureHeight && sendHeight ? Math.round((captureHeight / sendHeight) * 100) / 100 : null,
    };
    if (!cur) return out;
    if (typeof cur.upLossPct === "number") out.upLossPct = cur.upLossPct;
    if (typeof cur.bweDownKbps === "number") out.bweDownKbps = cur.bweDownKbps;
    if (!prev) return out;
    const d = (k: string) => Math.max(0, (cur[k] ?? 0) - (prev[k] ?? 0));
    const recv = d("inRecv");
    const lost = d("inLost");
    out.downLossPct = recv + lost > 0 ? Math.round((lost / (recv + lost)) * 1000) / 10 : null;
    out.recvFreezeMs = Math.round(d("freezeS") * 1000);
    out.pliIn = d("pliIn");
    out.pliOut = d("pliOut");
    out.keyFramesEncoded = d("keyEnc");
    out.keyFramesDecoded = d("keyDec");
    out.cpuLimitedS = Math.round(d("qlCpuS"));
    out.bwLimitedS = Math.round(d("qlBwS"));
    return out;
  }

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
    const screen = local.getTrackPublication(Track.Source.ScreenShare)?.track;
    const screenReport = screen ? await screen.getRTCStatsReport() : undefined;

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
    // Сколько кадров камера отдаёт на самом деле (запрошенная частота — в getSettings).
    let captureFps: number | null = null;
    if (cameraReport) {
      for (const m of statsOfType(cameraReport, "media-source")) {
        if (m.kind === "video") captureFps = num(m.framesPerSecond);
      }
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

    // Своя демонстрация: верхний активный слой и причина ограничения — видно,
    // упирается ли она в процессор (урок 2026-10-09: этого в логе не было).
    let shareHeight: number | null = null;
    let shareFps: number | null = null;
    let shareLimit: string | null = null;
    if (screenReport) {
      for (const o of statsOfType(screenReport, "outbound-rtp")) {
        const reason = str(o.qualityLimitationReason);
        if (reason && reason !== "none") shareLimit = reason;
        else shareLimit ??= reason;
        const h = num(o.frameHeight);
        if (h !== null && (num(o.framesPerSecond) ?? 0) > 0 && (shareHeight === null || h > shareHeight)) {
          shareHeight = h;
          shareFps = num(o.framesPerSecond);
        }
      }
    }

    // Приём: новые заморозки видео и доля маскированного звука с прошлого тика.
    let recvFreezes = 0;
    let recvMinFps: number | null = null;
    const freezes = new Map<string, number>();
    // Декодирование чужого видео: среднее время на кадр (растёт на перегруженном
    // процессоре) и кадры, отброшенные до показа. Вместе с джиттером звука ниже
    // отличает «не успевает устройство» от «пакеты приходят пачками» (урок 2026-10-19).
    let decodeS = 0;
    let decoded = 0;
    let recvFramesDropped: number | null = null;
    const video = new Map<string, { decoded: number; decodeS: number; dropped: number }>();
    for (const { sid, report } of remoteVideo) {
      for (const i of statsOfType(report, "inbound-rtp")) {
        const count = num(i.freezeCount) ?? 0;
        freezes.set(sid, count);
        recvFreezes += Math.max(0, count - (this.lastFreezes.get(sid) ?? count));
        const v = { decoded: num(i.framesDecoded) ?? 0, decodeS: num(i.totalDecodeTime) ?? 0, dropped: num(i.framesDropped) ?? 0 };
        video.set(sid, v);
        const pv = this.lastVideo.get(sid);
        if (pv && v.decoded > pv.decoded && v.decodeS >= pv.decodeS) {
          decoded += v.decoded - pv.decoded;
          decodeS += v.decodeS - pv.decodeS;
        }
        if (pv && v.dropped >= pv.dropped) recvFramesDropped = (recvFramesDropped ?? 0) + v.dropped - pv.dropped;
        const fps = num(i.framesPerSecond);
        if (fps !== null && (recvMinFps === null || fps < recvMinFps)) recvMinFps = fps;
      }
    }
    this.lastFreezes = freezes;
    this.lastVideo = video;
    let concealed = 0;
    let total = 0;
    // Задержка воспроизведения чужого звука (буфер джиттера), мс — худшая из дорожек.
    let recvAudioDelayMs: number | null = null;
    // Сколько буфер сам себе назначил (NetEq: по разбросу прихода пакетов) и джиттер прихода.
    let recvAudioTargetMs: number | null = null;
    let recvAudioJitterMs: number | null = null;
    const audio = new Map<string, { concealed: number; total: number; jbDelay: number; jbTarget: number; jbEmitted: number }>();
    for (const { sid, report } of remoteAudio) {
      for (const i of statsOfType(report, "inbound-rtp")) {
        // Тишину собеседника (DTX: в паузах Opus почти не шлёт пакеты) браузер
        // тоже маскирует — без вычета silentConcealedSamples выключенный или
        // молчащий микрофон давал 50–100% «потерь».
        const cur = {
          concealed: Math.max(0, (num(i.concealedSamples) ?? 0) - (num(i.silentConcealedSamples) ?? 0)),
          total: num(i.totalSamplesReceived) ?? 0,
          jbDelay: num(i.jitterBufferDelay) ?? 0,
          jbTarget: num(i.jitterBufferTargetDelay) ?? 0,
          jbEmitted: num(i.jitterBufferEmittedCount) ?? 0,
        };
        const jitter = num(i.jitter);
        if (jitter !== null) recvAudioJitterMs = Math.max(recvAudioJitterMs ?? 0, Math.round(jitter * 1000));
        audio.set(sid, cur);
        const prev = this.lastAudio.get(sid);
        // Переподписка (AudioLagGuard) создаёт новый приёмник — счётчики
        // начинаются заново, и разность уходила в минус («−2,3 %»).
        if (prev && cur.total >= prev.total && cur.concealed >= prev.concealed) {
          concealed += cur.concealed - prev.concealed;
          total += cur.total - prev.total;
        }
        if (prev && cur.jbEmitted > prev.jbEmitted && cur.jbDelay >= prev.jbDelay) {
          const ms = Math.round((1000 * (cur.jbDelay - prev.jbDelay)) / (cur.jbEmitted - prev.jbEmitted));
          recvAudioDelayMs = Math.max(recvAudioDelayMs ?? 0, ms);
          if (cur.jbTarget >= prev.jbTarget) {
            const target = Math.round((1000 * (cur.jbTarget - prev.jbTarget)) / (cur.jbEmitted - prev.jbEmitted));
            recvAudioTargetMs = Math.max(recvAudioTargetMs ?? 0, target);
          }
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
      captureFps: captureFps === null ? null : Math.round(captureFps),
      shareHeight,
      shareFps,
      shareLimit,
      recvVideo: remoteVideo.length,
      recvMinFps,
      recvFreezes,
      recvAudioConcealedPct: total > 0 ? Math.round((concealed / total) * 1000) / 10 : null,
      recvAudioDelayMs,
      recvAudioTargetMs,
      recvAudioJitterMs,
      recvDecodeMs: decoded > 0 ? Math.round((decodeS / decoded) * 10000) / 10 : null,
      recvFramesDropped,
      receivePressure: receivePressure(),
      hidden: document.visibilityState === "hidden",
    });
    const health = await this.connectionTotals(camera?.mediaStreamTrack?.getSettings().height ?? null, sendHeight);
    track("media_health", { ...base, ...health });
  }
}

/**
 * Поля по образцу «Метрик здоровья» Контур Толка (2026-10-17): потери вверх и
 * вниз, оценка канала вниз, длительность замираний, PLI, ключевые кадры,
 * причины ограничения кодировщика за минуту, уменьшение своей камеры, Compute
 * Pressure. Один полный `getStats()` соединения на тик.
 */
async function readTotals(room: Room): Promise<Record<string, number> | null> {
  const reports = await peerStats(room);
  if (!reports) return null;
  const t: Record<string, number> = {};
  const add = (k: string, v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) t[k] = (t[k] ?? 0) + v;
  };
  for (const i of statsEntries(reports, "inbound-rtp")) {
    add("inRecv", i.packetsReceived);
    add("inLost", typeof i.packetsLost === "number" ? Math.max(0, i.packetsLost) : 0);
    if (i.kind === "video") {
      add("freezeS", i.totalFreezesDuration);
      add("pliOut", i.pliCount);
      add("keyDec", i.keyFramesDecoded);
    }
  }
  for (const o of statsEntries(reports, "outbound-rtp")) {
    if (o.kind !== "video") continue;
    add("pliIn", o.pliCount);
    add("keyEnc", o.keyFramesEncoded);
    const d = o.qualityLimitationDurations as Record<string, number> | undefined;
    if (d) {
      add("qlCpuS", d.cpu);
      add("qlBwS", d.bandwidth);
    }
  }
  let lossSum = 0;
  let lossN = 0;
  for (const r of statsEntries(reports, "remote-inbound-rtp")) {
    if (typeof r.fractionLost === "number") {
      lossSum += r.fractionLost;
      lossN += 1;
    }
  }
  if (lossN) t.upLossPct = Math.round((lossSum / lossN) * 1000) / 10;
  for (const p of statsEntries(reports, "candidate-pair")) {
    if ((p.nominated === true || p.selected === true) && typeof p.availableIncomingBitrate === "number") {
      t.bweDownKbps = Math.round(p.availableIncomingBitrate / 1000);
    }
  }
  return t;
}

/** Подключение к LiveKit не удалось (onError у `<LiveKitRoom>`, повтор в MediaRecovery). */
export function reportLiveKitConnectionFailed(lessonId: string, err: unknown, stage: "initial" | "recover"): void {
  track("livekit_connection_failed", { lessonId, stage, online: navigator.onLine, ...errorFields(err) });
}
