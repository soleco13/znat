import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type Room } from "livekit-client";

import { track } from "../../shared/telemetry.js";

/**
 * Перевыбор сетевого пути медиа: то же переподключение, что LiveKit делает
 * при обрыве сигнального канала (resume: новый сигнал и ICE restart, треки и
 * публикации сохраняются). Браузер заново собирает кандидатов на текущих
 * маршрутах. `/ping?link=repath` — строка в серверном логе.
 */
export function refreshMediaPath(room: Room): void {
  const who = room.localParticipant.identity;
  void fetch(`/ping?link=repath&who=${encodeURIComponent(who)}`, { cache: "no-store" }).catch(() => undefined);
  void room.simulateScenario("signal-reconnect").catch(() => undefined);
}

/** Safari и любой браузер на iOS (все на WebKit). Chrome на Android сам предпочитает Wi-Fi. */
function isWebKitRouting(): boolean {
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua));
}

/**
 * Перезапуск — через 5–10 с после того, как новая сеть стала маршрутом по
 * умолчанию: проверка уже видит маршрут, а не включение Wi-Fi, поэтому
 * собранные заново кандидаты сядут в него. Две проверки подряд — от
 * дребезга сети.
 */
const ROUTE_CHECK_MS = 5_000;
/** Столько расхождений подряд — перезапуск. */
const ROUTE_MISMATCHES = 2;
/** Пауза после перезапуска, который снова сел не туда; удваивается. */
const ROUTE_RETRY_MIN_MS = 60_000;
const ROUTE_RETRY_MAX_MS = 8 * 60_000;
const PROBE_TIMEOUT_MS = 2_000;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Локальный IPv4 текущего маршрута по умолчанию. WebKit собирает host-
 * кандидатов только по маршрутам по умолчанию (по одному на IPv4 и IPv6),
 * поэтому первый host IPv4 пустого соединения — это сеть, через которую iOS
 * сейчас ходит наружу. Без ICE-серверов — ни одного пакета в сеть.
 * null — адрес скрыт (*.local: нет разрешения на микрофон/камеру) или не собрался.
 */
async function probeRouteAddress(): Promise<string | null> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    pc.createDataChannel("route");
    const found = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          clearTimeout(timer);
          resolve(null);
          return;
        }
        // candidate:<foundation> <component> <proto> <priority> <address> <port> typ <type>
        const parts = ev.candidate.candidate.split(" ");
        const address = ev.candidate.address ?? parts[4] ?? "";
        if (parts[7] === "host" && IPV4.test(address)) {
          clearTimeout(timer);
          resolve(address);
        }
      };
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS));
    const offer = (async () => {
      await pc.setLocalDescription(await pc.createOffer());
      return found;
    })();
    return await Promise.race([offer, timeout]);
  } catch {
    return null;
  } finally {
    pc.close();
  }
}

/**
 * Wi-Fi включился посреди урока, а медиа осталось на сотовой. Safari не
 * переносит UDP-соединение на новую сеть и не сообщает странице о смене
 * сети; сам LiveKit перезапускает ICE только при обрыве. Если обрыв случился
 * в первые секунды после включения Wi-Fi, iOS ещё держит маршрут по
 * умолчанию на сотовой, и кандидаты снова собираются там (тест 2026-10-08,
 * 08:51:53 и 09:10:33: перезапуск через 2 с после включения Wi-Fi сел на
 * сотовую).
 *
 * Сеть медиа из статистики не узнать: Safari не отдаёт в getStats ни host-
 * кандидатов, ни relatedAddress (тест 2026-10-08, 09:16). Поэтому помним
 * маршрут на момент сбора кандидатов: проба в начале (пере)подключения и
 * после него. Совпали — медиа в этой сети. Разошлись (маршрут сменился
 * посреди подключения) — сеть медиа неизвестна, считаем, что не та.
 * Раз в 5 с проба текущего маршрута; две подряд не совпали с сетью медиа —
 * перевыбор пути. Повтор не раньше чем через минуту, дальше с нарастающей
 * паузой. Только WebKit; молча, каждое срабатывание — в лог.
 */
