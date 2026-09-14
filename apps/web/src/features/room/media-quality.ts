import { VideoPreset, VideoPresets, type VideoResolution } from "livekit-client";
import type { Framerate, MediaQualityPreset } from "@school/shared";

/**
 * Параметры школы (§10.10 ТЗ, запрос 2026-09-14) — мягкие дефолты качества
 * камеры/демонстрации. `MediaQualityPreset` даёт только разрешение, fps —
 * отдельное поле, поэтому берём ширину/высоту готового `VideoPresets.*`, а
 * `frameRate` подставляем свой (у пресетов LiveKit fps зашит вместе с
 * разрешением, нам нужно порознь). 480p у LiveKit нет — ближайший `h540`.
 */
const RESOLUTION_BASE: Record<MediaQualityPreset, VideoResolution> = {
  "360p": VideoPresets.h360.resolution,
  "480p": VideoPresets.h540.resolution,
  "720p": VideoPresets.h720.resolution,
  "1080p": VideoPresets.h1080.resolution,
};

export function toVideoResolution(preset: MediaQualityPreset, fps: Framerate): VideoResolution {
  return { ...RESOLUTION_BASE[preset], frameRate: fps };
}

/**
 * Битрейт демонстрации экрана по (разрешение × fps) — те же цифры, что
 * `livekit-client`'s `ScreenSharePresets` там, где combo совпадает
 * (360p/15→400k, 720p/15→1.5M, 720p/30→2M, 1080p/15→2.5M, 1080p/30→5M —
 * сверено с исходником, не выдумано), остальные клетки (480p — которого у
 * `ScreenSharePresets` нет вовсе, у нас там `h540`; 24fps — которого там
 * тоже нет) досчитаны интерполяцией по пикселям/fps от тех же опорных
 * точек, ЗАРАНЕЕ округлённые числа (не формула в рантайме) — можно свериться
 * глазами, в отличие от риска с egress `cpu_cost` (см. memory: там была
 * динамическая нестыковка конфигов, тут просто таблица битрейтов кодека,
 * жёсткого отказа WebRTC на «неправильное» значение не бывает).
 */
const SCREEN_SHARE_BITRATE: Record<MediaQualityPreset, Record<Framerate, number>> = {
  "360p": { 15: 400_000, 24: 450_000, 30: 500_000 },
  "480p": { 15: 800_000, 24: 1_000_000, 30: 1_100_000 },
  "720p": { 15: 1_500_000, 24: 1_800_000, 30: 2_000_000 },
  "1080p": { 15: 2_500_000, 24: 4_000_000, 30: 5_000_000 },
};

/**
 * Демонстрация экрана — свой `VideoPreset` (не готовый `ScreenSharePresets`,
 * там нет 480p/24fps), приоритет `"medium"` как у `ScreenSharePresets` и
 * прежнего `DOCUMENT_SCREEN_SHARE_PRESET` в `ScreenShareControls.tsx`.
 */
export function toScreenShareEncoding(preset: MediaQualityPreset, fps: Framerate): VideoPreset {
  const { width, height } = RESOLUTION_BASE[preset];
  return new VideoPreset(width, height, SCREEN_SHARE_BITRATE[preset][fps], fps, "medium");
}
