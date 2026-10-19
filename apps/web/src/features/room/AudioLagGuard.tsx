import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RemoteTrackPublication, Track } from "livekit-client";

import { linkQuality } from "@/shared/link-quality";
import { track as trackEvent } from "@/shared/telemetry";
import { peerStats, selectedPair, statsEntries } from "./peer-stats.js";
import { markReceivePressure } from "./receive-pressure.js";

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
 *
 * Урок 2026-10-19 (Елена, слабый ПК и узкий входящий канал): задержка
 * 0,7–1 с весь урок, а сброс сработал один раз и выключился на 10 мин через
 * 8 с. Это был не возврат задержки: новая подписка ещё набирала буфер
 * (те же 600–1600 мс, что и при входе), а прогрева после сброса не было.
 * Теперь:
 *  - после сброса дорожка снова прогревается `WARMUP_MS`;
 *  - сброс ждёт паузы собеседника (пакетов почти нет — Opus DTX, — или
 *    сервер не видит речи) длиннее, чем звука в буфере: пропадает тишина, а
 *    не слова. Пауз нет `NO_PAUSE_MAX_MS` — сбрасываем как раньше;
 *  - возврат задержки при спокойной сети — не волна, а входящий канал или
 *    устройство не успевают: следующая попытка через 1, 2, 4, 8 мин, и всё
 *    это время чужие камеры принимаются легче (`receive-pressure.ts`), чтобы
 *    убрать саму причину. Возврат вместе с признаками плохой сети — как
 *    14.10: сброс выключается на 10 мин;
 *  - порог 400 мс вместо 600: цель — разговор без запаздывания (<300 мс).
 */
const TICK_MS = 1000;
/** Дорожек больше — такт реже: на слабом ПК в большом классе статистика сама стоит процессора. */
const MANY_TRACKS = 10;
const TICK_MANY_MS = 2500;
/**
 * Сразу после подписки буфер ещё набирается и задержка по
 * `jitterBufferDelay/EmittedCount` высокая (600–1600 мс) — это не «застрявший»
 * буфер. Без паузы почти каждый вход давал секунду тишины (аудит 2026-10-17, 4.7).
 * То же после каждого сброса (урок 2026-10-19).
 */
const WARMUP_MS = 12_000;
/** Обычная задержка воспроизведения — 20–250 мс; выше этого — «застрявший» буфер. */
const LAG_MS = 400;
/** Сколько подряд держится, прежде чем сбрасывать (не реагируем на разовые всплески). */
const LAG_FOR_MS = 3000;
/** Сеть спокойна: джиттер входящего звука ниже и потери за окно меньше. */
const CALM_JITTER_S = 0.03;
const CALM_LOSS = 0.02;
/** Пакетов звука в секунду меньше — собеседник молчит (DTX: в паузах ~2–3 пакета/с вместо 50). */
const SILENT_PPS = 15;
/** Речь идёт: пакетов не меньше — замер задержки по такому интервалу надёжен. */
const SPEECH_PPS = 30;
/** Пауза должна перекрыть звук в буфере и ещё столько. */
const PAUSE_MARGIN_MS = 500;
/** Задержку в буфере больше этого в ожидании паузы не учитываем. */
const PAUSE_DELAY_CAP_MS = 1500;
/** Пауз нет так долго — сбрасываем посреди речи. */
const NO_PAUSE_MAX_MS = 45_000;
/** Первая пауза между сбросами одной дорожки. */
const COOLDOWN_MS = 30_000;
/** После возврата задержки при спокойной сети — 1, 2, 4, 8 мин. */
const RELAPSE_COOLDOWN_MIN_MS = 60_000;
const RELAPSE_COOLDOWN_MAX_MS = 8 * 60_000;
/** Сеть без отметки «плохая связь» и без скачков RTT хотя бы столько. */
const QUIET_NET_MS = 3_000;
/** RTT выше — скачок (обычный — десятки мс). */
const RTT_SPIKE_S = 0.25;
/** Задержка вернулась так скоро после сброса (после прогрева) — сброс не помог. */
const RELAPSE_MS = 120_000;
/** На столько выключаем сброс для дорожки, если задержка вернулась вместе с плохой сетью. */
const DISABLE_MS = 10 * 60_000;
/** Другой собеседник звучал без задержки так недавно — задержка этого не про приём. */
const OTHERS_OK_MS = 30_000;
/** Пауза между отпиской и подпиской. */
const RESUBSCRIBE_GAP_MS = 150;

interface Sample {
  at: number;
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
    /** Задержка уже вернулась после последнего сброса (решение по ней принято). */
    const relapsed = new Set<string>();
    const cooldown = new Map<string, number>();
    const disabledUntil = new Map<string, number>();
    /** С какого такта собеседник молчит (0 — говорит). */
    const silentSince = new Map<string, number>();
    /** Последний замер задержки во время речи (для решения в паузе). */
    const lastLag = new Map<string, { delayMs: number; calm: boolean }>();
    /** Когда у дорожки последний раз была нормальная задержка (во время речи). */
    const lastOk = new Map<string, number>();
    let lastNetTroubleAt = Date.now();
    let running = false;
    let disposed = false;

    /** Начало прогрева дорожки: подписка или последний сброс. */
    const warmFrom = new Map<string, number>();
    let nextAt = 0;

