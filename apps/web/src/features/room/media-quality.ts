import { VideoPresets, type VideoResolution } from "livekit-client";
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
