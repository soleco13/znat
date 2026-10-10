import { ConnectionState, LocalAudioTrack, LocalVideoTrack, Track, type Room, type VideoCaptureOptions } from "livekit-client";

import { CpuGovernor, SHARE_LEVEL, type Decision, type LoadSample, type PressureLevel } from "./cpu-governor.js";

/**
 * Слабый процессор учителя (урок 2026-10-09, Pentium N3700): камера и
 * демонстрация отнимали процессор у звука, голос у учеников прерывался.
 * Стенд 2026-10-10 (учитель на 0,4 ядра, три ученика, запись звука у
 * ученика, PESQ): без видео 3,3; камера по настройкам школы (720p, три слоя
 * simulcast, 0,44 ядра на кодирование) — 1,3; та же камера одним слоем 360p
 * — 1,8, 180p/10 — 2,4; демонстрация одним слоем 5 кадр/с без камеры —
 * 3,15. Одна частота кадров звук не возвращала: работа — в разрешении,
 * числе слоёв и в самом захвате (кадры 720p с камеры разбираются, даже если
 * отправляется 180p).
 *
 * Ступени (`cpu-governor.ts`) — только пока устройство не справляется;
 * справилось — качество по ступеням возвращается к настройкам школы:
 *  0 — как задала школа;
 *  1 — камера 360p одним слоем (захват уменьшается на месте, `applyConstraints`);
 *  2 — камера 180p/10 одним слоем, камера один раз переоткрывается в
 *      640×360 — тогда и сама камера отдаёт меньше пикселей; демонстрация
 *      одним слоем 5 кадр/с; чужие камеры — нижним слоем (`PoorLinkMedia`);
 *  3 — минимум: камера 144p/5. Камера не выключается никогда.
 *
 * Слои: лишние слои simulcast выключаются, оставшийся растягивается на
 * размер захвата (без этого Chrome при захвате 360p сам выбрасывает верхний
 * слой и большая плитка получает 180p). dynacast LiveKit продолжает гасить
 * слои без зрителей, но включает только разрешённые. Остаётся нижний слой
 * `q` — сервер может отдать его любому зрителю. Соединение не трогается.
 */

interface CameraProfile {
  /** Короткая сторона захвата, px. */
  short: number;
  layers: number;
  fps: number;
  /** Переоткрыть камеру в низком разрешении (а не только уменьшить кадр после захвата). */
  reopen: boolean;
}

const CAMERA_PROFILES: (CameraProfile | null)[] = [
  null,
  { short: 360, layers: 1, fps: 24, reopen: false },
  { short: 180, layers: 1, fps: 10, reopen: true },
  { short: 144, layers: 1, fps: 5, reopen: true },
];

/** Камера, переоткрытая на тяжёлой ступени: 640×360 — хватает и ступени 1. */
const REOPEN_RESOLUTION = { width: 640, height: 360 };
/** Переоткрытие видно ученикам (кадр-два без изображения) — не чаще. */
const REOPEN_MIN_INTERVAL_MS = 120_000;

/** Демонстрация на тяжёлых ступенях: один слой, частота документа. */
const SCREEN_REDUCED_FPS = 5;
const SCREEN_SINGLE_LAYER_MAX_BITRATE = 1_500_000;

const TICK_MS = 2_000;

/** Битрейт слоя по его короткой стороне — как у `VideoPresets` LiveKit. */
function bitrateFor(short: number, fps: number): number {
  const base =
    short >= 720 ? 1_700_000 : short >= 540 ? 1_000_000 : short >= 360 ? 450_000 : short >= 270 ? 300_000 : short >= 180 ? 160_000 : 100_000;
  return fps < 15 ? Math.round(base * 0.75) : base;
}

let lastCpuConstrainedAt = 0;

/** Своё устройство недавно не справлялось (для `useMediaPathRefresh`: плохая оценка связи — не про сеть). */
export function cpuConstrainedRecently(withinMs: number): boolean {
  return lastCpuConstrainedAt > 0 && Date.now() - lastCpuConstrainedAt < withinMs;
}

// Ступень — подписчикам (приём чужих камер в `PoorLinkMedia`).
let currentLevel = 0;
const levelListeners = new Set<() => void>();

export function cpuLoadLevel(): number {
  return currentLevel;
}

export function subscribeCpuLoadLevel(listener: () => void): () => void {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
}

function setCurrentLevel(level: number): void {
  if (level === currentLevel) return;
  currentLevel = level;
  for (const l of levelListeners) l();
}

