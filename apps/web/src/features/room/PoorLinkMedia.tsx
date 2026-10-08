import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ConnectionQuality,
  ConnectionState,
  RemoteTrackPublication,
  RoomEvent,
  Track,
  VideoQuality,
  type Participant,
} from "livekit-client";

import { linkQuality, useLinkPoor, useLinkProbe } from "@/shared/link-quality";
import { requestLessonPrecache } from "@/shared/service-worker";
import { useIsNarrowViewport, useIsPhoneLandscape } from "./use-narrow-viewport.js";
import { refreshMediaPath, useRouteWatch } from "./use-route-watch.js";

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

/** Плохая оценка LiveKit держится столько — пробуем перевыбрать сетевой путь медиа. */
const STUCK_PATH_MS = 20_000;
/** Пауза между попытками: удваивается, пока связь не наладится. */
const PATH_RETRY_MIN_MS = 60_000;
const PATH_RETRY_MAX_MS = 8 * 60_000;
/** Связь хорошая столько подряд — прошлые попытки не в счёт. */
const PATH_GOOD_RESET_MS = 60_000;

/**
 * Медиа застревает на старой сети. Ученик вошёл с мобильного интернета и
 * включил Wi-Fi: страница работает через Wi-Fi, а WebRTC iPhone держит уже
 * выбранную пару ICE на сотовой сети, пока та хоть как-то жива, — камера и
 * звук так и идут через мобильную сеть с потерями (2026-10-05, МегаФон:
 * трафик шёл с IPv6 сотовой сети после перехода на Wi-Fi, потери каждые
 * 5–15 с). Сам LiveKit переподключается только при обрыве.
 *
 * Поэтому: плохая оценка держится `STUCK_PATH_MS` — делаем то же
 * переподключение, что LiveKit делает при обрыве сигнального канала
 * (resume: новый сигнал и ICE restart, треки и публикации сохраняются).
 * Браузер заново собирает кандидаты и выбирает лучшую сеть — Wi-Fi.
 * Если сеть не менялась, это короткая пауза на уже плохой связи; повторы
 * с нарастающей паузой. Молча, в интерфейсе ничего.
 */
function useMediaPathRefresh(): void {
  const room = useRoomContext();
  useEffect(() => {
    let badSince = 0;
    let goodSince = 0;
    let retryMs = PATH_RETRY_MIN_MS;
    let lastAttemptAt = 0;
    const tick = () => {
      const now = Date.now();
      if (room.state !== ConnectionState.Connected || document.hidden) {
        badSince = 0;
        return;
      }
      const quality = room.localParticipant.connectionQuality;
      if (!isBad(quality)) {
        badSince = 0;
        const good = quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent;
        if (!good) goodSince = 0;
        else if (!goodSince) goodSince = now;
        else if (now - goodSince >= PATH_GOOD_RESET_MS) retryMs = PATH_RETRY_MIN_MS;
        return;
      }
      goodSince = 0;
      if (!badSince) badSince = now;
      if (now - badSince < STUCK_PATH_MS) return;
      if (lastAttemptAt && now - lastAttemptAt < retryMs) return;
      if (lastAttemptAt) retryMs = Math.min(retryMs * 2, PATH_RETRY_MAX_MS);
      lastAttemptAt = now;
      badSince = 0;
      refreshMediaPath(room);
    };
    const interval = setInterval(tick, 2000);
    return () => clearInterval(interval);
  }, [room]);
}

/**
 * Потолок чужих камер на телефоне — 360p. Без него крупная плитка телефона
 * (около 370×480 CSS px при DPR 3) запрашивала 720p: 1,7 Мбит/с на одну
 * камеру, а с потолком — 640×360 и 0,45 Мбит/с при той же плитке (замер
 * 2026-10-07, `test-results/matis-media-adaptation-2026-10-07/`). Мелкие
 * плитки adaptiveStream по-прежнему опускает ниже.
 *
 * Именно `setVideoDimensions`, не `setVideoQuality(MEDIUM)`: livekit-client
 * сравнивает размер плитки со слоем по площади, портретная 370×480 «меньше»
 * 640×360 — потолок не срабатывал, а сервер по высоте 480 отдавал 720p.
 * Квадрат 360×360 больше любой мелкой плитки и меньше крупной по площади,
 * а по каждой стороне — ровно слой 640×360.
 */
const PHONE_CAMERA_MAX = { width: 360, height: 360 };

function useIsPhone(): boolean {
  const narrow = useIsNarrowViewport();
  const landscape = useIsPhoneLandscape();
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return coarse && (narrow || landscape);
}

export function PoorLinkMediaAdapter() {
  const room = useRoomContext();
  useReportLiveKitQuality();
  useMediaPathRefresh();
  useRouteWatch();
  useLinkProbe();
  const poor = useLinkPoor();
  const phone = useIsPhone();

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
  // канал не пролезал — каждая проба давала рывок. На телефоне камеры ещё и
  // не выше 360p (`PHONE_CAMERA_MAX`); оба ограничения — здесь, в одном
  // месте: `setVideoQuality` и `setVideoDimensions` сбрасывают друг друга.
  useEffect(() => {
    const quality = poor ? VideoQuality.LOW : VideoQuality.HIGH;
    const apply = (pub: RemoteTrackPublication) => {
      const video = pub.source === Track.Source.Camera || pub.source === Track.Source.ScreenShare;
      // Только у потоков со слоями: у однослойного (например, демонстрация
      // со старой версии страницы) нижнего слоя нет, просить его нечего.
      if (!video || !pub.isSubscribed || !pub.simulcasted) return;
      if (phone && !poor && pub.source === Track.Source.Camera) pub.setVideoDimensions(PHONE_CAMERA_MAX);
      else pub.setVideoQuality(quality);
    };
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) apply(pub);
    }
    const onSubscribed = (_track: unknown, pub: RemoteTrackPublication) => apply(pub);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
    };
  }, [room, poor, phone]);

  return null;
}
