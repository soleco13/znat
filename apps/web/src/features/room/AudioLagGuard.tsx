import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RemoteTrackPublication, Track } from "livekit-client";

import { linkQuality } from "@/shared/link-quality";
import { track as trackEvent } from "@/shared/telemetry";
import { peerStats, selectedPair, statsEntries } from "./peer-stats.js";

/**
 * Звук собеседника «застрял» с задержкой после скачка сети (UX-аудит
 * 2026-10-13, `test-results/matis-ux-audit-2026-10-13`, s15/s17).
 *
 * Корень: при скачке задержки (перегруженный Wi-Fi, «захлебнулся» роутер)
 * буфер звука WebRTC (NetEq) раздувается до 1–1,6 с и после того, как сеть
 * пришла в норму, сдувается очень медленно — 15–20 с люди слышат друг друга
 * с запаздыванием в секунду и перебивают. Полный короткий обрыв этого не
 * даёт (звук возвращается за 0,5 с), а скачок — даёт. Подсказка буферу
 * (`jitterBufferTarget`) не помогает — проверено.
 *
 * Что делаем: если задержка воспроизведения чужого звука держится выше
 * `LAG_MS` дольше `LAG_FOR_MS`, а сеть уже спокойна (джиттер и потери в
 * норме), переподписываемся на эту дорожку — приём начинается с пустым
 * буфером: задержка возвращается к ~30 мс за секунду ценой пропуска ~1 с.
 * Пока сеть штормит, не трогаем: там большой буфер и нужен.
 *
 * Урок 2026-10-14 (Елена, волнистый Wi-Fi: RTT 40 мс со скачками до 570 мс
 * раз в 1–2 мин): «сеть спокойна» по джиттеру и потерям в моменте выполнялось
 * между волнами, и сброс срабатывал 16 раз за 12 мин — каждые 30–50 с
 * секунда тишины и пустой буфер перед следующей волной (дорисовано до 50 %).
 * Большой буфер там был правильным. Поэтому сбрасываем только разовый
 * скачок: ни отметки «плохая связь», ни скачка RTT за последние 3 с, и
 * если задержка вернулась в течение 2 мин после сброса — сеть такая, сброс
 * для этой дорожки выключается на 10 мин: на волнистой сети — не больше
 * одного сброса за 10 мин вместо 16 за 12. (Контур Толк буфер не
 * сбрасывает вовсе — `test-results/kontur-research-2026-10-14`.)
 */
const TICK_MS = 1000;
/** Дорожек больше — такт реже: на слабом ПК в большом классе статистика сама стоит процессора. */
const MANY_TRACKS = 10;
const TICK_MANY_MS = 2500;
/**
 * Сразу после подписки буфер ещё набирается и задержка по
 * `jitterBufferDelay/EmittedCount` высокая (600–1600 мс) — это не «застрявший»
 * буфер. Без паузы почти каждый вход давал секунду тишины (аудит 2026-10-17, 4.7).
 */
const WARMUP_MS = 12_000;
/** Обычная задержка воспроизведения — 20–100 мс; выше этого — «застрявший» буфер. */
const LAG_MS = 600;
/** Сколько подряд держится, прежде чем сбрасывать (не реагируем на разовые всплески). */
const LAG_FOR_MS = 3000;
/** Сеть спокойна: джиттер входящего звука ниже и потери за окно меньше. */
const CALM_JITTER_S = 0.03;
const CALM_LOSS = 0.02;
/** Не чаще раза в полминуты на дорожку. */
const COOLDOWN_MS = 30_000;
/** Сеть без отметки «плохая связь» и без скачков RTT хотя бы столько. */
const QUIET_NET_MS = 3_000;
/** RTT выше — скачок (обычный — десятки мс). */
const RTT_SPIKE_S = 0.25;
/** Задержка вернулась так скоро после сброса — сброс не помогает. */
const RELAPSE_MS = 120_000;
/** На столько выключаем сброс для дорожки после возврата задержки. */
const DISABLE_MS = 10 * 60_000;
/** Пауза между отпиской и подпиской. */
const RESUBSCRIBE_GAP_MS = 150;

interface Sample {
  delay: number;
  emitted: number;
  received: number;
  lost: number;
}

