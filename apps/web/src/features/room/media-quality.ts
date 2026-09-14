import { VideoPreset, VideoPresets, type VideoResolution } from "livekit-client";
import type { Framerate, MediaQualityPreset } from "@school/shared";

/**
 * Параметры школы (§10.10 ТЗ, запрос 2026-09-14) — мягкие дефолты качества
 * камеры/демонстрации, включая явный битрейт (запрос «более гибкие
 * настройки ... выставить битрейт»). `MediaQualityPreset` даёт только
 * разрешение, fps/битрейт — отдельные поля из настроек школы, поэтому
 * берём ширину/высоту готового `VideoPresets.*`, остальное — своё.
 * 480p у LiveKit нет — ближайший `h540`.
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
 * `VideoEncoding` (публикация камеры) — `maxBitrate` у LiveKit в бит/с,
 * настройки школы хранят Кбит/с (человекопонятнее в UI) — конвертация тут,
 * в одном месте.
 */
export function toVideoEncoding(fps: Framerate, bitrateKbps: number): { maxBitrate: number; maxFramerate: number } {
  return { maxBitrate: bitrateKbps * 1000, maxFramerate: fps };
}

/**
 * Демонстрация экрана — свой `VideoPreset` с битрейтом ИЗ настроек школы
 * (не из таблицы-заглушки — запрос 2026-09-14 «выставить битрейт»),
 * приоритет `"medium"` как у `ScreenSharePresets`/прежнего
 * `DOCUMENT_SCREEN_SHARE_PRESET`. `simulcast: false` при публикации
 * (задаётся в `ScreenShareControls.tsx`, не здесь) — см. коммит-фикс
 * «публикация демонстрации виснет на первой попытке»: пусть даже
 * произвольный битрейт, лишние вычисляемые слои симулкаста не нужны и
 * были источником зависания негоциации.
 */
export function toScreenShareEncoding(
  preset: MediaQualityPreset,
  fps: Framerate,
  bitrateKbps: number,
): VideoPreset {
  const { width, height } = RESOLUTION_BASE[preset];
  return new VideoPreset(width, height, bitrateKbps * 1000, fps, "medium");
}
