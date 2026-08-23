import { useEffect, useRef, useState } from "react";
import type { ServerRoomMessage } from "@school/shared";
import { useAuthStore } from "../../shared/auth-store.js";

export type SocketStatus = "connecting" | "connected" | "reconnecting" | "closed";

const MAX_BACKOFF_MS = 16_000;

/**
 * WS-канал комнаты урока: только пуш от сервера, переподключение с экспоненциальным
 * бэкоффом. `enabled=false` держит канал закрытым — используется, пока ученик проходит
 * экран проверки устройств (Э2.4) и ещё не вошёл в урок.
 */
export function useRoomSocket(lessonId: string, onMessage: (message: ServerRoomMessage) => void, enabled = true) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        setStatus("reconnecting");
        reconnectTimer = setTimeout(connect, 1000);
        return;
      }
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws?lessonId=${encodeURIComponent(lessonId)}&token=${encodeURIComponent(token)}`;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        setStatus("connected");
      };
      socket.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data) as ServerRoomMessage);
        } catch {
          // игнорируем нераспознанные сообщения
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [lessonId, enabled]);

  return status;
}