/** Со ступени 2 — чужие камеры нижним слоем. */
export const RECEIVE_LOW_LEVEL = SHARE_LEVEL;

// ---------- слои ----------

type PublishingLayers = LocalVideoTrack["setPublishingLayers"];
type Qualities = Parameters<PublishingLayers>[1];

/**
 * Ограничитель dynacast: LiveKit по подпискам зрителей включает и гасит
 * слои через `setPublishingLayers`. Пока ограничитель стоит, слои выше
 * `allowed` не включаются, их запрос переносится на верхний разрешённый.
 */
interface LayerGate {
  allowed: number;
  original: PublishingLayers;
  /** Последний запрос LiveKit без поправок — вернуть его при снятии. */
  last: { qualities: Qualities; enabled: boolean[]; isSvc: boolean } | null;
  /** Какие слои были включены до ограничителя — если LiveKit с тех пор ничего не присылал. */
  activeBefore: boolean[];
}

const gates = new WeakMap<LocalVideoTrack, LayerGate>();

/** Слои выше `allowed` выключены; был включён хоть один из них — включён верхний разрешённый. */
function maskActive(active: boolean[], allowed: number): boolean[] {
  return active.map((on, i) => {
    if (i < allowed - 1) return on;
    if (i === allowed - 1) return active.slice(i).some(Boolean);
    return false;
  });
}

function setGate(videoTrack: LocalVideoTrack, allowed: number, activeNow: boolean[]): void {
  const existing = gates.get(videoTrack);
  if (existing) {
    existing.allowed = allowed;
    return;
  }
  const original = videoTrack.setPublishingLayers;
  const gate: LayerGate = { allowed, original, last: null, activeBefore: activeNow };
  gates.set(videoTrack, gate);
  videoTrack.setPublishingLayers = (isSvc, qualities) => {
    gate.last = { qualities, enabled: qualities.map((q) => q.enabled), isSvc };
    // Качество LOW/MEDIUM/HIGH = индекс слоя q/h/f.
    const byIndex: boolean[] = [];
    for (const q of qualities) byIndex[q.quality] = q.enabled;
    const masked = maskActive(byIndex, gate.allowed);
    for (const q of qualities) q.enabled = masked[q.quality] ?? false;
    return original.call(videoTrack, isSvc, qualities);
  };
}

/**
 * Какие слои просят зрители — последний запрос dynacast без поправок
 * ограничителя (текущие флаги уже урезаны: при возврате с одного слоя на два
 * средний иначе так и остался бы выключен).
 */
function wantedLayers(videoTrack: LocalVideoTrack, count: number): boolean[] {
  const gate = gates.get(videoTrack)!;
  if (!gate.last) return gate.activeBefore;
  const wanted = [...gate.activeBefore];
  gate.last.qualities.forEach((q, i) => {
    if (q.quality < count) wanted[q.quality] = gate.last!.enabled[i] ?? false;
  });
  return wanted;
}

async function removeGate(videoTrack: LocalVideoTrack): Promise<void> {
  const gate = gates.get(videoTrack);
  if (!gate) return;
  gates.delete(videoTrack);
  // Собственное свойство поверх метода прототипа — убрать его.
  delete (videoTrack as { setPublishingLayers?: PublishingLayers }).setPublishingLayers;
  if (gate.last) {
    gate.last.qualities.forEach((q, i) => (q.enabled = gate.last!.enabled[i] ?? q.enabled));
    await gate.original.call(videoTrack, gate.last.isSvc, gate.last.qualities);
    return;
  }
  const sender = videoTrack.sender;
  if (!sender) return;
  const params = sender.getParameters();
  if (params.encodings?.length !== gate.activeBefore.length) return;
  params.encodings.forEach((e, i) => (e.active = gate.activeBefore[i]!));
  await sender.setParameters(params);
}

// ---------- применение ступени к треку ----------

interface EncodingSnapshot {
  scaleResolutionDownBy?: number;
  maxBitrate?: number;
  maxFramerate?: number;
}

/** Исходные параметры слоёв (до первой ступени) — по отправителю. */
const snapshots = new WeakMap<RTCRtpSender, EncodingSnapshot[]>();

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** Захват до первой ступени — по трекам камеры (после смены камеры трек новый). */
const captureOriginals = new WeakMap<MediaStreamTrack, { short: number; fps: number }>();

