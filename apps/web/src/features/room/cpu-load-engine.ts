import { ConnectionState, LocalAudioTrack, LocalVideoTrack, Track, type Room } from "livekit-client";

import { CpuGovernor, SHARE_LEVEL, cameraFpsStarved, type Decision, type LoadSample, type PressureLevel } from "./cpu-governor.js";

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
 *  1 — камера 360p одним слоем;
 *  2 — камера 180p/10 одним слоем, демонстрация одним слоем 5 кадр/с; чужие
 *      камеры — нижним слоем (`PoorLinkMedia`);
 *  3 — минимум: камера 144p/5. Камера не выключается никогда.
 *
 * Облегчение не видно на уроке (решение владельца 2026-10-14): меняется только
 * кодировщик — число слоёв, `scaleResolutionDownBy`, `maxFramerate`,
 * `maxBitrate`. Камера не переоткрывается и захват не меняется: раньше
 * ступени делали `applyConstraints` и переоткрывали камеру в 640×360 — у
 * зрителей мигал кадр, а на iPhone вертикальный кадр 360×640 после
 * `applyConstraints` становился горизонтальным 320×180, и плитка ученика то
 * растягивалась на всю ширину, то становилась узкой вертикальной (урок
 * 2026-10-14, Саня, iPhone). Уменьшение в кодировщике сохраняет и
 * ориентацию, и пропорцию, своё превью не меняется. Тяжёлый захват
 * (720p) слабому устройству не достаётся вовсе: профиль устройства
 * определяется до проверки устройств, и такая камера сразу открывается в
 * 360p/15 (`RoomPage`).
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
}

const CAMERA_PROFILES: (CameraProfile | null)[] = [
  null,
  { short: 360, layers: 1, fps: 24 },
  { short: 180, layers: 1, fps: 10 },
  { short: 144, layers: 1, fps: 5 },
];

/**
 * Демонстрация на тяжёлых ступенях — и всегда, пока ведущий ушёл с вкладки
 * урока в показываемое окно: один слой, частота документа, как у Контур Толка
 * (у него демонстрация по умолчанию 5 кадр/с одним слоем, `contentHint:
 * detail`). Жалоба 2026-10-14: на слабом ПК с плохим каналом голос ведущего
 * зависал и пропадал, сильнее — когда он сворачивал урок или открывал
 * приложение поверх. Стенд (ведущий 0,5 ядра, выход 1 Мбит/с, поверх —
 * тяжёлое окно): захват микрофона 70 % при демонстрации по настройкам школы
 * (1080p/15, три слоя), 83 % одним слоем 5 кадр/с; у Толка 61 %.
 * Исключение — демонстрация со звуком вкладки (почти всегда видео): там нужна
 * плавность, облегчаем только по перегрузке.
 */
const SCREEN_REDUCED_FPS = 5;
/** Короткая сторона облегчённой демонстрации и её битрейт (Толк: 720p/5 — 1 Мбит/с). */
const SCREEN_REDUCED_SHORT = 720;
const SCREEN_SINGLE_LAYER_MAX_BITRATE = 1_000_000;

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
  /** Во сколько раз уменьшить верхний слой относительно захвата (кодировщиком). */
  baseScale = 1,
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
    const scale = baseScale * 2 ** (allowed - 1 - i);
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
 * Камера — по профилю ступени: только кодировщик (см. шапку). Верхний слой
 * уменьшается до короткой стороны профиля от фактического захвата, какой бы
 * ни была ориентация кадра.
 */
async function applyCamera(videoTrack: LocalVideoTrack, profile: CameraProfile | null, adjusted: Set<LocalVideoTrack>): Promise<void> {
  if (!profile) {
    if (!adjusted.has(videoTrack)) return;
    adjusted.delete(videoTrack);
    await restoreLayers(videoTrack);
    return;
  }
  adjusted.add(videoTrack);
  const { width, height } = videoTrack.mediaStreamTrack.getSettings();
  const captured = width && height ? Math.min(width, height) : profile.short;
  const baseScale = Math.max(1, captured / profile.short);
  await setLayers(videoTrack, profile.layers, (scale) => bitrateFor(captured / scale, profile.fps), profile.fps, baseScale);
}

/** Частота захвата демонстрации до облегчения — по трекам экрана. */
const screenCaptureFps = new WeakMap<MediaStreamTrack, number>();

