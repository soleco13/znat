import { useEffect } from "react";
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

import { linkQuality, useLinkPoor } from "@/shared/link-quality";
import { requestLessonPrecache } from "@/shared/service-worker";

/**
 * Видео уступает канал звуку и доске, когда у ЭТОГО участника плохая связь.
 * Молча (без надписей) и только у него:
 *  - чужие камеры и демонстрация экрана принимаются нижним слоем simulcast
 *    (плитки остаются, просто в низком качестве);
 *  - своя камера отправляет только нижний слой (~180p).
 * Звук не трогаем. Связь восстановилась — всё возвращается само.
 *
 * Режим — общий для доски и медиа (`shared/link-quality.ts`): плохие признаки
 * приходят и от LiveKit, и от пинга доски.
 */

function isBad(quality: ConnectionQuality): boolean {
  return quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
}

/**
 * Оценка LiveKit (по потерям и джиттеру) — ещё один источник плохих признаков
 * для общего детектора связи устройства. Пока качество плохое, сообщаем раз в
 * 2 с: событие приходит только при смене значения.
 */
function useReportLiveKitQuality(): void {
  const room = useRoomContext();
  useEffect(() => {
    const check = () => {
      if (isBad(room.localParticipant.connectionQuality)) linkQuality.reportBad();
    };
    const onQuality = (_quality: ConnectionQuality, participant: Participant) => {
      if (participant === room.localParticipant) check();
    };
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    const interval = setInterval(check, 2000);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      clearInterval(interval);
    };
  }, [room]);
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
  useReportLiveKitQuality();
  const poor = useLinkPoor();

  // Связь хорошая полминуты — просим service worker докачать файлы урока на
  // устройство (доска, задания): следующий вход откроется без сети. На
  // плохой связи не просим — фоновая закачка мешала бы уроку.
  useEffect(() => {
    if (poor) return;
    const timer = setTimeout(requestLessonPrecache, 30_000);
    return () => clearTimeout(timer);
  }, [poor]);

  // Чужие камеры и демонстрация: нижний слой при плохой связи (у демонстрации
  // он есть с 2026-09-26 — 360p/5 кадр/с), иначе — как решит adaptiveStream.
  // Без этого сервер периодически пробовал поднять качество, полный поток в
  // канал не пролезал — каждая проба давала рывок.
  useEffect(() => {
    const quality = poor ? VideoQuality.LOW : VideoQuality.HIGH;
    const apply = (pub: RemoteTrackPublication) => {
      const video = pub.source === Track.Source.Camera || pub.source === Track.Source.ScreenShare;
      if (video && pub.isSubscribed) pub.setVideoQuality(quality);
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
