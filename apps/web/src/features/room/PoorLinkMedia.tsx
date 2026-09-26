import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ConnectionQuality,
  LocalVideoTrack,
  RemoteTrackPublication,
  RoomEvent,
  Track,
  VideoQuality,
  type Participant,
} from "livekit-client";

/**
 * Видео уступает канал звуку и доске, когда у ЭТОГО участника плохая связь.
 * Молча (без надписей) и только у него:
 *  - чужие камеры принимаются нижним слоем simulcast (плитки камер остаются,
 *    просто в низком качестве); демонстрацию экрана не трогаем — это контент;
 *  - своя камера отправляет только нижний слой (~180p).
 * Звук не трогаем. Связь восстановилась — всё возвращается само.
 *
 * Качество — `ConnectionQuality` локального участника от сервера LiveKit (по
 * потерям и джиттеру). Выход с гистерезисом, как у доски (board-link.ts):
 * в облегчённом режиме канал свободен и качество «хорошее», фиксированный
 * таймер давал бы раскачку — повторный заход удваивает удержание.
 */

const RECOVER_MIN_MS = 20_000;
const RECOVER_MAX_MS = 5 * 60_000;
const RELAPSE_WINDOW_MS = 5 * 60_000;

function isBad(quality: ConnectionQuality): boolean {
  return quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
}

/** `true`, пока связь участника плохая (с гистерезисом). */
function useLocalLinkPoor(): boolean {
  const room = useRoomContext();
  const [poor, setPoor] = useState(false);

  useEffect(() => {
    let current = false;
    let lastBadAt = 0;
    let recoverMs = RECOVER_MIN_MS;
    let leftAt = 0;

    const evaluate = () => {
      const now = Date.now();
      if (isBad(room.localParticipant.connectionQuality)) lastBadAt = now;
      const next = lastBadAt > 0 && now - lastBadAt < recoverMs;
      if (next === current) return;
      if (next) {
        recoverMs =
          leftAt > 0 && now - leftAt < RELAPSE_WINDOW_MS ? Math.min(recoverMs * 2, RECOVER_MAX_MS) : RECOVER_MIN_MS;
      } else {
        leftAt = now;
      }
      current = next;
      setPoor(next);
    };
    const onQuality = (_quality: ConnectionQuality, participant: Participant) => {
      if (participant === room.localParticipant) evaluate();
    };

    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    const interval = setInterval(evaluate, 2000);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      clearInterval(interval);
    };
  }, [room]);

  return poor;
}

type Qualities = Parameters<LocalVideoTrack["setPublishingLayers"]>[1];

/**
 * Ограничивает публикацию дорожки нижним слоем. Dynacast (сервер решает,
 * какие слои нужны подписчикам) тоже идёт через `setPublishingLayers`, поэтому
 * оборачиваем именно его у этой дорожки — иначе следующее решение сервера
 * снова включило бы верхние слои. Возвращает снятие ограничения.
 */
function capToLowLayer(track: LocalVideoTrack): () => void {
  const original = track.setPublishingLayers.bind(track);
  let lastRequested: { isSvc: boolean; qualities: Qualities } | null = null;
  const capped = (qualities: Qualities): Qualities => {
    const anyEnabled = qualities.some((q) => q.enabled);
    return qualities.map((q) => {
      const copy = q.clone();
      copy.enabled = anyEnabled && q.quality === VideoQuality.LOW;
      return copy;
    });
  };

  track.setPublishingLayers = (isSvc, qualities) => {
    lastRequested = { isSvc, qualities };
    return original(isSvc, capped(qualities));
  };
  track.setPublishingQuality(VideoQuality.LOW);

  return () => {
    track.setPublishingLayers = original;
    if (lastRequested) void original(lastRequested.isSvc, lastRequested.qualities);
    else track.setPublishingQuality(VideoQuality.HIGH);
  };
}

export function PoorLinkMediaAdapter() {
  const room = useRoomContext();
  const poor = useLocalLinkPoor();

  // Чужие камеры: нижний слой при плохой связи, иначе — как решит adaptiveStream.
  useEffect(() => {
    const quality = poor ? VideoQuality.LOW : VideoQuality.HIGH;
    const apply = (pub: RemoteTrackPublication) => {
      if (pub.source === Track.Source.Camera && pub.isSubscribed) pub.setVideoQuality(quality);
    };
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) apply(pub);
    }
    const onSubscribed = (_track: unknown, pub: RemoteTrackPublication) => apply(pub);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
    };
  }, [room, poor]);

  // Своя камера: только нижний слой, пока связь плохая (и при перевключении камеры).
  useEffect(() => {
    if (!poor) return;
    let release: (() => void) | null = null;
    const attach = () => {
      release?.();
      release = null;
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
      if (track instanceof LocalVideoTrack) release = capToLowLayer(track);
    };
    attach();
    const onLocalTrack = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Camera) attach();
    };
    room.on(RoomEvent.LocalTrackPublished, onLocalTrack);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrack);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onLocalTrack);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrack);
      release?.();
    };
  }, [room, poor]);

  return null;
}
