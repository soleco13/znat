import { useEffect, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track, VideoPresets, type VideoResolution } from "livekit-client";

/**
 * Кнопка «камера» — источник CAMERA в LiveKit-гранте разрешён учителю/админу
 * всегда ролью (Э5.1) либо ученику отдельным правом `canPublishVideo`,
 * выданным учителем (Э6.1, см. `media/service.ts#buildPublishGrant`). Сама
 * кнопка одна и та же для обеих ролей — публикация трека ручная, как и
 * микрофон (`SelfMicButton`): автозапуск камеры без разрешения браузера или
 * при отсутствии вебкамеры не должен ронять подключение к уроку.
 *
 * Это и есть «одна кнопка», которой учитель прячется (результат Э5.3, §
 * ПЛАН.md): выключение трека убирает плитку у всех сразу (`TeacherVideoTile`
 * реагирует на отсутствие трека), отдельного переключателя «режим «только
 * доска»» не заводили — второй выключатель того же состояния только
 * запутал бы. Подпись явно называет доску, а не просто «камеру», чтобы
 * назначение кнопки было понятно без чтения ТЗ.
 *
 * `maxResolution` передаётся вызывающей стороной (`RoomPage.tsx`, знает
 * `isTeacher`), а не решается внутри кнопки — учителю 720p (Э5.1), ученику
 * максимум 360p (§5.2 ТЗ, Э6.1). Грант на сервере это не ограничивает
 * (`buildPublishGrant`), резолюция — целиком клиентская настройка.
 */
export function SelfCameraButton({ maxResolution = VideoPresets.h720.resolution }: { maxResolution?: VideoResolution }) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  return (
    <button
      onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled, { resolution: maxResolution })}
      className={`rounded border px-3 py-1 text-sm ${isCameraEnabled ? "" : "border-red-300 text-red-700"}`}
    >
      {isCameraEnabled ? "Скрыть видео (только доска)" : "Показать видео"}
    </button>
  );
}

/** Э5.5, ПЛАН.md — тот же порог формы, что `PacketLossWarning` для аудио (Э2.8), но для видео. */
const VIDEO_PACKET_LOSS_WARNING_RATIO = 0.05;
const POLL_MS = 2000;

/**
 * Деградация при плохом канале (Э5.5): «урок не разваливается на плохом
 * канале» — если исходящее видео учителя теряет больше 5% пакетов,
 * предлагаем выключить его одной кнопкой, а не просто мигать индикатором,
 * который легко пропустить в разгар урока. Видео жертвуется первым, аудио —
 * последним: доска и голос важнее картинки с камеры (§1.2 ТЗ, приоритет
 * связности урока над всем остальным).
 *
 * `LocalVideoTrack.getSenderStats()` отдаёт МАССИВ — по записи на каждый
 * слой simulcast (720/360/180, Э5.1), не одно число, как у аудио
 * (`LocalAudioTrack.getSenderStats()` в `PacketLossWarning`, Э2.8) —
 * проверено чтением `room/stats.d.ts` установленного `livekit-client@2.22.0`.
 * Складываем `packetsSent`/`packetsLost` по всем слоям — общая потеря на
 * пути публикации, а не потеря отдельного слоя.
 */
export function VideoDegradeSuggestion() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const [lossRatio, setLossRatio] = useState<number | null>(null);

  useEffect(() => {
    if (!isCameraEnabled) {
      setLossRatio(null);
      return;
    }
    let cancelled = false;

    async function poll() {
      const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
      const layers = await track?.getSenderStats();
      if (cancelled || !layers || layers.length === 0) return;
      let packetsSent = 0;
      let packetsLost = 0;
      for (const layer of layers) {
        packetsSent += layer.packetsSent ?? 0;
        packetsLost += layer.packetsLost ?? 0;
      }
      const total = packetsSent + packetsLost;
      // Та же защита от шумной ранней выборки, что в `PacketLossWarning`.
      setLossRatio(total >= 50 ? packetsLost / total : null);
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [localParticipant, isCameraEnabled]);

  if (lossRatio === null || lossRatio <= VIDEO_PACKET_LOSS_WARNING_RATIO) return null;

  return (
    <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
      <span>⚠️ Плохой канал (потери видео {Math.round(lossRatio * 100)}%) — видео может мешать звуку урока.</span>
      <button
        onClick={() => localParticipant.setCameraEnabled(false)}
        className="shrink-0 rounded border border-red-400 px-2 py-0.5"
      >
        Выключить видео
      </button>
    </div>
  );
}
