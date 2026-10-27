import { useEffect, useSyncExternalStore } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ParticipantEvent,
  RoomEvent,
  Track,
  type AudioProcessorOptions,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type TrackProcessor,
} from "livekit-client";
import type { ClientMediaSettings, NoiseSuppressionMode } from "@school/shared";

import { track } from "../../shared/telemetry.js";
import { cpuLoadLevel, currentPressure, subscribeCpuLoadLevel } from "./cpu-load-engine.js";
import { deviceProfileNow, type DeviceProfile } from "./device-profile.js";
import workletUrl from "./rnnoise-worklet.ts?worker&url";
import RnnoiseWorker from "./rnnoise-worker.ts?worker";

/**
 * Шумоподавление микрофона по силе устройства (запрос 2026-10-17):
 *  - сильное устройство (скорость ядра ≥ STRONG_SCORE и не «слабое» ни по чему,
 *    кроме двух ядер) — RNNoise (WASM в отдельном Worker `rnnoise-worker.ts`,
 *    AudioWorklet `rnnoise-worklet.ts` лишь обменивается кадрами и при опоздании
 *    Worker пропускает необработанный звук; не успевает в половине кадров за
 *    минуту — переходим на встроенное),
 *    встроенный фильтр браузера при этом выключен, чтобы звук не чистился дважды;
 *  - слабое — встроенное шумоподавление браузера (часть его же эхоподавления,
 *    почти бесплатно);
 *  - очень слабое — встроенное (выключать совсем нельзя: шум хуже, а фильтр
 *    браузера почти бесплатен; Контур Толк в «экономичном режиме» тоже
 *    переходит на встроенное, а не выключает).
 * Школа задаёт режим по умолчанию (`noiseSuppressionMode`), участник может
 * выбрать свой в настройках урока; «Сильное» на слабом устройстве недоступно.
 * Выбор участника живёт до закрытия страницы (без localStorage, CLAUDE.md).
 *
 * Если с RNNoise устройство начало захлёбываться — молча переходим на
 * встроенное до конца урока, в журнал — `noise_suppression`. Признаки:
 * RNNoise не успевает обработать часть звука (`LateGuard`), процессор
 * перегружен по Compute Pressure (`PressureGuard`), `cpu-load-engine` дошёл
 * до ступени `CPU_FALLBACK_LEVEL`, или RNNoise не запустился. Урок
 * 2026-10-26: у ученика (4 ядра, без камеры) процессор полчаса был в
 * «serious»/«critical», ступень видео не росла, а старый порог «не успел
 * в половине кадров за минуту» не сработал — учитель слышал шумы.
 * Раз в минуту — `noise_suppression_stats`: доля необработанного звука.
 */

export type NoiseTier = "strong" | "weak" | "very_weak";
export type NoiseEffective = "strong" | "standard" | "off";

/**
 * Не ниже — пробуем RNNoise (≈ 1–2 % одного ядра на i5, считается в своём
 * Worker). Число ядер не важно: двухъядерный MacBook (урок 2026-10-19, score
 * 35,8) тянет его спокойно, а если устройство всё же захлебнётся — молча
 * откатываемся на встроенное (ступень CPU `CPU_FALLBACK_LEVEL` или Worker
 * не успевает за кадрами).
 */
const STRONG_SCORE = 30;
/** Ниже — уровень Pentium N3700 (≈ 17): там каждый процент процессора на счету. */
const VERY_WEAK_SCORE = 18;
/** Ступень `cpu-load-engine`, на которой RNNoise отключаем (SHARE_LEVEL — урезана уже демонстрация). */
const CPU_FALLBACK_LEVEL = 2;
const READY_TIMEOUT_MS = 8_000;
/** Окно worklet (10 с): не успел больше — сразу на встроенное. */
const LATE_HARD = 0.2;
/** Не успел больше — два окна подряд — на встроенное. */
const LATE_SOFT = 0.05;
/** Compute Pressure: «critical» столько подряд — на встроенное. */
const PRESSURE_CRITICAL_MS = 6_000;
/** «serious» (или выше) столько подряд — на встроенное. */
const PRESSURE_SERIOUS_MS = 30_000;
const PRESSURE_POLL_MS = 2_000;
const STATS_EVERY_MS = 60_000;
const PROCESSOR_NAME = "matis-rnnoise";

