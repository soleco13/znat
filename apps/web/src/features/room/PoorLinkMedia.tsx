import { useEffect, useRef, useState } from "react";
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
import { isWebKitRouting, mediaRouteConfirmed, refreshMediaPath, useRouteWatch } from "./use-route-watch.js";
import { cpuConstrainedRecently, useCpuHeavy } from "./cpu-load.js";
import { useCameraBitrateBySize } from "./camera-bitrate.js";
import { peerStats, selectedPair, statsEntries } from "./peer-stats.js";

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
      if (isBad(quality)) linkQuality.reportBad("livekit_quality");
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

/**
 * Связь по самому медиапути (2026-10-17, аудит 4.4): потери и джиттер
 * входящих потоков и RTT выбранной пары ICE из одного `getStats()` соединения.
 * Раньше главным признаком был RTT HTTP-пинга по TCP: на потерях он растёт
 * сильнее медиа, а на далёкой сети с ровным RTT ≈ 400 мс ученик навсегда
 * сидел в экономном режиме.
 *
 * Плохой приём засчитываем, только если плохи потоки у ≥60 % публикаторов и
 * публикаторов хотя бы два (как в plugNmeet): иначе один ученик с плохим
 * исходящим каналом «портил» связь всем зрителям. С одним собеседником плохой
 * поток засчитываем, только если подтверждает и скачок RTT медиапути.
 * RTT — относительно базового (минимум за 2 мин), а не абсолютный.
 */
const MEDIA_TICK_MS = 4000;
/** Меньше пакетов за такт — потери не считаем (тихий/выключенный поток). */
const MEDIA_MIN_PACKETS = 20;
const MEDIA_POOR_LOSS = 0.05;
const MEDIA_POOR_AUDIO_JITTER_S = 0.05;
const MEDIA_POOR_SHARE = 0.6;
const MEDIA_RTT_SPIKE_MS = 250;
const MEDIA_RTT_BASE_WINDOW_MS = 120_000;

function useMediaPathQuality(): void {
  const room = useRoomContext();
  useEffect(() => {
    const prev = new Map<string, { received: number; lost: number }>();
    const rtts: { at: number; rtt: number }[] = [];
    const spikes: boolean[] = [];
    let running = false;
    const tick = async () => {
      if (running || document.hidden || room.state !== ConnectionState.Connected) return;
      running = true;
      try {
        const reports = await peerStats(room);
        if (!reports) return;
        const now = Date.now();
        const owner = new Map<string, string>();
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) {
            const id = pub.track?.mediaStreamTrack?.id;
            if (id) owner.set(id, p.identity);
          }
        }
        const measured = new Set<string>();
        const poor = new Set<string>();
        for (const r of statsEntries(reports, "inbound-rtp")) {
          const id = typeof r.trackIdentifier === "string" ? r.trackIdentifier : null;
          const who = id ? owner.get(id) : undefined;
          if (!id || !who) continue;
          const received = typeof r.packetsReceived === "number" ? r.packetsReceived : 0;
          const lost = typeof r.packetsLost === "number" ? Math.max(0, r.packetsLost) : 0;
          const before = prev.get(id);
          prev.set(id, { received, lost });
          if (!before) continue;
          const dr = received - before.received;
          const dl = Math.max(0, lost - before.lost);
          if (dr + dl < MEDIA_MIN_PACKETS) continue;
          measured.add(who);
          const jitter = typeof r.jitter === "number" ? r.jitter : 0;
          if (dl / (dr + dl) >= MEDIA_POOR_LOSS || (r.kind === "audio" && jitter >= MEDIA_POOR_AUDIO_JITTER_S)) poor.add(who);
        }
        const pair = selectedPair(reports);
        const rttS = typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime : null;
        let spike = false;
        if (rttS !== null) {
          const rtt = rttS * 1000;
          rtts.push({ at: now, rtt });
          while (rtts.length && now - rtts[0]!.at > MEDIA_RTT_BASE_WINDOW_MS) rtts.shift();
          const base = Math.min(...rtts.map((x) => x.rtt));
          spike = rtt > base + MEDIA_RTT_SPIKE_MS;
        }
        spikes.push(spike);
        if (spikes.length > 3) spikes.shift();
        const rttBad = spikes.filter(Boolean).length >= 2;
        let recvBad = false;
        if (measured.size >= 2) recvBad = poor.size / measured.size >= MEDIA_POOR_SHARE;
        else if (measured.size === 1) recvBad = poor.size === 1 && (spike || rttBad);
        if (recvBad) linkQuality.reportBad("media_loss");
        else if (rttBad) linkQuality.reportBad("media_rtt");
      } finally {
        running = false;
      }
    };
    const interval = setInterval(() => void tick(), MEDIA_TICK_MS);
    return () => clearInterval(interval);
  }, [room]);
}

