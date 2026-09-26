import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  type LocalParticipant,
  type ReconnectPolicy,
  type RoomConnectOptions,
} from "livekit-client";
import type { JoinLessonResponse } from "@school/shared";

import { apiFetch } from "@/shared/api-client";

/**
 * Медиа на плохой связи. Штатно LiveKit ждёт подключения 15 с с одним
 * повтором и переподключается ~45 с, а новое TCP+TLS-соединение на мобильной
 * сети с потерями само идёт 10–20 с. Даём больше времени и попыток.
 */
const RECONNECT_WINDOW_MS = 5 * 60_000;
const RECONNECT_MAX_DELAY_MS = 7000;
export const MEDIA_RECONNECT_POLICY: ReconnectPolicy = {
  nextRetryDelayInMs: ({ retryCount, elapsedMs }) =>
    elapsedMs > RECONNECT_WINDOW_MS ? null : Math.min(300 * 2 ** retryCount, RECONNECT_MAX_DELAY_MS),
};
export const MEDIA_CONNECT_OPTIONS: RoomConnectOptions = {
  // Э6.2, §5.2 ТЗ: автоподписка выключена намеренно — подпиской управляет
  // `VideoSubscriptionManager`, единственное место.
  autoSubscribe: false,
  maxRetries: 3,
  websocketTimeout: 30_000,
  peerConnectionTimeout: 30_000,
};

/** Причины отключения, после которых заново подключаться НЕ надо — это не сеть. */
const FINAL_DISCONNECT_REASONS = new Set<DisconnectReason>([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.ROOM_CLOSED,
]);
const CHECK_MS = 5000;
const RETRY_MAX_MS = 30_000;

/**
 * Если LiveKit так и не подключился или исчерпал переподключения —
 * подключаем ТУ ЖЕ комнату заново со свежим пропуском (/join) и возвращаем
 * камеру и микрофон, если они были включены.
 *
 * Прежняя версия (2026-09-26) пересоздавала `LiveKitRoom` на любую ошибку,
 * в том числе пока LiveKit сам восстанавливал соединение: сервер выкидывал
 * старую сессию (`DUPLICATE_IDENTITY`), а новая поднималась без камеры и
 * микрофона — у ученика пропадали видео и звук. Теперь: только когда
 * комната действительно в состоянии `Disconnected`, и без второй комнаты.
 */
export function MediaRecovery({
  lessonId,
  restoreCamera,
  onRejoined,
  onBlocked,
}: {
  lessonId: string;
  restoreCamera: (participant: LocalParticipant) => Promise<unknown>;
  onRejoined: (data: JoinLessonResponse) => void;
  /** Ошибка /join, после которой пробовать бессмысленно (удалён, урок закрыт). `true` — перестать. */
  onBlocked: (err: unknown) => boolean;
}) {
  const room = useRoomContext();
  const callbacks = useRef({ restoreCamera, onRejoined, onBlocked });
  callbacks.current = { restoreCamera, onRejoined, onBlocked };

  useEffect(() => {
    let wanted = { camera: false, microphone: false };
    let finished = false;
    let busy = false;
    let attempt = 0;
    let nextTryAt = 0;

    // Что было включено, пока связь была: при обрыве публикации уже сняты.
    const remember = () => {
      if (room.state !== ConnectionState.Connected) return;
      wanted = {
        camera: room.localParticipant.isCameraEnabled,
        microphone: room.localParticipant.isMicrophoneEnabled,
      };
    };

    const recover = async () => {
      if (finished || busy || room.state !== ConnectionState.Disconnected || Date.now() < nextTryAt) return;
      busy = true;
      try {
        const data = await apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" });
        if (finished || room.state !== ConnectionState.Disconnected) return;
        callbacks.current.onRejoined(data);
        await room.connect(data.media.url, data.media.token, MEDIA_CONNECT_OPTIONS);
        attempt = 0;
        if (wanted.microphone) await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
        if (wanted.camera) await callbacks.current.restoreCamera(room.localParticipant).catch(() => undefined);
      } catch (err) {
        if (callbacks.current.onBlocked(err)) {
          finished = true;
          return;
        }
        nextTryAt = Date.now() + Math.min(3000 * 2 ** attempt, RETRY_MAX_MS);
        attempt += 1;
      } finally {
        busy = false;
      }
    };

    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason !== undefined && FINAL_DISCONNECT_REASONS.has(reason)) finished = true;
    };

    room.on(RoomEvent.Reconnecting, remember);
    room.on(RoomEvent.LocalTrackPublished, remember);
    room.on(RoomEvent.LocalTrackUnpublished, remember);
    room.on(RoomEvent.Disconnected, onDisconnected);
    // Раз в несколько секунд: запоминаем включённое и, если комната в
    // `Disconnected` (первое подключение не удалось или переподключения
    // исчерпаны), подключаем заново. Пока идёт подключение или LiveKit
    // переподключается сам, состояние другое — не вмешиваемся.
    const interval = setInterval(() => {
      remember();
      void recover();
    }, CHECK_MS);
    return () => {
      finished = true;
      clearInterval(interval);
      room.off(RoomEvent.Reconnecting, remember);
      room.off(RoomEvent.LocalTrackPublished, remember);
      room.off(RoomEvent.LocalTrackUnpublished, remember);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, lessonId]);

  return null;
}