async function captureTo(videoTrack: LocalVideoTrack, short: number, maxFps: number): Promise<void> {
  const mst = videoTrack.mediaStreamTrack;
  const { width, height, frameRate } = mst.getSettings();
  if (!width || !height) return;
  const curShort = Math.min(width, height);
  if (!captureOriginals.has(mst)) captureOriginals.set(mst, { short: curShort, fps: frameRate ?? maxFps });
  const original = captureOriginals.get(mst)!;
  const target = Math.min(short, original.short);
  const fps = Math.min(maxFps, original.fps);
  if (Math.abs(curShort - target) <= 1 && Math.abs((frameRate ?? fps) - fps) <= 0.5) return;
  const w = width >= height ? even((target * width) / height) : target;
  const h = width >= height ? target : even((target * height) / width);
  try {
    await mst.applyConstraints({ width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate: { ideal: fps, max: fps } });
  } catch {
    // Строгие пределы камера не приняла — пусть подберёт ближайшее.
    await mst.applyConstraints({ width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: fps } }).catch(() => undefined);
  }
}

/**
 * Переоткрытие камеры: `applyConstraints` уменьшает кадр уже после захвата
 * — камера продолжает отдавать 720p, и браузер разбирает каждый такой кадр.
 * На тяжёлых ступенях камера открывается заново в 640×360 (LiveKit
 * `restartTrack`: тот же путь, что при каждом включении камеры кнопкой;
 * отправитель и соединение те же, микрофон не трогается). При возврате к
 * настройкам школы — заново в исходном разрешении. Не удалось — пробуем
 * прежние параметры, а переоткрытие больше не используем.
 */
interface ReopenState {
  /** Как камера была открыта до первого переоткрытия. */
  original: VideoCaptureOptions;
  low: boolean;
}
const reopened = new WeakMap<LocalVideoTrack, ReopenState>();
let lastReopenAt = 0;
let reopenBroken = false;

function captureOptions(videoTrack: LocalVideoTrack): VideoCaptureOptions {
  const c = videoTrack.constraints;
  const pick = (v: ConstrainULong | ConstrainDouble | undefined): number | undefined =>
    typeof v === "number" ? v : (v?.ideal ?? v?.exact ?? v?.max);
  const width = pick(c.width);
  const height = pick(c.height);
  const frameRate = pick(c.frameRate);
  const deviceId = typeof c.deviceId === "string" ? c.deviceId : Array.isArray(c.deviceId) ? c.deviceId[0] : c.deviceId?.exact ?? c.deviceId?.ideal;
  return {
    ...(width && height ? { resolution: { width, height, ...(frameRate ? { frameRate } : {}) } } : {}),
    ...(typeof deviceId === "string" ? { deviceId } : {}),
  };
}

async function reopenCamera(videoTrack: LocalVideoTrack, low: boolean): Promise<"done" | "skipped" | "failed"> {
  if (reopenBroken || videoTrack.isMuted) return "skipped";
  const state = reopened.get(videoTrack);
  if ((state?.low ?? false) === low) return "skipped";
  if (Date.now() - lastReopenAt < REOPEN_MIN_INTERVAL_MS) return "skipped";
  // Камера и так отдаёт не больше 360p — переоткрывать незачем. Смотрим на
  // захват до ступеней: после ступени 1 кадр уже уменьшен на месте.
  const { width, height } = videoTrack.mediaStreamTrack.getSettings();
  const deviceShort = captureOriginals.get(videoTrack.mediaStreamTrack)?.short ?? (width && height ? Math.min(width, height) : undefined);
  if (low && deviceShort !== undefined && deviceShort <= REOPEN_RESOLUTION.height) return "skipped";
  const original = state?.original ?? captureOptions(videoTrack);
  lastReopenAt = Date.now();
  try {
    await videoTrack.restartTrack(
      low ? { deviceId: original.deviceId, resolution: { ...REOPEN_RESOLUTION, frameRate: original.resolution?.frameRate } } : original,
    );
    if (low) reopened.set(videoTrack, { original, low: true });
    else reopened.delete(videoTrack);
    captureOriginals.delete(videoTrack.mediaStreamTrack);
    return "done";
  } catch {
    reopenBroken = true;
    reopened.delete(videoTrack);
    // Камера не открылась в новом режиме — прежние параметры, затем как есть.
    await videoTrack.restartTrack(original).catch(() => videoTrack.restartTrack().catch(() => undefined));
    return "failed";
  }
}