    const tick = async () => {
      if (running || disposed) return;
      const now = Date.now();
      if (now < nextAt) return;
      running = true;
      try {
        if (linkQuality.isPoor) lastNetTroubleAt = now;
        const subs: { pub: RemoteTrackPublication; identity: string; speaking: boolean; trackId: string }[] = [];
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (!(pub instanceof RemoteTrackPublication) || pub.kind !== Track.Kind.Audio || !pub.isSubscribed) continue;
            const id = pub.track?.mediaStreamTrack?.id;
            if (id) subs.push({ pub, identity: participant.identity, speaking: participant.isSpeaking, trackId: id });
          }
        }
        nextAt = now + (subs.length > MANY_TRACKS ? TICK_MANY_MS : TICK_MS);
        for (const sid of [...warmFrom.keys()]) {
          // Сброс сам ненадолго отписывает дорожку — её прогрев не теряем.
          if (!subs.some((x) => x.pub.trackSid === sid) && now - (lastReset.get(sid) ?? 0) > 5_000) {
            warmFrom.delete(sid);
            lastOk.delete(sid);
          }
        }
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

        for (const { pub, identity, speaking, trackId } of subs) {
          const sid = pub.trackSid;
          if (!warmFrom.has(sid)) warmFrom.set(sid, now);
          const r = inbound.get(trackId);
          if (!r) continue;
          const n = (v: unknown) => (typeof v === "number" ? v : 0);
          const cur: Sample = {
            at: now,
            delay: n(r.jitterBufferDelay),
            emitted: n(r.jitterBufferEmittedCount),
            received: n(r.packetsReceived),
            lost: n(r.packetsLost),
          };
          const jitter = n(r.jitter);
          const before = prev.get(sid);
          prev.set(sid, cur);
          if (!before || cur.received < before.received) continue;
          const pps = (1000 * (cur.received - before.received)) / Math.max(1, cur.at - before.at);
          // Пауза собеседника: пакетов почти нет (DTX) или сервер не слышит речи.
          if (pps < SILENT_PPS || !speaking) {
            if (!silentSince.get(sid)) silentSince.set(sid, before.at);
          } else {
            silentSince.set(sid, 0);
          }
          if (now - warmFrom.get(sid)! < WARMUP_MS) continue;
          let delayMs: number;
          let calm: boolean;
          if (cur.emitted > before.emitted && pps >= SPEECH_PPS) {
            delayMs = (1000 * (cur.delay - before.delay)) / (cur.emitted - before.emitted);
            const got = cur.received - before.received;
            const lost = Math.max(0, cur.lost - before.lost);
            calm = jitter < CALM_JITTER_S && got > 0 && lost / (got + lost) < CALM_LOSS;
            if (delayMs < LAG_MS) {
              lagSince.delete(sid);
              lastLag.delete(sid);
              lastOk.set(sid, now);
              continue;
            }
            lastLag.set(sid, { delayMs, calm });
            if (!lagSince.has(sid)) lagSince.set(sid, now);
            const resetAt = lastReset.get(sid);
            if (resetAt && now - resetAt < RELAPSE_MS && !relapsed.has(sid) && now - lagSince.get(sid)! >= LAG_FOR_MS) {
              relapsed.add(sid);
              // Задержка вернулась. Вместе с плохой сетью — сеть волнистая, большой
              // буфер ей нужен (урок 2026-10-14). При спокойной — не успевает приём:
              // следующая попытка позже, приём тем временем легче.
              const netCaused = !calm || lastNetTroubleAt > resetAt;
              const next = netCaused
                ? COOLDOWN_MS
                : Math.min(Math.max((cooldown.get(sid) ?? COOLDOWN_MS) * 2, RELAPSE_COOLDOWN_MIN_MS), RELAPSE_COOLDOWN_MAX_MS);
              cooldown.set(sid, next);
              if (netCaused) disabledUntil.set(sid, now + DISABLE_MS);
              trackEvent("audio_lag_reset", {
                delayMs: Math.round(delayMs),
                identity,
                relapse: true,
                disabled: netCaused,
                nextInS: netCaused ? DISABLE_MS / 1000 : next / 1000,
              });
            } else if (resetAt && now - resetAt >= RELAPSE_MS && !relapsed.has(sid)) {
              // Прошлый сброс помог надолго — снова короткая пауза.
              cooldown.delete(sid);
            }
          } else {
            // Собеседник молчит (DTX): по горстке пакетов задержку не измерить —
            // берём последний замер речи. Как раз в такой паузе и сбрасываем.
            const last = lastLag.get(sid);
            if (!last || !lagSince.has(sid)) continue;
            ({ delayMs, calm } = last);
          }
          // Приём легче — только если не успевает весь приём, а не один отправитель:
          // другой собеседник недавно звучал без задержки — дело в канале этого
          // отправителя, и опускать остальные камеры незачем (класс, учитель).
          const othersOk = [...lastOk].some(([other, at]) => other !== sid && now - at < OTHERS_OK_MS);
          if (now - lagSince.get(sid)! >= LAG_FOR_MS && !othersOk) markReceivePressure(now);
          if (!calm || (disabledUntil.get(sid) ?? 0) > now || now - lastNetTroubleAt < QUIET_NET_MS) continue;
          disabledUntil.delete(sid);
          if (now - lagSince.get(sid)! < LAG_FOR_MS || now - (lastReset.get(sid) ?? 0) < (cooldown.get(sid) ?? COOLDOWN_MS)) continue;
          const silent = silentSince.get(sid) ? now - silentSince.get(sid)! : 0;
          const pauseOk = silent >= Math.min(delayMs, PAUSE_DELAY_CAP_MS) + PAUSE_MARGIN_MS;
          if (!pauseOk && now - lagSince.get(sid)! < NO_PAUSE_MAX_MS) continue;
          lagSince.delete(sid);
          lastReset.set(sid, now);
          relapsed.delete(sid);
          warmFrom.set(sid, now);
          prev.delete(sid);
          silentSince.delete(sid);
          lastLag.delete(sid);
          trackEvent("audio_lag_reset", { delayMs: Math.round(delayMs), identity, pauseMs: silent });
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