export function noiseTier(profile: DeviceProfile | null): NoiseTier {
  if (!profile || profile.score === 0 || !profile.benchmarkTrusted) return "weak";
  if (profile.score < VERY_WEAK_SCORE) return "very_weak";
  // «Слабое» только из-за двух ядер (MacBook Юли) RNNoise не мешает; слабое
  // по замеру или по памяти (4 потока и ≤ 4 ГБ, ПК Елены) — встроенное.
  const weakBeyondCores = profile.weak && !(profile.cores > 0 && profile.cores <= 2);
  if (profile.score >= STRONG_SCORE && !weakBeyondCores) return "strong";
  return "weak";
}

/**
 * Браузер умеет всё нужное. Safari исключён: у него AudioContext с микрофоном
 * капризен (на iOS — общий аудиосеанс с разговором), там — встроенное.
 */
function rnnoiseSupported(): boolean {
  if (typeof AudioWorkletNode === "undefined" || typeof WebAssembly !== "object") return false;
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua);
  return !safari && !/iPhone|iPad|iPod/.test(ua);
}

/** Режим школы; старый флаг `noiseSuppressionEnabled: false` — это «выключено». */
export function schoolNoiseMode(settings: ClientMediaSettings | null): NoiseSuppressionMode {
  if (!settings) return "auto";
  return settings.noiseSuppressionMode ?? (settings.noiseSuppressionEnabled === false ? "off" : "auto");
}

let userMode: NoiseSuppressionMode | null = null;
/** Почему RNNoise отключён до конца урока (`null` — не отключён). */
let strongBlocked: string | null = null;
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUserNoiseMode(mode: NoiseSuppressionMode) {
  if (userMode === mode) return;
  userMode = mode;
  notify();
}

function blockStrong(reason: string) {
  if (strongBlocked) return;
  strongBlocked = reason;
  notify();
}

/** «Сильное» доступно на этом устройстве (и не отключено из-за перегрузки). */
export function strongNoiseAvailable(): boolean {
  return noiseTier(deviceProfileNow()) === "strong" && rnnoiseSupported() && strongBlocked === null;
}

export function resolveNoise(mode: NoiseSuppressionMode, tier: NoiseTier, strongOk: boolean): NoiseEffective {
  if (mode === "off") return "off";
  if (mode === "standard") return "standard";
  return tier === "strong" && strongOk ? "strong" : "standard";
}

export function currentNoiseMode(school: NoiseSuppressionMode): NoiseSuppressionMode {
  return userMode ?? school;
}

export function effectiveNoise(school: NoiseSuppressionMode): NoiseEffective {
  return resolveNoise(currentNoiseMode(school), noiseTier(deviceProfileNow()), strongNoiseAvailable());
}

/** Во что на этом устройстве превращается «Авто». */
export function autoNoise(): NoiseEffective {
  return resolveNoise("auto", noiseTier(deviceProfileNow()), strongNoiseAvailable());
}

/** Перерисовать при смене выбора участника или отключении RNNoise. */
export function useNoiseVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/**
 * Сколько звука RNNoise не успел обработать. Окна по 10 с от worklet;
 * первое окно после запуска пропускаем — Worker прогревается.
 */
class LateGuard {
  private windows = 0;
  private softInRow = 0;
  /** Накопление за минуту — для журнала. */
  total = 0;
  denoised = 0;
  worstPct = 0;

  /** Вернёт причину перехода на встроенное или `null`. */
  add(denoised: number, total: number): string | null {
    if (total <= 0) return null;
    this.windows++;
    if (this.windows === 1) return null;
    this.total += total;
    this.denoised += denoised;
    const late = 1 - denoised / total;
    this.worstPct = Math.max(this.worstPct, Math.round(late * 1000) / 10);
    if (late > LATE_HARD) return "rnnoise_late";
    this.softInRow = late > LATE_SOFT ? this.softInRow + 1 : 0;
    return this.softInRow >= 2 ? "rnnoise_late" : null;
  }

  /** Доля необработанного за накопленное время, % (null — нечего считать) — и сброс. */
  take(): { latePct: number | null; worstPct: number; frames: number } {
    const out = {
      latePct: this.total > 0 ? Math.round((1 - this.denoised / this.total) * 1000) / 10 : null,
      worstPct: this.worstPct,
      frames: this.total,
    };
    this.total = 0;
    this.denoised = 0;
    this.worstPct = 0;
    return out;
  }
}

let lateGuard = new LateGuard();