export function AudioLagGuard() {
  const room = useRoomContext();
  useEffect(() => {
    const prev = new Map<string, Sample>();
    const lagSince = new Map<string, number>();
    const lastReset = new Map<string, number>();
    const disabledUntil = new Map<string, number>();
    let lastNetTroubleAt = Date.now();
    let running = false;
    let disposed = false;

    const firstSeen = new Map<string, number>();
    let nextAt = 0;

    const tick = async () => {
      if (running || disposed) return;
      const now = Date.now();
      if (now < nextAt) return;
      running = true;
      try {
        if (linkQuality.isPoor) lastNetTroubleAt = now;
        const subs: { pub: RemoteTrackPublication; identity: string; trackId: string }[] = [];
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (!(pub instanceof RemoteTrackPublication) || pub.kind !== Track.Kind.Audio || !pub.isSubscribed) continue;
            const id = pub.track?.mediaStreamTrack?.id;
            if (id) subs.push({ pub, identity: participant.identity, trackId: id });
          }
        }
        nextAt = now + (subs.length > MANY_TRACKS ? TICK_MANY_MS : TICK_MS);
        for (const sid of [...firstSeen.keys()]) if (!subs.some((x) => x.pub.trackSid === sid)) firstSeen.delete(sid);
        if (!subs.length) return;
        // Один отчёт соединения на такт вместо `receiver.getStats()` на каждую дорожку.
        const reports = await peerStats(room);
        if (!reports || disposed) return;
        const inbound = new Map<string, Record<string, unknown>>();
        for (const r of statsEntries(reports, "inbound-rtp")) {
          if (r.kind === "audio" && typeof r.trackIdentifier === "string") inbound.set(r.trackIdentifier, r);
        }
        const pair = selectedPair(reports);
        const rtt = typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime : 0;
        if (rtt > RTT_SPIKE_S) lastNetTroubleAt = now;

        for (const { pub, identity, trackId } of subs) {
          const sid = pub.trackSid;
          if (!firstSeen.has(sid)) firstSeen.set(sid, now);
          const r = inbound.get(trackId);
          if (!r) continue;
          const n = (v: unknown) => (typeof v === "number" ? v : 0);
          const cur: Sample = {
            delay: n(r.jitterBufferDelay),
            emitted: n(r.jitterBufferEmittedCount),
            received: n(r.packetsReceived),
            lost: n(r.packetsLost),
          };
          const jitter = n(r.jitter);
          const before = prev.get(sid);
          prev.set(sid, cur);
          if (now - firstSeen.get(sid)! < WARMUP_MS) continue;
          if (!before || cur.emitted <= before.emitted) continue;
          const delayMs = (1000 * (cur.delay - before.delay)) / (cur.emitted - before.emitted);
          const got = cur.received - before.received;
          const lost = Math.max(0, cur.lost - before.lost);
          const calm = jitter < CALM_JITTER_S && got > 0 && lost / (got + lost) < CALM_LOSS;
          if (delayMs < LAG_MS || !calm) {
            lagSince.delete(sid);
            continue;
          }
          // Задержка вернулась вскоре после сброса — дело в сети, не в разовом скачке.
          const resetAt = lastReset.get(sid);
          if (resetAt && now - resetAt < RELAPSE_MS && !disabledUntil.has(sid)) {
            disabledUntil.set(sid, now + DISABLE_MS);
            trackEvent("audio_lag_reset", { delayMs: Math.round(delayMs), identity, disabled: true });
          }
          if ((disabledUntil.get(sid) ?? 0) > now || now - lastNetTroubleAt < QUIET_NET_MS) {
            lagSince.delete(sid);
            continue;
          }
          disabledUntil.delete(sid);
          if (!lagSince.has(sid)) lagSince.set(sid, now);
          if (now - lagSince.get(sid)! < LAG_FOR_MS || now - (lastReset.get(sid) ?? 0) < COOLDOWN_MS) continue;
          lagSince.delete(sid);
          lastReset.set(sid, now);
          prev.delete(sid);
          trackEvent("audio_lag_reset", { delayMs: Math.round(delayMs), identity });
          pub.setSubscribed(false);
          setTimeout(() => {
            if (!disposed) pub.setSubscribed(true);
          }, RESUBSCRIBE_GAP_MS);
        }
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => void tick(), TICK_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [room]);
  return null;
}