/** Плохая оценка LiveKit держится столько — пробуем перевыбрать сетевой путь медиа. */
const STUCK_PATH_MS = 20_000;
/** Пауза между попытками: удваивается, пока связь не наладится. */
const PATH_RETRY_MIN_MS = 60_000;
const PATH_RETRY_MAX_MS = 8 * 60_000;
/** Связь хорошая столько подряд — прошлые попытки не в счёт. */
const PATH_GOOD_RESET_MS = 60_000;
/** Своя отправка видео упиралась в процессор так недавно — плохая оценка не про сеть. */
const PATH_CPU_QUIET_MS = 120_000;

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
 *
 * Только там, где эта беда и была (WebKit: iPhone, Safari), и только пока
 * проверка маршрута (`useRouteWatch`) не подтвердила, что медиа идёт через
 * текущую сеть: подтвердила — сеть не менялась, а перевыбор лишь рвёт звук на
 * 1–5 с. Урок 2026-10-14 (Саня, iPhone, слабый мобильный канал): оценка
 * «плохая» держалась почти всё время, и перевыбор шёл каждые 1,5–4 мин.
 * Смену сети ловит сама проверка маршрута.
 *
 * Не перевыбираем, пока своё устройство недавно не справлялось
 * (`cpu-load.ts`): урок 2026-10-09 — у учителя на слабом компьютере
 * потери от перегрузки процессора LiveKit оценил как плохую связь, и три
 * перезапуска подряд (по 2–6 с без звука) только добавили обрывов. Сеть при
 * этом была исправна, новый путь ничего не менял.
 */
function useMediaPathRefresh(): void {
  const room = useRoomContext();
  useEffect(() => {
    if (!isWebKitRouting()) return;
    let badSince = 0;
    let goodSince = 0;
    let retryMs = PATH_RETRY_MIN_MS;
    let lastAttemptAt = 0;
    const tick = () => {
      const now = Date.now();
      if (room.state !== ConnectionState.Connected || document.hidden || mediaRouteConfirmed()) {
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
      if (cpuConstrainedRecently(PATH_CPU_QUIET_MS)) {
        badSince = 0;
        return;
      }
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

/**
 * Плавный возврат после экономного режима (2026-10-17, по образцу «медленного
 * подъёма» Контур Толка): раньше чужие видео сразу прыгали с нижнего слоя на
 * верхний, полный поток не пролезал в только что оживший канал — и через
 * секунды снова провал. Теперь: нижний → средний → (выдержка) → верхний.
 * Сорвались во время подъёма — следующая выдержка вдвое дольше (до 2 мин);
 * продержались на верхнем 5 мин — выдержка снова короткая.
 */
const CLIMB_STEP_MS = 20_000;
const CLIMB_STEP_MAX_MS = 120_000;
const CLIMB_RESET_AFTER_MS = 5 * 60_000;

function useReceiveLevel(poor: boolean): VideoQuality {
  const [level, setLevel] = useState<VideoQuality>(poor ? VideoQuality.LOW : VideoQuality.HIGH);
  const levelRef = useRef(level);
  const hold = useRef(CLIMB_STEP_MS);
  const climbing = useRef(false);
  useEffect(() => {
    const set = (q: VideoQuality) => {
      levelRef.current = q;
      setLevel(q);
    };
    if (poor) {
      if (climbing.current) hold.current = Math.min(hold.current * 2, CLIMB_STEP_MAX_MS);
      climbing.current = false;
      set(VideoQuality.LOW);
      return;
    }
    if (levelRef.current === VideoQuality.HIGH) return;
    climbing.current = true;
    set(VideoQuality.MEDIUM);
    let reset: ReturnType<typeof setTimeout> | undefined;
    const up = setTimeout(() => {
      climbing.current = false;
      set(VideoQuality.HIGH);
      reset = setTimeout(() => {
        hold.current = CLIMB_STEP_MS;
      }, CLIMB_RESET_AFTER_MS);
    }, hold.current);
    return () => {
      clearTimeout(up);
      if (reset) clearTimeout(reset);
    };
  }, [poor]);
  return level;
}

export function PoorLinkMediaAdapter() {
  const room = useRoomContext();
  useReportLiveKitQuality();
  useMediaPathQuality();
  useMediaPathRefresh();
  useCameraBitrateBySize();
  useRouteWatch();
  useLinkProbe();
  const poor = useLinkPoor();
  const receiveLevel = useReceiveLevel(poor);
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
    const reason = poor && linkQuality.badReason ? `&reason=${encodeURIComponent(linkQuality.badReason)}` : "";
    void fetch(`/ping?link=${poor ? "poor" : "ok"}&who=${encodeURIComponent(who)}${reason}`, { cache: "no-store" }).catch(
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

  // Своё устройство не справляется (`cpu-load.ts`, ступень 2+): чужие камеры
  // тоже нижним слоем — каждая принятая камера разбирается процессором
  // учителя. Демонстрацию — нет: её текст должен оставаться читаемым.
  const cpuHeavy = useCpuHeavy();

  // Чужие камеры и демонстрация: нижний слой при плохой связи (у демонстрации
  // он есть с 2026-09-26 — 360p/5 кадр/с), иначе — как решит adaptiveStream.
  // Без этого сервер периодически пробовал поднять качество, полный поток в
  // канал не пролезал — каждая проба давала рывок. На телефоне камеры ещё и
  // не выше 360p (`PHONE_CAMERA_MAX`); оба ограничения — здесь, в одном
  // месте: `setVideoQuality` и `setVideoDimensions` сбрасывают друг друга.
  useEffect(() => {
    const apply = (pub: RemoteTrackPublication) => {
      const video = pub.source === Track.Source.Camera || pub.source === Track.Source.ScreenShare;
      // Только у потоков со слоями: у однослойного (например, демонстрация
      // со старой версии страницы) нижнего слоя нет, просить его нечего.
      if (!video || !pub.isSubscribed || !pub.simulcasted) return;
      const camera = pub.source === Track.Source.Camera;
      const quality = camera && cpuHeavy ? VideoQuality.LOW : receiveLevel;
      if (phone && camera && quality === VideoQuality.HIGH) pub.setVideoDimensions(PHONE_CAMERA_MAX);
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
  }, [room, receiveLevel, phone, cpuHeavy]);

  return null;
}