/** Перегрузка процессора по Compute Pressure (Chromium); без API — молчит. */
export function pressureVerdict(
  level: string | null,
  since: { critical: number; serious: number },
  now: number,
): { since: { critical: number; serious: number }; reason: string | null } {
  const critical = level === "critical" ? since.critical || now : 0;
  const serious = level === "critical" || level === "serious" ? since.serious || now : 0;
  const reason =
    (critical && now - critical >= PRESSURE_CRITICAL_MS) || (serious && now - serious >= PRESSURE_SERIOUS_MS)
      ? "cpu_pressure"
      : null;
  return { since: { critical, serious }, reason };
}

/**
 * Процессор LiveKit: микрофон → свой AudioContext 48 кГц (частота RNNoise) →
 * worklet → MediaStreamDestination; `processedTrack` уходит на сервер вместо
 * исходного. Смену микрофона LiveKit доводит до нас через `restart`.
 */
class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = PROCESSOR_NAME;
  processedTrack?: MediaStreamTrack;
  private ctx: AudioContext | null = null;
  private moduleLoaded = false;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;

  async init(opts: AudioProcessorOptions) {
    await this.build(opts.track);
  }

  async restart(opts: AudioProcessorOptions) {
    this.teardownGraph();
    await this.build(opts.track);
  }

  async destroy() {
    this.teardownGraph();
    const ctx = this.ctx;
    this.ctx = null;
    await ctx?.close().catch(() => undefined);
  }

  private async build(input: MediaStreamTrack) {
    this.ctx ??= new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    const ctx = this.ctx;
    if (!this.moduleLoaded) {
      await ctx.audioWorklet.addModule(workletUrl);
      this.moduleLoaded = true;
    }
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("rnnoise_timeout")), READY_TIMEOUT_MS);
      node.port.onmessage = (e: MessageEvent<{ type?: string; message?: string; denoised?: number; total?: number }>) => {
        if (e.data?.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (e.data?.type === "error") {
          clearTimeout(timer);
          reject(new Error(e.data.message ?? "rnnoise_error"));
        } else if (e.data?.type === "stats") {
          // Окно 10 с: RNNoise не успевает — до конца урока встроенное.
          const reason = lateGuard.add(e.data.denoised ?? 0, e.data.total ?? 0);
          if (reason) blockStrong(reason);
        }
      };
    });
    const worker = new RnnoiseWorker();
    const channel = new MessageChannel();
    worker.postMessage({ type: "port", port: channel.port2 }, [channel.port2]);
    node.port.postMessage({ type: "port", port: channel.port1 }, [channel.port1]);
    this.worker = worker;
    const source = ctx.createMediaStreamSource(new MediaStream([input]));
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    source.connect(node).connect(dest);
    this.source = source;
    this.node = node;
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
    // Без жеста пользователя (вход после F5) контекст может остаться
    // приостановленным — тогда на сервер шла бы тишина.
    if (ctx.state !== "running") throw new Error("audio_context_suspended");
    await ready;
    this.processedTrack = dest.stream.getAudioTracks()[0];
  }

  private teardownGraph() {
    this.node?.port.postMessage({ type: "stop" });
    this.worker?.terminate();
    this.worker = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.source = null;
    this.node = null;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
  }
}

/**
 * Встроенный фильтр браузера. Chrome меняет его через `applyConstraints` не
 * всегда (стенд 2026-10-17: «обычное» после «сильного» оставалось без
 * фильтра) — тогда микрофон переоткрываем тем же устройством.
 */
async function setBrowserNoiseSuppression(mic: LocalAudioTrack, on: boolean) {
  const media = mic.mediaStreamTrack;
  const before = media.getSettings();
  if (before.noiseSuppression === undefined || before.noiseSuppression === on) return;
  await mic.applyConstraints({ ...media.getConstraints(), noiseSuppression: on }).catch(() => undefined);
  if (mic.mediaStreamTrack.getSettings().noiseSuppression === on) return;
  await mic
    .restartTrack({
      deviceId: before.deviceId,
      noiseSuppression: on,
      echoCancellation: before.echoCancellation,
      autoGainControl: before.autoGainControl,
      channelCount: before.channelCount,
    })
    .catch(() => undefined);
}