/** Вернуть захват к тому, что просил LiveKit при включении камеры. */
async function restoreCapture(videoTrack: LocalVideoTrack): Promise<void> {
  const { deviceId: _d, facingMode: _f, ...rest } = videoTrack.constraints;
  captureOriginals.delete(videoTrack.mediaStreamTrack);
  await videoTrack.mediaStreamTrack.applyConstraints(rest).catch(() => undefined);
}

/**
 * Слои отправителя: `layers` нижних, каждый следующий вдвое больше,
 * верхний — в размер захвата; остальные выключены через ограничитель.
 * `bitrate(scale)` — потолок слоя, `fps` — потолок частоты (нет — как у верхнего слоя).
 */
async function setLayers(
  videoTrack: LocalVideoTrack,
  layers: number,
  bitrate: (scale: number) => number,
  fps: number | undefined,
): Promise<void> {
  const sender = videoTrack.sender;
  if (!sender) return;
  const params = sender.getParameters();
  const encodings = params.encodings;
  if (!encodings?.length) return;
  if (!snapshots.has(sender)) {
    snapshots.set(
      sender,
      encodings.map((e) => ({ scaleResolutionDownBy: e.scaleResolutionDownBy, maxBitrate: e.maxBitrate, maxFramerate: e.maxFramerate })),
    );
  }
  const original = snapshots.get(sender)!;
  const allowed = Math.min(layers, encodings.length);
  if (encodings.length > 1) setGate(videoTrack, allowed, encodings.map((e) => e.active !== false));
  const active = encodings.length > 1 ? maskActive(wantedLayers(videoTrack, encodings.length), allowed) : [true];

  let changed = false;
  const assign = <K extends keyof RTCRtpEncodingParameters>(e: RTCRtpEncodingParameters, key: K, value: RTCRtpEncodingParameters[K]) => {
    if (e[key] !== value) {
      e[key] = value;
      changed = true;
    }
  };
  encodings.forEach((e, i) => {
    assign(e, "active", active[i]!);
    if (i >= allowed) return;
    const scale = 2 ** (allowed - 1 - i);
    const topFps = original[original.length - 1]?.maxFramerate;
    const layerFps = fps === undefined ? topFps : Math.min(fps, topFps ?? fps);
    const cap = original[original.length - 1]?.maxBitrate;
    assign(e, "scaleResolutionDownBy", scale);
    assign(e, "maxBitrate", Math.min(bitrate(scale), cap ?? Infinity));
    if (layerFps !== undefined) assign(e, "maxFramerate", layerFps);
  });
  if (changed) await sender.setParameters(params);
}

/** Исходные слои и подписка dynacast — как до первой ступени. */
async function restoreLayers(videoTrack: LocalVideoTrack): Promise<void> {
  const sender = videoTrack.sender;
  const original = sender ? snapshots.get(sender) : undefined;
  if (sender && original) {
    snapshots.delete(sender);
    const params = sender.getParameters();
    if (params.encodings?.length === original.length) {
      params.encodings.forEach((e, i) => {
        const o = original[i]!;
        e.scaleResolutionDownBy = o.scaleResolutionDownBy;
        e.maxBitrate = o.maxBitrate;
        e.maxFramerate = o.maxFramerate;
      });
      await sender.setParameters(params).catch(() => undefined);
    }
  }
  await removeGate(videoTrack).catch(() => undefined);
}

/**
 * Камера — по профилю ступени. Вниз: сначала захват меньше, потом слои
 * (иначе миг 720p на верхнем слое). К школе: сначала слои, потом захват.
 */
async function applyCamera(
  videoTrack: LocalVideoTrack,
  profile: CameraProfile | null,
  adjusted: Set<LocalVideoTrack>,
  onReopen: (result: "done" | "failed", low: boolean) => void,
): Promise<void> {
  if (!profile) {
    if (!adjusted.has(videoTrack)) return;
    await restoreLayers(videoTrack);
    if (reopened.get(videoTrack)?.low) {
      const r = await reopenCamera(videoTrack, false);
      // Рано переоткрывать ещё раз — следующий тик; кадр пока уменьшен на месте.
      if (r === "skipped") return;
      onReopen(r, false);
    }
    adjusted.delete(videoTrack);
    await restoreCapture(videoTrack);
    return;
  }
  adjusted.add(videoTrack);
  if (profile.reopen) {
    const r = await reopenCamera(videoTrack, true);
    if (r !== "skipped") onReopen(r, true);
  }
  await captureTo(videoTrack, profile.short, profile.fps);
  const { width, height } = videoTrack.mediaStreamTrack.getSettings();
  const short = width && height ? Math.min(width, height) : profile.short;
  await setLayers(videoTrack, profile.layers, (scale) => bitrateFor(short / scale, profile.fps), profile.fps);
}

