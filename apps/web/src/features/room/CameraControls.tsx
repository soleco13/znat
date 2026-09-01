import { useLocalParticipant } from "@livekit/components-react";
import { VideoPresets } from "livekit-client";

/**
 * Кнопка «камера учителя» (Э5.1) — источник CAMERA в LiveKit-гранте
 * учителя разрешён всегда (роль, не переключаемое право, см.
 * `media/service.ts#buildPublishGrant`), но публикация трека остаётся
 * ручной, как и микрофон (`SelfMicButton`) — автозапуск камеры на входе
 * без разрешения браузера или при отсутствии вебкамеры не должен ронять
 * подключение к уроку.
 *
 * Это и есть «одна кнопка», которой учитель прячется (результат Э5.3, §
 * ПЛАН.md): выключение трека убирает плитку у всех сразу (`TeacherVideoTile`
 * реагирует на отсутствие трека), отдельного переключателя «режим «только
 * доска»» не заводили — второй выключатель того же состояния только
 * запутал бы. Подпись явно называет доску, а не просто «камеру», чтобы
 * назначение кнопки было понятно без чтения ТЗ.
 */
export function SelfCameraButton() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  return (
    <button
      onClick={() =>
        localParticipant.setCameraEnabled(!isCameraEnabled, { resolution: VideoPresets.h720.resolution })
      }
      className={`rounded border px-3 py-1 text-sm ${isCameraEnabled ? "" : "border-red-300 text-red-700"}`}
    >
      {isCameraEnabled ? "Скрыть видео (только доска)" : "Показать видео"}
    </button>
  );
}