async function applyToTrack(mic: LocalAudioTrack, want: NoiseEffective): Promise<"ok" | string> {
  const hasRnnoise = mic.getProcessor()?.name === PROCESSOR_NAME;
  if (want !== "strong") {
    if (hasRnnoise) await mic.stopProcessor();
    await setBrowserNoiseSuppression(mic, want === "standard");
    return "ok";
  }
  if (hasRnnoise) return "ok";
  await setBrowserNoiseSuppression(mic, false);
  try {
    await mic.setProcessor(new RnnoiseProcessor());
    return "ok";
  } catch (err) {
    await mic.stopProcessor().catch(() => undefined);
    return err instanceof Error ? err.message.slice(0, 80) : "rnnoise_failed";
  }
}

/**
 * Ставит выбранный режим на опубликованный микрофон — при входе, при
 * публикации микрофона заново и при смене режима. Внутри `<LiveKitRoom>`.
 */
export function NoiseSuppressionController({ schoolMode }: { schoolMode: NoiseSuppressionMode }) {
  const room = useRoomContext();
  useNoiseVersion();
  const mode = currentNoiseMode(schoolMode);
  const effective = effectiveNoise(schoolMode);

  useEffect(() => {
    let chain: Promise<unknown> = Promise.resolve();
    let cancelled = false;
    const tier = noiseTier(deviceProfileNow());

    // Следующее включение микрофона без явных параметров (`MicControls.tsx`,
    // `MediaRecovery`) берёт этот дефолт комнаты.
    room.options.audioCaptureDefaults = {
      ...room.options.audioCaptureDefaults,
      noiseSuppression: effective === "standard",
    };

    const apply = () => {
      chain = chain.then(async () => {
        if (cancelled) return;
        const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as
          | LocalAudioTrack
          | undefined;
        if (!mic) return;
        const result = await applyToTrack(mic, effective);
        if (cancelled) return;
        track("noise_suppression", {
          livekitRoom: room.name || null,
          mode,
          effective,
          tier,
          score: deviceProfileNow()?.score ?? null,
          blocked: strongBlocked,
          result,
        });
        if (result !== "ok") {
          blockStrong(result);
          // Снова попробуем после жеста пользователя — контекст тогда запустится.
          if (result === "audio_context_suspended") {
            const retry = () => {
              if (strongBlocked === "audio_context_suspended") {
                strongBlocked = null;
                notify();
              }
            };
            document.addEventListener("pointerdown", retry, { once: true, capture: true });
          }
        }
      });
    };

    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone) apply();
    };
    room.localParticipant.on(ParticipantEvent.LocalTrackPublished, onPublished);
    room.on(RoomEvent.Connected, apply);
    apply();

    const strong = effective === "strong";
    const unsubscribeCpu = strong
      ? subscribeCpuLoadLevel(() => {
          if (cpuLoadLevel() >= CPU_FALLBACK_LEVEL) blockStrong("cpu_overload");
        })
      : () => undefined;

    // Перегрузка процессора по Compute Pressure — и без камеры (ступень
    // `cpu-load-engine` растёт только от видео и провалов захвата звука).
    let since = { critical: 0, serious: 0 };
    let worstPressure: string | null = null;
    const pressureTimer = strong
      ? setInterval(() => {
          const level = currentPressure();
          if (level === "critical" || (level === "serious" && worstPressure !== "critical")) worstPressure = level;
          const v = pressureVerdict(level, since, Date.now());
          since = v.since;
          if (v.reason) blockStrong(v.reason);
        }, PRESSURE_POLL_MS)
      : null;

    const report = (final: boolean) => {
      const s = lateGuard.take();
      if (s.frames === 0 && !final) return;
      track("noise_suppression_stats", {
        livekitRoom: room.name || null,
        latePct: s.latePct,
        worstWindowPct: s.worstPct,
        seconds: Math.round(s.frames / 100),
        pressure: worstPressure,
        blocked: strongBlocked,
        final,
      });
      worstPressure = null;
    };
    if (strong) lateGuard = new LateGuard();
    const statsTimer = strong ? setInterval(() => report(false), STATS_EVERY_MS) : null;

    return () => {
      cancelled = true;
      room.localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublished);
      room.off(RoomEvent.Connected, apply);
      unsubscribeCpu();
      if (pressureTimer) clearInterval(pressureTimer);
      if (statsTimer) clearInterval(statsTimer);
      // Последние секунды «сильного» (в т. ч. причина перехода на встроенное).
      if (strong) report(true);
    };
  }, [room, mode, effective]);

  return null;
}