/**
 * Облегчённая демонстрация: один слой не больше 720p и 5 кадр/с — и в
 * кодировщике, и в захвате экрана (для экрана это незаметно: зритель и так
 * получает 5 кадр/с). Раньше оставшийся слой растягивался до размера захвата —
 * 1080p, хотя сервер до этого включал только 360p: «облегчение» утяжеляло
 * кодирование (стенд 2026-10-14).
 */
async function applyScreen(videoTrack: LocalVideoTrack, reduced: boolean, adjusted: Set<LocalVideoTrack>): Promise<void> {
  const mst = videoTrack.mediaStreamTrack;
  if (!reduced) {
    if (!adjusted.has(videoTrack)) return;
    adjusted.delete(videoTrack);
    await restoreLayers(videoTrack);
    const fps = screenCaptureFps.get(mst);
    if (fps) {
      screenCaptureFps.delete(mst);
      await mst.applyConstraints({ ...mst.getConstraints(), frameRate: fps }).catch(() => undefined);
    }
    return;
  }
  adjusted.add(videoTrack);
  const { width, height, frameRate } = mst.getSettings();
  if (!screenCaptureFps.has(mst) && frameRate && frameRate > SCREEN_REDUCED_FPS) {
    screenCaptureFps.set(mst, frameRate);
    await mst.applyConstraints({ ...mst.getConstraints(), frameRate: SCREEN_REDUCED_FPS }).catch(() => undefined);
  }
  const short = width && height ? Math.min(width, height) : SCREEN_REDUCED_SHORT;
  const baseScale = Math.max(1, short / SCREEN_REDUCED_SHORT);
  await setLayers(videoTrack, 1, () => SCREEN_SINGLE_LAYER_MAX_BITRATE, SCREEN_REDUCED_FPS, baseScale);
}

// ---------- признаки перегрузки ----------

async function videoCpuLimited(videoTrack: LocalVideoTrack | undefined, encoderFpsCap?: number): Promise<boolean> {
  if (!videoTrack || videoTrack.isMuted || !videoTrack.sender) return false;
  try {
    const stats = await videoTrack.getSenderStats();
    if (stats.some((s) => s.qualityLimitationReason === "cpu")) return true;
    // Узкий канал браузер тоже отрабатывает частотой кадров — это сеть, не процессор.
    if (videoTrack.source !== Track.Source.Camera || stats.some((s) => s.qualityLimitationReason === "bandwidth")) return false;
    const captureFps = videoTrack.mediaStreamTrack.getSettings().frameRate ?? 0;
    const fps = Math.max(0, ...stats.map((s) => s.framesPerSecond ?? 0));
    return cameraFpsStarved(captureFps, encoderFpsCap, fps);
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
 * камере и демонстрации. `onChange` — смена ступени (для лога). Возвращает
 * остановку: всё возвращается к исходному.
 */
export function startCpuLoadAdapter(
  room: Room,
  handlers: {
    onChange?: (change: CpuLoadChange) => void;
  } = {},
  initialLevel = 0,
  strongDevice = false,
): () => void {
  const governor = new CpuGovernor(initialLevel, strongDevice);
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

      const [cameraCpu, screenCpu] = await Promise.all([videoCpuLimited(camera, CAMERA_PROFILES[governor.level]?.fps), videoCpuLimited(screen)]);
      const sample: LoadSample = {
        now: Date.now(),
        audioCapture,
        videoCpuLimited: cameraCpu || screenCpu,
        pressure,
        sharing: !!screen?.sender,
        hasVideo: (!!camera?.sender && !camera.isMuted) || !!screen?.sender,
        hidden: document.visibilityState === "hidden",
      };
      const decision = governor.update(sample);
      if (governor.level > 0 || (decision.changed && decision.reason !== "recovery")) lastCpuConstrainedAt = sample.now;
      setCurrentLevel(governor.level);

      // Каждый тик: после переподключения, смены камеры или нового включения
      // трек приходит с исходными параметрами — ступень применяется заново.
      if (camera?.sender && !camera.isMuted) {
        await applyCamera(camera, CAMERA_PROFILES[governor.level] ?? null, adjusted);
      }
      if (screen?.sender) {
        const away = document.visibilityState === "hidden" && !room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
        await applyScreen(screen, governor.level >= SHARE_LEVEL || away, adjusted);
      }
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
  // Ушёл с вкладки / вернулся — сразу, не ждём таймер (в скрытой вкладке
  // браузер таймеры замедляет).
  const onVisibility = () => void tick();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    disposed = true;
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    stopPressure();
    setCurrentLevel(0);
    for (const t of adjusted) void restoreLayers(t);
    adjusted.clear();
  };
}