export function useRouteWatch(): void {
  const room = useRoomContext();
  useEffect(() => {
    if (!isWebKitRouting()) return;
    let disposed = false;
    /** Сеть, в которой собраны кандидаты медиа; null — неизвестна. */
    let mediaRoute: string | null = null;
    /** Маршрут сменился посреди подключения — сеть медиа под вопросом. */
    let mediaAmbiguous = false;
    let startProbe: Promise<string | null> | null = null;
    let connectSeq = 0;
    let mismatches = 0;
    let attempts = 0;
    let nextAllowedAt = 0;
    let busy = false;
    let reportedReady = false;
    let reportedNoRoute = false;
    const base = () => ({ livekitRoom: room.name || null, identity: room.localParticipant.identity || null });

    const onState = (state: ConnectionState) => {
      if (
        state === ConnectionState.Connecting ||
        state === ConnectionState.Reconnecting ||
        state === ConnectionState.SignalReconnecting
      ) {
        // Повторные события одного переподключения — первая проба ближе к его началу.
        startProbe ??= probeRouteAddress();
        mismatches = 0;
        return;
      }
      if (state !== ConnectionState.Connected) return;
      const seq = ++connectSeq;
      const start = startProbe;
      startProbe = null;
      void (async () => {
        const [before, after] = await Promise.all([start, probeRouteAddress()]);
        if (disposed || seq !== connectSeq) return;
        mediaRoute = after;
        mediaAmbiguous = before !== null && after !== null && before !== after;
        mismatches = 0;
        if (mediaAmbiguous) track("media_route_switch", { ...base(), stage: "ambiguous", routeBefore: before, routeAfter: after });
      })();
    };

    const tick = async () => {
      if (busy || startProbe) return;
      if (room.state !== ConnectionState.Connected || document.hidden) {
        mismatches = 0;
        return;
      }
      busy = true;
      try {
        const route = await probeRouteAddress();
        if (disposed || room.state !== ConnectionState.Connected) return;
        if (!route) {
          if (!reportedNoRoute) {
            // Адрес маршрута скрыт (*.local) или не собрался — одна строка в лог.
            reportedNoRoute = true;
            track("media_route_switch", { ...base(), stage: "unavailable", reason: "no_route" });
          }
          mismatches = 0;
          return;
        }
        // Вкладка открылась уже подключённой — маршрут сейчас и есть сеть медиа.
        if (mediaRoute === null && !mediaAmbiguous) mediaRoute = route;
        if (!reportedReady) {
          reportedReady = true;
          track("media_route_switch", { ...base(), stage: "ready", mediaAddress: mediaRoute, routeAddress: route });
        }
        if (route === mediaRoute && !mediaAmbiguous) {
          if (attempts > 0) track("media_route_switch", { ...base(), stage: "settled", mediaAddress: route, attempts });
          mismatches = 0;
          attempts = 0;
          nextAllowedAt = 0;
          return;
        }
        mismatches += 1;
        const now = Date.now();
        if (mismatches < ROUTE_MISMATCHES || now < nextAllowedAt) return;
        mismatches = 0;
        attempts += 1;
        nextAllowedAt = now + Math.min(ROUTE_RETRY_MIN_MS * 2 ** (attempts - 1), ROUTE_RETRY_MAX_MS);
        track("media_route_switch", {
          ...base(),
          stage: "restart",
          mediaAddress: mediaAmbiguous ? "ambiguous" : mediaRoute,
          routeAddress: route,
          attempt: attempts,
        });
        refreshMediaPath(room);
      } catch {
        // Диагностика пути — не повод для ошибки урока; следующий тик попробует снова.
      } finally {
        busy = false;
      }
    };

    room.on(RoomEvent.ConnectionStateChanged, onState);
    const interval = setInterval(() => void tick(), ROUTE_CHECK_MS);
    return () => {
      disposed = true;
      room.off(RoomEvent.ConnectionStateChanged, onState);
      clearInterval(interval);
    };
  }, [room]);
}
