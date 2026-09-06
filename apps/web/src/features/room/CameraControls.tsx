import { useEffect, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track, VideoPresets, type VideoResolution } from "livekit-client";
import { AlertTriangle, Video, VideoOff } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { RoomControlButton } from "./RoomControlButton.js";

/**
 * Кнопка «камера» (Э5.1/Э5.3/Э6.1). Публикация трека ручная, как и микрофон.
 * `maxResolution` передаётся из RoomPage: учителю 720p, ученику максимум 360p.
 */
export function SelfCameraButton({
  maxResolution = VideoPresets.h720.resolution,
}: {
  maxResolution?: VideoResolution;
}) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  return (
    <RoomControlButton
      active={isCameraEnabled}
      activeIcon={Video}
      inactiveIcon={VideoOff}
      activeLabel="Камера"
      inactiveLabel="Камера выкл."
      onToggle={() =>
        localParticipant.setCameraEnabled(!isCameraEnabled, { resolution: maxResolution })
      }
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
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-foreground">
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden />
        Плохой канал (потери видео {Math.round(lossRatio * 100)}%) — видео может мешать звуку урока.
      </span>
      <Button
        variant="destructive"
        size="sm"
        className="h-7 shrink-0"
        onClick={() => localParticipant.setCameraEnabled(false)}
      >
        Выключить видео
      </Button>
    </div>
  );
}
