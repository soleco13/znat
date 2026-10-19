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
import { cpuLoadLevel, subscribeCpuLoadLevel } from "./cpu-load-engine.js";
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
 * Если с RNNoise устройство начало захлёбываться (`cpu-load-engine` дошёл до
 * ступени `CPU_FALLBACK_LEVEL`) или RNNoise не запустился — молча переходим
 * на встроенное до конца урока, в журнал — `noise_suppression`.
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
      node.port.onmessage = (e: MessageEvent<{ type?: string; message?: string }>) => {
        if (e.data?.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (e.data?.type === "error") {
          clearTimeout(timer);
          reject(new Error(e.data.message ?? "rnnoise_error"));
        } else if (e.data?.type === "fallback") {
          // Worker не успевал в половине кадров за минуту — до конца урока встроенное.
          blockStrong("rnnoise_late");
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

    const unsubscribeCpu =
      effective === "strong"
        ? subscribeCpuLoadLevel(() => {
            if (cpuLoadLevel() >= CPU_FALLBACK_LEVEL) blockStrong("cpu_overload");
          })
        : () => undefined;

    return () => {
      cancelled = true;
      room.localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublished);
      room.off(RoomEvent.Connected, apply);
      unsubscribeCpu();
    };
  }, [room, mode, effective]);

  return null;
}
