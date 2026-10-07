import { useEffect, useRef, useState } from "react";
import type { ServerRoomMessage } from "@school/shared";
import { getFreshAccessToken } from "../../shared/api-client.js";
import { clientSessionId, track } from "../../shared/telemetry.js";

export type SocketStatus = "connecting" | "connected" | "reconnecting" | "closed";

const MAX_BACKOFF_MS = 16_000;
/**
 * Сервер шлёт `heartbeat` раз в 20 с. Если за это время не пришло ни одного
 * сообщения, сокет считаем мёртвым и открываем новый: зависший на мобильной
 * сети TCP иначе «оживал» только по таймеру повторной передачи — события урока
 * приходили через ~30 с после возврата сети (E2E 2026-10-04, сценарий W).
 */
const STALE_AFTER_MS = 50_000;
/**
 * Подключение, зависшее без ответа (SYN теряются), тоже бросаем. Срок растёт
 * с каждой неудачей подряд: на 32 кбит/с с потерями 15 % TCP+TLS+upgrade
 * идёт 20–30 с, и жёсткие 20 с рвали каждую попытку — канал урока лежал
 * ~4 мин (E2E 2026-10-04 AFTER, HORRIBLE).
 */
const CONNECT_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MAX_MS = 60_000;
const STALE_CHECK_MS = 5_000;
/**
 * Браузер сообщил о возврате сети (`online`): не ждём остаток бэкоффа (до
 * 16 с), подключаемся сразу — но не чаще раза в этот срок, чтобы мигающая
 * сеть не устроила шторм подключений. `online` не гарантирует рабочий
 * интернет: неудачная попытка просто вернёт обычный бэкофф.
 */
const ONLINE_RETRY_MIN_GAP_MS = 5_000;
/** Сервер закрывает так сокет участника, которого нет в комнате (`rooms/ws.ts`). */
const NOT_JOINED_CLOSE_CODE = 4003;
/** Учитель удалил участника из урока — переподключаться незачем. */
const REMOVED_CLOSE_CODE = 4005;
/** Сервер не принял личность (`rooms/ws.ts`): у гостя — в том числе удалён или ссылку перевыпустили. */
const INVALID_TOKEN_CLOSE_CODE = 4001;
/**
 * Сервер вытеснил этот сокет более новым подключением той же личности
 * (`rooms/socket-registry.ts`): открыто больше вкладок, чем он держит.
 * Переподключаемся не сразу — иначе вкладки выбивали бы друг друга по кругу.
 */
const SUPERSEDED_CLOSE_CODE = 4009;

/**
 * WS-канал комнаты урока: только пуш от сервера, переподключение с экспоненциальным
 * бэкоффом. `enabled=false` держит канал закрытым — используется, пока ученик проходит
 * экран проверки устройств (Э2.4) и ещё не вошёл в урок.
 *
 * Э12.6 — `mode`: персонал передаёт access-токен в query, гость-ученик его
 * не имеет (httpOnly-кука `guest_session` уходит с рукопожатием сама,
 * см. `rooms/ws.ts`) — тогда параметр `token` опускаем.
 *
 * Э10.6 — `mode: "recorder"`: шаблон записи (`/egress`), вне `RequireAuth`
 * (нет `useAuthStore`). Токен приходит явным параметром `recorderToken`, не
 * из стора — recorder read-only и не участник урока (`rooms/ws.ts`
 * заводит для него отдельную ветку, в обход presence).
 */