async function applyScreen(videoTrack: LocalVideoTrack, reduced: boolean, adjusted: Set<LocalVideoTrack>): Promise<void> {
  if (!reduced) {
    if (!adjusted.has(videoTrack)) return;
    adjusted.delete(videoTrack);
    await restoreLayers(videoTrack);
    return;
  }
  adjusted.add(videoTrack);
  await setLayers(videoTrack, 1, () => SCREEN_SINGLE_LAYER_MAX_BITRATE, SCREEN_REDUCED_FPS);
}

// ---------- признаки перегрузки ----------

/** Камера кодирует меньше этой доли кадров захвата — кодировщик не успевает. */
const CAMERA_FPS_STARVED = 0.5;

async function videoCpuLimited(videoTrack: LocalVideoTrack | undefined): Promise<boolean> {
  if (!videoTrack || videoTrack.isMuted || !videoTrack.sender) return false;
  try {
    const stats = await videoTrack.getSenderStats();
    if (stats.some((s) => s.qualityLimitationReason === "cpu")) return true;
    // Узкий канал браузер тоже отрабатывает частотой кадров — это сеть, не процессор.
    if (videoTrack.source !== Track.Source.Camera || stats.some((s) => s.qualityLimitationReason === "bandwidth")) return false;
    const expected = videoTrack.mediaStreamTrack.getSettings().frameRate ?? 0;
    const fps = Math.max(0, ...stats.map((s) => s.framesPerSecond ?? 0));
    return expected > 0 && fps > 0 && fps < expected * CAMERA_FPS_STARVED;
  } catch {
    return false;
  }
}

/** Сколько секунд звука микрофон отдал к моменту отчёта (`timestamp`, мс). */
async function micCaptured(mic: LocalAudioTrack): Promise<{ at: number; seconds: number } | null> {
  const report = await mic.getRTCStatsReport().catch(() => undefined);
  if (!report) return null;
  let found: { at: number; seconds: number } | null = null;
  report.forEach((s: { type: string; kind?: string; timestamp: number; totalSamplesDuration?: number }) => {
    if (s.type === "media-source" && s.kind === "audio" && typeof s.totalSamplesDuration === "number") {
      found = { at: s.timestamp, seconds: s.totalSamplesDuration };
    }
  });
  return found;
}

