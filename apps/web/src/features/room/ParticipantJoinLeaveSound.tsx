import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { playParticipantSound } from "./participant-sound.js";

/**
 * Звук входа/выхода участника (не self — `ParticipantConnected`/
 * `ParticipantDisconnected` у LiveKit по определению относятся только к
 * удалённым участникам, локальный участник узнаёт о своём входе через
 * `RoomEvent.Connected`, отдельно не звучит).
 *
 * Событие для участников, уже бывших в комнате на момент подключения,
 * LiveKit не эмитит (`emitWhenConnected` в клиенте срабатывает только при
 * `state === Connected`, а `applyJoinResponse` заполняет список участников
 * раньше — см. комментарий "these should not trigger new events" в
 * `livekit-client`), поэтому при входе в урок с уже сидящими там людьми
 * шквала звуков не будет.
 *
 * Должен рендериться только внутри `<LiveKitRoom>`.
 */
export function ParticipantJoinLeaveSound() {
  const room = useRoomContext();

  useEffect(() => {
    const onConnected = () => playParticipantSound("joined");
    const onDisconnected = () => playParticipantSound("left");
    room.on(RoomEvent.ParticipantConnected, onConnected);
    room.on(RoomEvent.ParticipantDisconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onConnected);
      room.off(RoomEvent.ParticipantDisconnected, onDisconnected);
    };
  }, [room]);

  return null;
}
