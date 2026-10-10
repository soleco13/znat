import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { LocalVideoTrack, RoomEvent, Track, TrackEvent, type LocalTrackPublication } from "livekit-client";

/**
 * Битрейт школы для камеры учителя (по умолчанию 1700 кбит/с) рассчитан на
 * 720p, но веб-камера часто отдаёт меньше: на уроке 2026-10-09 камера
 * учителя открылась в 640×360 и верхний слой шёл на 1,0–1,3 Мбит/с — втрое
 * больше, чем нужно 360p, лишняя нагрузка на канал и кодировщик слабой
 * машины. Потолок верхнего слоя — по фактической высоте захвата; меньше
 * заданного школой не поднимаем.
 */
function bitrateCapForHeight(height: number): number | null {
  if (height <= 360) return 600_000;
  if (height <= 540) return 1_000_000;
  return null;
}

function capCameraBitrate(videoTrack: LocalVideoTrack): void {
  const sender = videoTrack.sender;
  const height = videoTrack.mediaStreamTrack.getSettings().height;
  if (!sender || !height) return;
  const cap = bitrateCapForHeight(height);
  if (cap === null) return;
  const params = sender.getParameters();
  const top = params.encodings?.[params.encodings.length - 1];
  if (!top || (top.maxBitrate !== undefined && top.maxBitrate <= cap)) return;
  top.maxBitrate = cap;
  void sender.setParameters(params).catch(() => undefined);
}

export function useCameraBitrateBySize(): void {
  const room = useRoomContext();
  useEffect(() => {
    // Камера заново открывается при каждом включении кнопкой и при смене
    // устройства (`restartTrack`): LiveKit тогда пересчитывает слои по
    // настройкам школы, и потолок надо поставить снова.
    const watched = new WeakSet<LocalVideoTrack>();
    const apply = (pub: LocalTrackPublication) => {
      const t = pub.track;
      if (pub.source !== Track.Source.Camera || !(t instanceof LocalVideoTrack)) return;
      capCameraBitrate(t);
      if (watched.has(t)) return;
      watched.add(t);
      t.on(TrackEvent.Restarted, () => capCameraBitrate(t));
    };
    const existing = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (existing) apply(existing);
    room.on(RoomEvent.LocalTrackPublished, apply);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, apply);
    };
  }, [room]);
}
