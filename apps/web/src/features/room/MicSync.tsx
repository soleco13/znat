import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";

/**
 * Реакция локального микрофона на изменение права `canSpeak` уже
 * подключённого участника (Э2.5). Пропс `audio` у `<LiveKitRoom>`
 * применяется только при (пере)подключении (`SignalConnected`), поэтому
 * отзыв/выдачу права после входа нужно обработать явно. Должен
 * рендериться только внутри `<LiveKitRoom>`.
 *
 * ВАЖНО: право ЗАБРАЛИ → глушим немедленно. Право ДАЛИ → просто
 * разрешаем, но микрофон за человека НЕ включаем — иначе каждый ученик с
 * `studentsCanSpeak` входил бы в урок с горячим микрофоном, да и учитель,
 * снявший галку на экране проверки, всё равно оказывался бы включённым.
 * Начальное состояние микрофона задаёт выбор на экране проверки
 * (`joinMicEnabled` → проп `audio` у `<LiveKitRoom>`).
 */
export function MicSync({ enabled }: { enabled: boolean }) {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!enabled) localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
  }, [enabled, localParticipant]);

  return null;
}
