import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";

/**
 * Синхронизирует локальный микрофон LiveKit с правом `canSpeak` (Э2.5).
 * Пропс `audio` у `<LiveKitRoom>` republish'ится только при (пере)подключении
 * (`SignalConnected`), а не при каждом изменении после него — значит когда
 * учитель меняет `canSpeak` уже подключённому участнику, нужно явно дёрнуть
 * `setMicrophoneEnabled()`. Должен рендериться только внутри `<LiveKitRoom>`.
 */
export function MicSync({ enabled }: { enabled: boolean }) {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    localParticipant.setMicrophoneEnabled(enabled).catch(() => undefined);
  }, [enabled, localParticipant]);

  return null;
}
