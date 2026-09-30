import { useEffect, useReducer } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, type TrackPublication } from "livekit-client";

/**
 * Перерисовка при смене состояния потока (`TrackStreamStateChanged`):
 * когда входящему каналу не хватает полосы, сервер ставит видео на паузу, а
 * плитка без этого оставалась бы тёмной «синей» — без лоадера.
 */
export function useStreamStateUpdates(): void {
  const room = useRoomContext();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    room.on(RoomEvent.TrackStreamStateChanged, bump);
    return () => {
      room.off(RoomEvent.TrackStreamStateChanged, bump);
    };
  }, [room]);
}

/** Сервер держит этот входящий поток на паузе (не хватает канала). */
export function isStreamPaused(publication: TrackPublication | undefined): boolean {
  return publication?.track?.streamState === Track.StreamState.Paused;
}
