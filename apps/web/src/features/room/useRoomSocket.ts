import { useEffect, useRef, useState } from "react";
import type { ServerRoomMessage } from "@school/shared";
import { getFreshAccessToken } from "../../shared/api-client.js";

export type SocketStatus = "connecting" | "connected" | "reconnecting" | "closed";

const MAX_BACKOFF_MS = 16_000;
/** Сервер закрывает так сокет участника, которого нет в комнате (`rooms/ws.ts`). */
const NOT_JOINED_CLOSE_CODE = 4003;
/** Учитель удалил участника из урока — переподключаться незачем. */
const REMOVED_CLOSE_CODE = 4005;

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
    let stopped = false;

    const connect = async () => {
      let tokenParam = "";
      if (mode === "staff") {
        const token = await getFreshAccessToken().catch(() => null);
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
      const url = `${protocol}//${location.host}/ws?lessonId=${encodeURIComponent(lessonId)}${tokenParam}`;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      socket = new WebSocket(url);

      socket.onopen = () => {
        setStatus("connected");
      };
      socket.onmessage = (event) => {
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
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === REMOVED_CLOSE_CODE) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        const rejoin =
          event.code === NOT_JOINED_CLOSE_CODE && onNotJoinedRef.current
            ? onNotJoinedRef.current().catch(() => undefined)
            : Promise.resolve();
        void rejoin.then(() => {
          if (!stopped) reconnectTimer = setTimeout(connect, delay);
        });
      };
    };

    void connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [lessonId, enabled, mode, recorderToken]);

  return status;
}
