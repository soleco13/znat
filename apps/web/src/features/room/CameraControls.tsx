import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { VideoPresets, type VideoEncoding, type VideoResolution } from "livekit-client";
import { Video, VideoOff } from "lucide-react";

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
