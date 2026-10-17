import type { Room } from "livekit-client";

/**
 * Один `getStats()` на соединение вместо отдельного запроса на каждую
 * дорожку. `receiver.getStats()` в Chrome собирает полный отчёт соединения и
 * лишь потом фильтрует его; в классе на 30 человек `AudioLagGuard` делал так
 * ~30 раз в секунду (аудит 2026-10-17, 4.5). Здесь — полный отчёт не чаще
 * раза в `MIN_INTERVAL_MS`, общий для всех, кто спросил в этом окне.
 *
 * `room.engine.pcManager` — внутреннее поле livekit-client (2.23). Нет его —
 * `null`, и вызывающий работает как раньше.
 */
const MIN_INTERVAL_MS = 900;

interface StatsSource {
  getStats(): Promise<RTCStatsReport> | undefined;
}

interface PcManagerLike {
  publisher?: StatsSource;
  subscriber?: StatsSource;
}

const cache = new WeakMap<Room, { at: number; reports: Promise<RTCStatsReport[]> }>();

function pcManager(room: Room): PcManagerLike | null {
  const engine = (room as unknown as { engine?: { pcManager?: PcManagerLike } }).engine;
  return engine?.pcManager ?? null;
}

/** Полные отчёты всех соединений комнаты (одно при single PC). */
export function peerStats(room: Room): Promise<RTCStatsReport[]> | null {
  const mgr = pcManager(room);
  if (!mgr) return null;
  const now = Date.now();
  const hit = cache.get(room);
  if (hit && now - hit.at < MIN_INTERVAL_MS) return hit.reports;
  const sources = [mgr.publisher, mgr.subscriber].filter((s): s is StatsSource => !!s);
  const reports = Promise.all(sources.map((s) => s.getStats()?.catch(() => undefined) ?? Promise.resolve(undefined))).then(
    (list) => list.filter((r): r is RTCStatsReport => !!r),
  );
  cache.set(room, { at: now, reports });
  return reports;
}

/** Все записи нужного типа из нескольких отчётов. */
export function statsEntries<T extends RTCStats = RTCStats>(reports: RTCStatsReport[], type: string): (T & Record<string, unknown>)[] {
  const out: (T & Record<string, unknown>)[] = [];
  for (const report of reports) {
    report.forEach((s: RTCStats) => {
      if (s.type === type) out.push(s as T & Record<string, unknown>);
    });
  }
  return out;
}

/** Выбранная пара ICE из отчётов (для RTT медиапути). */
export function selectedPair(reports: RTCStatsReport[]): Record<string, unknown> | null {
  for (const report of reports) {
    let pairId: string | null = null;
    report.forEach((s: RTCStats & { selectedCandidatePairId?: string }) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    let pair: Record<string, unknown> | null = pairId ? ((report.get(pairId) as Record<string, unknown> | undefined) ?? null) : null;
    if (!pair) {
      report.forEach((s: RTCStats & Record<string, unknown>) => {
        if (!pair && s.type === "candidate-pair" && (s.selected === true || (s.nominated === true && s.state === "succeeded"))) pair = s;
      });
    }
    if (pair) return pair;
  }
  return null;
}
