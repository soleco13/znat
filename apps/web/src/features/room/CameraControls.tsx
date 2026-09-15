import { useEffect, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track, VideoPresets, type VideoEncoding, type VideoResolution } from "livekit-client";
import { AlertTriangle, Video, VideoOff } from "lucide-react";

import { RoomControlButton, type RoomControlVariant } from "./RoomControlButton.js";
import { useSelfCameraUiStore } from "./self-camera-ui-store.js";

/**
 * Кнопка «камера» (Э5.1/Э5.3/Э6.1). Публикация трека ручная, как и микрофон.
 * `maxResolution` передаётся из RoomPage: учителю 720p, ученику максимум 360p.
 */
export function SelfCameraButton({
  maxResolution = VideoPresets.h720.resolution,
  encoding,
  disabled = false,
  disabledReason,
  variant,
  onOpenSettings,
}: {
  maxResolution?: VideoResolution;
  /** Параметры школы (запрос 2026-09-14) — битрейт камеры, `toVideoEncoding` в `RoomPage.tsx`. Без него — дефолт LiveKit по разрешению. */
  encoding?: VideoEncoding;
  /** Юзабилити-правка: без права `canPublishVideo` кнопка видна, но disabled с объяснением. */
  disabled?: boolean;
  disabledReason?: string;
  variant?: RoomControlVariant;
  onOpenSettings?: () => void;
}) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const desiredOn = useSelfCameraUiStore((s) => s.desiredOn);
  const frameReady = useSelfCameraUiStore((s) => s.frameReady);
  const setDesiredOn = useSelfCameraUiStore((s) => s.setDesiredOn);

  // Реальное состояние LiveKit (подтверждённое `getUserMedia`/публикацией
  // или их провалом) — источник истины, к которому UI подтягивается сам.
  // Нужен на случай, если камера включилась/выключилась не по клику этой
  // кнопки (напр. `setCameraEnabled(true)` не смог получить устройство —
  // тогда `isCameraEnabled` так и останется false, и лоадер должен сняться,
  // а не крутиться бесконечно).
  useEffect(() => {
    setDesiredOn(isCameraEnabled);
  }, [isCameraEnabled, setDesiredOn]);

  return (
    <RoomControlButton
      // Кнопка рисуется по «намерению» пользователя, а не по факту из
      // LiveKit — включение/выключение выглядит мгновенным по клику, даже
      // пока getUserMedia/публикация/остановка трека ещё идут под капотом.
      active={desiredOn}
      loading={desiredOn && !frameReady}
      activeIcon={Video}
      inactiveIcon={VideoOff}
      activeLabel="Камера"
      inactiveLabel="Включить камеру"
      onToggle={() => {
        const next = !desiredOn;
        setDesiredOn(next);
        localParticipant.setCameraEnabled(next, { resolution: maxResolution }, { videoEncoding: encoding }).catch(() => {
          // Не получилось — откатываем намерение к тому, что реально есть.
          setDesiredOn(localParticipant.isCameraEnabled);
        });
      }}
      caption="Камера"
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      variant={variant}
      onOpenSettings={onOpenSettings}
      settingsLabel="Выбрать камеру"
    />
  );
}

/** Э5.5, ПЛАН.md — тот же порог формы, что `PacketLossWarning` для аудио (Э2.8), но для видео. */
const VIDEO_PACKET_LOSS_WARNING_RATIO = 0.05;
const POLL_MS = 2000;

/**
 * Деградация при плохом канале (Э5.5). `LocalVideoTrack.getSenderStats()`
 * отдаёт МАССИВ — по записи на каждый слой simulcast; складываем по всем.
 */
export function VideoDegradeSuggestion() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const setDesiredOn = useSelfCameraUiStore((s) => s.setDesiredOn);
  const [lossRatio, setLossRatio] = useState<number | null>(null);

  useEffect(() => {
    if (!isCameraEnabled) {
      setLossRatio(null);
      return;
    }
    let cancelled = false;

    async function poll() {
      const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
      const layers = await track?.getSenderStats();
      if (cancelled || !layers || layers.length === 0) return;
      let packetsSent = 0;
      let packetsLost = 0;
      for (const layer of layers) {
        packetsSent += layer.packetsSent ?? 0;
        packetsLost += layer.packetsLost ?? 0;
      }
      const total = packetsSent + packetsLost;
      setLossRatio(total >= 50 ? packetsLost / total : null);
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [localParticipant, isCameraEnabled]);

  if (lossRatio === null || lossRatio <= VIDEO_PACKET_LOSS_WARNING_RATIO) return null;

  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-[#fde68a] bg-warn-light px-3.5 py-2.5 text-[13.5px] text-[#b45309]">
      <AlertTriangle className="size-[17px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 [text-wrap:pretty]">
        Плохая связь — теряется {Math.round(lossRatio * 100)}% видео. Видео может мешать звуку урока.
      </span>
      <button
        type="button"
        className="h-[30px] shrink-0 rounded-[9px] border border-current bg-transparent px-3 text-[13px] font-semibold"
        onClick={() => {
          setDesiredOn(false);
          localParticipant.setCameraEnabled(false).catch(() => undefined);
        }}
      >
        Выключить видео
      </button>
    </div>
  );
}
