import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, DisconnectReason, RoomEvent } from "livekit-client";
import { errorFields, track } from "../../shared/telemetry.js";

/**
 * События медиасоединения урока — в серверный лог (shared/telemetry.ts).
 * identity = participantId из livekit_token_created на сервере, комната —
 * имя LiveKit-комнаты: строки сводятся с логами LiveKit-сервера и вебхуками.
 * Ничего не показывает и на урок не влияет.
 */
export function MediaTelemetry({ lessonId }: { lessonId: string }) {
  const room = useRoomContext();

  useEffect(() => {
    let attempt = 0;
    let connectingSince = 0;
    let reconnectingSince = 0;
    const base = () => ({
      lessonId,
      livekitRoom: room.name || null,
      identity: room.localParticipant.identity || null,
      online: navigator.onLine,
    });

    const onState = (state: ConnectionState) => {
      if (state === ConnectionState.Connecting) {
        connectingSince = Date.now();
        track("livekit_connection_started", { ...base(), attempt });
        attempt += 1;
      } else if (state === ConnectionState.Connected && connectingSince > 0) {
        track("livekit_connected", { ...base(), durationMs: Date.now() - connectingSince });
        connectingSince = 0;
      }
    };
    const onReconnecting = (kind: "media" | "signal") => () => {
      if (reconnectingSince === 0) reconnectingSince = Date.now();
      track("livekit_reconnecting", { ...base(), kind });
    };
    const onMediaReconnecting = onReconnecting("media");
    const onSignalReconnecting = onReconnecting("signal");
    const onReconnected = () => {
      track("livekit_reconnected", { ...base(), durationMs: reconnectingSince ? Date.now() - reconnectingSince : null });
      reconnectingSince = 0;
    };
    const onDisconnected = (reason?: DisconnectReason) => {
      track("livekit_disconnected", {
        ...base(),
        reason: reason === undefined ? null : (DisconnectReason[reason] ?? String(reason)),
      });
      reconnectingSince = 0;
    };
    const onDevicesError = (err: Error) => {
      track("client_error", { ...base(), area: "media_devices", ...errorFields(err) });
    };

    room.on(RoomEvent.ConnectionStateChanged, onState);
    room.on(RoomEvent.Reconnecting, onMediaReconnecting);
    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.MediaDevicesError, onDevicesError);
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onState);
      room.off(RoomEvent.Reconnecting, onMediaReconnecting);
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.MediaDevicesError, onDevicesError);
    };
  }, [room, lessonId]);

  return null;
}

/** Подключение к LiveKit не удалось (onError у `<LiveKitRoom>`, повтор в MediaRecovery). */
export function reportLiveKitConnectionFailed(lessonId: string, err: unknown, stage: "initial" | "recover"): void {
  track("livekit_connection_failed", { lessonId, stage, online: navigator.onLine, ...errorFields(err) });
}
