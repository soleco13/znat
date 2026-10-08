import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, Track, type Room } from "livekit-client";

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
    await pc.setLocalDescription(await pc.createOffer());
    return await found;
  } catch {
    return null;
  } finally {
    pc.close();
  }
}

type StatsEntry = Record<string, unknown>;

/**
 * Локальные IPv4, на которых собраны кандидаты пары медиа: host-кандидаты её
 * транспорта. WebKit собирает их только на маршруте по умолчанию, поэтому это
 * сеть, в которой медиа сейчас. Сравниваем локальные адреса, не публичные:
 * публичный за NAT оператора меняется между соединениями. Адрес у самой пары
 * не годится — у Safari её локальный кандидат prflx/srflx без relatedAddress
 * (тест 2026-10-08). Пара через relay — не трогаем.
 */
async function mediaLocalAddresses(room: Room): Promise<{ addresses: string[]; localType: string | null } | null> {
  const local = room.localParticipant;
  const own = local.getTrackPublication(Track.Source.Microphone)?.track ?? local.getTrackPublication(Track.Source.Camera)?.track;
  let report = own ? await own.getRTCStatsReport() : undefined;
  if (!report) {
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.isSubscribed) report ??= await pub.track.getRTCStatsReport();
      }
    }
  }
  if (!report) return null;
  const entries: StatsEntry[] = [];
  report.forEach((s: StatsEntry) => entries.push(s));
  const pairId = entries.find((s) => s.type === "transport" && typeof s.selectedCandidatePairId === "string")
    ?.selectedCandidatePairId as string | undefined;
  const pair =
    (pairId ? (report.get(pairId) as StatsEntry | undefined) : undefined) ??
    entries.find((s) => s.type === "candidate-pair" && (s.selected === true || (s.nominated === true && s.state === "succeeded")));
  const cand = pair ? (report.get(String(pair.localCandidateId)) as StatsEntry | undefined) : undefined;
  if (!pair || !cand) return null;
  const localType = typeof cand.candidateType === "string" ? cand.candidateType : null;
  if (localType === "relay") return null;
  const addresses = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && IPV4.test(v)) addresses.add(v);
  };
  if (localType === "host") add(cand.address ?? cand.ip);
  else add(cand.relatedAddress);
  for (const s of entries) {
    if (s.type !== "local-candidate" || s.candidateType !== "host") continue;
    if (pair.transportId && s.transportId && s.transportId !== pair.transportId) continue;
    add(s.address ?? s.ip);
  }
  return { addresses: [...addresses], localType };
}

/**
 * Wi-Fi включился посреди урока, а медиа осталось на сотовой. Safari не
 * переносит UDP-соединение на новую сеть и не сообщает странице о смене
 * сети; сам LiveKit перезапускает ICE только при обрыве. Если обрыв случился
 * в первые секунды после включения Wi-Fi, iOS ещё держит маршрут по
 * умолчанию на сотовой, и кандидаты снова собираются там (тест 2026-10-08,
 * 08:51:53: перезапуск через 2 с после включения Wi-Fi сел на сотовую).
 *
 * Поэтому раз в 5 с сравниваем локальный адрес маршрута по умолчанию с
 * локальными адресами пары медиа. Два расхождения подряд — перевыбор пути.
 * После перезапуска проверка продолжается: снова не туда — следующий не
 * раньше чем через минуту, дальше с нарастающей паузой. Только WebKit;
 * молча, каждое срабатывание — в лог.
 */
export function useRouteWatch(): void {
  const room = useRoomContext();
  useEffect(() => {
    if (!isWebKitRouting()) return;
    let mismatches = 0;
    let attempts = 0;
    let nextAllowedAt = 0;
    let busy = false;
    let reportedUnavailable = false;
    let reportedReady = false;
    const base = () => ({ livekitRoom: room.name || null, identity: room.localParticipant.identity || null });
    const tick = async () => {
      if (busy) return;
      if (room.state !== ConnectionState.Connected || document.hidden) {
        mismatches = 0;
        return;
      }
      busy = true;
      try {
        const route = await probeRouteAddress();
        const found = route ? await mediaLocalAddresses(room) : null;
        if (route && found && found.addresses.length === 0 && !reportedUnavailable) {
          // Локальных адресов пары в статистике нет — детектор в этой вкладке
          // бесполезен; одна строка в лог, чтобы это было видно.
          reportedUnavailable = true;
          track("media_route_switch", { ...base(), stage: "unavailable", routeAddress: route, localType: found.localType });
        }
        const media = found?.addresses.join(",") ?? "";
        if (!route || !media || room.state !== ConnectionState.Connected) {
          mismatches = 0;
          return;
        }
        if (!reportedReady) {
          // Первое сравнение удалось — в лог, что детектор в этой вкладке работает.
          reportedReady = true;
          track("media_route_switch", { ...base(), stage: "ready", mediaAddress: media, routeAddress: route, localType: found?.localType });
        }
        if (found?.addresses.includes(route)) {
          if (attempts > 0) track("media_route_switch", { ...base(), stage: "settled", mediaAddress: media, attempts });
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
        track("media_route_switch", { ...base(), stage: "restart", mediaAddress: media, routeAddress: route, attempt: attempts });
        refreshMediaPath(room);
      } catch {
        // Диагностика пути — не повод для ошибки урока; следующий тик попробует снова.
      } finally {
        busy = false;
      }
    };
    const interval = setInterval(() => void tick(), ROUTE_CHECK_MS);
    return () => clearInterval(interval);
  }, [room]);
}
