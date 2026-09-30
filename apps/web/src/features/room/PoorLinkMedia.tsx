import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ConnectionQuality,
  RemoteTrackPublication,
  RoomEvent,
  Track,
  VideoQuality,
  type Participant,
} from "livekit-client";

import { linkQuality, useLinkPoor, useLinkProbe } from "@/shared/link-quality";
import { requestLessonPrecache } from "@/shared/service-worker";

/**
 * Видео уступает канал звуку и доске, когда у ЭТОГО участника плохая связь.
 * Молча (без надписей) и только у него:
 *  - чужие камеры и демонстрация экрана принимаются нижним слоем simulcast
 *    (плитки остаются, просто в низком качестве);
 *
 * Свою камеру не ограничиваем (было до 2026-09-26): обёртка над слоями
 * публикации при включении экономного режима оставляла собеседникам пустую
 * плитку до перевключения камеры, а браузер и так сам снижает отправку при
 * слабом канале.
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
      const quality = room.localParticipant.connectionQuality;
      if (isBad(quality)) linkQuality.reportBad();
      linkQuality.reportMediaExcellent(quality === ConnectionQuality.Excellent);
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

export function PoorLinkMediaAdapter() {
  const room = useRoomContext();
  useReportLiveKitQuality();
  useLinkProbe();
  const poor = useLinkPoor();

  // Смена режима — в лог сервера (не в интерфейс): так видно, что режим
  // включился и выключился, даже когда доска закрыта.
  const firstReport = useRef(true);
  useEffect(() => {
    if (firstReport.current && !poor) {
      firstReport.current = false;
      return;
    }
    firstReport.current = false;
    const who = room.localParticipant.identity;
    void fetch(`/ping?link=${poor ? "poor" : "ok"}&who=${encodeURIComponent(who)}`, { cache: "no-store" }).catch(
      () => undefined,
    );
  }, [poor, room]);

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
      // Только у потоков со слоями: у однослойного (например, демонстрация
      // со старой версии страницы) нижнего слоя нет, просить его нечего.
      if (video && pub.isSubscribed && pub.simulcasted) pub.setVideoQuality(quality);
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

  return null;
}
