import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionQuality, RoomEvent, type Participant, type Room } from "livekit-client";
import type { ClientRoomMessage, ConnectionStats, ServerRoomMessage } from "@school/shared";

import { peerStats, selectedPair, statsEntries } from "./peer-stats.js";

/**
 * Связь участника для окна по клику на имя (запрос 2026-10-24, по образцу
 * Контур Толка): качество 0–100, битрейт и потери в обе стороны, RTT, что
 * отправляет и какими кодеками.
 *
 * Цифры считает браузер самого участника: только он знает свою отдачу, свои
 * потери и задержку. Пока у кого-то открыто окно, тот раз в секунду шлёт
 * запрос через `/ws` урока (`stats_request`), сервер пересылает его только
 * адресату, тот отвечает ~300 байтами (`stats_report`). Канал данных LiveKit
 * не используем: по архитектуре данные комнаты идут через `/ws`
 * (`canPublishData: false`, CURRENT_STAGE Э1). Ничего не хранится; закрыли
 * окно — запросы прекратились.
 */
const REQUEST_EVERY_MS = 1000;
/** Нет ответа дольше — у участника старая версия страницы или он отключился. */
const UNAVAILABLE_AFTER_MS = 4000;

/** Схема — `connectionStatsSchema` в packages/shared (её же проверяет сервер). */
export type ParticipantStats = ConnectionStats;

interface Totals {
  at: number;
  sentBytes: number;
  recvBytes: number;
  sentPackets: number;
  upLost: number;
  recvPackets: number;
  downLost: number;
}

let prevTotals: Totals | null = null;
let lastOwn: { at: number; stats: Promise<ParticipantStats | null> } | null = null;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function codecName(reports: RTCStatsReport[], codecId: unknown): string | null {
  if (typeof codecId !== "string") return null;
  for (const r of reports) {
    const c = r.get(codecId) as { mimeType?: string } | undefined;
    if (c?.mimeType) return c.mimeType.split("/")[1]?.toLowerCase() ?? null;
  }
  return null;
}

/**
 * Оценка связи 0–100: потери сильнее всего портят звук и видео, задержка
 * выше 150 мс мешает разговору, джиттер выше 20 мс растит буфер звука.
 * 0 % потерь и 40 мс — 100; 32 % и 635 мс (пример из Толка) — 0.
 */