interface PressureRecordLike {
  state: PressureLevel;
}
interface PressureObserverLike {
  observe(source: "cpu", options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}
type PressureObserverCtor = new (cb: (records: PressureRecordLike[]) => void) => PressureObserverLike;

/** Compute Pressure (Chromium 125+): последнее состояние процессора, если браузер его даёт. */
function watchPressure(onState: (s: PressureLevel) => void): () => void {
  const Ctor = (globalThis as { PressureObserver?: PressureObserverCtor }).PressureObserver;
  if (!Ctor) return () => undefined;
  try {
    const observer = new Ctor((records) => {
      const last = records[records.length - 1];
      if (last) onState(last.state);
    });
    void observer.observe("cpu", { sampleInterval: TICK_MS }).catch(() => undefined);
    return () => observer.disconnect();
  } catch {
    return () => undefined;
  }
}

function localVideo(room: Room, source: Track.Source): LocalVideoTrack | undefined {
  const t = room.localParticipant.getTrackPublication(source)?.track;
  return t instanceof LocalVideoTrack ? t : undefined;
}

function localMic(room: Room): LocalAudioTrack | undefined {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  return pub?.track instanceof LocalAudioTrack && !pub.isMuted ? pub.track : undefined;
}

/** Активные слои и кодировщик своей камеры — для лога. */
async function cameraSendInfo(camera: LocalVideoTrack | undefined): Promise<{ layers: number | null; encoder: string | null }> {
  if (!camera?.sender || camera.isMuted) return { layers: null, encoder: null };
  try {
    const stats = await camera.getSenderStats();
    const active = stats.filter((s) => (s.framesPerSecond ?? 0) > 0);
    const report = await camera.getRTCStatsReport();
    let encoder: string | null = null;
    report?.forEach((s: { type: string; encoderImplementation?: string }) => {
      if (s.type === "outbound-rtp" && s.encoderImplementation) encoder ??= s.encoderImplementation;
    });
    return { layers: active.length, encoder };
  } catch {
    return { layers: null, encoder: null };
  }
}

export interface CpuLoadChange {
  decision: Decision;
  sample: LoadSample;
  camera: { height: number | null; fps: number | null; targetHeight: number | null; layers: number | null; encoder: string | null };
  remoteVideos: number;
}

/**
 * Запустить автомат для комнаты: тик раз в 2 с, ступени применяются к своей
 * камере и демонстрации. `onChange` — смена ступени, `onReopen` — камера
 * переоткрыта (оба для лога). Возвращает остановку: всё возвращается к
 * исходному.
 */
export function startCpuLoadAdapter(
  room: Room,
  handlers: {
    onChange?: (change: CpuLoadChange) => void;
    onReopen?: (result: "done" | "failed", low: boolean) => void;
  } = {},
): () => void {
  const governor = new CpuGovernor();
  const adjusted = new Set<LocalVideoTrack>();
  let pressure: PressureLevel | null = null;
  const stopPressure = watchPressure((s) => (pressure = s));
  let prevMic: { track: LocalAudioTrack; at: number; seconds: number } | null = null;
  let running = false;
  let disposed = false;
  /** Короткая сторона камеры, которую задала школа (до первой ступени). */
  const targets = new WeakMap<LocalVideoTrack, number>();

  const tick = async () => {
    if (running || disposed || room.state !== ConnectionState.Connected) return;
    running = true;
    try {
      const camera = localVideo(room, Track.Source.Camera);
      const screen = localVideo(room, Track.Source.ScreenShare);
      const mic = localMic(room);
      if (camera && !targets.has(camera) && !adjusted.has(camera)) {
        const { width, height } = camera.mediaStreamTrack.getSettings();
        if (width && height) targets.set(camera, Math.min(width, height));
      }

      let audioCapture: number | null = null;
      const cur = mic ? await micCaptured(mic) : null;
      if (mic && cur && prevMic && prevMic.track === mic && cur.at > prevMic.at) {
        const wallS = (cur.at - prevMic.at) / 1000;
        if (wallS >= 1) audioCapture = Math.min(1, (cur.seconds - prevMic.seconds) / wallS);
      }
      prevMic = mic && cur ? { track: mic, ...cur } : null;

      const [cameraCpu, screenCpu] = await Promise.all([videoCpuLimited(camera), videoCpuLimited(screen)]);
      const sample: LoadSample = {
        now: Date.now(),
        audioCapture,
        videoCpuLimited: cameraCpu || screenCpu,
        pressure,
        sharing: !!screen?.sender,
        hasVideo: (!!camera?.sender && !camera.isMuted) || !!screen?.sender,
      };
      const decision = governor.update(sample);
      if (governor.level > 0 || (decision.changed && decision.reason !== "recovery")) lastCpuConstrainedAt = sample.now;
      setCurrentLevel(governor.level);

      // Каждый тик: после переподключения, смены камеры или нового включения
      // трек приходит с исходными параметрами — ступень применяется заново.
      if (camera?.sender && !camera.isMuted) {
        await applyCamera(camera, CAMERA_PROFILES[governor.level] ?? null, adjusted, (r, low) => handlers.onReopen?.(r, low));
      }
      if (screen?.sender) await applyScreen(screen, governor.level >= SHARE_LEVEL, adjusted);
      for (const t of adjusted) {
        if (t !== camera && t !== screen) adjusted.delete(t);
      }

      if (decision.changed) {
        const settings = camera?.mediaStreamTrack.getSettings();
        const info = await cameraSendInfo(camera);
        let remoteVideos = 0;
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) if (pub.kind === Track.Kind.Video && pub.isSubscribed) remoteVideos++;
        }
        handlers.onChange?.({
          decision,
          sample,
          camera: {
            height: settings?.height ?? null,
            fps: settings?.frameRate ?? null,
            targetHeight: camera ? (targets.get(camera) ?? null) : null,
            ...info,
          },
          remoteVideos,
        });
      }
    } catch {
      // Статистика или параметры отправителя не дались — следующий тик попробует снова.
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), TICK_MS);
  return () => {
    disposed = true;
    clearInterval(interval);
    stopPressure();
    setCurrentLevel(0);
    for (const t of adjusted) {
      void restoreLayers(t).then(async () => {
        if (t.source !== Track.Source.Camera) return;
        if (reopened.get(t)?.low) {
          lastReopenAt = 0;
          await reopenCamera(t, false);
        }
        await restoreCapture(t);
      });
    }
    adjusted.clear();
  };
}