export function useRoomSocket(
  lessonId: string,
  onMessage: (message: ServerRoomMessage) => void,
  enabled = true,
  mode: "staff" | "guest" | "recorder" = "staff",
  recorderToken?: string,
  onNotJoined?: () => Promise<void>,
) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onNotJoinedRef = useRef(onNotJoined);
  onNotJoinedRef.current = onNotJoined;

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    /** Сколько раз подключались за жизнь хука: 0 — первое, дальше — переподключения (в лог сервера). */
    let connects = 0;
    let openedAt = 0;
    let stopped = false;
    let lastMessageAt = 0;
    let connectingSince = 0;
    /** Сколько подключений подряд брошено по таймауту — от этого растёт срок. */
    let connectTimeouts = 0;
    let lastCloseCode = 0;
    let wentOffline = false;
    let lastOnlineRetryAt = 0;
    /** Идёт получение токена перед подключением — второй `connect` не начинаем. */
    let tokenInFlight = false;
    /**
     * Соединение уже открывалось — дальше это переподключение, а не первое
     * подключение, даже если счётчик попыток сброшен (`online`, зависшая
     * попытка). Иначе метка показывала «Подключение…», а оверлей «Связь
     * прервалась» (только для переподключения) не появлялся вовсе.
     */
    let everOpened = false;
    const report = mode !== "recorder";

    const connect = async () => {
      // Уже есть живое или подключающееся соединение (например, `online`
      // переподключил раньше отложенного таймера) — второе не открываем:
      // сервер держит ограниченное число сокетов на личность.
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      if (tokenInFlight) return;
      let tokenParam = "";
      if (mode === "staff") {
        tokenInFlight = true;
        const token = await getFreshAccessToken().catch(() => null);
        tokenInFlight = false;
        if (stopped) return;
        if (!token) {
          setStatus("reconnecting");
          reconnectTimer = setTimeout(connect, 1000);
          return;
        }
        tokenParam = `&token=${encodeURIComponent(token)}`;
      } else if (mode === "recorder") {
        if (!recorderToken) {
          setStatus("reconnecting");
          reconnectTimer = setTimeout(connect, 1000);
          return;
        }
        tokenParam = `&recorderToken=${encodeURIComponent(recorderToken)}`;
      }
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const correlation = `&cs=${encodeURIComponent(clientSessionId)}&attempt=${connects}`;
      const url = `${protocol}//${location.host}/ws?lessonId=${encodeURIComponent(lessonId)}${tokenParam}${correlation}`;
      setStatus(attempt === 0 && !everOpened ? "connecting" : "reconnecting");
      connects += 1;
      openedAt = 0;
      const current = new WebSocket(url);
      socket = current;
      connectingSince = Date.now();

      current.onopen = () => {
        everOpened = true;
        connectTimeouts = 0;
        openedAt = Date.now();
        lastMessageAt = Date.now();
        setStatus("connected");
      };
      current.onmessage = (event) => {
        // Брошенный сокет (см. staleTimer) мог ожить — его события уже не наши.
        if (current !== socket) return;
        lastMessageAt = Date.now();
        // Бэкофф сбрасываем по первому сообщению, а не по open: сокет, который
        // сервер закрывает сразу после рукопожатия (4003), иначе долбил бы раз
        // в секунду бесконечно.
        attempt = 0;
        try {
          onMessageRef.current(JSON.parse(event.data) as ServerRoomMessage);
        } catch {
          // игнорируем нераспознанные сообщения
        }
      };
      current.onclose = (event) => {
        if (stopped || current !== socket) return;
        lastCloseCode = event.code;
        if (report) {
          track("websocket_disconnected", {
            channel: "room",
            lessonId,
            closeCode: event.code,
            wasClean: event.wasClean,
            opened: openedAt > 0,
            connectedMs: openedAt > 0 ? Date.now() - openedAt : null,
            online: navigator.onLine,
          });
        }
        if (event.code === REMOVED_CLOSE_CODE) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        const delay =
          event.code === SUPERSEDED_CLOSE_CODE ? MAX_BACKOFF_MS : Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        if (report) track("websocket_reconnect", { channel: "room", lessonId, attempt: connects, delayMs: delay, closeCode: event.code });
        // Гостя удалили или перевыпустили ссылку, пока его соединение было
        // разорвано, — сообщение об этом он не получил, а сокет теперь
        // отвергается кодом 4001. Без повторного /join он переподключался
        // бесконечно под оверлеем «Связь прервалась»; /join вернёт 403 и
        // покажет экран «Вас удалили из урока».
        const shouldRejoin =
          event.code === NOT_JOINED_CLOSE_CODE || (event.code === INVALID_TOKEN_CLOSE_CODE && mode === "guest");
        const rejoin =
          shouldRejoin && onNotJoinedRef.current
            ? onNotJoinedRef.current().catch(() => undefined)
            : Promise.resolve();
        void rejoin.then(() => {
          if (!stopped) reconnectTimer = setTimeout(connect, delay);
        });
      };
    };

    void connect();

    // Пульса нет дольше STALE_AFTER_MS — бросаем сокет и подключаемся заново.
    // Закрытие мёртвого сокета само `onclose` может не дать долго (рукопожатие
    // закрытия ждёт тот же зависший TCP), поэтому переподключаемся сразу.
    const staleTimer = setInterval(() => {
      const current = socket;
      if (stopped || !current) return;
      const connectTimeout = Math.min(CONNECT_TIMEOUT_MS * 2 ** connectTimeouts, CONNECT_TIMEOUT_MAX_MS);
      const connectStuck =
        current.readyState === WebSocket.CONNECTING && Date.now() - connectingSince >= connectTimeout;
      const stale =
        connectStuck || (current.readyState === WebSocket.OPEN && Date.now() - lastMessageAt >= STALE_AFTER_MS);
      if (!stale) return;
      if (connectStuck) connectTimeouts += 1;
      socket = null;
      current.close(4000, "stale");
      if (report) {
        track("websocket_disconnected", {
          channel: "room",
          lessonId,
          closeCode: 4000,
          wasClean: false,
          opened: openedAt > 0,
          connectedMs: openedAt > 0 ? Date.now() - openedAt : null,
          online: navigator.onLine,
        });
      }
      setStatus("reconnecting");
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 0);
    }, STALE_CHECK_MS);

    const onOffline = () => {
      wentOffline = true;
    };
    const onOnline = () => {
      const offlineBefore = wentOffline;
      wentOffline = false;
      if (stopped || Date.now() - lastOnlineRetryAt < ONLINE_RETRY_MIN_GAP_MS) return;
      // Вытеснены другой вкладкой — ждём, как и раньше, иначе вкладки выбивают друг друга.
      if (lastCloseCode === SUPERSEDED_CLOSE_CODE && !socket) return;
      const current = socket;
      const waiting = !current || current.readyState === WebSocket.CLOSED || current.readyState === WebSocket.CLOSING;
      // Сокет «открыт», но сеть пропадала, а сообщений давно не было, — TCP,
      // скорее всего, уже мёртв; не ждём 50 с тишины.
      const suspect =
        offlineBefore && current?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > STALE_CHECK_MS;
      if (!waiting && !suspect) return;
      lastOnlineRetryAt = Date.now();
      if (suspect && current) {
        socket = null;
        current.close(4000, "online");
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      attempt = 0;
      setStatus("reconnecting");
      reconnectTimer = setTimeout(connect, 0);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      clearInterval(staleTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [lessonId, enabled, mode, recorderToken]);

  return status;
}