export function qualityScore(lossPct: number, rttMs: number, jitterMs: number): number {
  const score = 100 - 2.5 * lossPct - 0.08 * Math.max(0, rttMs - 150) - 0.5 * Math.max(0, jitterMs - 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function computeOwn(room: Room): Promise<ParticipantStats | null> {
  const reports = await peerStats(room);
  if (!reports) return null;
  const now = Date.now();
  const t: Totals = { at: now, sentBytes: 0, recvBytes: 0, sentPackets: 0, upLost: 0, recvPackets: 0, downLost: 0 };
  let sendHeight: number | null = null;
  let audioCodec: string | null = null;
  let videoCodec: string | null = null;
  for (const o of statsEntries(reports, "outbound-rtp")) {
    t.sentBytes += num(o.bytesSent);
    t.sentPackets += num(o.packetsSent);
    if (o.kind === "video" && o.active !== false && num(o.frameHeight) > 0) {
      sendHeight = Math.max(sendHeight ?? 0, num(o.frameHeight));
      videoCodec ??= codecName(reports, o.codecId);
    }
    if (o.kind === "audio") audioCodec ??= codecName(reports, o.codecId);
  }
  for (const r of statsEntries(reports, "remote-inbound-rtp")) t.upLost += Math.max(0, num(r.packetsLost));
  const jitters: number[] = [];
  for (const i of statsEntries(reports, "inbound-rtp")) {
    t.recvBytes += num(i.bytesReceived);
    t.recvPackets += num(i.packetsReceived);
    t.downLost += Math.max(0, num(i.packetsLost));
    if (i.kind === "audio" && typeof i.jitter === "number") jitters.push(i.jitter * 1000);
  }
  const pair = selectedPair(reports);
  const rttMs = typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null;
  const jitterMs = jitters.length ? Math.round(Math.max(...jitters)) : null;

  const prev = prevTotals;
  prevTotals = t;
  const dt = prev ? (now - prev.at) / 1000 : 0;
  const fresh = prev && dt > 0.3 && dt < 10;
  const kbps = (bytes: number) => (fresh ? Math.max(0, Math.round(((bytes * 8) / dt) / 1000)) : null);
  const pct = (lost: number, total: number) => (fresh && total > 0 ? Math.round((Math.max(0, lost) / total) * 1000) / 10 : null);
  const upLossPct = prev ? pct(t.upLost - prev.upLost, t.sentPackets - prev.sentPackets) : null;
  const downLost = prev ? t.downLost - prev.downLost : 0;
  const downLossPct = prev ? pct(downLost, t.recvPackets - prev.recvPackets + Math.max(0, downLost)) : null;
  return {
    score: qualityScore(Math.max(upLossPct ?? 0, downLossPct ?? 0), rttMs ?? 0, jitterMs ?? 0),
    sendKbps: prev ? kbps(t.sentBytes - prev.sentBytes) : null,
    recvKbps: prev ? kbps(t.recvBytes - prev.recvBytes) : null,
    upLossPct,
    downLossPct,
    rttMs,
    jitterMs,
    sendHeight,
    audioCodec,
    videoCodec,
  };
}

/** Свои цифры; несколько запросов в одну секунду (двое открыли окно) — один расчёт. */
export function ownStats(room: Room): Promise<ParticipantStats | null> {
  const now = Date.now();
  if (lastOwn && now - lastOwn.at < 900) return lastOwn.stats;
  const stats = computeOwn(room).catch(() => null);
  lastOwn = { at: now, stats };
  return stats;
}

/** Отправка в `/ws` урока — ставит `useRoomSocket`, пока сокет открыт. */
let socketSend: ((message: ClientRoomMessage) => void) | null = null;
export function setStatsSocketSender(send: ((message: ClientRoomMessage) => void) | null): void {
  socketSend = send;
}

/** Комната LiveKit для ответа своими цифрами — ставит `ParticipantStatsResponder`. */
let responderRoom: Room | null = null;
type ReportListener = (from: string, stats: ParticipantStats) => void;
const reportListeners = new Set<ReportListener>();

/** Сообщения окна связи из `/ws` (`useRoomSocket` передаёт их сюда). */
export function handleStatsMessage(message: ServerRoomMessage): boolean {
  if (message.type === "stats_request") {
    const room = responderRoom;
    const from = message.from;
    if (room) void ownStats(room).then((stats) => stats && socketSend?.({ type: "stats_report", to: from, stats }));
    return true;
  }
  if (message.type === "stats_report") {
    for (const l of reportListeners) l(message.from, message.stats);
    return true;
  }
  return false;
}

/**
 * Отвечает своими цифрами тому, кто открыл окно с нашим именем. Внутри
 * `<LiveKitRoom>`; без запросов ничего не считает и не шлёт.
 */
export function ParticipantStatsResponder() {
  const room = useRoomContext();
  useEffect(() => {
    responderRoom = room;
    return () => {
      if (responderRoom === room) responderRoom = null;
    };
  }, [room]);
  return null;
}

export type StatsState =
  | { kind: "waiting" }
  | { kind: "ready"; stats: ParticipantStats }
  | { kind: "unavailable" };

/** Цифры участника (`userId`), пока окно открыто (`open`). Свои — считаются на месте. */
export function useParticipantStats(userId: string, isSelf: boolean, open: boolean): StatsState {
  const room = useRoomContext();
  const [state, setState] = useState<StatsState>({ kind: "waiting" });
  useEffect(() => {
    if (!open) return;
    setState({ kind: "waiting" });
    let lastAnswer = Date.now();
    let cancelled = false;
    const onReport: ReportListener = (from, stats) => {
      if (from !== userId) return;
      lastAnswer = Date.now();
      setState({ kind: "ready", stats });
    };
    const tick = () => {
      if (isSelf) {
        void ownStats(room).then((s) => {
          if (!cancelled && s) setState({ kind: "ready", stats: s });
        });
        return;
      }
      socketSend?.({ type: "stats_request", to: userId });
      if (Date.now() - lastAnswer > UNAVAILABLE_AFTER_MS) setState({ kind: "unavailable" });
    };
    if (!isSelf) reportListeners.add(onReport);
    tick();
    const timer = setInterval(tick, REQUEST_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      reportListeners.delete(onReport);
    };
  }, [room, userId, isSelf, open]);
  return state;
}

/** Состояние участника для строки «Статус». */
export function useParticipantStatus(identity: string, open: boolean, reconnecting: boolean): "active" | "reconnecting" | "lost" | "absent" {
  const room = useRoomContext();
  const find = (): Participant | undefined =>
    identity === room.localParticipant.identity ? room.localParticipant : room.getParticipantByIdentity(identity);
  const [quality, setQuality] = useState<ConnectionQuality | null>(() => find()?.connectionQuality ?? null);
  useEffect(() => {
    if (!open) return;
    const update = () => setQuality(find()?.connectionQuality ?? null);
    update();
    room.on(RoomEvent.ConnectionQualityChanged, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    room.on(RoomEvent.ParticipantConnected, update);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
      room.off(RoomEvent.ParticipantConnected, update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, identity, open]);
  if (reconnecting) return "reconnecting";
  if (quality === null) return "absent";
  return quality === ConnectionQuality.Lost ? "lost" : "active";
}
