import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, type LocalParticipant } from "livekit-client";

/**
 * Урок 2026-10-09: учитель остановил демонстрацию в 10:13:04, пока его
 * соединение переподключалось (`RR_PUBLISHER_FAILED` в 10:12:53). Снятие
 * трека упало, ошибка была проглочена — трек провисел на сервере пять
 * минут, до выхода учителя, а повторный запуск демонстрации не прошёл.
 *
 * Теперь остановка: захват экрана гасится сразу (браузер перестаёт
 * снимать и кодировать экран, значок «идёт демонстрация» пропадает), снятие
 * публикации — с пределом по времени, а не удалось — дочищается, как только
 * соединение снова в порядке (`ScreenShareStopSweep`).
 */
let stopPending = false;

const UNPUBLISH_TIMEOUT_MS = 6_000;
const SWEEP_MS = 5_000;

async function unpublishWithin(localParticipant: LocalParticipant, ms: number): Promise<void> {
  const track = localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!track) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      localParticipant.unpublishTrack(track, true),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("unpublish timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Остановить свою демонстрацию. Не бросает: недоснятый трек дочистит `ScreenShareStopSweep`. */
export async function stopOwnScreenShare(localParticipant: LocalParticipant): Promise<void> {
  const track = localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!track) return;
  stopPending = true;
  track.stop();
  await unpublishWithin(localParticipant, UNPUBLISH_TIMEOUT_MS).catch(() => undefined);
  if (!localParticipant.getTrackPublication(Track.Source.ScreenShare)) stopPending = false;
}

/** Перед новой демонстрацией: недоснятая прежняя не должна мешать публикации. */
export async function clearStaleScreenShare(localParticipant: LocalParticipant): Promise<void> {
  if (stopPending || localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack.readyState === "ended") {
    await stopOwnScreenShare(localParticipant);
  }
  stopPending = false;
}

/** Дочистка остановленной, но не снятой демонстрации — после переподключения и раз в 5 с. */
export function ScreenShareStopSweep() {
  const room = useRoomContext();
  useEffect(() => {
    let running = false;
    const sweep = async () => {
      if (!stopPending || running || room.state !== ConnectionState.Connected) return;
      const lp = room.localParticipant;
      if (!lp.getTrackPublication(Track.Source.ScreenShare)) {
        stopPending = false;
        return;
      }
      running = true;
      try {
        await unpublishWithin(lp, UNPUBLISH_TIMEOUT_MS);
        if (!lp.getTrackPublication(Track.Source.ScreenShare)) stopPending = false;
      } catch {
        // следующий тик
      } finally {
        running = false;
      }
    };
    const onReconnected = () => void sweep();
    room.on(RoomEvent.Reconnected, onReconnected);
    const timer = setInterval(() => void sweep(), SWEEP_MS);
    return () => {
      room.off(RoomEvent.Reconnected, onReconnected);
      clearInterval(timer);
    };
  }, [room]);
  return null;
}
